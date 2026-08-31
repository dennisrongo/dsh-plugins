/**
 * Host half of dsh-mission-control: one origin-independent state cell.
 *
 * The panel used to be a pure client-side consumer with all persistence in
 * localStorage. That silently broke on DSH Desktop, which serves the UI from
 * an ephemeral port per launch: localStorage is origin-scoped, so every
 * restart was a fresh website and the pomodoro timer (and eventually the
 * panel settings) vanished. This service is the smallest possible fix: a
 * single JSON cell at `<DSH_HOME>/storages/dsh-mission-control.json` with a
 * load/save pair, the client owning the envelope shape.
 *
 * The methods are marked `@Remote`, publishing them through the Typert
 * gateway; the client mounts the matching descriptor from ./remote.ts and
 * calls them as `ctx.remote.dshMissionControl.load(...)` / `.save(...)`.
 *
 * @module @dennisrongo/dsh-mission-control
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

/** Hard cap on the cell, so a corrupt or hostile client cannot grow it
 *  without bound — the panel's real payload is well under 1KB. */
export const MAX_STATE_BYTES = 64 * 1024

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshMissionControl: MissionControlService
  }
}

/** Result of a load: the stored payload, or null when nothing was saved yet. */
export interface McLoadResult {
  state: string | null
}

/** How one platform opens a terminal window at a directory. */
export interface TerminalLaunch {
  command: string
  args: string[]
  /** Working directory for the spawned launcher; also `start`'s /D target. */
  cwd?: string
}

/**
 * Pick the launcher for a platform. Pure so the smoke suite can pin every
 * platform's choice without actually opening a window:
 *  - macOS: `open -a Terminal <dir>` (the stock terminal; it cd's to the dir)
 *  - Windows: Windows Terminal when on PATH, else `cmd /c start` — `start`
 *    needs the empty title argument (`""`) or a quoted /D path is eaten as
 *    the window title.
 *  - anything else: the freedesktop `x-terminal-emulator` indirection.
 * @param platform - process.platform value being answered for.
 * @param dir - directory the new terminal starts in; already stat-verified.
 * @param hasWindowsTerminal - whether `wt.exe` resolved on PATH.
 */
export function terminalLaunchFor(
  platform: NodeJS.Platform,
  dir: string,
  hasWindowsTerminal: boolean,
): TerminalLaunch {
  if (platform === 'darwin') return { command: 'open', args: ['-a', 'Terminal', dir] }
  if (platform === 'win32') {
    return hasWindowsTerminal
      ? { command: 'wt.exe', args: ['-d', dir] }
      : { command: 'cmd.exe', args: ['/c', 'start', '""', '/D', dir, 'cmd.exe'], cwd: dir }
  }
  return { command: 'x-terminal-emulator', args: [], cwd: dir }
}

/**
 * Whether `bin` resolves on PATH. `spawn` would answer the same question via
 * its async error event, but probing first lets openTerminal fall back from
 * Windows Terminal to cmd instead of failing the whole call.
 * @param bin - bare binary name, without extension.
 */
function onPath(bin: string): boolean {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    for (const ext of exts) {
      if (existsSync(join(entry, bin + ext))) return true
    }
  }
  return false
}

/** The panel's persisted state, one JSON cell per harness home. */
export class MissionControlService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'dshMissionControl')
  }

  /** Absolute path of the state cell, or null when DSH_HOME is unset. */
  private file(): string | null {
    const home = process.env.DSH_HOME
    return home ? join(home, 'storages', 'dsh-mission-control.json') : null
  }

  /**
   * Read the cell. An absent or UNREADABLE cell reads as null — the client
   * falls back to its localStorage seed, which is the degradation contract.
   * @param request - empty; there is exactly one cell.
   * @returns the stored payload, or null.
   */
  @Remote
  async load(request: Record<string, never>): Promise<McLoadResult> {
    const file = this.file()
    if (!file || !existsSync(file)) return { state: null }
    try {
      return { state: readFileSync(file, 'utf8') }
    } catch {
      return { state: null }
    }
  }

  /**
   * Replace the cell. The host never parses the payload (the client owns the
   * shape); it only enforces the size cap. Writes are atomic — tmp file plus
   * rename — so a crash mid-write cannot leave a truncated cell.
   * @param request - `{ state }`, the serialized payload.
   */
  @Remote
  async save(request: { state: string }): Promise<{ ok: true }> {
    const state = request?.state
    if (typeof state !== 'string') {
      throw new Error('dsh-mission-control: state must be a string')
    }
    if (state.length > MAX_STATE_BYTES) {
      throw new Error('dsh-mission-control: state exceeds the 64KB cap')
    }
    const file = this.file()
    if (!file) throw new Error('dsh-mission-control: DSH_HOME is not set')
    mkdirSync(dirname(file), { recursive: true })
    const tmp = file + '.tmp'
    writeFileSync(tmp, state, 'utf8')
    renameSync(tmp, file)
    return { ok: true }
  }

  /**
   * Open a terminal window at a workspace directory. The spawn is
   * fire-and-forget — detached, unref'd, stdio ignored — so the harness never
   * waits on the terminal's lifetime; the promise resolves once the launcher
   * process has actually spawned (an ENOENT launcher still rejects, which is
   * the failure the client surfaces).
   * @param request - `{ path }`, an existing directory, typically a
   *   workspace root the client resolved from the current session.
   */
  @Remote
  async openTerminal(request: { path: string }): Promise<{ ok: true }> {
    const dir = request?.path
    if (typeof dir !== 'string' || dir.length === 0) {
      throw new Error('dsh-mission-control: path must be a non-empty string')
    }
    try {
      if (!statSync(dir).isDirectory()) {
        throw new Error(`dsh-mission-control: not a directory: ${dir}`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('dsh-mission-control:')) throw error
      throw new Error(`dsh-mission-control: directory does not exist: ${dir}`)
    }
    const launch = terminalLaunchFor(
      process.platform,
      dir,
      process.platform === 'win32' ? onPath('wt') : false,
    )
    await new Promise<void>((resolve, reject) => {
      const child = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        detached: true,
        stdio: 'ignore',
      })
      child.once('error', (error) => {
        reject(new Error(`dsh-mission-control: could not open a terminal: ${error.message}`))
      })
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })
    return { ok: true }
  }
}

export default MissionControlService
