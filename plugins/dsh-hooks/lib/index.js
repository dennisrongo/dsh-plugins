var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : Symbol.for("Symbol." + name);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __decoratorStart = (base) => [, , , __create(base?.[__knownSymbol("metadata")] ?? null)];
var __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"];
var __expectFn = (fn) => fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn;
var __decoratorContext = (kind, name, done, metadata, fns) => ({ kind: __decoratorStrings[kind], name, metadata, addInitializer: (fn) => done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null)) });
var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
var __runInitializers = (array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++) flags & 1 ? fns[i].call(self) : value = fns[i].call(self, value);
  return value;
};
var __decorateElement = (array, flags, name, decorators, target, extra) => {
  var fn, it, done, ctx, access, k = flags & 7, s = !!(flags & 8), p = !!(flags & 16);
  var j = k > 3 ? array.length + 1 : k ? s ? 1 : 2 : 0, key = __decoratorStrings[k + 5];
  var initializers = k > 3 && (array[j - 1] = []), extraInitializers = array[j] || (array[j] = []);
  var desc = k && (!p && !s && (target = target.prototype), k < 5 && (k > 3 || !p) && __getOwnPropDesc(k < 4 ? target : { get [name]() {
    return __privateGet(this, extra);
  }, set [name](x) {
    return __privateSet(this, extra, x);
  } }, name));
  k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name) : __name(target, name);
  for (var i = decorators.length - 1; i >= 0; i--) {
    ctx = __decoratorContext(k, name, done = {}, array[3], extraInitializers);
    if (k) {
      ctx.static = s, ctx.private = p, access = ctx.access = { has: p ? (x) => __privateIn(target, x) : (x) => name in x };
      if (k ^ 3) access.get = p ? (x) => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get) : (x) => x[name];
      if (k > 2) access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => x[name] = y;
    }
    it = (0, decorators[i])(k ? k < 4 ? p ? extra : desc[key] : k > 4 ? void 0 : { get: desc.get, set: desc.set } : target, ctx), done._ = 1;
    if (k ^ 4 || it === void 0) __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? p ? extra = it : desc[key] = it : target = it);
    else if (typeof it !== "object" || it === null) __typeError("Object expected");
    else __expectFn(fn = it.get) && (desc.get = fn), __expectFn(fn = it.set) && (desc.set = fn), __expectFn(fn = it.init) && initializers.unshift(fn);
  }
  return k || __decoratorMetadata(array, target), desc && __defProp(target, name, desc), p ? k ^ 4 ? extra : desc : target;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// src/index.ts
import { Service } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";

// src/config.ts
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";

// src/types.ts
var HOOK_EVENTS = [
  /** `tools/pre-execute` — allow / deny / ask before a tool dispatches. */
  "PreToolUse",
  /** `tools/post-execute` — accept / block a settled tool result, or add context. */
  "PostToolUse",
  /** `agent/pre-step`, gated to steps that claimed a user-sourced message. */
  "UserPromptSubmit",
  /** `agent/session-start` — fires for startup, resume, clear AND compact. */
  "SessionStart",
  /** `agent/disposed` — observe only; teardown is never delayed on a decision. */
  "SessionEnd",
  /** `agent/turn-stopping` — may steer the agent back into another step. */
  "Stop",
  /** `subagent/end` — observe only. */
  "SubagentStop",
  /** `approval/request` — observe only; the approval waterfall decides. */
  "Notification"
];
var HOOK_EVENT_SET = new Set(HOOK_EVENTS);
var DECIDING_EVENTS = /* @__PURE__ */ new Set([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop"
]);
var DEFAULT_TIMEOUT_SECONDS = 60;
var MAX_TIMEOUT_SECONDS = 600;
var MAX_OUTPUT_BYTES = 256 * 1024;
var RECENT_LIMIT = 200;

