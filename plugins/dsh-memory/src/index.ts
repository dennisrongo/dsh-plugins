/**
 * Host half of dsh-memory: write a fact into the instruction hierarchy, and see
 * what the loader did with it.
 *
 * dsh already has the read half of a memory system, and it is more capable than
 * it looks. `@deepseek-ai/dsh-agent-instructions` — described by its own
 * manifest as a "Workspace context loader for AGENTS.md/CLAUDE.md instruction
 * files" — loads the user-global `$DSH_HOME/AGENTS.md`, then every
 * `AGENTS.md` / `CLAUDE.md` from the project root down to the session cwd, plus
 * `.local` overlays, deduplicated per directory, cut to a byte budget, and it
 * pulls in nested files as the agent touches them.
 *
 * Two things were missing, and this plugin is exactly those two:
 *
 *   * **Nothing writes.** There is no `#`-style capture and no `/remember`, so
 *     a fact learned mid-session is a fact you retype into a file by hand.
 *   * **Nothing shows what loaded.** The budget silently omits files. A file
 *     that exists, is discovered, and is dropped for budget is indistinguishable
 *     from a file the agent is ignoring for no reason — and the byte budget in
 *     the shipped `code` preset is 64 KiB, which a real monorepo reaches.
 *
 * Deliberately NOT a second memory store. A parallel fact database beside the
 * instruction files would mean two things to keep in sync, two precedence
 * orders, and a place for facts to hide from a loader that already works.
 *
 * @module @dennisrongo/dsh-memory
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { appendFact, dshHome, inspect, readInstruction, targetFor } from './files.ts'
import {
  MEMORY_SCOPES,
  parseScope,
  validateFact,
  type InstructionReport,
  type MemoryScope,
} from './types.ts'

export type * from './types.ts'
export { appendFact, inspect, readInstruction, targetFor, findProjectRoot, dshHome } from './files.ts'
export { formatFact, parseScope, validateFact, MEMORY_SCOPES, MEMORY_HEADING, MAX_FACT_CHARS } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshMemory: MemoryService
  }
}

/**
 * Default byte budget the inspector reports against.
 *
 * The shipped `code` agent preset configures `agent-instructions` with
 * `maxBytes: 65536`. This plugin cannot read another plugin's entry config, so
 * it restates that value and lets a profile override it — reporting against the
 * wrong budget would mean reporting the wrong omissions, which is the one thing
 * the inspector exists to get right.
 */
export const DEFAULT_MAX_BYTES = 65536

/** Plugin config. */
export interface Config {
  /** Byte budget to report against; must match `agent-instructions`' `maxBytes`. */
  maxBytes?: number
}

/** Request naming one workspace. */
export interface MemoryInspectRequest {
  workspaceId: string
}

/** Reply carrying the instruction report. */
export interface MemoryInspectResult {
  report: InstructionReport
}

/** Request to write one fact. */
export interface MemoryRememberRequest {
  workspaceId: string
  fact: string
  scope: MemoryScope
}

/** Reply to a write. */
export type MemoryRememberResult =
  | { ok: true; path: string; line: string }
  | { ok: false; reason: string }

/** Request to read one discovered instruction file. */
export interface MemoryReadRequest {
  workspaceId: string
  absolutePath: string
}

/** Reply carrying a file's contents. */
export interface MemoryReadResult {
  text?: string
}

/**
 * Instruction capture and inspection.
 *
 * `workspaceRegistry` is injected because every endpoint is addressed by
 * workspace id. `commands` is not: it is picked up through a child fiber, so a
 * deployment that composes no command registry still gets the endpoints.
 */
export class MemoryService extends TypertRemoteService {
  static inject = ['workspaceRegistry']

  /** Byte budget the inspector reports against. */
  private readonly maxBytes: number

  /** Resolved workspace directory per workspace id. */
  private readonly dirs = new Map<string, string>()

