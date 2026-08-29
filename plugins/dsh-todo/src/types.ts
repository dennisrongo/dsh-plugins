/**
 * Shared todo vocabulary, imported by both halves.
 *
 * This module is deliberately dependency-free (no cordis, no react, no zod) so
 * the host half, the client half, and the smoke test can all import it without
 * dragging a runtime into the browser bundle.
 *
 * @module @dennisrongo/dsh-todo/types
 */

/**
 * Workflow state of one task.
 *
 * This replaces the old boolean `done` as the source of truth, because a sprint
 * runs on two states a boolean cannot express: what is moving RIGHT NOW
 * (`in-progress`) and what needs escalating at standup (`blocked`).
 *
 * `backlog` is deliberately distinct from `todo`: backlog is "someday, not this
 * sprint", todo is "committed, not started". Collapsing them is what turns a
 * roadmap back into an undifferentiated pile.
 */
export type TodoStatus = 'backlog' | 'todo' | 'in-progress' | 'blocked' | 'done'

/** Every status, in board order — the order the UI presents and groups by. */
export const STATUSES: readonly TodoStatus[] = ['backlog', 'todo', 'in-progress', 'blocked', 'done']

/** The status a task gets when none is supplied, and the fallback for junk input. */
export const DEFAULT_STATUS: TodoStatus = 'todo'

/**
 * Priority band. Four levels, not five: a scale people actually triage on. `p2`
 * is the default, so an unranked task sits mid-pile rather than jumping the queue.
 */
export type TodoPriority = 'p0' | 'p1' | 'p2' | 'p3'

/** Every priority, most urgent first. */
export const PRIORITIES: readonly TodoPriority[] = ['p0', 'p1', 'p2', 'p3']

/** The priority a task gets when none is supplied. */
export const DEFAULT_PRIORITY: TodoPriority = 'p2'

/** One task as stored on disk and rendered in the UI. */
export interface TodoItem {
  id: string
  /** Short, scannable summary — the one line shown on a collapsed row. */
  title: string
  /**
   * The body: repro steps, acceptance criteria, links. Optional and hidden
   * until a row is expanded, so adding it never costs list scannability.
   */
  description?: string
  /** Workflow state. `done` is derived from this, never stored separately. */
  status: TodoStatus
  priority: TodoPriority
  /**
   * What ships together, e.g. `"1.5"` or `"0.5.1"`. One to three numeric
   * segments, enforced at every write path — a numeric label sorts by version
   * and never mixes alpha with numeric the way `"v1.5"` would. Still modelled
   * as a LABEL rather than an entity: grouping and filtering work with no
   * releases table, no CRUD, and no migration when one is renamed.
   */
  release?: string
  /**
   * When it is worked on, e.g. `"24"`. A single decimal — a sprint is a point
   * on a calendar, not a shipped artefact, so unlike
   * {@link TodoItem.release} it takes no patch segment. Deliberately a separate
   * axis: a task can be worked in sprint 24 and ship in 1.3, and collapsing the
   * two loses the ability to answer either question.
   */
  sprint?: string
  /**
   * Due date as `YYYY-MM-DD`, not epoch ms.
   *
   * A due date is a CALENDAR day, not an instant: "due the 14th" must read as
   * the 14th in Berlin and in Denver alike. Storing an epoch would bind it to a
   * timezone and let the same task show two different days.
   */
  dueDate?: string
  /** Epoch ms. */
  createdAt: number
  /** Epoch ms, set when `status` becomes `done`. */
  completedAt?: number
  /**
   * Epoch ms, set when the item is archived. Presence — not a separate boolean
   * — IS the archived state, so there is one source of truth and no way to
   * store an archived item with no archive date.
   *
   * An archived item is hidden from the active views but is never deleted; it
   * stays in the same `items` array and is reachable through the Archive view,
   * where it can be restored or permanently removed.
   */
  archivedAt?: number
}

/**
 * The durable per-workspace record. `revision` is the optimistic-concurrency
 * token: every write states the revision it observed, and the host rejects a
 * write whose token no longer matches, so two browser tabs cannot silently
 * clobber one another.
 */
export interface TodoList {
  items: TodoItem[]
  /** Monotonic counter, incremented by the host on every accepted write. */
  revision: number
  /** Epoch ms of the last accepted write. */
  updatedAt: number
}

/** `list` request: read one workspace's todos. */
export interface TodoListRequest {
  workspaceId: string
}

/** `list` reply: always succeeds, returning an empty list for an unseen workspace. */
export interface TodoListResult {
  list: TodoList
}

/**
 * `replace` request: store a whole list for one workspace.
 *
 * The whole-list shape is deliberate. The UI mutates via pure list transforms
 * (add / toggle / reorder / clear), so a per-item command set would only
 * re-derive the same array on the host at the cost of a much wider API.
 */
