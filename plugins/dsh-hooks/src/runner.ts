/**
 * Spawning one hook command and turning its exit into a verdict.
 *
 * The contract is Claude Code's, restated here because it is the thing a hook
 * author has to get right:
 *
 *   * The JSON payload arrives on **stdin** and the process is expected to read
 *     it to EOF. dsh's `{ data }` stdin mode writes and closes, so a hook that
 *     never reads still exits cleanly rather than deadlocking.
 *   * **Exit 0** — success. stdout is parsed as JSON when it parses; anything
 *     else is treated as ordinary log output, not as an error.
 *   * **Exit 2** — blocking error. stderr is the reason handed to the model.
 *   * **Any other code** — non-blocking error. It is recorded and logged, and
 *     it only becomes a denial when the entry set `failClosed`.
 *
 * Everything here is defensive about one specific failure: this code runs
 * inside `tools/pre-execute`, which the tool registry awaits before every
 * single dispatch. A hook that hangs would stall the whole session, so the
 * deadline is owned here (never delegated to the hook) and expiry escalates
 * through `SubprocessHandle.terminate`, which is tree-scoped on every platform.
 *
 * @module @dennisrongo/dsh-hooks/runner
 */
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import {
  DEFAULT_TIMEOUT_SECONDS,
  DECIDING_EVENTS,
  MAX_OUTPUT_BYTES,
  type HookOutput,
  type HookPayload,
  type HookRun,
  type HookVerdict,
  type ResolvedHook,
} from './types.ts'
import { matchesTool } from './matcher.ts'

/** Grace period between SIGTERM and SIGKILL when a hook overruns, in millis. */
const GRACE_MS = 2_000

/** What the runner needs from the host, passed explicitly so it stays testable. */
export interface RunnerDeps {
  /** The harness subprocess seam. */
  subprocess: SubprocessRuntime
  /** argv prefix the command line is appended to. */
  shell: readonly string[]
}

/**
 * Parse a hook's stdout, tolerating the common case of no JSON at all.
 *
 * Only a top-level object counts. A bare `true`, a number, or an array is
 * valid JSON but says nothing in this grammar, and reading one as a decision
 * would be inventing intent.
 * @param stdout - captured stdout.
 * @returns the parsed output, or undefined when there is none.
 */
export function parseHookOutput(stdout: string): HookOutput | undefined {
  const trimmed = stdout.trim()
  if (trimmed === '' || !trimmed.startsWith('{')) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as HookOutput
  } catch {
    return undefined
  }
}

/**
 * Environment handed to every hook, layered over the subprocess seam's scrub.
 *
 * These names would otherwise be stripped: `scrubbedParentEnv()` removes all
 * `DSH_*` entries so harness identity cannot leak implicitly. Supplying them
 * through the spec's explicit `env` is the documented opt-in, and it is
 * deliberate — a hook that cannot find its own project directory is useless.
 *
 * `CLAUDE_PROJECT_DIR` is set to the same value on purpose: it is what a hook
 * script ported from Claude Code already reads, and honouring it costs one line.
 * @param payload - the event payload the hook is about to receive.
 * @param projectDir - the resolved project/workspace directory.
 * @returns explicit environment entries for the child.
 */
export function hookEnv(payload: HookPayload, projectDir: string): NodeJS.ProcessEnv {
  return {
    DSH_PROJECT_DIR: projectDir,
    DSH_SESSION_ID: payload.session_id,
    DSH_HOOK_EVENT: payload.hook_event_name,
    // Parity alias so a hook script written against Claude Code runs unchanged.
    CLAUDE_PROJECT_DIR: projectDir,
  }
}

/**
 * Run one hook command to settlement.
 *
 * Never throws: a spawn failure, a timeout and a non-zero exit are all
 * outcomes, recorded on the returned {@link HookRun}. The caller decides what
 * they mean, because only the caller knows whether the entry is fail-closed.
 * @param deps - subprocess seam and shell prefix.
 * @param hook - the configured entry being run.
 * @param payload - the JSON written to stdin.
 * @param cwd - working directory for the child.
 * @param outerSignal - caller cancellation, fused with the deadline.
 * @returns the settled run.
 */