// src/config.ts
var DOT_DSH = ".dsh";
var PROJECT_FILE = "hooks.json";
var commandSchema = z.object({
  type: z.union(["command"]).default("command").description("Only `command` exists today."),
  command: z.string().required().description("Shell command line, run through the configured shell."),
  timeout: z.number().min(1).max(MAX_TIMEOUT_SECONDS).default(DEFAULT_TIMEOUT_SECONDS).description("Wall-clock budget in seconds before the process tree is terminated."),
  failClosed: z.boolean().default(false).description(
    "Treat a crash, timeout or unparseable reply as a denial. Off by default so a broken hook cannot brick every tool call."
  )
});
var groupSchema = z.object({
  matcher: z.string().default("").description("Regular expression over the tool name. Empty or `*` matches every tool."),
  hooks: z.array(commandSchema).default([]).description("Commands run in parallel when the matcher hits.")
});
var HooksSettings = z.object({
  enabled: z.boolean().default(true).description("Master switch for every hook in both layers."),
  shell: z.array(z.string()).default([]).description(
    'argv prefix the command line is appended to, e.g. ["bash","-lc"]. Empty picks the platform default: pwsh/powershell on Windows, bash elsewhere.'
  ),
  projectHooks: z.boolean().default(true).description("Also read <workspace>/.dsh/hooks.json. Turn off to trust only your own settings."),
  hooks: z.object(Object.fromEntries(HOOK_EVENTS.map((event) => [event, z.array(groupSchema).default([])]))).default({}).description("Matcher groups per lifecycle point.")
});
function defaultShell() {
  return process.platform === "win32" ? ["pwsh", "-NoProfile", "-NonInteractive", "-Command"] : ["bash", "-lc"];
}
__name(defaultShell, "defaultShell");
function coerceCommand(value) {
  if (!value || typeof value !== "object") return void 0;
  const raw = value;
  if (typeof raw.command !== "string" || raw.command.trim() === "") return void 0;
  if (raw.type !== void 0 && raw.type !== "command") return void 0;
  const timeout = typeof raw.timeout === "number" && Number.isFinite(raw.timeout) && raw.timeout > 0 ? Math.min(raw.timeout, MAX_TIMEOUT_SECONDS) : DEFAULT_TIMEOUT_SECONDS;
  return {
    type: "command",
    command: raw.command,
    timeout,
    failClosed: raw.failClosed === true
  };
}
__name(coerceCommand, "coerceCommand");
function coerceDocument(value) {
  const config = {};
  let dropped = 0;
  if (!value || typeof value !== "object") return { config, dropped };
  for (const [key, raw] of Object.entries(value)) {
    if (!HOOK_EVENT_SET.has(key)) {
      dropped += 1;
      continue;
    }
    if (!Array.isArray(raw)) {
      dropped += 1;
      continue;
    }
    const groups = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        dropped += 1;
        continue;
      }
      const group = entry;
      const hooks = [];
      for (const command of Array.isArray(group.hooks) ? group.hooks : []) {
        const coerced = coerceCommand(command);
        if (coerced === void 0) dropped += 1;
        else hooks.push(coerced);
      }
      if (hooks.length === 0) continue;
      groups.push({
        matcher: typeof group.matcher === "string" ? group.matcher : void 0,
        hooks
      });
    }
    if (groups.length > 0) config[key] = groups;
  }
  return { config, dropped };
}
__name(coerceDocument, "coerceDocument");
var _ProjectHooks = class _ProjectHooks {
  constructor() {
    __publicField(this, "cache", /* @__PURE__ */ new Map());
  }
  /**
   * Read one workspace's project-layer document.
   * @param workspaceDir - absolute workspace directory.
   * @returns the parsed document, or an empty one when absent or unreadable.
   */
  read(workspaceDir) {
    const path = join(workspaceDir, DOT_DSH, PROJECT_FILE);
    let stamp;
    try {
      const stat = statSync(path);
      stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      this.cache.delete(path);
      return { config: {}, dropped: 0, path };
    }
    const cached = this.cache.get(path);
    if (cached?.stamp === stamp) return { config: cached.config, dropped: cached.dropped, path };
    try {
      const { config, dropped } = coerceDocument(JSON.parse(readFileSync(path, "utf8")));
      this.cache.set(path, { stamp, config, dropped });
      return { config, dropped, path };
    } catch (err) {
      console.warn(`[dsh-hooks] ignoring unparseable ${path}:`, err instanceof Error ? err.message : err);
      this.cache.set(path, { stamp, config: {}, dropped: 0 });
      return { config: {}, dropped: 0, path };
    }
  }
  /** Drop every cached parse; used when the plugin is reconfigured. */
  clear() {
    this.cache.clear();
  }
};
__name(_ProjectHooks, "ProjectHooks");
var ProjectHooks = _ProjectHooks;
function resolveHooks(event, user, project, userOrigin, projectOrigin) {
  const out = [];
  for (const [config, source, origin] of [
    [user, "user", userOrigin],
    [project, "project", projectOrigin]
  ]) {
    for (const group of config[event] ?? []) {
      for (const command of group.hooks) {
        out.push({ event, matcher: group.matcher, command, source, origin });
      }
    }
  }
  return out;
}
__name(resolveHooks, "resolveHooks");

