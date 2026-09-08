/**
 * Host half of dsh-hooks: a Claude Code-compatible hook lifecycle for dsh.
 *
 * dsh already publishes the lifecycle — `tools/pre-execute` is a waterfall
 * returning `allow | deny | ask`, `tools/post-execute` can block a settled
 * result or attach model-facing context, `agent/pre-step` can reject or rewrite
 * the messages entering a step, `agent/turn-stopping` can steer an agent back
 * into another step. What it has never had is a way to attach a *command* to
 * any of that from configuration. This plugin is that runner and nothing more:
 * it owns no policy of its own, and with an empty config it is inert.
 *
 * ## What does not map
 *
 * Two Claude Code capabilities have no dsh expression, and both are reported
 * rather than silently dropped:
 *
 *   * **Rewriting tool arguments.** `PreToolDecision` is `allow | deny | ask`;
 *     the registry's own docs say input rewriting is excluded because arguments
 *     are already logged and presented. A hook returning `updatedInput` gets a
 *     warning naming the alternative (deny the call).
 *   * **Blocking session teardown.** `agent/disposed` is emit-mode, so a
 *     `SessionEnd` hook runs for effect and cannot object.
 *
 * ## Why the hot path is defended so hard
 *
 * `tools/pre-execute` is awaited by the tool registry before *every* dispatch.
 * A hook that hangs would stall the session, so the deadline is owned by the
 * runner, expiry escalates through the tree-scoped `terminate`, and a hook that
 * fails is fail-OPEN unless its entry opted into `failClosed`. The failure mode
 * this avoids — one broken hook bricking every tool call — is the one that
 * makes people delete their hooks entirely.
 *
 * @module @dennisrongo/dsh-hooks
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: keeps dsh-settings' `Context.settings` augmentation and the
// `SettingsNamespace` brand in the program without a named value import
// (the value export does not exist on all host versions — see below).
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PreToolDecision, PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { UserMessage } from '@deepseek-ai/dsh-session'
// Imported for the type-level module augmentation that declares
// `ctx.workspaceRegistry`; the service itself is read through `ctx.get`.
import type { Workspace } from '@deepseek-ai/dsh-workspace'
// Type-only, and deliberately NOT package.json peers: these two contribute the
// `subagent/*` and `approval/request` entries to cordis' `Events` interface, but
// this plugin imports no value from either. A deployment that composes neither
// simply never fires those listeners. They ARE in tsconfig `paths`, which is the
// other half of what scripts/anchor.mjs derives its links from.
import type { SubagentRunEndInfo, SubagentRunInfo } from '@deepseek-ai/dsh-subagent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
// Type-only, and deliberately NOT a package.json peer: this contributes the
// `ctx.skills` service and the `skills/change` event to cordis' interfaces, but
// nothing is imported from it at runtime — the registry is read through
// `ctx.get('skills')`, which yields `undefined` in a deployment that composes
// no skill provider. It IS in tsconfig `paths`, which is the other half of what
// scripts/anchor.mjs derives its links from.
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import {
  HooksSettings,
  ProjectHooks,
  defaultShell,
  coerceDocument,
  resolveHooks,
  type HooksSettingsValue,
} from './config.ts'
import { runHooks } from './runner.ts'
import { matchesTool, resetMatcherCache } from './matcher.ts'
import {
  HintEngine,
  emptyTurn,
  fingerprint,
  invokedSkillNames,
  observeToolCall,
  type CatalogSkill,
  type ProjectType,
  type SessionSituation,
  type SkillHint,
  type TurnFacts,
} from './hints.ts'
import {
  HOOK_EVENTS,
  RECENT_LIMIT,
  type HookEvent,
  type HookPayload,
  type HookRun,
  type HookVerdict,
  type HooksConfig,
} from './types.ts'

export type * from './types.ts'
export { matchesTool, isWildcard, resetMatcherCache } from './matcher.ts'
export { parseHookOutput, hookEnv, runHook, runHooks, type RunnerDeps } from './runner.ts'
export { coerceDocument, resolveHooks, defaultShell, HooksSettings, ProjectHooks } from './config.ts'
export { HOOK_EVENTS } from './types.ts'
export {
  HintEngine,
  DEFAULT_MAX_HINTS,
  MAX_MAX_HINTS,
  MAX_REASON,
  RULE_IDS,
  emptyTurn,
  fingerprint,
  invokedSkillNames,
  matchesPrompt,
  observeToolCall,
  phrasesOf,
  resetFingerprintCache,
  type CatalogSkill,
  type HintOptions,
  type ProjectType,
  type SessionSituation,
  type SkillHint,
  type TurnFacts,
} from './hints.ts'

/**
 * How many times in a row a `Stop` hook may steer one agent back into work.
 *
 * The protocol's own guard is `stop_hook_active`, which a well-written hook
 * checks — and this plugin passes it faithfully. The cap exists for the hook
 * that does not check it: without one, `{"decision":"block"}` on `Stop` is an
 * infinite loop that burns tokens until the user notices. Five is high enough
 * that a legitimate "run the tests, then fix, then re-check" chain completes.
 */
const MAX_STOP_CONTINUATIONS = 5

/** The settings namespace this plugin owns; also its config file section name. */
const NAMESPACE = 'dsh-hooks'

