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
}
export default MissionControlService;