// src/matcher.ts
var compiled = /* @__PURE__ */ new Map();
var warned = /* @__PURE__ */ new Set();
function isWildcard(matcher) {
  if (matcher === void 0) return true;
  const trimmed = matcher.trim();
  return trimmed === "" || trimmed === "*";
}
__name(isWildcard, "isWildcard");
function compile(matcher) {
  const cached = compiled.get(matcher);
  if (cached !== void 0) return cached;
  let value;
  try {
    value = new RegExp(matcher);
  } catch {
    value = null;
  }
  compiled.set(matcher, value);
  return value;
}
__name(compile, "compile");
function matchesTool(matcher, toolName) {
  if (isWildcard(matcher)) return true;
  if (toolName === void 0) return false;
  const expression = compile(matcher);
  if (expression === null) {
    if (!warned.has(matcher)) {
      warned.add(matcher);
      console.warn(
        `[dsh-hooks] matcher ${JSON.stringify(matcher)} is not a valid regular expression; it will never match`
      );
    }
    return false;
  }
  return expression.test(toolName);
}
__name(matchesTool, "matchesTool");
function resetMatcherCache() {
  compiled.clear();
  warned.clear();
}
__name(resetMatcherCache, "resetMatcherCache");

// src/runner.ts
var GRACE_MS = 2e3;
function parseHookOutput(stdout) {
  const trimmed = stdout.trim();
  if (trimmed === "" || !trimmed.startsWith("{")) return void 0;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
    return parsed;
  } catch {
    return void 0;
  }
}
__name(parseHookOutput, "parseHookOutput");
function hookEnv(payload, projectDir) {
  return {
    DSH_PROJECT_DIR: projectDir,
    DSH_SESSION_ID: payload.session_id,
    DSH_HOOK_EVENT: payload.hook_event_name,
    // Parity alias so a hook script written against Claude Code runs unchanged.
    CLAUDE_PROJECT_DIR: projectDir
  };
}
__name(hookEnv, "hookEnv");
async function runHook(deps, hook, payload, cwd, outerSignal) {
  const startedAt = Date.now();
  const base = {
    event: hook.event,
    command: hook.command.command,
    source: hook.source,
    sessionId: payload.session_id,
    ...payload.tool_name !== void 0 ? { toolName: payload.tool_name } : {},
    startedAt,
    durationMs: 0,
    exitCode: null,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: ""
  };
  const timeoutMs = (hook.command.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1e3;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = /* @__PURE__ */ __name(() => controller.abort(), "onOuterAbort");
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const handle = deps.subprocess.spawn({
      argv: [...deps.shell, hook.command.command],
      cwd,
      stdio: {
        stdin: { data: JSON.stringify(payload) },
        stdout: { maxBytes: MAX_OUTPUT_BYTES },
        stderr: { maxBytes: MAX_OUTPUT_BYTES }
      },
      graceMs: GRACE_MS,
      signal: controller.signal,
      env: hookEnv(payload, cwd)
    });
    const outcome = await handle.done;
    const stdout = handle.collected.stdout?.readFrom(0).text ?? "";
    const stderr = handle.collected.stderr?.readFrom(0).text ?? "";
    const output = parseHookOutput(stdout);
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut,
      stdout,
      stderr,
      ...output !== void 0 ? { output } : {}
    };
  } catch (err) {
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      timedOut,
      error: err instanceof Error ? err.message : String(err)
    };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}