/**
 * How long a signal waits before the hints are recomputed.
 *
 * `tools/post-execute` fires once per tool call, and a busy turn is dozens of
 * them. Coalescing means a burst costs one catalog read and one compute rather
 * than one per call — and the strip is ambient, so a quarter second of lag on
 * a chip is invisible.
 */
const RECOMPUTE_DEBOUNCE_MS = 250

/** How long a per-session skill catalog is trusted before it is re-read. */
const CATALOG_TTL_MS = 60_000

/**
 * Sessions kept in the situation map.
 *
 * `agent/disposed` drops a session normally; this bound is for the deployment
 * where it does not fire (a crashed driver, a provider that never disposes) so
 * a long-lived harness cannot accumulate state forever.
 */
const MAX_TRACKED_SESSIONS = 200

/** Paths remembered per session, bounded so a big refactor cannot grow forever. */
const MAX_TRACKED_PATHS = 500

/**
 * A comparable identity for one computed hint list.
 *
 * The change token must move when the CONTENT changes and not merely when a
 * recompute ran, so the two lists are compared as strings. The separator is a
 * newline because a hint id is `${rule}:${skill}` and both halves are
 * kebab-case — it cannot appear inside one, so two different lists can never
 * fold to the same key.
 * @param hints - a computed hint list.
 * @returns a stable key for equality comparison.
 */
function joinIds(hints: readonly SkillHint[]): string {
  return hints.map((hint) => hint.id).join('\n')
}

/** Everything the hint engine needs about one live session. */
interface HintState {
  /** The session's working directory. */
  cwd: string
  /**
   * The agent, used as the `scope` argument to `ctx.skills.list`.
   *
   * Omitting it reads the GLOBAL layer alone, which misses every provider a
   * preset's standing composition mounted — so a preset-scoped skill would
   * never be suggested. `dsh-tool-skill` passes `scope: exec.agent`, and the
   * agent object IS the `ScopeKey`; this mirrors it exactly.
   */
  scope: object | undefined
  projectTypes: ReadonlySet<ProjectType>
  skillsUsed: Set<string>
  editedPaths: Set<string>
  /** Facts from the turn that most recently stopped. */
  lastTurn: TurnFacts
  /** Facts accumulating for the turn in flight. */
  currentTurn: TurnFacts
  lastPrompt: string
  prompts: number
  status: 'idle' | 'running'
  dismissed: Set<string>
  /** Last computed chips, served by `hints`. */
  hints: SkillHint[]
  /** Bumped only when {@link hints} actually changes; served by `hintsToken`. */
  token: number
  /** Cached catalog read, invalidated by `skills/change` and by TTL. */
  catalog: { skills: CatalogSkill[]; at: number } | undefined
  /** Pending coalesced recompute. */
  timer: ReturnType<typeof setTimeout> | undefined
}

/** Request shape of the `hints` endpoint. */
export interface HooksHintsRequest {
  /** The session whose chips to read. */
  sessionId: string
}

/** Reply shape of the `hints` endpoint. */
export interface HooksHintsResult {
  hints: SkillHint[]
  /** The token the returned list corresponds to. */
  token: number
}

/** Request shape of the `hintsToken` endpoint. */
export interface HooksHintsTokenRequest {
  sessionId: string
}

/** Reply shape of the `hintsToken` endpoint. */
export interface HooksHintsTokenResult {
  token: number
}

/** Request shape of the `dismissHint` endpoint. */
export interface HooksDismissHintRequest {
  sessionId: string
  /** The {@link SkillHint.id} the user dismissed. */
  id: string
}

/** Reply shape of the `dismissHint` endpoint. */
export interface HooksDismissHintResult {
  /** False when the session is unknown; never an error. */
  ok: boolean
  token: number
}

/**
 * Validate a settings-namespace name.
 *
 * Upstream moved this check around between releases: some versions export a
 * `settingsNamespace()` brand helper from `@deepseek-ai/dsh-settings`, others
 * (0.1.2-rc.1) validate inside `register()` instead and dropped the export —
 * importing it there is a boot-fatal named-import error. Both versions apply
 * the identical pattern (`/^[a-z][a-z0-9-]*$/`), so validating here with that
 * pattern keeps the call sites identical and the plugin loadable on either
 * host. Declared peers stay unchanged: `@deepseek-ai/dsh-settings` remains a
 * runtime dependency via `settings.register`, just no longer a named import.
 */
function settingsNamespace(value: string): SettingsNamespace {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new TypeError(`settings namespace "${value}" must match /^[a-z][a-z0-9-]*$/`)
  }
  return value as SettingsNamespace
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshHooks: HooksService
  }
}

/**
 * Empty resolved settings, used before registration and when no settings
 * provider is composed at all. `enabled` is true so that composing the plugin
 * without a settings provider still runs project-layer hooks.
 */
const EMPTY_SETTINGS: HooksSettingsValue = {
  enabled: true,
  shell: [],
  projectHooks: true,
  hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, []])) as unknown as HooksSettingsValue['hooks'],
  hints: { enabled: true, max: 3, disableRules: [] },
}

/** Request shape of the `describe` endpoint. */
export interface HooksDescribeRequest {
  /** Workspace whose project layer to include; omitted describes the user layer only. */
  workspaceId?: string
}