  /**
   * @param ctx - host context carrying the workspace registry.
   * @param config - plugin config; `maxBytes` must match the loader's.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'dshMemory')
    const configured = config.maxBytes
    this.maxBytes =
      typeof configured === 'number' && Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_MAX_BYTES
  }

  /** Register `/remember` if a command registry is composed. */
  protected async [Service.init](): Promise<void> {
    // A fiber rather than an inject entry: `commands` may mount after this
    // service, and its registration unwinds with the fiber if it unmounts.
    this.ctx.inject(['commands'], (scoped: Context) => {
      scoped.effect(
        () =>
          scoped.commands.register({
            name: 'remember',
            description: 'Append a fact to AGENTS.md so future sessions read it',
            input: { hint: '[--project|--local|--user] the thing to remember' },
            handler: (invocation: CommandInvocation): CommandResult => this.handleRemember(invocation),
          }),
        'dsh-memory: /remember registration',
      )
    })
  }

  /**
   * Run one `/remember` invocation.
   *
   * The reply names the exact file written, always. A capture command whose
   * output is "saved" leaves the user guessing which of four candidate files in
   * the hierarchy it landed in.
   * @param invocation - the command invocation.
   * @returns the rendered result.
   */
  private handleRemember(invocation: CommandInvocation): CommandResult {
    const { scope, rest } = parseScope(invocation.rawInput)
    const checked = validateFact(rest)
    if (!checked.ok) {
      return { kind: 'error', text: `/remember: ${checked.reason}` }
    }
    const cwd = invocation.agent.session.header.cwd
    if (cwd === undefined) {
      return { kind: 'error', text: '/remember: this session has no working directory to write into' }
    }
    try {
      const path = targetFor(scope, cwd)
      const line = appendFact(path, checked.fact)
      return { kind: 'success', text: `Remembered in ${path}\n${line}` }
    } catch (err) {
      return {
        kind: 'error',
        text: `/remember: could not write the memory — ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  /**
   * Resolve a workspace id to its canonical directory.
   * @param workspaceId - id from the wire.
   * @returns the absolute workspace directory.
   */
  private dirOf(workspaceId: unknown): string {
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      throw new Error('dsh-memory: workspaceId must be a non-empty string')
    }
    const cached = this.dirs.get(workspaceId)
    if (cached !== undefined) return cached
    const hit = this.ctx.workspaceRegistry.list().find((w: Workspace) => String(w.id) === workspaceId)
    if (hit === undefined) throw new Error(`dsh-memory: unknown workspace ${workspaceId}`)
    this.dirs.set(workspaceId, hit.path)
    return hit.path
  }

  /**
   * Every instruction file discovered for a workspace, and whether the byte
   * budget kept it.
   * @param request - the workspace to inspect.
   * @returns the report.
   */
  @Remote
  async inspect(request: MemoryInspectRequest): Promise<MemoryInspectResult> {
    const dir = this.dirOf(request?.workspaceId)
    return { report: await inspect(dir, this.maxBytes) }
  }

  /**
   * Append one fact to the instruction file for the chosen scope.
   * @param request - the workspace, fact and scope.
   * @returns the file written and the line, or a refusal.
   */
  @Remote
  async remember(request: MemoryRememberRequest): Promise<MemoryRememberResult> {
    const dir = this.dirOf(request?.workspaceId)
    const checked = validateFact(request?.fact)
    if (!checked.ok) return { ok: false, reason: checked.reason }
    const scope = request?.scope
    if (!MEMORY_SCOPES.includes(scope)) {
      return { ok: false, reason: `scope must be one of ${MEMORY_SCOPES.join(', ')}` }
    }
    try {
      const path = targetFor(scope, dir)
      const line = appendFact(path, checked.fact)
      return { ok: true, path, line }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * Read one discovered instruction file.
   *
   * Only a path the loader discovered for this workspace is accepted — that
   * check is what stops this becoming a read-any-file endpoint.
   * @param request - the workspace and the absolute path.
   * @returns the contents, or an empty reply.
   */
  @Remote
  async read(request: MemoryReadRequest): Promise<MemoryReadResult> {
    const dir = this.dirOf(request?.workspaceId)
    const text = await readInstruction(dir, request?.absolutePath)
    return text === undefined ? {} : { text }
  }
}

export { dshHome as harnessHome }
export default MemoryService
