/**
 * The two configuration layers and how they combine.
 *
 * **User layer** — a `dsh-hooks` settings namespace, so the document is
 * `$DSH_HOME/settings.yaml`, validated by schemastery, observable through
 * `SettingsScope.watch`, and visible to any configuration surface that renders
 * `ctx.settings.describe()`.
 *
 * **Project layer** — `<workspace>/.dsh/hooks.json`, so a repository can ship
 * its own hooks and a clone gets them with no setup. Read from disk on every
 * resolve and cached against the file's mtime+size, because the alternative —
 * a watcher per workspace — costs a handle per open project to save a `stat`.
 *
 * The layers are **additive, not overriding**: every matching hook from both
 * documents runs. That is Claude Code's own semantics, and it is the safe
 * direction — a checked-out repository must not be able to silently disable a
 * user's global guard by declaring an empty list for the same event.
 *
 * @module @dennisrongo/dsh-hooks/config
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_TIMEOUT_SECONDS,
  HOOK_EVENTS,
  HOOK_EVENT_SET,
  MAX_TIMEOUT_SECONDS,
  type HookCommand,
  type HookEvent,
  type HookMatcherGroup,
  type HooksConfig,
  type ResolvedHook,
} from './types.ts'

/** Directory inside a workspace that carries harness-local state. */
export const DOT_DSH = '.dsh'
/** Project-layer document name inside `<workspace>/.dsh`. */
export const PROJECT_FILE = 'hooks.json'

/** One command entry, as schemastery validates it in the settings document. */
const commandSchema = z.object({
  type: z.union(['command' as const]).default('command').description('Only `command` exists today.'),
  command: z.string().required().description('Shell command line, run through the configured shell.'),
  timeout: z
    .number()
    .min(1)
    .max(MAX_TIMEOUT_SECONDS)
    .default(DEFAULT_TIMEOUT_SECONDS)
    .description('Wall-clock budget in seconds before the process tree is terminated.'),
  failClosed: z
    .boolean()
    .default(false)
    .description(
      'Treat a crash, timeout or unparseable reply as a denial. Off by default so a broken hook cannot brick every tool call.',
    ),
})

/** One matcher group. */
const groupSchema = z.object({
  matcher: z
    .string()
    .default('')
    .description('Regular expression over the tool name. Empty or `*` matches every tool.'),
  hooks: z.array(commandSchema).default([]).description('Commands run in parallel when the matcher hits.'),
})

/**
 * The settings namespace value.
 *
 * `shell` is explicit rather than derived because the derivation is a guess:
 * a Windows box with Git Bash on PATH can legitimately want either shell, and
 * a hook that silently ran under the wrong one would fail in a way that reads
 * like the hook itself is broken.
 */
export const HooksSettings = z.object({
  enabled: z.boolean().default(true).description('Master switch for every hook in both layers.'),
  shell: z
    .array(z.string())
    .default([])
    .description(
      'argv prefix the command line is appended to, e.g. ["bash","-lc"]. Empty picks the platform default: pwsh/powershell on Windows, bash elsewhere.',
    ),
  projectHooks: z
    .boolean()
    .default(true)
    .description('Also read <workspace>/.dsh/hooks.json. Turn off to trust only your own settings.'),
  hooks: z
    .object(Object.fromEntries(HOOK_EVENTS.map((event) => [event, z.array(groupSchema).default([])])))
    .default({})
    .description('Matcher groups per lifecycle point.'),
})

/** Resolved settings-namespace value. */
export interface HooksSettingsValue {
  enabled: boolean
  shell: string[]
  projectHooks: boolean
  hooks: Record<HookEvent, HookMatcherGroup[]>
}

/**
 * The platform's default shell argv prefix.
 *
 * PowerShell is chosen over `cmd` on Windows for the same reason the harness
 * ships `tool-pwsh` there: `cmd` has no usable quoting story for a command line
 * that came out of a JSON string.
 * @returns the argv prefix a command line is appended to.
 */
export function defaultShell(): string[] {
  return process.platform === 'win32'
    ? ['pwsh', '-NoProfile', '-NonInteractive', '-Command']
    : ['bash', '-lc']
}

/**
 * Coerce one untrusted command entry, dropping it when it cannot be run.
 *
 * A malformed entry is dropped rather than defaulted, because every default
 * this could invent — an empty command, a zero timeout — describes a hook the
 * user did not ask for. Returning `undefined` lets the caller count and report it.
 * @param value - raw entry from either document.
 * @returns the usable command, or undefined when the entry is unusable.
 */
function coerceCommand(value: unknown): HookCommand | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.command !== 'string' || raw.command.trim() === '') return undefined
  // `type` is required by the schema for Claude Code parity, but an entry that
  // omits it is unambiguous — there is only one type — so it is defaulted here
  // rather than rejected.
  if (raw.type !== undefined && raw.type !== 'command') return undefined
  const timeout =
    typeof raw.timeout === 'number' && Number.isFinite(raw.timeout) && raw.timeout > 0
      ? Math.min(raw.timeout, MAX_TIMEOUT_SECONDS)
      : DEFAULT_TIMEOUT_SECONDS
  return {
    type: 'command',
    command: raw.command,
    timeout,
    failClosed: raw.failClosed === true,
  }
}

