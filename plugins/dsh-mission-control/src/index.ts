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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
}

export default MissionControlService