__name(runHook, "runHook");
function refusalReason(run, hook) {
  if (run.exitCode === 2) {
    return run.stderr.trim() || `hook exited 2: ${hook.command.command}`;
  }
  const failed = run.error !== void 0 || run.timedOut || run.exitCode !== null && run.exitCode !== 0;
  if (!failed) return void 0;
  if (!hook.command.failClosed) return void 0;
  if (run.timedOut) return `hook timed out after ${hook.command.timeout ?? DEFAULT_TIMEOUT_SECONDS}s: ${hook.command.command}`;
  if (run.error !== void 0) return `hook could not run: ${run.error}`;
  return run.stderr.trim() || `hook exited ${run.exitCode}: ${hook.command.command}`;
}
__name(refusalReason, "refusalReason");
function decisionOf(output) {
  const permission = output.hookSpecificOutput?.permissionDecision;
  const permissionReason = output.hookSpecificOutput?.permissionDecisionReason ?? output.reason ?? "";
  if (permission === "deny" || output.decision === "block") {
    return { kind: "deny", reason: (permission === "deny" ? permissionReason : output.reason) || "blocked by hook" };
  }
  if (permission === "ask") return { kind: "ask", reason: permissionReason || "a hook asked for confirmation" };
  if (permission === "allow" || output.decision === "approve") {
    return { kind: "approve", reason: permissionReason || output.reason || "" };
  }
  return void 0;
}
__name(decisionOf, "decisionOf");
async function runHooks(deps, hooks, payload, cwd, signal) {
  const selected = hooks.filter((hook) => matchesTool(hook.matcher, payload.tool_name));
  const verdict = { additionalContext: [], runs: [] };
  if (selected.length === 0) return verdict;
  const settled = await Promise.all(
    selected.map(async (hook) => ({ hook, run: await runHook(deps, hook, payload, cwd, signal) }))
  );
  for (const { hook, run } of settled) {
    verdict.runs.push(run);
    const context = run.output?.hookSpecificOutput?.additionalContext;
    if (typeof context === "string" && context.trim() !== "") verdict.additionalContext.push(context);
    if (run.output?.hookSpecificOutput?.updatedInput !== void 0) {
      console.warn(
        `[dsh-hooks] ${hook.command.command} returned updatedInput, which dsh cannot honour: PreToolDecision is allow/deny/ask only and tool arguments are already logged. Deny the call instead if the arguments are unacceptable.`
      );
    }
    const decision = run.output ? decisionOf(run.output) : void 0;
    if (decision !== void 0 && !DECIDING_EVENTS.has(hook.event)) {
      console.warn(
        `[dsh-hooks] ${hook.command.command} returned a "${decision.kind}" decision on ${hook.event}, which cannot act on one; it was recorded but had no effect.`
      );
    }
    const refusal = refusalReason(run, hook);
    const failed = run.error !== void 0 || run.timedOut || run.exitCode !== null && run.exitCode !== 0;
    if (failed && run.exitCode !== 2) {
      const detail = run.error ?? (run.timedOut ? "timed out" : `exit ${run.exitCode}`);
      const effect = refusal !== void 0 ? "blocking, failClosed" : "non-blocking";
      console.warn(`[dsh-hooks] ${hook.event} hook failed (${effect}): ${hook.command.command} \u2014 ${detail}`);
      if (run.stderr.trim() !== "") console.warn(`[dsh-hooks]   stderr: ${run.stderr.trim()}`);
    }
    if (refusal !== void 0) {
      verdict.denied ??= { reason: refusal };
      continue;
    }
    if (decision === void 0 || !DECIDING_EVENTS.has(hook.event)) continue;
    if (decision.kind === "deny") verdict.denied ??= { reason: decision.reason };
    else if (decision.kind === "ask") verdict.asked ??= { reason: decision.reason };
  }
  return verdict;
}
__name(runHooks, "runHooks");

