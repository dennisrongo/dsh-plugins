/**
 * Host half of dsh-plan-board: durable plans, captured off `exit_plan_mode`.
 *
 * dsh already has plan mode. `@deepseek-ai/dsh-plan-mode` logs a `plan/mode`
 * event, registers the `/plan` command, and exposes an `exit_plan_mode` tool
 * that takes the complete plan as markdown and presents it through
 * `ctx.userQuestions.ask()` for Approve / Keep planning. What it does not do is
 * keep the plan: the markdown exists only inside the tool-call event in the
 * session log, so once you scroll past it, it is gone, and the reviewer's
 * feedback exists only as the text of a thrown error.
 *
 * This plugin captures both, as markdown files under `<workspace>/.dsh/plans/`.
 *
 * ## Where it hooks, and why there
 *
 * `tools/execute` is the around-dispatch waterfall: `next()` runs the tool body,
 * which is the call that blocks on the human. Wrapping it is what makes the
 * outcome observable — the plan is written `pending` before `next()`, and the
 * same file is settled to `approved` or `rejected` after, with the rejection
 * feedback lifted out of the error the tool threw.
 *
 * Two alternatives were rejected. `tools/pre-execute` sees the plan but never
 * the outcome. Registering a second `userQuestions` provider would see the
 * outcome, but the service documents one active provider per context and the
 * shipped UI already holds it — taking it would hijack every question in the
 * harness, not just plan reviews.
 *
 * ## What this plugin deliberately does not do
 *
 * It does not approve plans. Approval belongs to the review question the tool
 * already raised, and answering it from here would mean owning the
 * user-questions channel. The window this plugin opens is a **reading**
 * surface: the plan at full size, with history — the approve control stays
 * where the harness put it.
 *
 * @module @dennisrongo/dsh-plan-board
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ToolDispatchExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { PlanStore, isSafeId } from './store.ts'
import { EXIT_PLAN_MODE, type PlanMeta, type PlanRecord } from './types.ts'

export type * from './types.ts'
export { PlanStore, parse, serialize, isSafeId } from './store.ts'
export { firstHeading, slugify, stamp, MAX_PLAN_BYTES, MAX_PLANS } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshPlans: PlanService
  }
}

/** Request naming one workspace. */
export interface PlanListRequest {
  workspaceId: string
}

/** Reply carrying every plan's metadata, newest first. */
export interface PlanListResult {
  plans: PlanMeta[]
  /** Monotonic token; a change means re-read the list. */
  token: number
}

/** Request naming one plan. */
export interface PlanGetRequest {
  workspaceId: string
  id: string
}

/** Reply carrying one plan with its markdown, or nothing. */
export interface PlanGetResult {
  plan?: PlanRecord
}

/** Reply carrying just the change token. */
export interface PlanTokenResult {
  token: number
  /** Id of the newest pending plan, so a UI can open it without a list read. */
  pendingId?: string
}

/** Reply to a delete. */
export interface PlanRemoveResult {
  ok: boolean
  token: number
}

/**
 * Durable per-workspace plan storage.
 *
 * `workspaceRegistry` is injected because every endpoint is addressed by
 * workspace id — without it the wire surface has nothing to resolve. The
 * capture path does not need it: it takes the directory straight off the
 * presenting session's header, so a plan raised in an unregistered directory is
 * still written.
 */
export class PlanService extends TypertRemoteService {
  static inject = ['tools', 'workspaceRegistry']

  private readonly store = new PlanStore()

  /** Resolved workspace directory per workspace id. */
  private readonly dirs = new Map<string, string>()

  /**
   * @param ctx - host context carrying the tool registry and workspace registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'dshPlans')
  }

  /** Wrap `exit_plan_mode`'s dispatch so the plan and its outcome are kept. */
  protected async [Service.init](): Promise<void> {
    this.ctx.on(
      'tools/execute',
      async (
        exec: ToolDispatchExecution,
        next: () => Promise<ToolExecutionResult>,
      ): Promise<ToolExecutionResult> => {
        if (exec.name !== EXIT_PLAN_MODE) return next()

        const plan = (exec.arguments as { plan?: unknown } | undefined)?.plan
        const dir = exec.agent?.session.header.cwd
        // No directory means no workspace to write into. The plan still gets
        // reviewed — capture is an addition, never a precondition.
        if (typeof plan !== 'string' || dir === undefined) return next()

        let record: PlanRecord | undefined
        try {
          record = await this.store.enqueue(dir, () =>
            this.store.create(dir, plan, String(exec.agent?.id ?? '')),
          )
        } catch (err) {
          console.warn('[dsh-plan-board] could not store the presented plan:', err)
        }

        // `next()` runs the tool body, which blocks on the human. Whatever it
        // does, the wrapper must return it unchanged: this plugin observes the
        // review, it does not participate in it.
        try {
          const result = await next()
          if (record !== undefined) {
            await this.settle(
              dir,
              record.id,
              result.isError ? 'rejected' : 'approved',
              result.isError ? messageOf(result) : undefined,
            )
          }
          return result
        } catch (err) {
          // A throw here is the plan-mode tool refusing (kept planning, or the
          // review dismissed). It still has to propagate untouched.
          if (record !== undefined) {
            await this.settle(dir, record.id, 'rejected', err instanceof Error ? err.message : String(err))
          }
          throw err
        }
      },
    )
  }

