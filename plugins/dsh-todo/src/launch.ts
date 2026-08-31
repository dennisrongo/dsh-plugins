/**
 * dsh-todo — launching a harness session from a task.
 *
 * A task carries everything a session needs to start work: a title, a
 * description, and the roadmap fields that say how urgent it is. This module
 * turns one into a running session.
 *
 * The whole file exists because of ORDERING. The harness has no single call
 * that creates a session with a model and a mode: `sessions.create()` accepts
 * only a workspace, and the shipped agent-preset UI says so outright — a pick
 * "cannot simply ride along on sessions.create". So a launch is a sequence, and
 * two of its steps are order-critical in a way that fails SILENTLY:
 *
 *   1. create the session
 *   2. select the agent preset   <- refused once the session is not blank
 *   3. select the model
 *   4. send the prompt           <- this is what un-blanks the session
 *   5. rename it after the task  <- no blank window; late on purpose
 *   6. navigate to it
 *
 * Step 2 must precede step 4. Prompting is exactly what ends the blank window,
 * and the preset applier drops a pick aimed at a non-blank session without
 * raising anything — the session simply runs the default mode instead of the
 * chosen one, with no error in the console, no rejected promise, and no visible
 * difference until the agent behaves unexpectedly ten turns later. The smoke
 * test pins the order against the source for that reason.
 */
import type { TodoItem } from './types.ts'

/** One selectable model, flattened from the harness's grouped catalog. */
export interface ModelOption {
  provider: string
  model: string
  /** Display name from the catalog; falls back to the raw model id. */
  label: string
  /** Group heading the catalog filed it under, for `<optgroup>`. */
  group: string
}

/** One selectable agent preset — the "mode" in the New Session flow. */
export interface PresetOption {
  id: string
  label: string
}

/** The chosen model, in the shape `ModelDirectory.select` expects. */
export interface ModelChoice {
  provider: string
  model: string
  reasoningEffort?: string
}

/**
 * The slice of the harness client context a launch needs.
 *
 * Declared structurally rather than imported: these are shell services reached
 * through `ctx.inject`, and the packages that declare them are build-time
 * externals of the host bundles, so a plugin cannot import their types.
 */
export interface LaunchContext {
  sessions: {
    create: (opts: { workspaceId: string }) => Promise<string>
    open: (sessionId: string) => void
    binding: (sessionId: string) => { session: SessionFace } | undefined
  }
  /**
   * OPTIONAL. Supplies the model picker; absent on a profile without
   * ui-model-selection, where a launch simply runs the deployment default.
   */
  /**
   * `directoryFor` may return undefined: `launchContext()` wraps the borrowed
   * service so an unreachable one degrades instead of throwing, and the type
   * must say so or every call site silently skips the null check.
   */
  modelDirectories?: {
    directoryFor: (sessionId: string) => ModelDirectoryFace | undefined
  }
  remote: {
    /**
     * OPTIONAL. Supplies the mode picker; absent on a profile without
     * ui-agent-preset, where a launch runs the default preset.
     */
    agentPresets?: {
      list: () => Promise<RemoteResult<{ presets: RawPreset[] }>>
      select: (sessionId: string, presetId: string) => Promise<RemoteResult<unknown>>
    }
  }
  uiWorkspace?: {
    archiveSession: (sessionId: string) => Promise<void>
  }
  /**
   * OPTIONAL. Resolves a shipped preset's display name in the shell's own
   * language. Absent on a profile without `locale`, where the roster's own
   * metadata is used instead.
   */
  presetLabel?: (key: string) => string | undefined
  /**
   * OPTIONAL. The session-INDEPENDENT model catalog RPC.
   *
   * This — not the per-session model directory — is what populates the picker.
   * The directory waits on a session's `modelSelection` projection, and that
   * store is seeded only when a history PAGE loads, so it can never settle for
   * the blank session this dialog creates: `status` stays "loading" and
   * `groups` stays empty forever, with nothing thrown. `modelCatalog()` takes
   * no arguments and answers the same `{ groups, default }` regardless of
   * history.
   */
  modelCatalog?: () => Promise<unknown>
}

/** One provider group as `session.modelCatalog()` returns it. */
export interface RawCatalogGroup {
  id?: string
  name?: string
  models?: { id?: string; name?: string; description?: string }[]
}

