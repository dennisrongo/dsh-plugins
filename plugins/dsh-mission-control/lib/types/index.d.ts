import { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/** Hard cap on the cell, so a corrupt or hostile client cannot grow it
 *  without bound — the panel's real payload is well under 1KB. */
export declare const MAX_STATE_BYTES: number;
declare module '@deepseek-ai/cordis' {
    interface Context {
        dshMissionControl: MissionControlService;
    }
}
/** Result of a load: the stored payload, or null when nothing was saved yet. */
export interface McLoadResult {
    state: string | null;
}
/** How one platform opens a terminal window at a directory. */
export interface TerminalLaunch {
    command: string;
    args: string[];
    /** Working directory for the spawned launcher; also `start`'s /D target. */
    cwd?: string;
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
export declare function terminalLaunchFor(platform: NodeJS.Platform, dir: string, hasWindowsTerminal: boolean): TerminalLaunch;
/** The panel's persisted state, one JSON cell per harness home. */
export declare class MissionControlService extends TypertRemoteService {
    constructor(ctx: Context);
    /** Absolute path of the state cell, or null when DSH_HOME is unset. */
    private file;
    /**
     * Read the cell. An absent or UNREADABLE cell reads as null — the client
     * falls back to its localStorage seed, which is the degradation contract.
     * @param request - empty; there is exactly one cell.
     * @returns the stored payload, or null.
     */
    load(request: Record<string, never>): Promise<McLoadResult>;
    /**
     * Replace the cell. The host never parses the payload (the client owns the
     * shape); it only enforces the size cap. Writes are atomic — tmp file plus
     * rename — so a crash mid-write cannot leave a truncated cell.
     * @param request - `{ state }`, the serialized payload.
     */
    save(request: {
        state: string;
    }): Promise<{
        ok: true;
    }>;
    /**
     * Open a terminal window at a workspace directory. The spawn is
     * fire-and-forget — detached, unref'd, stdio ignored — so the harness never
     * waits on the terminal's lifetime; the promise resolves once the launcher
     * process has actually spawned (an ENOENT launcher still rejects, which is
     * the failure the client surfaces).
     * @param request - `{ path }`, an existing directory, typically a
     *   workspace root the client resolved from the current session.
     */
    openTerminal(request: {
        path: string;
    }): Promise<{
        ok: true;
    }>;
}
export default MissionControlService;
