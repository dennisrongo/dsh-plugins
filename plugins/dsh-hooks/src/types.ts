/**
 * Vocabulary shared by the config loader, the matcher, the runner and the
 * listeners: which lifecycle points exist, what a configured hook looks like,
 * what the child process is handed on stdin, and what it may say back.
 *
 * The payload and output shapes are deliberately **Claude Code compatible** —
 * same `snake_case` field names, same `decision` / `hookSpecificOutput`
 * grammar, same exit-code contract — so a hook script written for Claude Code
 * runs here unchanged. Where dsh cannot express a Claude Code capability the
 * field is still parsed and then reported as unsupported, never ignored: see
 * {@link HookOutput.hookSpecificOutput}'s `updatedInput` note.
 *
 * @module @dennisrongo/dsh-hooks/types
 */

/**
 * Every lifecycle point a command can be attached to, and the dsh event each
 * one is driven by.
 *
 * The names are Claude Code's, not dsh's, because they are what a user types
 * into a config file and what a ported hook script switches on. The mapping to
 * dsh events lives in `index.ts`; this list is the user-facing vocabulary.
 */
export const HOOK_EVENTS = [
  /** `tools/pre-execute` — allow / deny / ask before a tool dispatches. */
  'PreToolUse',
  /** `tools/post-execute` — accept / block a settled tool result, or add context. */
  'PostToolUse',
  /** `agent/pre-step`, gated to steps that claimed a user-sourced message. */
  'UserPromptSubmit',
  /** `agent/session-start` — fires for startup, resume, clear AND compact. */
  'SessionStart',
  /** `agent/disposed` — observe only; teardown is never delayed on a decision. */
  'SessionEnd',
  /** `agent/turn-stopping` — may steer the agent back into another step. */
  'Stop',
  /** `subagent/end` — observe only. */
  'SubagentStop',
  /** `approval/request` — observe only; the approval waterfall decides. */
  'Notification',
] as const

/** One lifecycle point, as named in configuration. */
export type HookEvent = (typeof HOOK_EVENTS)[number]

/** Set form of {@link HOOK_EVENTS}, for O(1) validation of a config key. */
export const HOOK_EVENT_SET: ReadonlySet<string> = new Set(HOOK_EVENTS)

/**
 * The lifecycle points whose listener can change what the harness does. Every
 * other event runs its commands for effect only, and a `decision` in their
 * output is reported as ineffective rather than silently dropped — a hook that
 * believes it is blocking something when it is not is worse than one that
 * cannot block at all.
 */
export const DECIDING_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>([
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Stop',
])

/** Default per-hook wall-clock budget, in seconds, when the entry sets none. */
export const DEFAULT_TIMEOUT_SECONDS = 60

/** Hard ceiling on a configured timeout, so a typo cannot wedge a session for an hour. */
export const MAX_TIMEOUT_SECONDS = 600

/** In-memory cap on each captured stream, in bytes. The tail is kept. */
export const MAX_OUTPUT_BYTES = 256 * 1024

/** How many settled runs the service keeps for the `recent` endpoint. */
export const RECENT_LIMIT = 200

/** One command attached to a lifecycle point. */
export interface HookCommand {
  /** Only `command` exists today; the field is required for Claude Code parity. */
  type: 'command'
  /** Shell command line, run through the configured shell. */
  command: string
  /** Wall-clock budget in seconds; defaults to {@link DEFAULT_TIMEOUT_SECONDS}. */
  timeout?: number
  /**
   * How a hook that could not produce a verdict is read.
   *
   * A crash, a timeout, or an unparseable reply is NOT a denial by default:
   * fail-open keeps a broken hook from bricking every tool call in the session,
   * which is the failure mode that makes people delete their hooks entirely.
   * A hook that exists to enforce something sets this true and accepts that a
   * broken hook stops the work — that is the correct trade for a security gate
   * and the wrong one for a formatter.
   */
  failClosed?: boolean
}

/** One matcher and the commands it fires. */
export interface HookMatcherGroup {
  /**
   * Regular expression tested against the tool name. Absent, empty or `*`
   * matches everything. Events that carry no tool name ignore it entirely.
   */
  matcher?: string
  /** Commands run in parallel when the matcher hits. */
  hooks: HookCommand[]
}

/** A whole hooks document, from either configuration layer. */
export type HooksConfig = Partial<Record<HookEvent, HookMatcherGroup[]>>

/** Which layer a configured hook came from, for diagnostics and the UI. */
export type HookSource = 'user' | 'project'

