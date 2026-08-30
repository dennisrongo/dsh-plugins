/**
 * Host half of dsh-plan-board: durable plans, captured two ways.
 *
 * **Explicitly**, from `exit_plan_mode` — the plan-mode route, which carries a
 * real review outcome. **Implicitly**, from a ```plan fence in an assistant
 * message — the route for sessions that never enter plan mode, which is how
 * most sessions actually work. Both land in the same store and the same panel;
 * they differ only in status, because one was submitted for approval and the
 * other was not.
 *
 * The implicit path is marker-based, not heuristic. A registered system-prompt
 * section asks the model to fence its plans; detection is then exact. Sniffing
 * prose for "plan-shaped" structure would fire on any answer with a heading and
 * a list, and a plan store full of false positives is worse than one that
 * occasionally misses — an unfenced plan simply stays in the transcript, which
 * is the behaviour without this plugin anyway.
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
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { PlanStore, isSafeId } from './store.ts'
import { EXIT_PLAN_MODE, PLAN_FENCE, extractFencedPlans, type PlanMeta, type PlanRecord } from './types.ts'

export type * from './types.ts'
export { PlanStore, parse, serialize, isSafeId } from './store.ts'
export { firstHeading, slugify, stamp, extractFencedPlans, MAX_PLAN_BYTES, MAX_PLANS, PLAN_FENCE } from './types.ts'

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
  /**
   * Newest plan the reader has not dealt with, so a UI can open it without a
   * list read. Covers BOTH unsettled states: `pending` (a review is open) and
   * `proposed` (written into the conversation, no review). Keying this on
   * `pending` alone was the bug that stopped the dock ever opening for a plan
   * the model fenced — which is the case it exists for.
   */
  openPlanId?: string
}

/** Reply to a delete. */
export interface PlanRemoveResult {
  ok: boolean
  token: number
}

/** Request to pin one assistant message into the plan store by hand. */
export interface PlanPinRequest {
  workspaceId: string
  /** Identity from the `assistant/message` event, as the action seat supplies it. */
  messageId: string
}

/** Reply to a pin. */
export type PlanPinResult = { ok: true; id: string; token: number } | { ok: false; reason: string }

/**
 * How many recent assistant messages stay pinnable.
 *
 * Enough to cover scrolling back a little in a live session; not a transcript
 * mirror. A pin on something older simply reports that it is no longer
 * available rather than silently doing nothing.
 */
const MAX_REMEMBERED_MESSAGES = 200

/**
 * Concatenate an assistant message's text blocks.
 * @param content - the message's content blocks.
 * @returns the text, or an empty string when it carries none.
 */
function messageText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type: 'text'; text: string } => {
      const block = b as { type?: unknown; text?: unknown }
      return block.type === 'text' && typeof block.text === 'string'
    })
    .map((b) => b.text)
    .join('\n')
}

/**
 * What the model is told about presenting plans.
 *
 * This is the whole reason capture works outside plan mode. Sniffing assistant
 * prose for "plan-shaped" structure fires on any answer with a heading and a
 * list; asking for one unambiguous marker makes detection exact, and a model
 * that ignores it just leaves the plan in the transcript — which is the
 * behaviour without this plugin anyway. Nothing here asks the model to change
 * WHAT it writes, only to fence it.
 */