/** Reply shape of the `describe` endpoint. */
export interface HooksDescribeResult {
  enabled: boolean
  /** Resolved shell argv prefix actually in use. */
  shell: string[]
  /** Absolute path of the settings document, when the provider has one. */
  userOrigin?: string
  /** Absolute path of the project document, when a workspace was named. */
  projectOrigin?: string
  /** One row per configured hook, both layers, in resolution order. */
  hooks: Array<{
    event: HookEvent
    matcher?: string
    command: string
    timeout: number
    failClosed: boolean
    source: 'user' | 'project'
  }>
}

/** Request shape of the `recent` endpoint. */
export interface HooksRecentRequest {
  /** Maximum rows to return, newest first; clamped to {@link RECENT_LIMIT}. */
  limit?: number
}

/** Reply shape of the `recent` endpoint. */
export interface HooksRecentResult {
  runs: HookRun[]
}

/**
 * The hook runner.
 *
 * `tools` and `subprocess` are injected because nothing works without them.
 * `settings` and `workspaceRegistry` deliberately are NOT: a deployment that
 * composes neither should still get project-layer hooks and a working
 * cwd-derived payload rather than a service that never becomes injectable.
 */
export class HooksService extends TypertRemoteService {
  static inject = ['tools', 'subprocess']

  /** Latest resolved settings-namespace value. */
  private settings: HooksSettingsValue = EMPTY_SETTINGS

  /**
   * The user layer, coerced once per settings value.
   *
   * `tools/pre-execute` is awaited before EVERY tool dispatch, so anything
   * `hooksFor` does runs on the hot path. Re-coercing the whole settings
   * document there allocated a fresh config object per tool call, for a value
   * that only changes when the user edits settings.yaml.
   */
  private userConfigCache: { source: HooksSettingsValue['hooks']; config: HooksConfig } | undefined

  /** Absolute path of the settings document, when the provider exposes one. */
  private userOrigin: string | undefined

  /** Project-layer document reader, cached per workspace against mtime+size. */
  private readonly project = new ProjectHooks()

  /** Newest-last ring of settled runs, served by `recent`. */
  private readonly runs: HookRun[] = []

  /** Consecutive hook-driven continuations per agent, bounded by {@link MAX_STOP_CONTINUATIONS}. */
  private readonly stopDepth = new WeakMap<Agent, number>()

  /** Working directory captured at `subagent/start`, keyed by run id. */
  private readonly subagentCwd = new Map<string, string>()

  /** Hint engine, reconfigured in place on every settings commit. */
  private readonly engine = new HintEngine()

  /**
   * Per-session hint state, keyed by `String(agent.id)` — the same value
   * `basePayload` puts on the wire as `session_id`, so the client can address
   * a session with the id it already has.
   *
   * Insertion-ordered, which is what makes the {@link MAX_TRACKED_SESSIONS}
   * bound an LRU-by-first-seen rather than an arbitrary eviction.
   */
  private readonly hintStates = new Map<string, HintState>()

  /**
   * @param ctx - host context carrying the tool registry and subprocess seam.
   */
  constructor(ctx: Context) {
    super(ctx, 'dshHooks')
  }

  /** Register the settings namespace, then wire every lifecycle listener. */
  protected async [Service.init](): Promise<void> {
    // A fiber rather than an inject entry: settings may mount after this
    // service, and the callback's effects unwind with it if it ever unmounts.
    this.ctx.inject(['settings'], (scoped: Context) => {
      const scope = scoped.settings.register(settingsNamespace(NAMESPACE), HooksSettings, { applies: 'live' })
      this.settings = scope.get() as HooksSettingsValue
      this.applyHintSettings()
      this.userOrigin = scoped.settings.documentPath
      scoped.effect(
        () =>
          scope.watch((next) => {
            this.settings = next as HooksSettingsValue
            // A changed document may have changed a matcher; drop the compiled
            // regex cache so an edited pattern takes effect without a restart.
            resetMatcherCache()
            this.project.clear()
            this.userConfigCache = undefined
            this.applyHintSettings()
            // A changed `max` or `disableRules` changes what the strip should
            // show, and nothing else will wake the recompute — the session may
            // be idle for hours after a settings edit.
            for (const sessionId of this.hintStates.keys()) this.scheduleHints(sessionId)
          }),
        'dsh-hooks: settings watcher',
      )
    })

    this.wireToolEvents()
    this.wireAgentEvents()
    this.wireObserverEvents()
    this.wireHintEvents()
  }