/** One resolved hook: the command, its matcher group, and where it was configured. */
export interface ResolvedHook {
  event: HookEvent
  matcher: string | undefined
  command: HookCommand
  source: HookSource
  /** Absolute path of the document this came from, for error messages. */
  origin: string
}

/**
 * The JSON object written to a hook's stdin.
 *
 * `snake_case` is deliberate and load-bearing: it is Claude Code's wire shape,
 * and the entire point of this plugin's protocol choice is that an existing
 * hook script can be pointed at dsh without being rewritten.
 */
export interface HookPayload {
  /** The lifecycle point, e.g. `PreToolUse`. */
  hook_event_name: HookEvent
  /** The dsh session id, which is also the agent id. */
  session_id: string
  /** The session's working directory. */
  cwd: string
  /** Workspace registry id, when the cwd resolves to a registered workspace. */
  workspace_id?: string
  /** Tool name, on the two tool events. */
  tool_name?: string
  /** Parsed tool arguments, on the two tool events. */
  tool_input?: unknown
  /** The settled tool result, on `PostToolUse`. */
  tool_response?: unknown
  /** Concatenated text of the user-sourced messages, on `UserPromptSubmit`. */
  prompt?: string
  /** Why the session started, on `SessionStart`: startup | resume | clear | compact. */
  source?: string
  /** True when this `Stop` run was itself triggered by a previous Stop hook's steer. */
  stop_hook_active?: boolean
  /** Human-readable detail, on `Notification` and `SubagentStop`. */
  message?: string
}

/** What a hook may print on stdout to influence the harness. */
export interface HookOutput {
  /** False asks the harness to stop; honoured on `Stop` only. */
  continue?: boolean
  /** Reason shown when `continue` is false. */
  stopReason?: string
  /** Reserved for parity; dsh has no transcript surface to suppress. */
  suppressOutput?: boolean
  /** Free text surfaced in the harness log. */
  systemMessage?: string
  /** Coarse verdict: `block` denies/blocks, `approve` allows. */
  decision?: 'block' | 'approve'
  /** Why {@link decision} was reached; becomes the model-facing reason. */
  reason?: string
  /** Per-event structured output. */
  hookSpecificOutput?: {
    hookEventName?: string
    /** `PreToolUse` only. */
    permissionDecision?: 'allow' | 'deny' | 'ask'
    /** Reason accompanying {@link permissionDecision}. */
    permissionDecisionReason?: string
    /** Extra model-facing context, appended as a plugin-sourced user message. */
    additionalContext?: string
    /**
     * Accepted by the parser and then REFUSED with a warning.
     *
     * dsh's `PreToolDecision` is `allow | deny | ask` and its own docs state
     * that "input rewriting is excluded because arguments are already logged
     * and presented". A hook that rewrites arguments here would be silently
     * ineffective, and a security hook that believes it sanitized an argument
     * is more dangerous than one that never ran.
     */
    updatedInput?: unknown
  }
}

/** One settled hook execution, kept for `recent` and for diagnostics. */
export interface HookRun {
  event: HookEvent
  command: string
  source: HookSource
  /** Session the hook ran for. */
  sessionId: string
  /** Tool name when the event had one. */
  toolName?: string
  /** Epoch millis at spawn. */
  startedAt: number
  /** Wall-clock duration in millis. */
  durationMs: number
  /** Exit code, or null when the process died from a signal. */
  exitCode: number | null
  /** Terminating signal name, or null. */
  signal: string | null
  /** True when the hook exceeded its budget and was terminated. */
  timedOut: boolean
  /** Captured stdout tail. */
  stdout: string
  /** Captured stderr tail. */
  stderr: string
  /** Parsed stdout, when it was JSON. */
  output?: HookOutput
  /** Set when the hook could not produce a verdict at all (spawn failure). */
  error?: string
}

/**
 * What the listeners actually consume, after a whole matcher set has settled.
 *
 * Aggregation is deliberately monotonic toward "more restrictive": one denial
 * out of five hooks is a denial. Listener order cannot change that, which is
 * the same property `agent/turn-stopping` documents for itself.
 */
export interface HookVerdict {
  /** Set when any hook denied, or a fail-closed hook could not answer. */
  denied?: { reason: string }
  /** Set when any hook asked for confirmation and none denied. */
  asked?: { reason: string }
  /** Model-facing context contributed by every hook that supplied some. */
  additionalContext: string[]
  /** Every run in this batch, in completion order. */
  runs: HookRun[]
}