const PLAN_PROMPT_SECTION = [
  'When you present an implementation plan, a design, or a proposed approach for',
  'the user to review, wrap the plan itself in a FOUR-backtick fenced block',
  'tagged `' + PLAN_FENCE + '`:',
  '',
  '    ````' + PLAN_FENCE,
  '    # Title of the plan',
  '',
  '    ...the complete plan as markdown, including any ``` code blocks...',
  '    ````',
  '',
  'Four backticks, not three. Plans routinely contain code blocks, and a',
  'three-backtick plan fence ends at the first ``` inside it — silently, taking',
  'the rest of the plan with it.',
  '',
  'Start it with a `#` heading naming the plan. Put ONLY the plan inside the',
  'fence — any preamble or follow-up question belongs outside it. Fence a plan',
  'once; do not repeat it verbatim in a later message.',
  '',
  'This is presentation only. It does not change whether you need approval, and',
  'it is not a substitute for `' + EXIT_PLAN_MODE + '` when the session is in plan',
  'mode — in plan mode, present through that tool as instructed there.',
].join('\n')

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
   * Recent assistant message text, keyed by message id.
   *
   * The manual pin arrives from the browser carrying only a `messageId` — that
   * is all the assistant-actions seat is given — so the text has to be
   * recoverable here. Bounded because this is a convenience cache, not a
   * second copy of the transcript: the session log remains the record.
   */
  private readonly recentMessages = new Map<string, string>()

  /**
   * @param ctx - host context carrying the tool registry and workspace registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'dshPlans')
  }

  /**
   * Wire both capture paths.
   *
   * They are deliberately independent. `exit_plan_mode` is the explicit route
   * and carries a real review outcome; the fenced block is the implicit one and
   * carries none. A session can use either, or both, and neither knows about
   * the other.
   */
  protected async [Service.init](): Promise<void> {
    // Teaching the model to mark plans is what makes implicit capture exact.
    // A fiber rather than an inject entry: system-prompt may mount after this
    // service, and a deployment without one still gets explicit capture.
    this.ctx.inject(['systemPrompt'], (scoped: Context) => {
      scoped.effect(
        () =>
          scoped.systemPrompt.section({
            name: 'dsh-plan-board:plan-fence',
            // Before the persona (0) and well before tool guidance (100+):
            // this is a presentation convention, not behaviour.
            order: -40,
            text: PLAN_PROMPT_SECTION,
          }),
        'dsh-plan-board: plan fence section',
      )
    })

    this.ctx.on('session/event', (session: Session, event: SessionEvent) => {
      if (event.type !== 'assistant/message') return
      void this.captureFenced(session, event as SessionEvent<'assistant/message'>)
    })

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
          // A throw here is normally the plan-mode tool refusing — kept
          // planning, or the review dismissed — which is a real outcome worth
          // recording. But `exit_plan_mode` stays registered while plan mode is
          // INACTIVE (the tool catalog is deliberately stable across
          // transitions), and a stray call then fails before any review is
          // raised. Keeping that would leave a plan marked "Kept planning" whose
          // feedback is an internal error, so it is removed instead.
          const message = err instanceof Error ? err.message : String(err)
          if (record !== undefined) {
            if (message.includes('only available in plan mode')) {
              await this.store.enqueue(dir, () => this.store.remove(dir, record.id))
            } else {
              await this.settle(dir, record.id, 'rejected', message)
            }
          }
          throw err
        }
      },
    )
  }

  /**
   * Capture every `plan` fence in one assistant message.
   *
   * Stored as `proposed`: nothing was submitted for approval, so calling it
   * pending would advertise a review that does not exist. Failures are swallowed
   * — this observes the conversation and must never disturb it.
   * @param session - the session whose log grew.
   * @param event - the appended `assistant/message` event.
   */
  private async captureFenced(session: Session, event: SessionEvent): Promise<void> {
    try {
      const dir = session.header.cwd
      if (dir === undefined) return
      const message = (event as { data?: { message?: { content?: unknown } } }).data?.message
      const blocks = Array.isArray(message?.content) ? message.content : []
      const text = blocks
        .filter((b): b is { type: 'text'; text: string } => {
          const block = b as { type?: unknown; text?: unknown }
          return block.type === 'text' && typeof block.text === 'string'
        })
        .map((b) => b.text)
        .join('\n')
      if (text === '') return
      const plans = extractFencedPlans(text)
      if (plans.length === 0) return
      for (const plan of plans) {
        await this.store.enqueue(dir, () =>
          this.store.create(dir, plan, String(session.id), Date.now(), 'proposed'),
        )
      }
    } catch (err) {
      console.warn('[dsh-plan-board] could not store a fenced plan:', err)
    }
  }

  /**
   * Keep one assistant message's text for a later manual pin.
   * @param id - the message id the browser will name.
   * @param text - its concatenated text blocks.
   */
  private rememberMessage(id: string, text: string): void {
    this.recentMessages.set(id, text)
    if (this.recentMessages.size > MAX_REMEMBERED_MESSAGES) {
      // Map iterates in insertion order, so the first key is the oldest.
      const oldest = this.recentMessages.keys().next()
      if (!oldest.done) this.recentMessages.delete(oldest.value)
    }
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
    const open = this.store
      .list(dir)
      .find((plan) => plan.status === 'pending' || plan.status === 'proposed')
    return {
      token: this.store.token(dir),
      ...(open !== undefined ? { openPlanId: open.id } : {}),
    }
  }

  /**
   * Pin one assistant message into the plan store by hand.
   *
   * The escape hatch for the marker: when the model writes a plan and does not
   * fence it, nothing is captured, and a user who wants it in the panel has no
   * other route. The whole message becomes the plan — the fence is what
   * separates plan from prose, and without one there is nothing to trim by, so
   * guessing where the plan starts would be the heuristic this design avoids.
   * @param request - the workspace and the message to pin.
   * @returns the stored plan id, or why it could not be pinned.
   */
  @Remote
  async pin(request: PlanPinRequest): Promise<PlanPinResult> {
    const dir = this.dirOf(request?.workspaceId)
    const messageId = request?.messageId
    if (typeof messageId !== 'string' || messageId === '') {
      return { ok: false, reason: 'messageId must be a non-empty string' }
    }
    const text = this.recentMessages.get(messageId)
    if (text === undefined) {
      return { ok: false, reason: 'that message is no longer available to pin' }
    }
    // A fenced plan in the message is the plan; otherwise the message is.
    const fenced = extractFencedPlans(text)
    const body = fenced.length > 0 ? fenced.join('\n\n') : text
    const record = await this.store.enqueue(dir, () =>
      this.store.create(dir, body, '', Date.now(), 'proposed'),
    )
    if (record === undefined) return { ok: false, reason: 'that plan is already saved' }
    return { ok: true, id: record.id, token: this.store.token(dir) }
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