interface SessionFace {
  prompt: (
    content: { type: 'text'; text: string }[],
    mode: 'queue' | 'steer',
  ) => Promise<{ ok: boolean; error?: { code: string; message: string } }>
  /**
   * OPTIONAL. Names the session, superseding the generated title.
   *
   * Declared optional because this is a BORROWED face: the shell's own sidebar
   * calls it (`dsh-client-ui-workspace` -> `sessions.binding(id).session.rename`),
   * but this package does not own the contract, and a deployment whose binding
   * predates it must degrade rather than crash a launch the user confirmed.
   */
  rename?: (
    title: string,
  ) => Promise<{ ok: boolean; error?: { code: string; message: string } }>
}

interface ModelDirectoryFace {
  load: () => Promise<unknown>
  select: (selection: ModelChoice) => Promise<void>
  store: {
    getSnapshot: () => ModelSnapshot
    subscribe: (fn: () => void) => () => void
  }
}

interface ModelSnapshot {
  current: { provider: string; model: string } | null
  groups: RawGroup[]
  status: string
  error: string | null
}

/**
 * One catalog group — which IS a provider: `group.id` is the provider id every
 * selection is built from, and `group.name` is its display heading.
 *
 * The optional spellings this once carried (`label`, `title`, `items`) do not
 * exist in the catalog. Listing them let `flattenModels` compile while reading
 * keys that are never present, so the empty picker looked like a data problem
 * rather than a typo. Model the REAL shape and let a mismatch fail loudly.
 */
interface RawGroup {
  id?: string
  name?: string
  models?: RawModel[]
}

/** One model within a group. `id` is the model id; `name` is its display label. */
interface RawModel {
  id?: string
  name?: string
  description?: string
}

interface RawPreset {
  id: string
  label?: string
  name?: string
  title?: string
  isDefault?: boolean
  /**
   * `"system"` for a preset the deployment ships. Those must be labelled from
   * the locale, never from file metadata — see `presetOptions`.
   */
  trust?: string
  /** Present when the host could not compose the preset; those are unusable. */
  broken?: unknown
}

type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/**
 * Compose the prompt a launched session opens with.
 *
 * Markdown rather than a sentence: the title becomes a heading so the agent
 * reads it as the objective, and the description follows as the brief. The
 * roadmap fields are appended only when set — an empty "Priority: —" line is
 * noise that teaches the model the metadata is meaningless.
 *
 * @param item - the task being launched.
 * @returns the prompt text, which the dialog then lets the user edit.
 */
export function composePrompt(item: TodoItem): string {
  const parts: string[] = [`# ${item.title}`]
  const description = item.description?.trim()
  if (description) parts.push(description)

  const context: string[] = []
  // The bare band ("P0"), not the UI's "P0 · Urgent": the human label lives in
  // client.tsx beside React, and this module stays dependency-free so the smoke
  // test can import it under plain Node.
  if (item.priority) context.push(`Priority: ${item.priority.toUpperCase()}`)
  if (item.release) context.push(`Release: ${item.release}`)
  if (item.sprint) context.push(`Sprint: ${item.sprint}`)
  if (item.dueDate) context.push(`Due: ${item.dueDate}`)
  if (context.length > 0) parts.push(context.join(' · '))

  return parts.join('\n\n')
}

/**
 * The longest session title worth sending.
 *
 * A task title caps at `MAX_TEXT` (500), which is far longer than any sidebar
 * row can show. Truncating here keeps the stored title readable rather than
 * relying on CSS to hide the tail.
 */
const MAX_SESSION_TITLE = 80

/**
 * Name a launched session after the task it is working.
 *
 * Without this the title is INVENTED: the deployment's
 * `session-title-first-prompt-llm` provider asks a model to summarise the first
 * human message, so a launched session gets a paraphrase of the prompt rather
 * than the task's own name. The task title is already the objective, so there
 * is nothing to infer.
 *
 * Normalisation mirrors what the connection does on receipt
 * (`trim`, collapse runs of whitespace) so the caller can tell in ADVANCE
 * whether a title would be refused: the wire rejects a blank one with
 * `title-invalid`, and sending a title we know is invalid just to discover that
 * is a wasted round-trip.
 *
 * @param item - the task being launched.
 * @returns the title to set, or undefined when the task has no usable one.
 */
export function sessionTitleFor(item: TodoItem): string | undefined {
  const normalized = item.title.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) return undefined
  if (normalized.length <= MAX_SESSION_TITLE) return normalized
  // Cut on a word boundary when there is one reasonably near the limit, so the
  // title does not end mid-word; fall back to a hard cut for unbroken text.
  const clipped = normalized.slice(0, MAX_SESSION_TITLE)
  const lastSpace = clipped.lastIndexOf(' ')
  return `${(lastSpace > MAX_SESSION_TITLE - 20 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`
}