  /** Push the resolved `hints` block into the engine. */
  private applyHintSettings(): void {
    const hints = this.settings.hints
    this.engine.configure({ maxHints: hints.max, disableRules: hints.disableRules })
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
  private userConfig(): HooksConfig {
    const source = this.settings.hooks
    if (this.userConfigCache?.source === source) return this.userConfigCache.config
    const { config } = coerceDocument(source)
    this.userConfigCache = { source, config }
    return config
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
  private workspaceIdFor(cwd: string | undefined): string | undefined {
    if (cwd === undefined) return undefined
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined) return undefined
    try {
      const hit = registry.list().find((w: Workspace) => w.path === cwd)
      return hit === undefined ? undefined : String(hit.id)
    } catch {
      return undefined
    }
  }

  /** The shell argv prefix in force: configured, else the platform default. */
  private shell(): string[] {
    return this.settings.shell.length > 0 ? this.settings.shell : defaultShell()
  }

  /**
   * Every hook configured for one event, across both layers.
   * @param event - the lifecycle point.
   * @param cwd - the session working directory whose project layer to read.
   * @returns the resolved hooks, or an empty array when hooks are disabled.
   */
  private hooksFor(event: HookEvent, cwd: string | undefined) {
    if (!this.settings.enabled) return []
    const user = this.userConfig()
    let project: HooksConfig = {}
    let projectOrigin = ''
    if (this.settings.projectHooks && cwd !== undefined) {
      const read = this.project.read(cwd)
      project = read.config
      projectOrigin = read.path
    }
    return resolveHooks(event, user, project, this.userOrigin ?? '(settings)', projectOrigin)
  }

  // ── dispatch ─────────────────────────────────────────────────────────────

  /** The session cwd an agent's hooks run in, falling back to the process cwd. */
  private cwdOf(agent: Agent | undefined): string {
    return agent?.session.header.cwd ?? process.cwd()
  }

  /**
   * Build the payload common to every event.
   * @param event - the lifecycle point.
   * @param agent - the agent the event belongs to, when there is one.
   * @returns the base payload, ready for per-event fields.
   */
  private basePayload(event: HookEvent, agent: Agent | undefined): HookPayload {
    const cwd = this.cwdOf(agent)
    const workspaceId = this.workspaceIdFor(agent?.session.header.cwd)
    return {
      hook_event_name: event,
      session_id: agent === undefined ? '' : String(agent.id),
      cwd,
      ...(workspaceId !== undefined ? { workspace_id: workspaceId } : {}),
    }
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
  private async dispatch(
    event: HookEvent,
    payload: HookPayload,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<HookVerdict> {
    const hooks = this.hooksFor(event, payload.cwd)
    if (hooks.length === 0) return { additionalContext: [], runs: [] }
    try {
      const verdict = await runHooks(
        { subprocess: this.ctx.subprocess, shell: this.shell() },
        hooks,
        payload,
        cwd,
        signal,
      )
      this.record(verdict.runs)
      return verdict
    } catch (err) {
      console.warn(`[dsh-hooks] ${event} dispatch failed:`, err)
      return { additionalContext: [], runs: [] }
    }
  }

  /** Append settled runs to the ring, trimming from the front. */
  private record(runs: readonly HookRun[]): void {
    this.runs.push(...runs)
    if (this.runs.length > RECENT_LIMIT) this.runs.splice(0, this.runs.length - RECENT_LIMIT)
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
  private contextMessage(event: HookEvent, text: string): UserMessage {
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: 'plugin',
        plugin: NAMESPACE,
        form: 'notice',
        summary: `${event} hook context`.slice(0, 120),
      },
    })
  }

  // ── tool lifecycle ───────────────────────────────────────────────────────

  /** `PreToolUse` and `PostToolUse`. */
  private wireToolEvents(): void {
    this.ctx.on(
      'tools/pre-execute',
      async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
        const payload: HookPayload = {
          ...this.basePayload('PreToolUse', exec.agent),
          tool_name: exec.name,
          tool_input: exec.arguments,
        }
        const verdict = await this.dispatch('PreToolUse', payload, payload.cwd, exec.signal)
        if (verdict.denied !== undefined) return { kind: 'deny', reason: verdict.denied.reason }
        if (verdict.asked !== undefined) return { kind: 'ask', reason: verdict.asked.reason }
        // No hook claimed the call, so the rest of the chain still decides —
        // this plugin adds hooks, it does not become the approval policy.
        return next()
      },
    )

    this.ctx.on(
      'tools/post-execute',
      async (
        exec: ToolExecution,
        result: Readonly<ToolExecutionResult>,
        next: () => Promise<PostToolDecision>,
      ): Promise<PostToolDecision> => {
        const payload: HookPayload = {
          ...this.basePayload('PostToolUse', exec.agent),
          tool_name: exec.name,
          tool_input: exec.arguments,
          tool_response: result.isError ? { isError: true, error: result.error } : result.value,
        }
        // Signal capture lives HERE and never in `tools/pre-execute`: that
        // listener is awaited before every dispatch, and a feature as
        // discretionary as a hint chip has no business on that path.
        this.captureToolCall(exec, result)

        const verdict = await this.dispatch('PostToolUse', payload, payload.cwd, exec.signal)
        const contexts = verdict.additionalContext.map((text) => this.contextMessage('PostToolUse', text))

        if (verdict.denied !== undefined) {
          // Blocking here turns the hook's reason into the model's tool result,
          // which is the whole point: the model reads it and corrects course.
          return {
            kind: 'block',
            feedback: [{ type: 'text', text: verdict.denied.reason }],
            ...(contexts.length > 0 ? { additionalContexts: contexts } : {}),
          }
        }

        const base = await next()
        if (contexts.length === 0) return base
        return { ...base, additionalContexts: [...(base.additionalContexts ?? []), ...contexts] }
      },
    )
  }