export async function runHook(
  deps: RunnerDeps,
  hook: ResolvedHook,
  payload: HookPayload,
  cwd: string,
  outerSignal?: AbortSignal,
): Promise<HookRun> {
  const startedAt = Date.now()
  const base: HookRun = {
    event: hook.event,
    command: hook.command.command,
    source: hook.source,
    sessionId: payload.session_id,
    ...(payload.tool_name !== undefined ? { toolName: payload.tool_name } : {}),
    startedAt,
    durationMs: 0,
    exitCode: null,
    signal: null,
    timedOut: false,
    stdout: '',
    stderr: '',
  }

  const timeoutMs = (hook.command.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  // The caller's signal must also terminate the child; without this a cancelled
  // tool call would leave the hook running against a session that moved on.
  const onOuterAbort = () => controller.abort()
  outerSignal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
    const handle = deps.subprocess.spawn({
      argv: [...deps.shell, hook.command.command],
      cwd,
      stdio: {
        stdin: { data: JSON.stringify(payload) },
        stdout: { maxBytes: MAX_OUTPUT_BYTES },
        stderr: { maxBytes: MAX_OUTPUT_BYTES },
      },
      graceMs: GRACE_MS,
      signal: controller.signal,
      env: hookEnv(payload, cwd),
    })

    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    const output = parseHookOutput(stdout)
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut,
      stdout,
      stderr,
      ...(output !== undefined ? { output } : {}),
    }
  } catch (err) {
    // `done` rejects only for spawn-level failures — a missing shell, an
    // unreadable cwd. That is not a hook verdict, so it is recorded as an error
    // and left for the caller's fail-open/closed policy.
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      timedOut,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
    outerSignal?.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * Whether one settled run should be read as a refusal.
 *
 * Exit 2 is the protocol's blocking code. Everything else that failed — a
 * crash, a timeout, a spawn error — is a refusal only when the entry opted in
 * to fail-closed.
 * @param run - the settled run.
 * @param hook - the entry it came from.
 * @returns the refusal reason, or undefined.
 */
function refusalReason(run: HookRun, hook: ResolvedHook): string | undefined {
  if (run.exitCode === 2) {
    return run.stderr.trim() || `hook exited 2: ${hook.command.command}`
  }
  const failed = run.error !== undefined || run.timedOut || (run.exitCode !== null && run.exitCode !== 0)
  if (!failed) return undefined
  if (!hook.command.failClosed) return undefined
  if (run.timedOut) return `hook timed out after ${hook.command.timeout ?? DEFAULT_TIMEOUT_SECONDS}s: ${hook.command.command}`
  if (run.error !== undefined) return `hook could not run: ${run.error}`
  return run.stderr.trim() || `hook exited ${run.exitCode}: ${hook.command.command}`
}

/**
 * Read one run's JSON output into the verdict vocabulary.
 *
 * `decision` and `hookSpecificOutput.permissionDecision` are both honoured;
 * where they disagree the more restrictive one wins, because a hook that says
 * `deny` in one field and `approve` in another has a bug and denying is the
 * safe reading of a buggy security hook.
 * @param output - parsed stdout.
 * @returns the decision this hook expressed, if any.
 */
function decisionOf(output: HookOutput): { kind: 'deny' | 'ask' | 'approve'; reason: string } | undefined {
  const permission = output.hookSpecificOutput?.permissionDecision
  const permissionReason = output.hookSpecificOutput?.permissionDecisionReason ?? output.reason ?? ''
  if (permission === 'deny' || output.decision === 'block') {
    return { kind: 'deny', reason: (permission === 'deny' ? permissionReason : output.reason) || 'blocked by hook' }
  }
  if (permission === 'ask') return { kind: 'ask', reason: permissionReason || 'a hook asked for confirmation' }
  if (permission === 'allow' || output.decision === 'approve') {
    return { kind: 'approve', reason: permissionReason || output.reason || '' }
  }
  return undefined
}

/**
 * Run every hook that matches this event and fold the results into one verdict.
 *
 * Hooks run **concurrently**: they are independent commands and the pipeline is
 * already holding a tool call open, so serializing them would multiply the
 * worst case by the number of hooks. Folding is monotonic toward the most
 * restrictive outcome, which is what makes concurrency safe — completion order
 * cannot change the verdict.
 * @param deps - subprocess seam and shell prefix.
 * @param hooks - every configured hook for the event.
 * @param payload - the JSON written to each hook's stdin.
 * @param cwd - working directory for the children.
 * @param signal - caller cancellation.
 * @returns the folded verdict and every run in completion order.
 */
export async function runHooks(
  deps: RunnerDeps,
  hooks: readonly ResolvedHook[],
  payload: HookPayload,
  cwd: string,
  signal?: AbortSignal,
): Promise<HookVerdict> {
  const selected = hooks.filter((hook) => matchesTool(hook.matcher, payload.tool_name))
  const verdict: HookVerdict = { additionalContext: [], runs: [] }
  if (selected.length === 0) return verdict

  const settled = await Promise.all(
    selected.map(async (hook) => ({ hook, run: await runHook(deps, hook, payload, cwd, signal) })),
  )

  for (const { hook, run } of settled) {
    verdict.runs.push(run)

    const context = run.output?.hookSpecificOutput?.additionalContext
    if (typeof context === 'string' && context.trim() !== '') verdict.additionalContext.push(context)

    // Loud about the one Claude Code capability dsh cannot express, rather than
    // letting a hook believe it sanitized an argument that was never changed.
    if (run.output?.hookSpecificOutput?.updatedInput !== undefined) {
      console.warn(
        `[dsh-hooks] ${hook.command.command} returned updatedInput, which dsh cannot honour: ` +
          'PreToolDecision is allow/deny/ask only and tool arguments are already logged. ' +
          'Deny the call instead if the arguments are unacceptable.',
      )
    }

    // A decision on a non-deciding event is a config mistake worth surfacing;
    // silently discarding it is how a "working" hook turns out never to have done anything.
    const decision = run.output ? decisionOf(run.output) : undefined
    if (decision !== undefined && !DECIDING_EVENTS.has(hook.event)) {
      console.warn(
        `[dsh-hooks] ${hook.command.command} returned a "${decision.kind}" decision on ${hook.event}, ` +
          'which cannot act on one; it was recorded but had no effect.',
      )
    }

    const refusal = refusalReason(run, hook)

    // Warn about every failure that is NOT the protocol's own blocking exit —
    // and warn before the refusal short-circuit, or a fail-open hook that
    // crashes (the common case) would produce no verdict and no diagnostic.
    const failed = run.error !== undefined || run.timedOut || (run.exitCode !== null && run.exitCode !== 0)
    if (failed && run.exitCode !== 2) {
      const detail = run.error ?? (run.timedOut ? 'timed out' : `exit ${run.exitCode}`)
      const effect = refusal !== undefined ? 'blocking, failClosed' : 'non-blocking'
      console.warn(`[dsh-hooks] ${hook.event} hook failed (${effect}): ${hook.command.command} — ${detail}`)
      if (run.stderr.trim() !== '') console.warn(`[dsh-hooks]   stderr: ${run.stderr.trim()}`)
    }

    if (refusal !== undefined) {
      verdict.denied ??= { reason: refusal }
      continue
    }
    if (decision === undefined || !DECIDING_EVENTS.has(hook.event)) continue
    if (decision.kind === 'deny') verdict.denied ??= { reason: decision.reason }
    else if (decision.kind === 'ask') verdict.asked ??= { reason: decision.reason }
  }

  return verdict
}