/**
 * Flatten the harness's grouped model catalog into a flat option list.
 *
 * **The PROVIDER is the group's id, not a field on the model.** A group IS a
 * provider: `dsh-client-ui-model-selection` builds every selection as
 * `{ provider: group.id, model: model.id }` and every label as `model.name`,
 * in five independent places (`optionsOf`, `selectionOf`, and the seat's own
 * rows). There is no `model.provider` anywhere in that catalog.
 *
 * An earlier version guessed at key spellings "defensively" and required
 * `model.provider`, so the `provider === undefined` guard skipped EVERY row and
 * the picker rendered empty with no error — the defensive read looked careful
 * and failed closed. Accepting alternate spellings is not defensiveness when
 * the real shape was never checked; it just hides the mismatch. These names are
 * verified against the shipped bundle, so a future rename should fail loudly in
 * review rather than silently emptying the list again.
 *
 * @param groups - catalog groups as the model directory snapshot carries them.
 * @returns every selectable model, in catalog order.
 */
export function flattenModels(groups: readonly RawGroup[]): ModelOption[] {
  const out: ModelOption[] = []
  for (const group of groups) {
    const provider = group.id
    if (provider === undefined) continue
    const heading = group.name ?? ''
    for (const model of group.models ?? []) {
      const id = model.id
      if (id === undefined) continue
      out.push({
        provider,
        model: id,
        label: model.name ?? id,
        group: heading,
      })
    }
  }
  return out
}

/**
 * Locale keys the shell uses for the presets it ships, keyed by preset id.
 *
 * A SHIPPED preset's display name is translated copy, not file metadata: the
 * roster row's own `name` is an internal value that is Chinese in this build,
 * and `dsh-client-ui-agent-preset` never renders it — `presetDisplayText()`
 * swaps in `t(key)` whenever `trust === 'system'`. Reading `preset.name`
 * directly is what put "创造模式" in the mode picker on an English UI.
 *
 * User-authored presets are deliberately absent here: their names are the
 * author's own copy and must never be translated.
 */
const BUILT_IN_PRESET_NAME_KEYS: Readonly<Record<string, string>> = {
  standard: 'presetStandardName',
  ptc: 'presetPtcName',
  minimal: 'presetMinimalName',
  cordis: 'presetCordisName',
}

/**
 * The presets a person may actually pick, with the deployment default first.
 *
 * A broken preset is one the host failed to compose; offering it would launch a
 * session that cannot run. The shipped picker filters them the same way.
 *
 * @param presets - the roster as the host answered it.
 * @param t - the shell's locale lookup for the `settings.agentPreset`
 *   namespace, so a shipped preset is named in the UI's own language. Omit it
 *   (or return undefined) to fall back to the roster's own metadata.
 * @returns selectable options, and the id to preselect.
 */
export function presetOptions(
  presets: readonly RawPreset[],
  t?: (key: string) => string | undefined,
): {
  options: PresetOption[]
  defaultId: string | undefined
} {
  const healthy = presets.filter((preset) => preset.broken === undefined)
  const options = healthy.map((preset) => {
    // Translate ONLY the presets the deployment ships. A user-authored preset's
    // name is the author's copy, and running it through a lookup would either
    // miss (returning the key) or, worse, collide with a shipped key.
    const key = preset.trust === 'system' ? BUILT_IN_PRESET_NAME_KEYS[preset.id] : undefined
    const translated = key !== undefined && t !== undefined ? t(key) : undefined
    // A miss must not surface the raw key: `t()` implementations commonly echo
    // the key back, so anything that still looks like one is discarded.
    const localized = translated !== undefined && translated !== key ? translated : undefined
    return {
      id: preset.id,
      label: localized ?? preset.label ?? preset.name ?? preset.title ?? preset.id,
    }
  })
  const defaultId = healthy.find((preset) => preset.isDefault)?.id ?? healthy[0]?.id
  return { options, defaultId }
}

/** What {@link launchSession} needs in order to start the work. */
export interface LaunchRequest {
  sessionId: string
  presetId: string | undefined
  model: ModelChoice | undefined
  prompt: string
  /**
   * OPTIONAL. Names the session after the task, superseding the generated
   * title. Built by {@link sessionTitleFor}, which yields undefined for a task
   * whose title normalises to nothing — the wire would refuse that anyway.
   */
  title?: string
}