  /**
   * Fold one settled tool call into the session's turn facts.
   *
   * Wrapped whole: this is an addition to a listener the harness awaits, and
   * a hint-engine bug must not be able to break a tool result.
   * @param exec - the tool execution.
   * @param result - the settled result.
   */
  private captureToolCall(exec: ToolExecution, result: Readonly<ToolExecutionResult>): void {
    if (!this.settings.hints.enabled) return
    try {
      const state = this.hintStateFor(exec.agent)
      if (state === undefined) return
      const path = observeToolCall(exec.name, exec.arguments, result.isError, state.currentTurn)
      if (path !== undefined && state.editedPaths.size < MAX_TRACKED_PATHS) state.editedPaths.add(path)
      if (exec.name === 'skill' && !result.isError) {
        const args = exec.arguments as Record<string, unknown> | null
        // `{ name }` is the `skill` tool's only parameter
        // (dsh-tool-skill/lib/index.js:62).
        this.noteSkillUsed(state, args?.name)
      }
      this.scheduleHints(String(exec.agent?.id))
    } catch (err) {
      console.warn('[dsh-hooks] hints: tool capture failed:', err)
    }
  }

  // ── agent lifecycle ──────────────────────────────────────────────────────

  /** `UserPromptSubmit`, `SessionStart` and `Stop`. */
  private wireAgentEvents(): void {
    this.ctx.on(
      'agent/pre-step',
      async (
        payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
        next: () => Promise<{ kind: 'reject' } | { kind: 'enter'; messages: UserMessage[] }>,
      ) => {
        // `agent/pre-step` runs on EVERY step, but UserPromptSubmit means what
        // its name says. Gating on a user-sourced message in the claimed batch
        // is what keeps a prompt hook from firing once per tool round-trip.
        const prompts = payload.messages.filter((message) => message.source.kind === 'user')
        if (prompts.length === 0) return next()

        const text = prompts
          .flatMap((message) => message.content)
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map((block) => block.text)
          .join('\n')

        this.capturePrompt(payload.agent, text)

        const hookPayload: HookPayload = { ...this.basePayload('UserPromptSubmit', payload.agent), prompt: text }
        const verdict = await this.dispatch('UserPromptSubmit', hookPayload, hookPayload.cwd, payload.signal)
        if (verdict.denied !== undefined) {
          console.warn(`[dsh-hooks] UserPromptSubmit blocked the step: ${verdict.denied.reason}`)
          return { kind: 'reject' as const }
        }
        if (verdict.additionalContext.length === 0) return next()

        const base = await next()
        if (base.kind === 'reject') return base
        return {
          kind: 'enter' as const,
          messages: [
            ...base.messages,
            ...verdict.additionalContext.map((entry) => this.contextMessage('UserPromptSubmit', entry)),
          ],
        }
      },
    )

    this.ctx.on('agent/session-start', (payload: { agent: Agent; source: string }) => {
      const hookPayload: HookPayload = {
        ...this.basePayload('SessionStart', payload.agent),
        source: payload.source,
      }
      this.captureSessionStart(payload.agent)

      // Emit-mode: cordis does not await this listener, so the hooks race the
      // first step. `inject` is the documented seam for exactly this — a
      // running driver claims queued context at its nearest step boundary — so
      // a slow SessionStart hook lands a step later rather than being lost.
      void this.dispatch('SessionStart', hookPayload, hookPayload.cwd).then((verdict) => {
        for (const text of verdict.additionalContext) {
          payload.agent.inject(this.contextMessage('SessionStart', text))
        }
      })
    })

    this.ctx.on(
      'agent/turn-stopping',
      async (payload: { agent: Agent; turn: number; signal: AbortSignal }) => {
        this.captureTurnEnd(payload.agent)

        const depth = this.stopDepth.get(payload.agent) ?? 0
        const hookPayload: HookPayload = {
          ...this.basePayload('Stop', payload.agent),
          stop_hook_active: depth > 0,
        }
        const verdict = await this.dispatch('Stop', hookPayload, hookPayload.cwd, payload.signal)
        if (verdict.denied === undefined) {
          this.stopDepth.delete(payload.agent)
          return
        }
        if (depth >= MAX_STOP_CONTINUATIONS) {
          console.warn(
            `[dsh-hooks] Stop hook asked to continue ${depth} times in a row; ignoring to break the loop. ` +
              'A Stop hook must check `stop_hook_active` in its payload and stop asking.',
          )
          this.stopDepth.delete(payload.agent)
          return
        }
        this.stopDepth.set(payload.agent, depth + 1)
        // Steering is how a listener objects here: the machine re-reads its
        // inbox and runs another step. There is no return value that can do it.
        payload.agent.steer(this.contextMessage('Stop', verdict.denied.reason))
      },
    )
  }

  /**
   * Note a session's workspace shape at start or resume.
   * @param agent - the agent whose session started.
   */
  private captureSessionStart(agent: Agent | undefined): void {
    if (!this.settings.hints.enabled) return
    try {
      const state = this.hintStateFor(agent)
      if (state === undefined) return
      state.cwd = this.cwdOf(agent)
      // `fingerprint` never throws and caches per cwd, so a resume of a session
      // in an already-seen directory costs a stat.
      state.projectTypes = fingerprint(state.cwd)
      this.scheduleHints(String(agent?.id))
    } catch (err) {
      console.warn('[dsh-hooks] hints: session-start capture failed:', err)
    }
  }

