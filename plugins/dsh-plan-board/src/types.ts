/**
 * Shared vocabulary for dsh-plan-board.
 *
 * A plan is a **document**, not a row: it is written to disk as markdown so it
 * can be opened in an editor, committed with the repository, or handed to
 * someone who is not running the harness. Everything here describes the
 * metadata that rides alongside that markdown.
 *
 * @module @dennisrongo/dsh-plan-board/types
 */

/** Where a plan stands. */
export type PlanStatus =
  /** Presented through `exit_plan_mode`, review not yet settled. */
  | 'pending'
  /** The user approved it; plan mode ended and implementation follows. */
  | 'approved'
  /** The user chose to keep planning, or the review was dismissed. */
  | 'rejected'
  /**
   * Written straight into the conversation rather than presented for review —
   * a `plan` fence in an assistant message, or one you pinned by hand.
   *
   * It gets its own status rather than borrowing `pending` because `pending`
   * means "a review is open and waiting for you", and there is no review here.
   * Labelling these "Awaiting review" would send you looking for an approve
   * control that was never raised.
   */
  | 'proposed'

/** One plan's metadata — everything except the markdown body. */
export interface PlanMeta {
  /** Stable id, which is also the filename stem. */
  id: string
  /** First markdown heading of the plan, or a fallback. */
  title: string
  /** Session that produced the plan. */
  sessionId: string
  /** Epoch millis when `exit_plan_mode` presented it. */
  createdAt: number
  status: PlanStatus
  /** Epoch millis when the review settled; absent while pending. */
  decidedAt?: number
  /**
   * The reviewer's own words when they kept planning.
   *
   * dsh returns this as the tool's error message, which is the only place the
   * feedback exists — the session log records the failed call, not the reason
   * as a field. Capturing it here is what makes a rejected plan legible later.
   */
  feedback?: string
  /** Size of the markdown body in bytes, so a list can show it without reading. */
  bytes: number
}

/** One plan, metadata plus its markdown. */
export interface PlanRecord extends PlanMeta {
  body: string
}

/** Directory inside a workspace that carries harness-local state. */
export const DOT_DSH = '.dsh'

/** Subdirectory of `.dsh` holding one markdown file per plan. */
export const PLANS_DIR = 'plans'

/** The model-facing tool whose argument this plugin captures. */
export const EXIT_PLAN_MODE = 'exit_plan_mode'

/**
 * The fence the system-prompt section asks the model to wrap plans in.
 *
 * A marker rather than a heuristic: sniffing assistant prose for
 * "plan-shaped" structure fires on any answer with a heading and a list, and a
 * plan store full of false positives is worse than one that occasionally
 * misses. An unmarked plan simply stays in the transcript, which is the
 * behaviour without this plugin anyway.
 */
export const PLAN_FENCE = 'plan'

/**
 * One fence line: indentation, the run of backticks, and the info string.
 *
 * The backtick run is captured because its LENGTH decides what can close it —
 * see {@link extractFencedPlans}. A backtick inside the info string would make
 * the line something other than a fence, hence `[^\s\`]*`.
 */
const FENCE_LINE = /^[ \t]*(`{3,})[ \t]*([^\s`]*)[ \t]*$/

/**
 * Extract every fenced plan block from one assistant message.
 *
 * Scanned line by line rather than with one regex, because a plan routinely
 * CONTAINS code blocks and the naive pattern truncated the plan at the first
 * one. That was not hypothetical: two plans captured from a real session were
 * cut at "## The prompt", losing everything from the prompt template onward,
 * and the panel rendered the truncation faithfully — the data was already gone.
 *
 * Two CommonMark rules do the work:
 *
 * - A fence is closed only by a bare fence AT LEAST AS LONG as the one that
 *   opened it. So ` ````plan ` survives any ordinary ``` block inside it, and
 *   that is what the prompt section now asks the model to write.
 * - A fence line carrying an info string opens a nested block; the plan cannot
 *   end inside one. That rescues ` ```plan ` containing ` ```ts ` even when
 *   both are three backticks.
 *
 * What remains genuinely ambiguous is a BARE ``` inside a ```plan of the same
 * length: nothing in the text distinguishes "nested block opens" from "plan
 * ends", and CommonMark itself would end the plan. The longer opening fence is
 * the only fix, which is why the prompt asks for it.
 *
 * An unterminated plan fence yields nothing, deliberately: a message still
 * streaming, or one cut off mid-plan, should not land a half-written plan in
 * the user's repository.
 * @param text - the assistant message's text content.
 * @returns each fenced plan body, trimmed, in document order.
 */
export function extractFencedPlans(text: string): string[] {
  const lines = text.split('\n')
  const out: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const open = FENCE_LINE.exec(lines[i])
    if (open === null || open[2] !== PLAN_FENCE) continue

    const ticks = open[1].length
    const body: string[] = []
    // Length of the nested fence currently open, or 0 at the plan's own level.
    let nested = 0
    let closed = false

    for (i += 1; i < lines.length; i += 1) {
      const fence = FENCE_LINE.exec(lines[i])
      if (fence !== null) {
        const length = fence[1].length
        const bare = fence[2] === ''
        if (nested === 0) {
          if (bare && length >= ticks) {
            closed = true
            break
          }
          // Anything else at this level opens a nested block: a tagged fence of
          // any length, or a bare one too short to close the plan.
          nested = length
        } else if (bare && length >= nested) {
          nested = 0
        }
      }
      body.push(lines[i])
    }

    if (!closed) break
    const plan = body.join('\n').replace(/^\n+/, '').replace(/\s+$/, '')
    if (plan !== '') out.push(plan)
  }

  return out
}

/**
 * Largest plan body accepted, in bytes.
 *
 * A plan is a review document a human is expected to read; something larger
 * than this is a runaway generation, and writing it would put an unbounded
 * file into the user's repository.
 */
export const MAX_PLAN_BYTES = 512 * 1024

/** Most plans retained per workspace; the oldest settled ones are pruned. */
export const MAX_PLANS = 200

/**
 * The plan's first markdown heading, at any level.
 *
 * `exit_plan_mode` already refuses a plan that does not start with `# `, so in
 * practice this always hits — but the fallback matters for a file that was
 * hand-edited afterwards.
 * @param plan - the markdown body.
 * @returns the heading text, or undefined when there is none.
 */
export function firstHeading(plan: string): string | undefined {
  for (const line of plan.split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line)
    if (match) return match[1]
  }
  return undefined
}

/**
 * Turn a title into a filesystem-safe slug.
 *
 * Deliberately conservative: lowercase ASCII, digits and single hyphens only.
 * A plan title is model-written text that lands in a filename, so anything
 * that could be a path separator, a shell metacharacter, or a Windows reserved
 * character has to be gone rather than escaped.
 * @param title - the plan's heading.
 * @returns a slug of at most 48 characters, or `plan` when nothing survives.
 */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return slug === '' ? 'plan' : slug
}

/**
 * Compact sortable timestamp used as the filename prefix.
 *
 * Lexicographic order equals chronological order, so a directory listing is
 * already sorted and the store never has to read a file to order the list.
 * @param at - epoch millis.
 * @returns e.g. `20260829T121500123`.
 */
export function stamp(at: number): string {
  return new Date(at).toISOString().replace(/[-:.]/g, '').replace(/Z$/, '')
}