// src/index.ts
var MAX_STOP_CONTINUATIONS = 5;
var NAMESPACE = "dsh-hooks";
var EMPTY_SETTINGS = {
  enabled: true,
  shell: [],
  projectHooks: true,
  hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, []]))
};
var _recent_dec, _describe_dec, _a, _init, _b;
var _HooksService = class _HooksService extends (_b = TypertRemoteService) {
  /**
   * @param ctx - host context carrying the tool registry and subprocess seam.
   */
  constructor(ctx) {
    super(ctx, "dshHooks");
    __runInitializers(_init, 5, this);
    /** Latest resolved settings-namespace value. */
    __publicField(this, "settings", EMPTY_SETTINGS);
    /**
     * The user layer, coerced once per settings value.
     *
     * `tools/pre-execute` is awaited before EVERY tool dispatch, so anything
     * `hooksFor` does runs on the hot path. Re-coercing the whole settings
     * document there allocated a fresh config object per tool call, for a value
     * that only changes when the user edits settings.yaml.
     */
    __publicField(this, "userConfigCache");
    /** Absolute path of the settings document, when the provider exposes one. */
    __publicField(this, "userOrigin");
    /** Project-layer document reader, cached per workspace against mtime+size. */
    __publicField(this, "project", new ProjectHooks());
    /** Newest-last ring of settled runs, served by `recent`. */
    __publicField(this, "runs", []);
    /** Consecutive hook-driven continuations per agent, bounded by {@link MAX_STOP_CONTINUATIONS}. */
    __publicField(this, "stopDepth", /* @__PURE__ */ new WeakMap());
    /** Working directory captured at `subagent/start`, keyed by run id. */
    __publicField(this, "subagentCwd", /* @__PURE__ */ new Map());
  }
  /** Register the settings namespace, then wire every lifecycle listener. */
  async [(_a = Service.init, _describe_dec = [Remote], _recent_dec = [Remote], _a)]() {
    this.ctx.inject(["settings"], (scoped) => {
      const scope = scoped.settings.register(settingsNamespace(NAMESPACE), HooksSettings, { applies: "live" });
      this.settings = scope.get();
      this.userOrigin = scoped.settings.documentPath;
      scoped.effect(
        () => scope.watch((next) => {
          this.settings = next;
          resetMatcherCache();
          this.project.clear();
          this.userConfigCache = void 0;
        }),
        "dsh-hooks: settings watcher"
      );
    });
    this.wireToolEvents();
    this.wireAgentEvents();
    this.wireObserverEvents();
  }
  // ── configuration ────────────────────────────────────────────────────────
  /**
   * The user layer, coerced from the resolved settings section.
   *
   * Cached against the settings object's identity: the settings service hands
   * out a new resolved value on every commit, so identity is an exact change
   * signal and no revision counter is needed.
   * @returns the coerced user-layer document.
   */
  userConfig() {
    const source = this.settings.hooks;
    if (this.userConfigCache?.source === source) return this.userConfigCache.config;
    const { config } = coerceDocument(source);
    this.userConfigCache = { source, config };
    return config;
  }
  /**
   * Resolve one workspace directory from a session's cwd.
   *
   * The workspace registry is consulted only for the id that rides the payload;
   * the directory itself comes from the session header, so hooks still work in
   * a directory that was never registered as a workspace.
   * @param cwd - the session's working directory.
   * @returns the workspace id, when the cwd matches a registered workspace.
   */
  workspaceIdFor(cwd) {
    if (cwd === void 0) return void 0;
    const registry = this.ctx.get("workspaceRegistry");
    if (registry === void 0) return void 0;
    try {
      const hit = registry.list().find((w) => w.path === cwd);
      return hit === void 0 ? void 0 : String(hit.id);
    } catch {
      return void 0;
    }
  }
  /** The shell argv prefix in force: configured, else the platform default. */
  shell() {
    return this.settings.shell.length > 0 ? this.settings.shell : defaultShell();
  }
  /**
   * Every hook configured for one event, across both layers.
   * @param event - the lifecycle point.
   * @param cwd - the session working directory whose project layer to read.
   * @returns the resolved hooks, or an empty array when hooks are disabled.
   */
  hooksFor(event, cwd) {
    if (!this.settings.enabled) return [];
    const user = this.userConfig();
    let project = {};
    let projectOrigin = "";
    if (this.settings.projectHooks && cwd !== void 0) {
      const read = this.project.read(cwd);
      project = read.config;
      projectOrigin = read.path;
    }
    return resolveHooks(event, user, project, this.userOrigin ?? "(settings)", projectOrigin);
  }
  // ── dispatch ─────────────────────────────────────────────────────────────
  /** The session cwd an agent's hooks run in, falling back to the process cwd. */
  cwdOf(agent) {
    return agent?.session.header.cwd ?? process.cwd();
  }
  /**
   * Build the payload common to every event.
   * @param event - the lifecycle point.
   * @param agent - the agent the event belongs to, when there is one.
   * @returns the base payload, ready for per-event fields.
   */
  basePayload(event, agent) {
    const cwd = this.cwdOf(agent);
    const workspaceId = this.workspaceIdFor(agent?.session.header.cwd);
    return {
      hook_event_name: event,
      session_id: agent === void 0 ? "" : String(agent.id),
      cwd,
      ...workspaceId !== void 0 ? { workspace_id: workspaceId } : {}
    };
  }
  /**
   * Run one event's hooks and record the results.
   *
   * Never throws: a listener that threw would take a tool call or a turn
   * boundary down with it, and a hook runner must not be able to break the
   * harness it observes.
   * @param event - the lifecycle point.
   * @param payload - the JSON handed to each hook.
   * @param cwd - working directory for the children.
   * @param signal - caller cancellation.
   * @returns the folded verdict; an empty one when nothing matched or it failed.
   */
  async dispatch(event, payload, cwd, signal) {
    const hooks = this.hooksFor(event, payload.cwd);
    if (hooks.length === 0) return { additionalContext: [], runs: [] };
    try {
      const verdict = await runHooks(
        { subprocess: this.ctx.subprocess, shell: this.shell() },
        hooks,
        payload,
        cwd,
        signal
      );
      this.record(verdict.runs);
      return verdict;
    } catch (err) {
      console.warn(`[dsh-hooks] ${event} dispatch failed:`, err);
      return { additionalContext: [], runs: [] };
    }
  }
  /** Append settled runs to the ring, trimming from the front. */
  record(runs) {
    this.runs.push(...runs);
    if (this.runs.length > RECENT_LIMIT) this.runs.splice(0, this.runs.length - RECENT_LIMIT);
  }
  /**
   * Turn hook-supplied context into a plugin-sourced user message.
   *
   * `form: 'notice'` is the accurate declaration — a one-off account of
   * something that just happened, superseding nothing — and it is what makes
   * the harness render it as a collapsed row rather than as instructions.
   * @param event - the lifecycle point, used in the collapsed summary.
   * @param text - the hook's `additionalContext`.
   * @returns a frozen user message ready for `inject` / `additionalContexts`.
   */
  contextMessage(event, text) {
    return createUserMessage({
      content: [{ type: "text", text }],
      source: {
        kind: "plugin",
        plugin: NAMESPACE,
        form: "notice",
        summary: `${event} hook context`.slice(0, 120)
      }
    });
  }
  // ── tool lifecycle ───────────────────────────────────────────────────────
  /** `PreToolUse` and `PostToolUse`. */
  wireToolEvents() {
    this.ctx.on(
      "tools/pre-execute",
      async (exec, next) => {
        const payload = {
          ...this.basePayload("PreToolUse", exec.agent),
          tool_name: exec.name,
          tool_input: exec.arguments
        };
        const verdict = await this.dispatch("PreToolUse", payload, payload.cwd, exec.signal);
        if (verdict.denied !== void 0) return { kind: "deny", reason: verdict.denied.reason };
        if (verdict.asked !== void 0) return { kind: "ask", reason: verdict.asked.reason };
        return next();
      }
    );
    this.ctx.on(
      "tools/post-execute",
      async (exec, result, next) => {
        const payload = {
          ...this.basePayload("PostToolUse", exec.agent),
          tool_name: exec.name,
          tool_input: exec.arguments,
          tool_response: result.isError ? { isError: true, error: result.error } : result.value
        };
        const verdict = await this.dispatch("PostToolUse", payload, payload.cwd, exec.signal);
        const contexts = verdict.additionalContext.map((text) => this.contextMessage("PostToolUse", text));
        if (verdict.denied !== void 0) {
          return {
            kind: "block",
            feedback: [{ type: "text", text: verdict.denied.reason }],
            ...contexts.length > 0 ? { additionalContexts: contexts } : {}
          };
        }
        const base = await next();
        if (contexts.length === 0) return base;
        return { ...base, additionalContexts: [...base.additionalContexts ?? [], ...contexts] };
      }
    );
  }
  // ── agent lifecycle ──────────────────────────────────────────────────────
  /** `UserPromptSubmit`, `SessionStart` and `Stop`. */
  wireAgentEvents() {
    this.ctx.on(
      "agent/pre-step",
      async (payload, next) => {
        const prompts = payload.messages.filter((message) => message.source.kind === "user");
        if (prompts.length === 0) return next();
        const text = prompts.flatMap((message) => message.content).filter((block) => block.type === "text").map((block) => block.text).join("\n");
        const hookPayload = { ...this.basePayload("UserPromptSubmit", payload.agent), prompt: text };
        const verdict = await this.dispatch("UserPromptSubmit", hookPayload, hookPayload.cwd, payload.signal);
        if (verdict.denied !== void 0) {
          console.warn(`[dsh-hooks] UserPromptSubmit blocked the step: ${verdict.denied.reason}`);
          return { kind: "reject" };
        }
        if (verdict.additionalContext.length === 0) return next();
        const base = await next();
        if (base.kind === "reject") return base;
        return {
          kind: "enter",
          messages: [
            ...base.messages,
            ...verdict.additionalContext.map((entry) => this.contextMessage("UserPromptSubmit", entry))
          ]
        };
      }
    );
    this.ctx.on("agent/session-start", (payload) => {
      const hookPayload = {
        ...this.basePayload("SessionStart", payload.agent),
        source: payload.source
      };
      void this.dispatch("SessionStart", hookPayload, hookPayload.cwd).then((verdict) => {
        for (const text of verdict.additionalContext) {
          payload.agent.inject(this.contextMessage("SessionStart", text));
        }
      });
    });
    this.ctx.on(
      "agent/turn-stopping",
      async (payload) => {
        const depth = this.stopDepth.get(payload.agent) ?? 0;
        const hookPayload = {
          ...this.basePayload("Stop", payload.agent),
          stop_hook_active: depth > 0
        };
        const verdict = await this.dispatch("Stop", hookPayload, hookPayload.cwd, payload.signal);
        if (verdict.denied === void 0) {
          this.stopDepth.delete(payload.agent);
          return;
        }
        if (depth >= MAX_STOP_CONTINUATIONS) {
          console.warn(
            `[dsh-hooks] Stop hook asked to continue ${depth} times in a row; ignoring to break the loop. A Stop hook must check \`stop_hook_active\` in its payload and stop asking.`
          );
          this.stopDepth.delete(payload.agent);
          return;
        }
        this.stopDepth.set(payload.agent, depth + 1);
        payload.agent.steer(this.contextMessage("Stop", verdict.denied.reason));
      }
    );
  }
  // ── observers ────────────────────────────────────────────────────────────
  /** `SessionEnd`, `SubagentStop` and `Notification` — effect only, no verdict. */
  wireObserverEvents() {
    this.ctx.on("agent/disposed", (payload) => {
      const hookPayload = this.basePayload("SessionEnd", payload.agent);
      void this.dispatch("SessionEnd", hookPayload, hookPayload.cwd);
    });
    this.ctx.on("subagent/start", (info) => {
      const agent = this.ctx.get("agents")?.get(info.id);
      this.subagentCwd.set(String(info.runId), this.cwdOf(agent));
    });
    this.ctx.on("subagent/end", (info) => {
      const runId = String(info.runId);
      const cwd = this.subagentCwd.get(runId) ?? process.cwd();
      this.subagentCwd.delete(runId);
      const workspaceId = this.workspaceIdFor(cwd);
      const payload = {
        hook_event_name: "SubagentStop",
        session_id: String(info.id),
        cwd,
        ...workspaceId !== void 0 ? { workspace_id: workspaceId } : {},
        message: `subagent ${info.provider} stopped: ${info.stopReason}`
      };
      void this.dispatch("SubagentStop", payload, cwd);
    });
    this.ctx.on(
      "approval/request",
      async (req, next) => {
        const payload = {
          ...this.basePayload("Notification", req.agent),
          tool_name: req.toolName,
          message: req.reason ?? `${req.toolName} is waiting for approval`
        };
        void this.dispatch("Notification", payload, payload.cwd, req.signal);
        return next();
      }
    );
  }
  async describe(request) {
    const cwd = this.workspaceDirFor(request?.workspaceId);
    const rows = [];
    let projectOrigin;
    for (const event of HOOK_EVENTS) {
      for (const hook of this.hooksFor(event, cwd)) {
        if (hook.source === "project") projectOrigin = hook.origin;
        rows.push({
          event,
          ...hook.matcher !== void 0 ? { matcher: hook.matcher } : {},
          command: hook.command.command,
          timeout: hook.command.timeout ?? 60,
          failClosed: hook.command.failClosed === true,
          source: hook.source
        });
      }
    }
    return {
      enabled: this.settings.enabled,
      shell: this.shell(),
      ...this.userOrigin !== void 0 ? { userOrigin: this.userOrigin } : {},
      ...projectOrigin !== void 0 ? { projectOrigin } : {},
      hooks: rows
    };
  }
  async recent(request) {
    const limit = Math.min(Math.max(1, request?.limit ?? 50), RECENT_LIMIT);
    return { runs: this.runs.slice(-limit).reverse() };
  }
  /** Resolve a workspace id to its directory, for the endpoints. */
  workspaceDirFor(workspaceId) {
    if (typeof workspaceId !== "string" || workspaceId === "") return void 0;
    const registry = this.ctx.get("workspaceRegistry");
    if (registry === void 0) return void 0;
    const hit = registry.list().find((w) => String(w.id) === workspaceId);
    return hit?.path;
  }
};
_init = __decoratorStart(_b);
__decorateElement(_init, 1, "describe", _describe_dec, _HooksService);
__decorateElement(_init, 1, "recent", _recent_dec, _HooksService);
__decoratorMetadata(_init, _HooksService);
__name(_HooksService, "HooksService");
__publicField(_HooksService, "inject", ["tools", "subprocess"]);
var HooksService = _HooksService;
var index_default = HooksService;
export {
  HOOK_EVENTS,
  HooksService,
  HooksSettings,
  ProjectHooks,
  coerceDocument,
  index_default as default,
  defaultShell,
  hookEnv,
  isWildcard,
  matchesTool,
  parseHookOutput,
  resetMatcherCache,
  resolveHooks,
  runHook,
  runHooks
};