  /**
   * Note a claimed user prompt: it opens a turn and it is the prompt rules' input.
   * @param agent - the agent entering the step.
   * @param text - the joined text of the user-sourced messages.
   */
  private capturePrompt(agent: Agent, text: string): void {
    if (!this.settings.hints.enabled) return
    try {
      const state = this.hintStateFor(agent)
      if (state === undefined) return
      state.lastPrompt = text
      state.prompts += 1
      state.status = 'running'
      // The new turn's facts start empty, and the previous turn's stay in
      // `lastTurn` — the turn rules describe the turn that FINISHED, so
      // clearing both here would blank the strip the moment the user replies.
      state.currentTurn = emptyTurn()
      // A skill the user typed is a skill they are already using; suggesting it
      // back is the most obvious way for this feature to feel broken. Detected
      // from the prompt's own `/name` gesture rather than from the injected
      // `skill-invocation` message, because that message is appended by
      // dsh-tool-skill's own `agent/pre-step` listener and whether this one
      // sees it depends on registration order between two plugins.
      for (const name of invokedSkillNames(text)) state.skillsUsed.add(name)
      // The project fingerprint is cheap and TTL-cached, and a session whose
      // first signal is a prompt (no session-start listener composed) would
      // otherwise never get project hints at all.
      if (state.projectTypes.size === 0) state.projectTypes = fingerprint(state.cwd)
      this.scheduleHints(String(agent.id))
    } catch (err) {
      console.warn('[dsh-hooks] hints: prompt capture failed:', err)
    }
  }

  /**
   * Close the turn in flight and hand its facts to the turn rules.
   * @param agent - the agent whose turn is stopping.
   */
  private captureTurnEnd(agent: Agent): void {
    if (!this.settings.hints.enabled) return
    try {
      const state = this.hintStateFor(agent)
      if (state === undefined) return
      state.lastTurn = state.currentTurn
      state.currentTurn = emptyTurn()
      state.status = 'idle'
      // A turn that wrote files may have scaffolded the project itself — an
      // empty folder at session start, a `.csproj` in a subdirectory by the
      // time the turn ends. The cache cannot see that (a new subdirectory's
      // contents change no mtime the top level owns), so a turn with edits
      // re-reads the disk. Observed live: a Hello-World MCP server built from
      // nothing showed no .NET chip until the NEXT prompt.
      if (state.lastTurn.edits > 0) state.projectTypes = fingerprint(state.cwd, true)
      this.scheduleHints(String(agent.id))
    } catch (err) {
      console.warn('[dsh-hooks] hints: turn capture failed:', err)
    }
  }

  // ── observers ────────────────────────────────────────────────────────────