/**
 * Apply the mode and model to a freshly created session, send the prompt, and
 * navigate to it.
 *
 * The session is created earlier, when the dialog opens, so the model picker can
 * bind to that session's own directory and offer only what it can actually run.
 *
 * ORDER IS LOAD-BEARING — see this module's header. The preset and the model are
 * both applied BEFORE the prompt, because prompting ends the blank window in
 * which a preset can still be selected, and a late pick is dropped in silence.
 *
 * @param ctx - the injected harness services.
 * @param request - the created session plus the choices made in the dialog.
 * @returns the session now working the task, for the caller to record on it.
 * @throws when the prompt is refused; the caller leaves the task untouched.
 */
export async function launchSession(ctx: LaunchContext, request: LaunchRequest): Promise<string> {
  const { sessionId, presetId, model, prompt, title } = request

  // 1. Mode first: only a blank session accepts a preset. Skipped entirely when
  //    the deployment composes no agent presets — the session then runs the
  //    default, exactly as one started from the sidebar would.
  // `ctx.remote` is the PLAIN object launchContext() built, not a cordis proxy,
  // so this read is safe. The CALL is the risk: the handle belongs to another
  // fiber, and a borrowed method can throw `cannot get property "X" without
  // inject` from inside the callee. A mode that cannot be applied must fail
  // LOUDLY here — unlike the pickers, silently defaulting the mode is the
  // failure this module's header exists to prevent.
  if (presetId !== undefined && ctx.remote.agentPresets !== undefined) {
    let applied
    try {
      applied = await ctx.remote.agentPresets.select(sessionId, presetId)
    } catch (cause) {
      throw new Error(`could not set mode: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    if (!applied.ok) {
      throw new Error(`could not set mode: ${applied.error.message}`)
    }
  }

  // 2. Model second, still before the prompt. Same optionality.
  //
  // `directoryFor` is the borrowed method that crashed conversation.view: it
  // re-enters `remote.session`, a service this fiber never declared, so a
  // present service can still throw on call. Unlike the mode above, a model
  // that cannot be applied is NOT fatal — the session runs the deployment
  // default, exactly as a launch with no pick does — so this degrades instead
  // of aborting a launch the user already confirmed.
  if (model !== undefined && ctx.modelDirectories !== undefined) {
    // launchContext() wraps this handle, so it yields undefined rather than
    // throwing when the borrowed service is unreachable from this fiber.
    const directory = ctx.modelDirectories.directoryFor(sessionId) as
      | { select: (m: typeof model) => Promise<unknown> }
      | undefined
    if (directory !== undefined) await directory.select(model)
  }

  // 3. The prompt, which starts the work and ends the blank window.
  const binding = ctx.sessions.binding(sessionId)
  if (binding === undefined) {
    throw new Error('the new session is not addressable yet')
  }
  const sent = await binding.session.prompt([{ type: 'text', text: prompt }], 'queue')
  if (!sent.ok) {
    throw new Error(`could not send the prompt: ${sent.error?.message ?? 'unknown error'}`)
  }

  // 4. Name the session after the task, AFTER the prompt on purpose.
  //
  // Unlike the preset, a rename has no blank-session window to beat — the
  // connection simply appends a `session/title` event — so there is nothing to
  // gain by going earlier, and going LATER means a launch that failed above
  // leaves no renamed session behind to explain.
  //
  // NOT fatal, and deliberately unlike the mode. A launch the user already
  // confirmed must not fail over a cosmetic title: without this the session
  // keeps the model-generated name, which is exactly the status quo. Both the
  // call and the await are guarded because `rename` is a borrowed face — absent
  // on an older binding, and able to throw from inside the callee.
  //
  // Note this PINS the title: the connection records `source: { kind: 'user' }`,
  // which permanently supersedes automatic generation. That is the intent — the
  // task title is the objective — but it does mean the name is final.
  if (title !== undefined && typeof binding.session.rename === 'function') {
    try {
      await binding.session.rename(title)
    } catch {
      // The session is running and has its brief; the title is cosmetic.
    }
  }

  // 5. Only now navigate, so a failure above leaves the user on the list with
  //    the dialog's error rather than in a session that never got its brief.
  ctx.sessions.open(sessionId)
  return sessionId
}

/**
 * Discard a session created for a dialog the user then cancelled.
 *
 * Creating on open is what makes the model picker honest, and this is its
 * price: without it every dismissed dialog leaves a blank session in the
 * sidebar. Failure is swallowed deliberately — the user cancelled, and an error
 * about cleanup for a thing they abandoned is noise.
 *
 * @param ctx - the injected harness services.
 * @param sessionId - the unused session created when the dialog opened.
 */
export async function discardSession(ctx: LaunchContext, sessionId: string): Promise<void> {
  try {
    await ctx.uiWorkspace?.archiveSession(sessionId)
  } catch {
    // Nothing actionable: the session is blank and the user has moved on.
  }
}
