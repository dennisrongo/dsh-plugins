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
 *   5. navigate to it
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
  modelDirectories?: {
    directoryFor: (sessionId: string) => ModelDirectoryFace
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
}

interface SessionFace {
  prompt: (
    content: { type: 'text'; text: string }[],
    mode: 'queue' | 'steer',
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

interface RawGroup {
  label?: string
  title?: string
  name?: string
  models?: RawModel[]
  items?: RawModel[]
}

interface RawModel {
  provider?: string
  model?: string
  id?: string
  label?: string
  name?: string
  displayName?: string
}

interface RawPreset {
  id: string
  label?: string
  name?: string
  title?: string
  isDefault?: boolean
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
 * Flatten the harness's grouped model catalog into a flat option list.
 *
 * The catalog's group and model records are read defensively — several key
 * spellings are accepted — because this shape is the shell's internal wire
 * projection rather than a contract published for plugins, and a renamed key
 * should cost a missing label, never a crashed dialog.
 *
 * @param groups - catalog groups as the model directory snapshot carries them.
 * @returns every selectable model, in catalog order.
 */
export function flattenModels(groups: readonly RawGroup[]): ModelOption[] {
  const out: ModelOption[] = []
  for (const group of groups) {
    const heading = group.label ?? group.title ?? group.name ?? ''
    for (const model of group.models ?? group.items ?? []) {
      const id = model.model ?? model.id
      const provider = model.provider
      if (id === undefined || provider === undefined) continue
      out.push({
        provider,
        model: id,
        label: model.label ?? model.displayName ?? model.name ?? id,
        group: heading,
      })
    }
  }
  return out
}

/**
 * The presets a person may actually pick, with the deployment default first.
 *
 * A broken preset is one the host failed to compose; offering it would launch a
 * session that cannot run. The shipped picker filters them the same way.
 *
 * @param presets - the roster as the host answered it.
 * @returns selectable options, and the id to preselect.
 */
export function presetOptions(presets: readonly RawPreset[]): {
  options: PresetOption[]
  defaultId: string | undefined
} {
  const healthy = presets.filter((preset) => preset.broken === undefined)
  const options = healthy.map((preset) => ({
    id: preset.id,
    label: preset.label ?? preset.name ?? preset.title ?? preset.id,
  }))
  const defaultId = healthy.find((preset) => preset.isDefault)?.id ?? healthy[0]?.id
  return { options, defaultId }
}

/** What {@link launchSession} needs in order to start the work. */
export interface LaunchRequest {
  sessionId: string
  presetId: string | undefined
  model: ModelChoice | undefined
  prompt: string
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
  const { sessionId, presetId, model, prompt } = request

  // 1. Mode first: only a blank session accepts a preset. Skipped entirely when
  //    the deployment composes no agent presets — the session then runs the
  //    default, exactly as one started from the sidebar would.
  if (presetId !== undefined && ctx.remote.agentPresets !== undefined) {
    const applied = await ctx.remote.agentPresets.select(sessionId, presetId)
    if (!applied.ok) {
      throw new Error(`could not set mode: ${applied.error.message}`)
    }
  }

  // 2. Model second, still before the prompt. Same optionality.
  if (model !== undefined && ctx.modelDirectories !== undefined) {
    await ctx.modelDirectories.directoryFor(sessionId).select(model)
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

  // 4. Only now navigate, so a failure above leaves the user on the list with
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