export interface TodoReplaceRequest {
  workspaceId: string
  items: TodoItem[]
  /**
   * Revision this write is based on. `null` means "first write from a client
   * that has not read yet" and is accepted only when no record exists.
   */
  ifRevision: number | null
}

/** `replace` reply: the committed list, or the authoritative list on conflict. */
export type TodoReplaceResult =
  | { ok: true; list: TodoList }
  | { ok: false; code: 'revision-conflict'; list: TodoList }

/** True when this status means the work is finished. */
export function isDoneStatus(status: TodoStatus): boolean {
  return status === 'done'
}

/** Coerce untrusted input to a known status, falling back to the default. */
export function toStatus(value: unknown): TodoStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
    ? (value as TodoStatus)
    : DEFAULT_STATUS
}

/** Coerce untrusted input to a known priority, falling back to the default. */
export function toPriority(value: unknown): TodoPriority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value)
    ? (value as TodoPriority)
    : DEFAULT_PRIORITY
}

/**
 * Normalize a release/sprint label: trimmed, collapsed, capped, and `undefined`
 * when empty — so an absent label is one value, never `''` competing with it.
 */
export function normalizeLabel(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL)
  return text.length > 0 ? text : undefined
}

/** The two label fields, which are numeric but do NOT share one rule. */
export type LabelField = 'release' | 'sprint'

/**
 * A release: one to three numeric segments, e.g. `1`, `1.5`, `0.5.1`. The
 * third segment is the patch level, so a fix shipping on top of 0.5 has a
 * label of its own instead of overloading the minor.
 */
const RELEASE_LABEL_RE = /^\d+(\.\d+){0,2}$/

/**
 * A sprint: a single decimal, e.g. `1`, `1.5`, `24`. A sprint is a point on a
 * calendar, not a shipped artefact, so it takes no patch segment.
 */
const SPRINT_LABEL_RE = /^\d+(\.\d+)?$/

/**
 * Coerce untrusted input to a valid label for `field`, or `undefined`.
 *
 * Both fields stay purely numeric — `v1.5` and `Sprint 24` never pass — so
 * labels sort without mixing alpha and numeric; they differ only in how many
 * segments are allowed. Callers refuse on `undefined` rather than dropping the
 * input, the same contract as {@link normalizeDueDate}.
 */
export function normalizeVersionLabel(raw: unknown, field: LabelField): string | undefined {
  const label = normalizeLabel(raw)
  if (label === undefined) return undefined
  const pattern = field === 'release' ? RELEASE_LABEL_RE : SPRINT_LABEL_RE
  return pattern.test(label) ? label : undefined
}

/**
 * Compare two numeric labels SEGMENT BY SEGMENT, newest first.
 *
 * Version semantics, not decimal: `1.10` outranks `1.9`, and `0.5.1` sits
 * between `0.5` and `0.6`. A label that is not numeric at all (data written
 * before the rule existed) falls back to a numeric-aware string compare, so
 * legacy lists still group in a sane order.
 */
export function compareVersionsDesc(a: string, b: string): number {
  const segsA = a.split('.')
  const segsB = b.split('.')
  const numeric = (segs: string[]) => segs.every((s) => s.length > 0 && /^\d+$/.test(s))
  if (!numeric(segsA) || !numeric(segsB)) return b.localeCompare(a, undefined, { numeric: true })
  for (let i = 0; i < Math.max(segsA.length, segsB.length); i += 1) {
    // A missing segment is 0, so 0.5 ranks below 0.5.1 rather than equal to it.
    const diff = Number(segsB[i] ?? '0') - Number(segsA[i] ?? '0')
    if (diff !== 0) return diff
  }
  return 0
}

/** Matches a `YYYY-MM-DD` calendar date. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Coerce untrusted input to a `YYYY-MM-DD` date, or `undefined`.
 *
 * The shape is checked AND the date is round-tripped through `Date`, so
 * `2025-02-31` is rejected rather than silently normalized to March 3rd by the
 * browser's date input.
 */
export function normalizeDueDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.trim()
  if (!DATE_RE.test(text)) return undefined
  // Parsed as UTC so the check cannot drift a day either side of the date line.
  const parsed = new Date(`${text}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString().slice(0, 10) === text ? text : undefined
}

/** Hard cap on stored title length; enforced on both sides. */
export const MAX_TEXT = 500

/**
 * Hard cap on stored description length. Much larger than {@link MAX_TEXT}
 * because a description holds acceptance criteria and repro steps; reusing the
 * title's 500 would silently truncate real notes.
 */
export const MAX_DESC = 5000

/** Hard cap on a release/sprint label, which is a tag rather than prose. */
export const MAX_LABEL = 60

/** Hard cap on stored items per workspace, so a runaway client cannot bloat the file. */
export const MAX_ITEMS = 1000
