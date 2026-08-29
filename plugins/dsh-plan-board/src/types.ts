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

/** Where a plan stands in its review. */
export type PlanStatus =
  /** Presented through `exit_plan_mode`, review not yet settled. */
  | 'pending'
  /** The user approved it; plan mode ended and implementation follows. */
  | 'approved'
  /** The user chose to keep planning, or the review was dismissed. */
  | 'rejected'

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