  /** `SessionEnd`, `SubagentStop` and `Notification` — effect only, no verdict. */
  private wireObserverEvents(): void {
    this.ctx.on('agent/disposed', (payload: { agent: Agent }) => {
      // The AGENT is gone; the session is not. A UI reopens a finished session
      // without composing an agent until the next prompt, and the strip polls
      // by session id the whole time — so dropping the state here would blank
      // the chips the moment the harness released the agent, which reads as
      // the feature not working. Keep the computed hints, release only what
      // referenced the live agent; the LRU bound is what reclaims memory.
      this.detachHintState(String(payload.agent.id))

      const hookPayload = this.basePayload('SessionEnd', payload.agent)
      // Teardown is never delayed on a hook: `agent/disposed` is emit-mode and
      // the session is already gone, so this runs for its side effects only.
      void this.dispatch('SessionEnd', hookPayload, hookPayload.cwd)
    })

    this.ctx.on('subagent/start', (info: SubagentRunInfo) => {
      // `subagent/end` carries no agent, so the child's directory has to be
      // remembered here or the hook would run against the wrong cwd. The
      // registry resolves the child during this notification for in-process
      // providers; anything else falls back to the process cwd.
      const agent = this.ctx.get('agents')?.get(info.id)
      this.subagentCwd.set(String(info.runId), this.cwdOf(agent))
    })

    this.ctx.on('subagent/end', (info: SubagentRunEndInfo) => {
      const runId = String(info.runId)
      const cwd = this.subagentCwd.get(runId) ?? process.cwd()
      this.subagentCwd.delete(runId)
      const workspaceId = this.workspaceIdFor(cwd)
      const payload: HookPayload = {
        hook_event_name: 'SubagentStop',
        session_id: String(info.id),
        cwd,
        ...(workspaceId !== undefined ? { workspace_id: workspaceId } : {}),
        message: `subagent ${info.provider} stopped: ${info.stopReason}`,
      }
      void this.dispatch('SubagentStop', payload, cwd)
    })

    this.ctx.on(
      'approval/request',
      async (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> => {
        const payload: HookPayload = {
          ...this.basePayload('Notification', req.agent),
          tool_name: req.toolName,
          message: req.reason ?? `${req.toolName} is waiting for approval`,
        }
        // Fire-and-forget on purpose: the approval waterfall owns this decision
        // and a notification hook must not be able to answer it by being slow.
        void this.dispatch('Notification', payload, payload.cwd, req.signal)
        return next()
      },
    )
  }

  // ── skill hints ──────────────────────────────────────────────────────────

  /**
   * The hint state for one agent, created on first sight.
   *
   * @param agent - the agent the signal belongs to.
   * @returns the state, or undefined when there is no agent to key on.
   */
  private hintStateFor(agent: Agent | undefined): HintState | undefined {
    if (agent === undefined) return undefined
    const sessionId = String(agent.id)
    const existing = this.hintStates.get(sessionId)
    if (existing !== undefined) {
      // The scope can arrive later than the first signal (a session resumed
      // before any agent-scoped listener fired), so keep taking the newest.
      existing.scope = agent
      return existing
    }
    const cwd = this.cwdOf(agent)
    const state: HintState = {
      cwd,
      scope: agent,
      projectTypes: new Set(),
      skillsUsed: new Set(),
      editedPaths: new Set(),
      lastTurn: emptyTurn(),
      currentTurn: emptyTurn(),
      lastPrompt: '',
      prompts: 0,
      status: 'idle',
      dismissed: new Set(),
      hints: [],
      token: 0,
      catalog: undefined,
      timer: undefined,
    }
    this.hintStates.set(sessionId, state)
    // First-seen eviction, and the timer goes with the entry: a pending
    // recompute for a dropped session would resolve against nothing and hold a
    // handle for its debounce window.
    while (this.hintStates.size > MAX_TRACKED_SESSIONS) {
      const oldest = this.hintStates.keys().next()
      if (oldest.done === true) break
      this.dropHintState(oldest.value)
    }
    return state
  }

  /**
   * Release a disposed agent from its session's hint state, keeping the hints.
   *
   * The pending recompute is cancelled because it would read the catalog
   * through a scope that no longer exists; the chips already computed stay
   * addressable by session id until the LRU bound evicts them.
   * @param sessionId - the session whose agent was disposed.
   */
  private detachHintState(sessionId: string): void {
    const state = this.hintStates.get(sessionId)
    if (state === undefined) return
    if (state.timer !== undefined) clearTimeout(state.timer)
    state.timer = undefined
    state.scope = undefined
    state.status = 'idle'
  }

  /** Forget one session's hint state, clearing any pending recompute. */
  private dropHintState(sessionId: string): void {
    const state = this.hintStates.get(sessionId)
    if (state?.timer !== undefined) clearTimeout(state.timer)
    this.hintStates.delete(sessionId)
  }

  /**
   * Queue a coalesced recompute for one session.
   *
   * A pending timer is left alone rather than reset, so a long burst of tool
   * calls still recomputes on a fixed cadence instead of being starved by its
   * own signals.
   * @param sessionId - the session to recompute.
   */
  private scheduleHints(sessionId: string): void {
    if (!this.settings.hints.enabled) return
    const state = this.hintStates.get(sessionId)
    if (state === undefined || state.timer !== undefined) return
    const timer = setTimeout(() => {
      state.timer = undefined
      void this.recomputeHints(sessionId)
    }, RECOMPUTE_DEBOUNCE_MS)
    // The strip is ambient; a pending recompute must never be the reason a
    // `dsh` CLI invocation refuses to exit.
    timer.unref?.()
    state.timer = timer
  }

  /**
   * The skills visible to one session's agent, cached per session.
   *
   * @param state - the session's hint state.
   * @returns the user-visible catalog, or an empty list when no registry is composed.
   */
  private async catalogFor(state: HintState): Promise<CatalogSkill[]> {
    const now = Date.now()
    if (state.catalog !== undefined && now - state.catalog.at < CATALOG_TTL_MS) return state.catalog.skills
    // Read through `ctx.get`: a cordis context is a Proxy and a bare property
    // read for an undeclared service THROWS. `skills` is deliberately not in
    // `static inject` for the same reason `settings` is not — this cordis has
    // no optional inject, so listing it would make the plugin never mount in a
    // deployment that composes no skill registry.
    const skills = this.ctx.get('skills')
    if (skills === undefined) return []
    const summaries: readonly SkillSummary[] = await skills.list({
      cwd: state.cwd,
      ...(state.scope !== undefined ? { scope: state.scope } : {}),
    })
    const list = summaries.map((skill) => skill as CatalogSkill)
    state.catalog = { skills: list, at: now }
    return list
  }

  /**
   * Recompute one session's chips, bumping the token only if they changed.
   *
   * Never throws and never rejects: this is driven from listeners that must
   * not be able to fail because a hint could not be computed.
   * @param sessionId - the session to recompute.
   */
  private async recomputeHints(sessionId: string): Promise<void> {
    const state = this.hintStates.get(sessionId)
    if (state === undefined) return
    try {
      const next = this.settings.hints.enabled
        ? this.engine.compute(this.situationOf(state), await this.catalogFor(state))
        : []
      // The state may have been dropped while the catalog read was in flight.
      if (this.hintStates.get(sessionId) !== state) return
      const before = joinIds(state.hints)
      const after = joinIds(next)
      if (before === after) return
      state.hints = next
      // The token is what the client polls, so it moves ONLY here. Bumping it
      // on every signal would make an idle session poll a rising counter and
      // refetch a list that never changed — which is the trap `dsh-git`'s
      // changeToken documents, one layer up.
      state.token += 1
    } catch (err) {
      console.warn('[dsh-hooks] hints: recompute failed:', err)
    }
  }

  /** Snapshot one session's state as the engine's input. */
  private situationOf(state: HintState): SessionSituation {
    return {
      cwd: state.cwd,
      projectTypes: state.projectTypes,
      skillsUsed: state.skillsUsed,
      editedPaths: state.editedPaths,
      lastTurn: state.lastTurn,
      lastPrompt: state.lastPrompt,
      prompts: state.prompts,
      status: state.status,
      dismissed: state.dismissed,
    }
  }

  /** Note a skill as used, so it is never suggested again this session. */
  private noteSkillUsed(state: HintState, name: unknown): void {
    if (typeof name !== 'string' || name === '') return
    state.skillsUsed.add(name)
  }

  /** Invalidate every cached catalog when the skill registry says it may have changed. */
  private wireHintEvents(): void {
    // `skills/change` is unfiltered: a provider mounted, a runtime skill was
    // registered, or a catalog was invalidated. Dropping the caches and
    // recomputing is the whole response — a hint naming a skill that has since
    // been removed is exactly what this prevents.
    this.ctx.on('skills/change', () => {
      for (const [sessionId, state] of this.hintStates) {
        state.catalog = undefined
        this.scheduleHints(sessionId)
      }
    })
  }

  // ── endpoints ────────────────────────────────────────────────────────────

  /**
   * Describe the hooks in force, both layers, for a configuration surface.
   * @param request - optional workspace whose project layer to include.
   * @returns the resolved rows plus the documents they came from.
   */
  @Remote
  async describe(request: HooksDescribeRequest): Promise<HooksDescribeResult> {
    const cwd = this.workspaceDirFor(request?.workspaceId)
    const rows: HooksDescribeResult['hooks'] = []
    let projectOrigin: string | undefined
    for (const event of HOOK_EVENTS) {
      for (const hook of this.hooksFor(event, cwd)) {
        if (hook.source === 'project') projectOrigin = hook.origin
        rows.push({
          event,
          ...(hook.matcher !== undefined ? { matcher: hook.matcher } : {}),
          command: hook.command.command,
          timeout: hook.command.timeout ?? 60,
          failClosed: hook.command.failClosed === true,
          source: hook.source,
        })
      }
    }
    return {
      enabled: this.settings.enabled,
      shell: this.shell(),
      ...(this.userOrigin !== undefined ? { userOrigin: this.userOrigin } : {}),
      ...(projectOrigin !== undefined ? { projectOrigin } : {}),
      hooks: rows,
    }
  }

  /**
   * The most recent settled hook runs, newest first.
   * @param request - optional row cap.
   * @returns the recorded runs.
   */
  @Remote
  async recent(request: HooksRecentRequest): Promise<HooksRecentResult> {
    const limit = Math.min(Math.max(1, request?.limit ?? 50), RECENT_LIMIT)
    return { runs: this.runs.slice(-limit).reverse() }
  }

  /**
   * The chips currently computed for one session.
   *
   * An unknown session is an empty list and token 0, never an error: the strip
   * mounts as soon as a session view does, which is before any signal has
   * necessarily reached this service.
   * @param request - the session to read.
   * @returns the hints and the token they correspond to.
   */
  @Remote
  async hints(request: HooksHintsRequest): Promise<HooksHintsResult> {
    const state = this.hintStates.get(String(request?.sessionId ?? ''))
    if (state === undefined || !this.settings.hints.enabled) return { hints: [], token: 0 }
    return { hints: state.hints, token: state.token }
  }

  /**
   * The change token for one session's hints.
   *
   * This is the POLLED endpoint and it must stay O(1): it reads an in-memory
   * counter that only {@link recomputeHints} moves, and it does no fs work, no
   * catalog read and no compute. The moment it computes anything it costs what
   * `hints` costs and the polling design is pointless — the same trap
   * `dsh-git`'s and `dsh-plan-board`'s `changeToken` both document.
   * @param request - the session to read.
   * @returns the counter, frozen at 0 while hints are disabled.
   */
  @Remote
  async hintsToken(request: HooksHintsTokenRequest): Promise<HooksHintsTokenResult> {
    if (!this.settings.hints.enabled) return { token: 0 }
    return { token: this.hintStates.get(String(request?.sessionId ?? ''))?.token ?? 0 }
  }

  /**
   * Silence one chip for the rest of the session.
   *
   * Dismissal is per session and per hint id. Hint ids are `${rule}:${skill}`,
   * which is stable for a given rule/skill pair — so a dismissed chip does not
   * reappear on the next recompute, while the same rule firing for a DIFFERENT
   * skill still gets its chance.
   * @param request - the session and the hint id.
   * @returns whether the session was known, and the resulting token.
   */
  @Remote
  async dismissHint(request: HooksDismissHintRequest): Promise<HooksDismissHintResult> {
    const sessionId = String(request?.sessionId ?? '')
    const id = String(request?.id ?? '')
    const state = this.hintStates.get(sessionId)
    if (state === undefined || id === '') return { ok: false, token: 0 }
    state.dismissed.add(id)
    const remaining = state.hints.filter((hint) => hint.id !== id)
    if (remaining.length !== state.hints.length) {
      state.hints = remaining
      state.token += 1
    }
    // Dropping the chip may free a slot under `max`, so re-resolve rather than
    // leaving the strip one shorter than the user configured.
    this.scheduleHints(sessionId)
    return { ok: true, token: state.token }
  }

  /** Resolve a workspace id to its directory, for the endpoints. */
  private workspaceDirFor(workspaceId: string | undefined): string | undefined {
    if (typeof workspaceId !== 'string' || workspaceId === '') return undefined
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined) return undefined
    const hit = registry.list().find((w: Workspace) => String(w.id) === workspaceId)
    return hit?.path
  }
}

export default HooksService