  /** Settle a stored plan without letting a storage failure reach the caller. */
  private async settle(
    dir: string,
    id: string,
    status: 'approved' | 'rejected',
    feedback: string | undefined,
  ): Promise<void> {
    try {
      await this.store.enqueue(dir, () => this.store.settle(dir, id, status, feedback))
    } catch (err) {
      console.warn('[dsh-plan-board] could not record the plan decision:', err)
    }
  }

  /**
   * Resolve a workspace id to its canonical directory.
   * @param workspaceId - id from the wire.
   * @returns the absolute workspace directory.
   */
  private dirOf(workspaceId: unknown): string {
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      throw new Error('dsh-plan-board: workspaceId must be a non-empty string')
    }
    const cached = this.dirs.get(workspaceId)
    if (cached !== undefined) return cached
    const hit = this.ctx.workspaceRegistry.list().find((w: Workspace) => String(w.id) === workspaceId)
    if (hit === undefined) throw new Error(`dsh-plan-board: unknown workspace ${workspaceId}`)
    this.dirs.set(workspaceId, hit.path)
    return hit.path
  }

  /**
   * Every plan's metadata for one workspace, newest first.
   * @param request - the workspace to read.
   * @returns metadata only — bodies are fetched one at a time through `get`.
   */
  @Remote
  async list(request: PlanListRequest): Promise<PlanListResult> {
    const dir = this.dirOf(request?.workspaceId)
    return { plans: this.store.list(dir), token: this.store.token(dir) }
  }

  /**
   * One plan with its markdown.
   * @param request - the workspace and plan id.
   * @returns the record, or an empty reply when it is gone.
   */
  @Remote
  async get(request: PlanGetRequest): Promise<PlanGetResult> {
    const dir = this.dirOf(request?.workspaceId)
    if (!isSafeId(request?.id)) return {}
    const plan = this.store.get(dir, request.id)
    return plan === undefined ? {} : { plan }
  }

  /**
   * The change token, plus the newest pending plan's id.
   *
   * This is the polled endpoint, so it must stay cheap. It reads the directory
   * — one `readdir` plus a parse per file — and never touches a plan the caller
   * did not ask for. The token itself is an in-memory counter, so a poll that
   * finds no change costs nothing beyond the listing.
   * @param request - the workspace to check.
   * @returns the token and any pending plan.
   */
  @Remote
  async changeToken(request: PlanListRequest): Promise<PlanTokenResult> {
    const dir = this.dirOf(request?.workspaceId)
    const pending = this.store.list(dir).find((plan) => plan.status === 'pending')
    return {
      token: this.store.token(dir),
      ...(pending !== undefined ? { pendingId: pending.id } : {}),
    }
  }

  /**
   * Delete one plan file.
   * @param request - the workspace and plan id.
   * @returns whether a file was removed, and the new token.
   */
  @Remote
  async discard(request: PlanGetRequest): Promise<PlanRemoveResult> {
    const dir = this.dirOf(request?.workspaceId)
    const ok = await this.store.enqueue(dir, () => this.store.remove(dir, request?.id))
    return { ok, token: this.store.token(dir) }
  }
}

/**
 * The human-readable text of a failed tool result.
 *
 * The rejection feedback lives in the failure's message and nowhere else, so
 * this is the only place it can be recovered from.
 * @param result - a failed execution result.
 * @returns the message, or an empty string.
 */
function messageOf(result: ToolExecutionResult): string {
  if (!result.isError) return ''
  const error = result.error as { message?: unknown } | undefined
  if (typeof error?.message === 'string') return error.message
  for (const block of result.content) {
    if (block.type === 'text' && typeof block.text === 'string') return block.text
  }
  return ''
}

export default PlanService
