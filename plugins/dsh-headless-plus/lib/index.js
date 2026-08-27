import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import z from "@deepseek-ai/schemastery";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";

/**
 * dsh-headless-plus runner: the stock one-shot direct Agent driver plus
 * Claude Code-style resume and per-run model override.
 *
 * Differences from the stock runner:
 * - `--resume <id|latest>` / `--continue` reattach to a persisted session via
 *   the public `ctx.agents.resume()` seam instead of always creating fresh.
 * - `--model provider/model` overrides the default-model selection for this
 *   run only (nothing is written to settings).
 * - `--session-info` prints the session id to stderr so shell scripts can
 *   chain runs (`SESSION=$(dsh ... --session-info 2>&1 >/dev/null | …)`).
 *
 * @module dsh-headless-plus
 */

/** Stable Cordis plugin name. */
export const name = "headless-plus-runner";

/** Core services required before the one-shot turn can start. */
export const inject = ["agentDefaultModel", "agents", "sessions", "headlessPlusStartup"];

export const Config = z.object({ task: z.string().required() });

/** The process streams the runner writes to; tests substitute captures. */
export const internals = { stdout: process.stdout, stderr: process.stderr };

/**
 * Workspace project key, mirroring dsh-session-persistence-jsonl's projectKey:
 * separators (/\:) collapse runs to a single '-', chars outside [A-Za-z0-9._-]
 * (except ~) become ~XXXX hex escapes, leading dashes stripped, capped 251,
 * wrapped in '--'. Lossy by design.
 * @param {string} cwd
 * @returns {string}
 */
export function workspaceSlug(cwd) {
  if (cwd.length === 0) throw new Error("cannot encode an empty project path");
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

/**
 * Resolve "latest" to the newest persisted session id for a workspace dir.
 * mtime of the session directory decides recency.
 * @param {string} sessionsRoot - $DSH_HOME/sessions
 * @param {string} cwd - the working directory whose workspace folder to read
 * @returns {string | undefined} the session id (directory name), or undefined
 */
export function resolveLatestSession(sessionsRoot, cwd) {
  const ws = join(sessionsRoot, workspaceSlug(cwd));
  let entries;
  try {
    entries = readdirSync(ws, { withFileTypes: true });
  } catch {
    return undefined;
  }
  let best;
  let bestMtime = -1;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("session-")) continue;
    let mtime;
    try {
      mtime = statSyncSafe(join(ws, entry.name));
    } catch {
      continue;
    }
    if (mtime > bestMtime) {
      bestMtime = mtime;
      best = entry.name;
    }
  }
  return best;
}

import { statSync } from "node:fs";
function statSyncSafe(p) {
  return statSync(p).mtimeMs;
}

/** Aggregate the last assistant text and turn outcome in one owned interval. (stock) */
export function summarize(events, firstSeq) {
  let started = false;
  let text = "";
  let reason;
  for (const event of events) {
    if (event.seq < firstSeq) continue;
    if (event.type === "turn/start") {
      started = true;
      continue;
    }
    if (!started) continue;
    if (event.type === "assistant/message") {
      const joined = event.data.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      if (joined !== "") text = joined;
    }
    if (event.type === "turn/end") reason = event.data.reason;
  }
  return { text, reason };
}

/** Report an unexpected direct-driver failure and request a failing exit. (stock) */
function fail(io, error) {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`);
  io.exit(1);
}

/**
 * Session id resolution shared by create and resume paths.
 * @param {object} startup - {task, model, resume, sessionInfo}
 * @param {string} sessionsRoot
 * @param {string} cwd
 * @returns {{resumeSessionId?: string}} — resumeSessionId present means resume
 */
export function resolveSessionTarget(startup, sessionsRoot, cwd) {
  if (startup.resume === undefined) return {};
  if (startup.resume === "latest") {
    const latest = resolveLatestSession(sessionsRoot, cwd);
    if (latest === undefined) {
      throw new Error(
        `--resume latest: no persisted session found for this workspace (${workspaceSlug(cwd)}). Run without --resume first.`,
      );
    }
    return { resumeSessionId: SessionId(latest) };
  }
  return { resumeSessionId: SessionId(startup.resume) };
}

/**
 * Run one task on a fresh or resumed Agent and request process exit.
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {object} startup - values from the startup provider
 * @param {object} io - {stdout, stderr, exit}
 */
export async function run(ctx, startup, io) {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return;

  const sessionsRoot = process.env.DSH_SESSIONS_ROOT ?? join(homedir(), ".dsh", "sessions");
  const target = resolveSessionTarget(startup, sessionsRoot, process.cwd());

  const selection = startup.model ?? defaultModel.currentSelection();

  const setup = (agentCtx) => {
    installModelSelection(agentCtx, { current: selection, assembled: undefined });
  };

  const { agent } = target.resumeSessionId
    ? await agents.resume({ resumeSessionId: target.resumeSessionId, setup })
    : await agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: process.cwd() },
        agentOptions: { provider: selection.provider, model: selection.model },
        setup,
      });

  await agent.whenIdle();
  const firstSeq = agent.session.seq;
  agent.followup(
    createUserMessage({
      content: [{ type: "text", text: startup.task }],
      source: { kind: "user" },
    }),
  );
  await agent.whenIdle();
  await sessions.flush(agent.session);
  const outcome = summarize(agent.session.events, firstSeq);
  io.stdout.write(outcome.text + "\n");
  if (startup.sessionInfo) io.stderr.write(`session: ${agent.session.id}\n`);
  if (outcome.reason?.kind === "error")
    io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`);
  io.exit(outcome.reason?.kind === "completed" ? 0 : 1);
}

/**
 * Mount the extended one-shot direct driver.
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {{task: string}} config - validated task config (from the injected startup).
 */
export function apply(ctx, config) {
  const exit = ctx.get("appExit");
  if (exit === undefined)
    throw new Error("headless-plus-runner: the launcher must provide ctx.appExit before the tree mounts");
  const io = { stdout: internals.stdout, stderr: internals.stderr, exit };
  const startup = ctx.get("headlessPlusStartup") ?? { task: config.task };
  run(ctx, startup, io).catch((error) => fail(io, error));
}