/**
 * Coerce a whole untrusted hooks document.
 *
 * Unknown event keys are dropped: a typo like `PreToolUSe` must not become a
 * lifecycle point that never fires and never complains.
 * @param value - parsed JSON or a resolved settings section.
 * @returns the usable subset, plus the count of entries that were dropped.
 */
export function coerceDocument(value: unknown): { config: HooksConfig; dropped: number } {
  const config: HooksConfig = {}
  let dropped = 0
  if (!value || typeof value !== 'object') return { config, dropped }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!HOOK_EVENT_SET.has(key)) {
      dropped += 1
      continue
    }
    if (!Array.isArray(raw)) {
      dropped += 1
      continue
    }
    const groups: HookMatcherGroup[] = []
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') {
        dropped += 1
        continue
      }
      const group = entry as Record<string, unknown>
      const hooks: HookCommand[] = []
      for (const command of Array.isArray(group.hooks) ? group.hooks : []) {
        const coerced = coerceCommand(command)
        if (coerced === undefined) dropped += 1
        else hooks.push(coerced)
      }
      if (hooks.length === 0) continue
      groups.push({
        matcher: typeof group.matcher === 'string' ? group.matcher : undefined,
        hooks,
      })
    }
    if (groups.length > 0) config[key as HookEvent] = groups
  }
  return { config, dropped }
}

/** One cached project document, keyed by its path. */
interface ProjectCacheEntry {
  /** `mtimeMs:size` of the file when it was parsed; a miss re-reads. */
  stamp: string
  config: HooksConfig
  dropped: number
}

/**
 * Reads and caches `<workspace>/.dsh/hooks.json`.
 *
 * Cached against `mtimeMs:size` rather than watched: a hooks document changes
 * about as often as a `.gitignore`, and one `stat` per lifecycle point is
 * cheaper than an `fs.watch` handle held open for every workspace a long-lived
 * harness has ever touched.
 */
export class ProjectHooks {
  private readonly cache = new Map<string, ProjectCacheEntry>()

  /**
   * Read one workspace's project-layer document.
   * @param workspaceDir - absolute workspace directory.
   * @returns the parsed document, or an empty one when absent or unreadable.
   */
  read(workspaceDir: string): { config: HooksConfig; dropped: number; path: string } {
    const path = join(workspaceDir, DOT_DSH, PROJECT_FILE)
    let stamp: string
    try {
      const stat = statSync(path)
      stamp = `${stat.mtimeMs}:${stat.size}`
    } catch {
      // Absent is the overwhelmingly common case and is not an error; drop any
      // cached parse so deleting the file takes effect immediately.
      this.cache.delete(path)
      return { config: {}, dropped: 0, path }
    }
    const cached = this.cache.get(path)
    if (cached?.stamp === stamp) return { config: cached.config, dropped: cached.dropped, path }
    try {
      const { config, dropped } = coerceDocument(JSON.parse(readFileSync(path, 'utf8')))
      this.cache.set(path, { stamp, config, dropped })
      return { config, dropped, path }
    } catch (err) {
      // A syntax error must be loud: a hooks file that silently does nothing is
      // indistinguishable from one that is working.
      console.warn(`[dsh-hooks] ignoring unparseable ${path}:`, err instanceof Error ? err.message : err)
      this.cache.set(path, { stamp, config: {}, dropped: 0 })
      return { config: {}, dropped: 0, path }
    }
  }

  /** Drop every cached parse; used when the plugin is reconfigured. */
  clear(): void {
    this.cache.clear()
  }
}

/**
 * Flatten both layers into the hooks that apply to one lifecycle point.
 *
 * User entries come first so their runs are reported first, but order carries
 * no authority: aggregation in `runner.ts` is monotonic toward the most
 * restrictive verdict, so which document a denial came from cannot change the
 * outcome.
 * @param event - the lifecycle point being dispatched.
 * @param user - the resolved settings-namespace section.
 * @param project - the workspace document, already coerced.
 * @param userOrigin - path of the settings document, for diagnostics.
 * @param projectOrigin - path of the workspace document, for diagnostics.
 * @returns every configured hook for this event, in layer order.
 */
export function resolveHooks(
  event: HookEvent,
  user: HooksConfig,
  project: HooksConfig,
  userOrigin: string,
  projectOrigin: string,
): ResolvedHook[] {
  const out: ResolvedHook[] = []
  for (const [config, source, origin] of [
    [user, 'user', userOrigin],
    [project, 'project', projectOrigin],
  ] as const) {
    for (const group of config[event] ?? []) {
      for (const command of group.hooks) {
        out.push({ event, matcher: group.matcher, command, source, origin })
      }
    }
  }
  return out
}
