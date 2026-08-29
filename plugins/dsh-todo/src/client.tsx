/**
 * dsh-todo — a per-workspace todo list for the DeepSeek Harness web UI.
 *
 * Registers into the additive `conversation.view` slot, so the list appears as
 * its own tab beside Chat and Trajectory and fills the session pane.
 *
 * Storage lives on the HOST, not in the browser: this half mounts a Typert
 * Remote descriptor for the host's `dshTodo` service and calls
 * `list` / `replace` over it. The list therefore survives a restart, a cleared
 * browser cache, and a different browser. Each workspace gets its own list,
 * keyed by workspace id.
 *
 * Todos left in `localStorage` by the older browser-only version are migrated
 * once, into the first workspace that opens with an empty stored list.
 */
import React from 'react'
// Supplied by the shell's client module table, exactly as the shipped
// ui-trajectory / ui-renderer / ui-attachment bundles require it.
import { createPortal } from 'react-dom'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { TODO_REMOTE } from './remote.ts'
import {
  DEFAULT_PRIORITY,
  DEFAULT_STATUS,
  MAX_DESC,
  MAX_TEXT,
  PRIORITIES,
  STATUSES,
  compareVersionsDesc,
  normalizeDueDate,
  normalizeLabel,
  normalizeVersionLabel,
  toPriority,
  toStatus,
  type LabelField,
  type TodoItem,
  type TodoPriority,
  type TodoStatus,
} from './types.ts'

// Re-exported so the smoke test can assert the contribution stays strict —
// a non-strict codec makes the browser's $mount throw and the tab vanish.
export { TODO_REMOTE }

/**
 * Required services. `remote` is the Typert client bridge (used here only for
 * `$mount`), `workspaces` maps the active session onto its workspace, and
 * `slots` hosts the tab.
 *
 * The mounted namespace `remote.dshTodo` is deliberately NOT listed here: this
 * plugin mounts that contract itself, so requiring it up front would park
 * apply() forever waiting on a service only apply() can create.
 */
export const inject = ['slots', 'remote', 'workspaces']

export type { TodoItem, TodoStatus, TodoPriority }
export { STATUSES, PRIORITIES }

export interface TodoStats {
  total: number
  done: number
  open: number
  /** 0–100, rounded. 0 when the list is empty. */
  percent: number
  /** How many items are archived. Excluded from total/done/open/percent. */
  archived: number
  /** Active items currently in progress — the "what is moving" number. */
  inProgress: number
  /** Active items blocked — the standup escalation number. */
  blocked: number
}

/** Human labels for each status, used by the filter ring and group headers. */
export const STATUS_LABEL: Record<TodoStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  'in-progress': 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
}

/** Human labels for each priority band. */
export const PRIORITY_LABEL: Record<TodoPriority, string> = {
  p0: 'P0 · Urgent',
  p1: 'P1 · High',
  p2: 'P2 · Medium',
  p3: 'P3 · Low',
}

/** True when the item counts as finished. Replaces the old boolean field. */
export function isDone(item: TodoItem): boolean {
  return item.status === 'done'
}

/** Legacy browser-only key, read once for migration and then left alone. */
const LEGACY_KEY = 'dsh-todo:items'
/** Marks the legacy list as already migrated, so it is never re-imported. */
const MIGRATED_KEY = 'dsh-todo:migrated'

// ---------------------------------------------------------------------------
// Pure logic (exported for the smoke test)
// ---------------------------------------------------------------------------

/** True when an item has been archived out of the active list. */
export function isArchived(item: TodoItem): boolean {
  return typeof item.archivedAt === 'number'
}

/** The items still in play: everything that has not been archived. */
export function activeItems(items: TodoItem[]): TodoItem[] {
  return items.filter((i) => !isArchived(i))
}

/** The archived items, newest archive first, so the Archive view reads as a log. */
export function archivedItems(items: TodoItem[]): TodoItem[] {
  return items.filter(isArchived).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
}

/**
 * Count totals for the summary row.
 *
 * Archived items are deliberately excluded from total/done/open/percent:
 * archiving is how the user declares work finished and out of mind, so leaving
 * it in the denominator would make the progress bar sag as they tidy up.
 */
export function computeStats(items: TodoItem[]): TodoStats {
  const active = activeItems(items)
  const total = active.length
  const done = active.filter(isDone).length
  const open = total - done
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return {
    total,
    done,
    open,
    percent,
    archived: items.length - active.length,
    inProgress: active.filter((i) => i.status === 'in-progress').length,
    blocked: active.filter((i) => i.status === 'blocked').length,
  }
}

/** The item the user should look at next: first unfinished and not archived, in list order. */
export function nextOpen(items: TodoItem[]): TodoItem | undefined {
  return items.find((i) => !isDone(i) && !isArchived(i))
}

/** Normalize free text into a storable task title. Returns '' when unusable. */
export function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
}

/**
 * Normalize a description. Unlike a title this keeps newlines — acceptance
 * criteria are written as lists — so only trailing whitespace is trimmed.
 */
export function normalizeDescription(raw: string): string {
  return raw.replace(/[ \t]+$/gm, '').trim().slice(0, MAX_DESC)
}

/**
 * Create a task. `now`/`rand` are injectable to keep the function pure-testable.
 * @param title - the task title, already normalized.
 * @param fields - optional starting status/priority/release/sprint.
 */
export function makeItem(
  title: string,
  now = Date.now(),
  rand = Math.random,
  fields: Partial<Pick<TodoItem, 'status' | 'priority' | 'release' | 'sprint' | 'description'>> = {},
): TodoItem {
  const release = normalizeLabel(fields.release)
  const sprint = normalizeLabel(fields.sprint)
  return {
    id: `t${now.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`,
    title,
    status: fields.status ?? DEFAULT_STATUS,
    priority: fields.priority ?? DEFAULT_PRIORITY,
    ...(fields.description ? { description: fields.description } : {}),
    ...(release !== undefined ? { release } : {}),
    ...(sprint !== undefined ? { sprint } : {}),
    createdAt: now,
  }
}

/**
 * Set one task's status, stamping/clearing `completedAt` to match.
 *
 * This is the single write path for workflow state, so the completion stamp can
 * never drift from the status that justifies it.
 */
export function setStatus(
  items: TodoItem[],
  id: string,
  status: TodoStatus,
  now = Date.now(),
): TodoItem[] {
  let changed = false
  const next = items.map((i) => {
    if (i.id !== id || i.status === status) return i
    changed = true
    const updated = { ...i, status }
    if (status === 'done') updated.completedAt = now
    else delete updated.completedAt
    return updated
  })
  // Identity is preserved when nothing changed, because the store treats a new
  // array as a reason to write: returning one unconditionally would put a
  // round-trip on the wire every time a select re-emits its current value.
  return changed ? next : items
}

/** Set one task's priority. Preserves identity when nothing changed. */
export function setPriority(items: TodoItem[], id: string, priority: TodoPriority): TodoItem[] {
  let changed = false
  const next = items.map((i) => {
    if (i.id !== id || i.priority === priority) return i
    changed = true
    return { ...i, priority }
  })
  return changed ? next : items
}

/**
 * Patch the editable text fields of one task. An empty label clears the field
 * rather than storing `''`, so "no release" has exactly one representation.
 */
export function updateItem(
  items: TodoItem[],
  id: string,
  patch: Partial<Pick<TodoItem, 'title' | 'description' | 'release' | 'sprint' | 'dueDate'>>,
): TodoItem[] {
  let changed = false
  const out = items.map((i) => {
    if (i.id !== id) return i
    changed = true
    const next = { ...i }
    if (patch.title !== undefined) next.title = patch.title
    if (patch.description !== undefined) {
      if (patch.description) next.description = patch.description
      else delete next.description
    }
    for (const key of ['release', 'sprint'] as const) {
      if (patch[key] === undefined) continue
      const label = normalizeLabel(patch[key])
      if (label !== undefined) next[key] = label
      else delete next[key]
    }
    if (patch.dueDate !== undefined) {
      const due = normalizeDueDate(patch.dueDate)
      if (due !== undefined) next.dueDate = due
      else delete next.dueDate
    }
    return next
  })
  return changed ? out : items
}

/**
 * Toggle a task between done and not-done.
 *
 * Retained as the checkbox's action. Un-checking returns the task to `todo`
 * rather than to whatever it was before, because the prior state is not stored
 * and guessing `in-progress` would silently claim work is underway.
 */
export function toggleItem(items: TodoItem[], id: string, now = Date.now()): TodoItem[] {
  const item = items.find((i) => i.id === id)
  if (!item) return items
  return setStatus(items, id, isDone(item) ? 'todo' : 'done', now)
}

/**
 * Move an item one slot up (-1) or down (+1); out-of-range moves are no-ops.
 *
 * Movement is computed over the ACTIVE items only. The raw array interleaves
 * archived entries, so a naive index shift would let a visible item swap with a
 * hidden one and appear not to move at all.
 */
export function moveItem(items: TodoItem[], id: string, delta: number): TodoItem[] {
  const active = activeItems(items)
  const from = active.findIndex((i) => i.id === id)
  if (from < 0) return items
  const to = from + delta
  if (to < 0 || to >= active.length) return items
  const reordered = active.slice()
  const [moved] = reordered.splice(from, 1)
  reordered.splice(to, 0, moved)
  // Rebuild the full array, refilling active slots in their new order and
  // leaving every archived entry pinned where it already sat.
  let cursor = 0
  return items.map((i) => (isArchived(i) ? i : reordered[cursor++]))
}

/**
 * Archive one item, stamping when it happened. Archiving is idempotent — a
 * second call must not move an item's archive date and reorder the Archive view.
 */
export function archiveItem(items: TodoItem[], id: string, now = Date.now()): TodoItem[] {
  let changed = false
  const next = items.map((i) => {
    if (i.id !== id || isArchived(i)) return i
    changed = true
    return { ...i, archivedAt: now }
  })
  return changed ? next : items
}

/** Restore one archived item back into the active list. */
export function restoreItem(items: TodoItem[], id: string): TodoItem[] {
  let changed = false
  const next = items.map((i) => {
    if (i.id !== id || !isArchived(i)) return i
    changed = true
    const rest = { ...i }
    delete rest.archivedAt
    return rest
  })
  return changed ? next : items
}

/**
 * Archive every completed item. This is the safe replacement for the old
 * destructive "Clear completed": nothing leaves the record, it only leaves the
 * active view.
 */
export function archiveCompleted(items: TodoItem[], now = Date.now()): TodoItem[] {
  let changed = false
  const next = items.map((i) => {
    if (!isDone(i) || isArchived(i)) return i
    changed = true
    return { ...i, archivedAt: now }
  })
  return changed ? next : items
}

/** Permanently drop every archived item. The only destructive bulk action left. */
export function clearArchived(items: TodoItem[]): TodoItem[] {
  const next = items.filter((i) => !isArchived(i))
  return next.length === items.length ? items : next
}

/** Drop every completed item outright. Retained for callers that want a hard delete. */
export function clearCompleted(items: TodoItem[]): TodoItem[] {
  return items.filter((i) => !isDone(i))
}

/**
 * Which subset of the list the view is showing.
 *
 * The ring is status-driven now: each `TodoStatus` is selectable directly, and
 * `open` remains as the "everything unfinished" shortcut people actually want
 * as a default working view.
 */
export type TodoFilter = 'all' | 'open' | 'archived' | TodoStatus

/**
 * Apply the view's filter ring. Every filter except `archived` operates on the
 * active list, so archived items stay out of sight until asked for. Unknown
 * filters fall back to the active list.
 */
export function filterItems(items: TodoItem[], filter: TodoFilter): TodoItem[] {
  if (filter === 'archived') return archivedItems(items)
  const active = activeItems(items)
  if (filter === 'open') return active.filter((i) => !isDone(i))
  if ((STATUSES as readonly string[]).includes(filter)) {
    return active.filter((i) => i.status === filter)
  }
  return active
}

/** How the list is broken into sections. `none` renders one flat list. */
export type TodoGroupBy = 'none' | 'status' | 'release' | 'sprint' | 'priority'

/** One rendered section: a heading plus the items under it. */
export interface TodoGroup {
  /** Stable key for React and for collapse state. */
  key: string
  /** Heading text. */
  label: string
  items: TodoItem[]
}

/** Shown as the heading for items with no release/sprint set. */
export const UNASSIGNED = 'Unassigned'

/**
 * Compare two release/sprint labels, newest first.
 *
 * Delegates to the shared VERSION comparator: labels compare segment by
 * segment, so `1.10` outranks `1.9` and `0.5.1` sits between `0.5` and `0.6`.
 * Legacy labels written before the numeric rule still sort sanely through its
 * string fallback (no migration).
 */
const compareLabelsDesc = compareVersionsDesc

/**
 * Strip everything a decimal label cannot contain — anything but digits and
 * dots. The inputs run every keystroke and paste through this, so invalid
 * characters can never be entered at all; whether the remaining text is a
 * VALID label (at most one dot) is decided on blur by
 * {@link isCommittableLabel}.
 */
export function sanitizeDecimalInput(raw: string): string {
  return raw.replace(/[^0-9.]/g, '')
}

/**
 * Whether a typed edit may be committed to `field`: empty clears it, a numeric
 * label writes, anything else is refused — the same rule the CLI enforces, so
 * neither face of the plugin can mix alpha into a numeric label. The two
 * fields differ in shape, which is why the field is a parameter.
 */
export function isCommittableLabel(raw: string, field: LabelField): boolean {
  return normalizeLabel(raw) === undefined || normalizeVersionLabel(raw, field) !== undefined
}

/** Inline message when a release edit is refused. */
export const RELEASE_ERROR = 'Use a version like 1.5 or 0.5.1 (up to three numbers) — not saved'

/** Inline message when a sprint edit is refused — no patch segment here. */
export const SPRINT_ERROR = 'Use a decimal like 1.5 (one dot at most) — not saved'

/**
 * The validation error for a typed edit to `field`, or `undefined` when it may
 * commit. A refused edit must SAY so — silently reverting the field reads as
 * the input being broken, and the user never learns the rule. The message
 * names the shape THAT field accepts, since release and sprint differ.
 */
export function labelError(raw: string, field: LabelField): string | undefined {
  if (isCommittableLabel(raw, field)) return undefined
  return field === 'release' ? RELEASE_ERROR : SPRINT_ERROR
}

/**
 * Break a list into ordered sections.
 *
 * Ordering is by MEANING, not alphabetical: statuses follow board order and
 * priorities follow urgency, so "In Progress" never sorts under "Backlog".
 * Release and sprint are decimal labels, so they sort NUMERICALLY descending —
 * the newest release is the one being worked on — with `Unassigned` pinned last.
 *
 * Empty groups are omitted, except that grouping by status keeps the board's
 * shape visible only where work exists; a section with nothing in it is noise.
 */
export function groupItems(items: TodoItem[], by: TodoGroupBy): TodoGroup[] {
  if (by === 'none') return [{ key: 'all', label: '', items }]

  if (by === 'status') {
    return STATUSES.map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      items: items.filter((i) => i.status === s),
    })).filter((g) => g.items.length > 0)
  }

  if (by === 'priority') {
    return PRIORITIES.map((p) => ({
      key: p,
      label: PRIORITY_LABEL[p],
      items: items.filter((i) => i.priority === p),
    })).filter((g) => g.items.length > 0)
  }

  const field = by === 'release' ? 'release' : 'sprint'
  const buckets = new Map<string, TodoItem[]>()
  for (const item of items) {
    const key = item[field] ?? UNASSIGNED
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => {
      // Unassigned is always last, regardless of how it sorts as a string.
      if (a === UNASSIGNED) return 1
      if (b === UNASSIGNED) return -1
      return compareLabelsDesc(a, b)
    })
    .map(([key, groupItems]) => ({ key, label: key, items: groupItems }))
}

/**
 * Every distinct release (or sprint) label in use, newest first.
 *
 * This is what keeps the datalists useful: the editors offer these as
 * suggestions, so labels converge on a shared vocabulary without a releases
 * table to maintain.
 */
export function knownLabels(items: TodoItem[], field: 'release' | 'sprint'): string[] {
  const seen = new Set<string>()
  for (const item of items) {
    const value = item[field]
    if (value) seen.add(value)
  }
  return [...seen].sort(compareLabelsDesc)
}

/**
 * Defensive parse of a stored JSON array: never throws, always returns a
 * well-formed array, and drops entries that don't look like todo items. Used
 * for the legacy localStorage migration and for host replies alike.
 */
export function parseItems(raw: string | null): TodoItem[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  return coerceItems(data)
}

/** Coerce an already-decoded value into a well-formed item array. */
export function coerceItems(data: unknown): TodoItem[] {
  if (!Array.isArray(data)) return []
  const out: TodoItem[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    // `text` is the v1 title. Accepting it here is what lets a list written by
    // the old version survive the upgrade instead of being dropped as junk.
    const title = typeof e.title === 'string' ? e.title : e.text
    if (typeof e.id !== 'string' || typeof title !== 'string') continue
    // A v1 item has `done` and no `status`; map it rather than resetting
    // finished work back to 'todo'.
    const status = e.status === undefined && e.done === true ? 'done' : toStatus(e.status)
    out.push({
      id: e.id,
      title: title.slice(0, MAX_TEXT),
      status,
      priority: toPriority(e.priority),
      description:
        typeof e.description === 'string' && e.description.length > 0
          ? e.description.slice(0, MAX_DESC)
          : undefined,
      release: normalizeLabel(e.release),
      sprint: normalizeLabel(e.sprint),
      dueDate: normalizeDueDate(e.dueDate),
      createdAt: typeof e.createdAt === 'number' ? e.createdAt : 0,
      completedAt: typeof e.completedAt === 'number' ? e.completedAt : undefined,
      // Presence of a number is the archived flag, so anything else must decay
      // to undefined rather than survive as a truthy marker.
      archivedAt: typeof e.archivedAt === 'number' ? e.archivedAt : undefined,
    })
  }
  return out
}

/** Today as `YYYY-MM-DD` in the VIEWER's timezone, which is what "overdue" means to them. */
export function today(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * True when a task's due date has passed. Compared as `YYYY-MM-DD` STRINGS,
 * which sort lexicographically the same way they sort chronologically — no Date
 * parsing, so no timezone can shift the boundary by a day.
 *
 * A finished task is never overdue: shipping it late does not leave it pending.
 */
export function isOverdue(item: TodoItem, ref = today()): boolean {
  if (!item.dueDate || isDone(item) || isArchived(item)) return false
  return item.dueDate < ref
}

/** True when a task is due exactly today. */
export function isDueToday(item: TodoItem, ref = today()): boolean {
  if (!item.dueDate || isDone(item) || isArchived(item)) return false
  return item.dueDate === ref
}

/** Short due-date label for the row chip: "Today", "Tomorrow", or "Mar 14". */
export function fmtDue(date: string, ref = today()): string {
  if (date === ref) return 'Today'
  const day = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(day.getTime())) return date
  const next = new Date(`${ref}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  if (date === next.toISOString().slice(0, 10)) return 'Tomorrow'
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`
}

/** Short relative age, e.g. "just now", "5m", "3h", "2d". */
export function fmtAge(from: number, now = Date.now()): string {
  if (!from) return ''
  const ms = Math.max(0, now - from)
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}

/**
 * Resolve which workspace owns a session, from the workspace list projection.
 * Returns undefined when the session is not accounted to any workspace (a
 * brand-new blank session), in which case the view shows a neutral notice
 * rather than silently writing to the wrong list.
 */
export function workspaceIdForSession(
  items: readonly { workspaceId: string; sessionIds: readonly string[] }[],
  sessionId: string,
): string | undefined {
  for (const ws of items) {
    if (ws.sessionIds.includes(sessionId)) return ws.workspaceId
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Store — one instance per workspace, shared by every mounted tab
// ---------------------------------------------------------------------------

type Listener = () => void

/** What the view renders: the list plus its load/save status. */
export interface TodoState {
  items: TodoItem[]
  status: 'loading' | 'ready' | 'error'
  error: string | null
  /** True while a write is in flight, so the UI can stay honest about saving. */
  saving: boolean
}

const INITIAL: TodoState = { items: [], status: 'loading', error: null, saving: false }

/**
 * Per-workspace object layer over the host's durable list.
 *
 * Writes are optimistic — the UI updates immediately and the host commits
 * behind it — but the committed revision always wins, so a rejected or
 * conflicting write snaps the view back to the authoritative list rather than
 * leaving the browser showing something the disk does not agree with.
 */
export class TodoStore {
  private state: TodoState = INITIAL
  private readonly listeners = new Set<Listener>()
  private revision: number | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private loaded = false

  /**
   * @param remote - the host's dshTodo remote namespace.
   * @param workspaceId - the workspace whose list this store owns.
   */
  constructor(
    private readonly remote: TodoRemote,
    private readonly workspaceId: string,
  ) {}

  getSnapshot = (): TodoState => this.state

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Load once; a failed load stays retryable via {@link refresh}. */
  async ensure(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    await this.refresh()
  }

  /** Re-read the authoritative list from the host. */
  async refresh(): Promise<void> {
    try {
      const reply = await this.remote.list({ workspaceId: this.workspaceId })
      if (!reply.ok) {
        this.publish({ ...this.state, status: 'error', error: reply.error.message })
        return
      }
      const list = reply.value.list
      this.revision = list.revision
      const items = coerceItems(list.items)
      // A first-run migration only makes sense into a genuinely empty list.
      if (items.length === 0 && list.revision === 0) {
        const legacy = takeLegacyItems()
        if (legacy.length > 0) {
          this.publish({ items: legacy, status: 'ready', error: null, saving: true })
          await this.commit(legacy)
          return
        }
      }
      this.publish({ items, status: 'ready', error: null, saving: false })
    } catch (error) {
      this.publish({ ...this.state, status: 'error', error: describe(error) })
    }
  }

  /**
   * Apply a pure list transform, echo it immediately, and persist it.
   * @param fn - pure transform over the current items.
   */
  update(fn: (items: TodoItem[]) => TodoItem[]): void {
    if (this.state.status !== 'ready') return
    const next = fn(this.state.items)
    if (next === this.state.items) return
    this.publish({ ...this.state, items: next, saving: true })
    void this.commit(next)
  }

  /** Serialize writes so queued saves always compare against the committed revision. */
  private commit(items: TodoItem[]): Promise<void> {
    const run = async (): Promise<void> => {
      try {
        const reply = await this.remote.replace({
          workspaceId: this.workspaceId,
          items,
          ifRevision: this.revision,
        })
        if (!reply.ok) {
          this.publish({ ...this.state, saving: false, error: reply.error.message })
          return
        }
        const result = reply.value
        this.revision = result.list.revision
        if (result.ok) {
          this.publish({ ...this.state, saving: false, error: null })
          return
        }
        // Another tab won the race: adopt the authoritative list outright.
        this.publish({
          items: coerceItems(result.list.items),
          status: 'ready',
          error: null,
          saving: false,
        })
      } catch (error) {
        this.publish({ ...this.state, saving: false, error: describe(error) })
      }
    }
    this.tail = this.tail.then(run, run)
    return this.tail as Promise<void>
  }

  private publish(next: TodoState): void {
    this.state = next
    for (const fn of this.listeners) {
      try {
        fn()
      } catch {
        // One bad subscriber must not stop the rest from updating.
      }
    }
  }
}

/** The two host calls this half needs, as the generated Remote face shapes them. */
export interface TodoRemote {
  list: (request: { workspaceId: string }) => Promise<RemoteReply<{ list: StoredList }>>
  replace: (request: {
    workspaceId: string
    items: TodoItem[]
    ifRevision: number | null
  }) => Promise<RemoteReply<ReplaceReply>>
}

interface StoredList {
  items: TodoItem[]
  revision: number
  updatedAt: number
}

type ReplaceReply =
  | { ok: true; list: StoredList }
  | { ok: false; code: 'revision-conflict'; list: StoredList }

type RemoteReply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

/** Render an unknown throw as a short message for the status line. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read the legacy browser-only list exactly once, then mark it migrated.
 * The original key is deliberately left in place, so a downgrade or a mistake
 * does not destroy the user's data.
 */
export function takeLegacyItems(): TodoItem[] {
  try {
    if (window.localStorage.getItem(MIGRATED_KEY) === '1') return []
    const items = parseItems(window.localStorage.getItem(LEGACY_KEY))
    window.localStorage.setItem(MIGRATED_KEY, '1')
    return items
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Styles — theme exclusively through the shell's --dsw-* tokens
// ---------------------------------------------------------------------------

const VIEW_STYLES = `
.dshtd {
  --td-border: var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
  --td-primary: var(--dsw-alias-label-primary, #f9fafb);
  --td-secondary: var(--dsw-alias-label-secondary, #cfd3d6);
  --td-caption: var(--dsw-alias-label-caption, #81858c);
  --td-accent: var(--dsw-alias-state-success-primary, #22c55e);
  --td-hover: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08));
  --td-danger: var(--dsw-alias-state-error-primary, #ef4444);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--td-secondary);
  font: 400 14px/22px var(--dsw-font-family, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
  font-variant-numeric: tabular-nums;
}
.dshtd *, .dshtd *::before, .dshtd *::after { box-sizing: border-box; }

/* The dropdown POPUP of a select is painted by the OS outside the page, so no
   descendant CSS reaches it. It obeys the color-scheme property and nothing
   else: left unset it renders as a LIGHT popup while the option text inherits
   the shell near-white label colour, i.e. white-on-white and unreadable.

   This used to key off the prefers-color-scheme query, on the premise that the
   shell "publishes its theme as CSS VARIABLES and never sets a color-scheme".
   That premise was wrong: ui-layout's ThemePresenter sets
   documentElement.style.colorScheme from the resolved theme on every change,
   and color-scheme inherits — so native controls already follow the APP's
   light/dark, including in the modal, which portals to document.body but is
   still a descendant of <html>. Keying off the OS instead meant a light theme
   on a dark-mode machine rendered dark popups. Nothing is needed here now.

/* ---- header ---- */
.dshtd-head {
  flex: none;
  display: flex; align-items: center; gap: 12px;
  padding: 14px 20px 10px;
}
.dshtd-title { font-size: 14px; line-height: 22px; font-weight: 600; color: var(--td-primary); flex: none; }
.dshtd-progress {
  flex: 1 1 auto; max-width: 260px; height: 5px; border-radius: 999px;
  background: var(--td-hover); overflow: hidden;
}
.dshtd-progress > i {
  display: block; height: 100%; border-radius: 999px;
  background: var(--td-accent); transition: width 180ms ease;
}
.dshtd-score { flex: none; color: var(--td-caption); font-size: 12px; line-height: 18px; }

/* ---- filter ring ---- */
.dshtd-filters { flex: none; display: flex; gap: 4px; padding: 0 20px 10px; }
.dshtd-filter {
  border: 1px solid transparent; background: transparent; cursor: pointer;
  color: var(--td-caption); font: inherit; font-size: 12px; line-height: 18px;
  padding: 3px 10px; border-radius: 999px;
}
.dshtd-filter:hover { background: var(--td-hover); color: var(--td-primary); }
.dshtd-filter[aria-pressed="true"] {
  background: var(--td-hover); color: var(--td-primary);
  border-color: var(--td-border); font-weight: 500;
}

/* ---- add box ---- */
.dshtd-addrow { flex: none; display: flex; gap: 8px; padding: 0 20px 12px; }
.dshtd-add {
  flex: 1 1 auto; min-width: 0;
  border: 1px solid var(--td-border); border-radius: 8px;
  background: transparent; color: var(--td-primary); font: inherit;
  padding: 8px 12px;
}
.dshtd-add::placeholder { color: var(--td-caption); }
.dshtd-add:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #6b7280); }
.dshtd-addbtn {
  flex: none; border: 1px solid var(--td-border); border-radius: 8px;
  background: var(--td-hover); color: var(--td-primary); font: inherit; font-weight: 500;
  padding: 8px 16px; cursor: pointer;
}
.dshtd-addbtn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary, #6b7280); }
.dshtd-addbtn:disabled { opacity: 0.4; cursor: default; }

/* ---- list ---- */
.dshtd-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 20px 16px; }
.dshtd-list { list-style: none; margin: 0; padding: 0; }
.dshtd-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 9px 10px; border-radius: 8px;
  border: 1px solid transparent;
  /* 20px, matching the icon button and the badge, so a row's height comes from
     its controls rather than the body scale's 22px line-height. Todo text wraps,
     so this also sets the spacing between wrapped lines. */
  line-height: 20px;
}
.dshtd-row + .dshtd-row { margin-top: 2px; }
.dshtd-row:hover { background: var(--td-hover); border-color: var(--td-border); }
.dshtd-row.done .dshtd-text { color: var(--td-caption); text-decoration: line-through; }
/* Archived rows read as a quiet log: dimmed, no strikethrough, no edit affordance. */
.dshtd-row.archived .dshtd-text { color: var(--td-caption); cursor: default; }
/* The badge holds a 16px icon, so it is a 16px box rather than a text cell. */
.dshtd-badge {
  flex: none; width: 16px; height: 20px; color: var(--td-accent);
  display: inline-flex; align-items: center; justify-content: center;
}
.dshtd-badge svg { display: block; }
/* 16px, matching the icon column so the check, badge and row buttons align.

   Centred on the 20px text line via a 20px box instead of a hand-tuned
   margin-top: at 16px the old 2px nudge pushed the row 1px taller, because the
   row is flex-start and the checkbox's margin+height then exceeded the line. */
.dshtd-check {
  flex: none; width: 16px; height: 16px;
  /* (20px line - 16px control) / 2 = 2px, centring it on the FIRST text line and
     keeping it there when the text wraps. Paired with the 2px bottom margin the
     control's outer box is 20px, so it never sets the row height. */
  margin: 2px 0;
  accent-color: var(--td-accent); cursor: pointer;
}
.dshtd-text {
  flex: 1 1 auto; min-width: 0; color: var(--td-secondary);
  overflow-wrap: anywhere; cursor: text;
}
/* The 12px/18px caption is centred against the 20px text line rather than nudged
   down by a hand-tuned margin: at 18px tall a 2px offset pushed its bottom edge
   past the text's and made every row 1px taller. */
.dshtd-age {
  flex: none; color: var(--td-caption); font-size: 12px;
  line-height: 20px;
}
.dshtd-edit {
  flex: 1 1 auto; min-width: 0;
  border: 1px solid var(--dsw-alias-brand-primary, #6b7280); border-radius: 6px;
  background: transparent; color: var(--td-primary); font: inherit; padding: 3px 8px;
}
.dshtd-edit:focus { outline: none; }
.dshtd-rowbtns { flex: none; display: flex; gap: 1px; opacity: 0; transition: opacity 100ms ease; }
.dshtd-row:hover .dshtd-rowbtns, .dshtd-row:focus-within .dshtd-rowbtns { opacity: 1; }
/* A 16px glyph centred in a fixed 20px square. 20px, not 24px: the button is
   the tallest thing in a row, so its height sets the row height — a 24px box
   silently makes every row taller. */
.dshtd-icon {
  border: 0; background: transparent; cursor: pointer; color: var(--td-caption);
  width: 20px; height: 20px; padding: 0; border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
}
.dshtd-icon svg { display: block; }
.dshtd-icon:hover { background: var(--td-hover); color: var(--td-primary); }
.dshtd-icon.danger:hover { color: var(--td-danger); }
.dshtd-icon:disabled { opacity: 0.3; cursor: default; }
.dshtd-icon:disabled:hover { background: transparent; color: var(--td-caption); }

/* ---- metadata chips ----
   Every chip is a 20px box on the row's 20px line, so adding metadata to a row
   cannot change its height — the 40px row budget is asserted by test/icon-probe. */
.dshtd-chips { flex: none; display: flex; align-items: center; gap: 4px; }
.dshtd-chip {
  flex: none; height: 20px; display: inline-flex; align-items: center;
  padding: 0 6px; border-radius: 999px; border: 1px solid var(--td-border);
  font-size: 12px; line-height: 20px; color: var(--td-caption);
  max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* Priority reads as a rank, so only the urgent bands get colour — colouring all
   four would make the list a rainbow and hide the two that matter. */
.dshtd-chip.p0 { color: var(--td-danger); border-color: currentColor; font-weight: 500; }
.dshtd-chip.p1 { color: var(--dsw-alias-state-warn-primary, #f59e0b); border-color: currentColor; }
.dshtd-chip.rel { color: var(--dsw-alias-state-business-primary, #60a5fa); border-color: currentColor; }

/* Status pill doubles as the status control, so it is a real button. */
.dshtd-status {
  flex: none; height: 20px; padding: 0 8px; border-radius: 999px;
  border: 1px solid var(--td-border); background: transparent;
  font: inherit; font-size: 12px; line-height: 20px; color: var(--td-caption);
  cursor: pointer; appearance: none;
}
.dshtd-status:hover { color: var(--td-primary); border-color: var(--dsw-alias-brand-primary, #6b7280); }
.dshtd-status.s-in-progress { color: var(--dsw-alias-state-business-primary, #60a5fa); border-color: currentColor; }
.dshtd-status.s-blocked { color: var(--td-danger); border-color: currentColor; }
.dshtd-status.s-done { color: var(--td-accent); border-color: currentColor; }

/* ---- group headers ---- */
.dshtd-group + .dshtd-group { margin-top: 10px; }
.dshtd-ghead {
  display: flex; align-items: center; gap: 8px; width: 100%;
  border: 0; background: transparent; cursor: pointer; text-align: left;
  padding: 4px 10px; border-radius: 6px;
  color: var(--td-primary); font: inherit; font-size: 12px; line-height: 20px; font-weight: 600;
}
.dshtd-ghead:hover { background: var(--td-hover); }
.dshtd-gcount { color: var(--td-caption); font-weight: 400; }
.dshtd-gbar { flex: 1 1 auto; height: 3px; border-radius: 999px; background: var(--td-hover); overflow: hidden; max-width: 120px; }
.dshtd-gbar > i { display: block; height: 100%; background: var(--td-accent); }

/* ---- expandable detail ----
   Lives OUTSIDE the 40px row, as a sibling, so an expanded task never stretches
   the row itself and the collapsed list keeps its density. */
.dshtd-detail {
  padding: 8px 10px 12px 36px; display: flex; flex-direction: column; gap: 8px;
}
.dshtd-desc {
  width: 100%; min-height: 64px; resize: vertical;
  border: 1px solid var(--td-border); border-radius: 6px; background: transparent;
  color: var(--td-secondary); font: inherit; font-size: 14px; line-height: 22px; padding: 6px 8px;
}
.dshtd-desc:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #6b7280); }
.dshtd-fields { display: flex; flex-wrap: wrap; gap: 8px; }
.dshtd-field { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; color: var(--td-caption); }
.dshtd-field-col { display: flex; flex-direction: column; gap: 2px; }
.dshtd-input {
  border: 1px solid var(--td-border); border-radius: 6px; background: transparent;
  color: var(--td-primary); font: inherit; font-size: 12px; line-height: 18px;
  padding: 3px 8px; min-width: 0; width: 130px;
}
.dshtd-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #6b7280); }
.dshtd-input[aria-invalid="true"], .dshtd-input[aria-invalid="true"]:focus { border-color: var(--td-danger); }
.dshtd-label-err { display: block; font-size: 12px; line-height: 18px; color: var(--td-danger); }
.dshtd-select {
  border: 1px solid var(--td-border); border-radius: 6px; background: transparent;
  color: var(--td-primary); font: inherit; font-size: 12px; line-height: 18px; padding: 3px 6px;
}

/* Option rows get an explicit pair on the platforms that honour it (Windows and
   Linux Chromium paint them; macOS ignores it and defers to color-scheme,
   which ui-layout already sets on <html> from the resolved theme).

   Gated on the APP's palette, not the OS query it used to use: applied
   unconditionally these declarations paint a dark popup under a light theme,
   and keyed to the OS query they did exactly that whenever the theme and the
   OS disagreed. body[data-ds-dark-theme] is what ThemePresenter
   actually toggles, so this now follows the theme the user picked. */
body[data-ds-dark-theme] .dshtd-select option,
body[data-ds-dark-theme] .dshtd-status option {
  background: var(--dsw-alias-bg-layer-1, #1b1d21);
  color: var(--dsw-alias-label-primary, #f9fafb);
}

/* ---- task modal ----
   Portalled to document.body, so it escapes .dshtd-scroll's overflow-y: auto —
   rendered inside the tab it would be CLIPPED by its own scroll container.

   z-index sits just under DSH Desktop's window-drag strip
   (#dsh-desktop-windows-drag-region, z-index 2147483644). That strip swallows
   clicks even though it sets pointer-events: none, because the compositor
   resolves drag regions BEFORE hit-testing — so raising z-index cannot beat it.
   The panel instead keeps its controls clear of the 36px strip via padding. */
.dshtd-modal-backdrop {
  position: fixed; inset: 0; z-index: 2147483100;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 48px 24px 24px;
}
.dshtd-modal {
  --td-border: var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
  --td-primary: var(--dsw-alias-label-primary, #f9fafb);
  --td-secondary: var(--dsw-alias-label-secondary, #cfd3d6);
  --td-caption: var(--dsw-alias-label-caption, #81858c);
  --td-accent: var(--dsw-alias-state-success-primary, #22c55e);
  --td-hover: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08));
  --td-danger: var(--dsw-alias-state-error-primary, #ef4444);
  box-sizing: border-box;
  width: min(680px, 100%); max-height: 100%;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-layer-1, #1b1d21);
  border: 1px solid var(--td-border); border-radius: 12px;
  color: var(--td-secondary);
  font: 400 14px/22px var(--dsw-font-family, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
}
.dshtd-modal *, .dshtd-modal *::before, .dshtd-modal *::after { box-sizing: border-box; }
.dshtd-modal-head {
  flex: none; display: flex; align-items: flex-start; gap: 10px;
  padding: 14px 16px; border-bottom: 1px solid var(--td-border);
}
.dshtd-modal-title {
  flex: 1 1 auto; min-width: 0;
  border: 1px solid transparent; border-radius: 6px; background: transparent;
  color: var(--td-primary); font: inherit; font-size: 16px; line-height: 24px; font-weight: 600;
  padding: 4px 8px;
}
.dshtd-modal-title:hover { border-color: var(--td-border); }
.dshtd-modal-title:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #6b7280); }
.dshtd-modal-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
.dshtd-modal-desc {
  width: 100%; min-height: 160px; resize: vertical;
  border: 1px solid var(--td-border); border-radius: 8px; background: transparent;
  color: var(--td-secondary); font: inherit; font-size: 14px; line-height: 22px; padding: 8px 10px;
}
.dshtd-modal-desc:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #6b7280); }
.dshtd-modal-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.dshtd-modal-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; line-height: 18px; color: var(--td-caption); }
.dshtd-modal-foot {
  flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 16px; border-top: 1px solid var(--td-border);
  color: var(--td-caption); font-size: 12px; line-height: 18px;
}
.dshtd-modal .dshtd-input, .dshtd-modal .dshtd-select { width: 100%; font-size: 14px; line-height: 20px; padding: 5px 8px; }
/* The date input's calendar glyph is a UA shadow part drawn dark-on-dark; it
   needs inverting rather than colouring, because it is an image, not text. */
.dshtd-modal input[type="date"]::-webkit-calendar-picker-indicator {
  filter: invert(0.7);
  cursor: pointer;
}

/* ---- confirm dialog ----
   Narrower than the task modal and never scrollable: a destructive prompt that
   needs scrolling to reach its buttons is a prompt people dismiss blind. */
.dshtd-confirm { width: min(420px, 100%); }
.dshtd-confirm-body {
  padding: 16px; display: flex; flex-direction: column; gap: 8px;
}
.dshtd-confirm-title { color: var(--td-primary); font-size: 14px; line-height: 22px; font-weight: 600; }
.dshtd-confirm-text { color: var(--td-secondary); font-size: 14px; line-height: 22px; }
/* The thing being destroyed is quoted back verbatim, so the dialog cannot be
   confused with the one for a neighbouring row. */
.dshtd-confirm-subject {
  color: var(--td-primary); overflow-wrap: anywhere;
  border-left: 2px solid var(--td-danger); padding-left: 8px;
}
.dshtd-confirm-foot {
  flex: none; display: flex; justify-content: flex-end; gap: 8px;
  padding: 10px 16px; border-top: 1px solid var(--td-border);
}
.dshtd-btn {
  border: 1px solid var(--td-border); border-radius: 8px; background: transparent;
  color: var(--td-primary); font: inherit; font-size: 14px; line-height: 20px;
  padding: 6px 14px; cursor: pointer;
}
.dshtd-btn:hover { background: var(--td-hover); }
.dshtd-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #6b7280); outline-offset: 1px; }
/* The destructive action is the one that looks destructive; Cancel stays quiet
   so the safe choice is never the visually louder one. */
.dshtd-btn.danger { border-color: var(--td-danger); color: var(--td-danger); }
.dshtd-btn.danger:hover { background: var(--td-danger); color: var(--dsw-alias-label-primary-foreground, #fff); }
/* The shell's own filled primary, token for token, so a confirm action here
   reads as the same control as one in Settings rather than a bespoke link.
   Both tokens follow the active theme AND the accent axis. */
.dshtd-btn.primary {
  background: var(--dsw-alias-button-primary-fill, #f9fafb);
  border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground, #0f1115);
  font-weight: 500;
}
.dshtd-btn.primary:hover { background: var(--dsw-alias-button-primary-hover, #e1e5ee); }

/* Overdue is the one state worth colouring in the list: it is the thing a
   standup escalates. Due-today is warned, not alarmed. */
.dshtd-chip.due-over { color: var(--td-danger); border-color: currentColor; font-weight: 500; }
.dshtd-chip.due-today { color: var(--dsw-alias-state-warn-primary, #f59e0b); border-color: currentColor; }

/* ---- toolbar (group-by) ---- */
.dshtd-tools { flex: none; display: flex; align-items: center; gap: 6px; padding: 0 20px 10px; }
.dshtd-tools label { color: var(--td-caption); font-size: 12px; line-height: 18px; }

/* ---- empty + footer ---- */
.dshtd-empty {
  padding: 40px 20px; text-align: center; color: var(--td-caption);
}
.dshtd-empty b { display: block; color: var(--td-secondary); font-weight: 500; margin-bottom: 4px; }
.dshtd-foot {
  flex: none;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 20px; border-top: 1px solid var(--td-border);
  color: var(--td-caption); font-size: 12px; line-height: 18px;
}
.dshtd-link {
  border: 0; background: transparent; cursor: pointer; color: var(--td-caption);
  font: inherit; padding: 3px 8px; border-radius: 6px;
}
.dshtd-link:hover { background: var(--td-hover); color: var(--td-primary); }
.dshtd-link.danger:hover { color: var(--td-danger); }
.dshtd-state { color: var(--td-caption); font-size: 12px; line-height: 18px; }
.dshtd-state.err { color: var(--td-danger); }

@media (prefers-reduced-motion: reduce) {
  .dshtd-progress > i, .dshtd-rowbtns { transition: none; }
}
`

let stylesInjected = false
function injectStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dennisrongo/dsh-todo'
  tag.textContent = VIEW_STYLES
  document.head.appendChild(tag)
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/**
 * Icons, matching the shell's own convention: an inline SVG stroked in
 * `currentColor` and marked `aria-hidden`, because every call site already
 * carries a `title`/`aria-label`.
 *
 * Size is fixed at 16 and NOT a prop. The shell draws icons at 12/14/16/20, but
 * it pairs each size with a matching viewBox (a 14px icon is authored on
 * `0 0 14 14`), so 16-unit path data rendered into a 14px box comes out shrunk
 * with thinned strokes. Footprint belongs to the button box below, not the glyph.
 *
 * These are inlined rather than imported: the shell's icon set lives in
 * `@deepseek-ai/dsh-client-ui-primitives`, which is a build-time external of the
 * host bundles — neither a loadable client module nor served over `/plugins/` —
 * so a plugin cannot import it. Inlining to the same spec is the only way to
 * match, and it keeps the tab free of an icon-font dependency.
 */
function Icon({ path }: { path: string }): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  )
}

/**
 * Path data, keyed by role, so call sites read as names rather than glyphs.
 *
 * This also retires a latent bug: Archive was `⌸` (U+2338), which has no glyph
 * in the common UI fonts and rendered as a tofu box on Windows.
 */
const ICON = {
  check: 'M3.5 8.5l3 3 6-6',
  restore: 'M3 8a5 5 0 1 0 1.6-3.68M3 2.5v3h3',
  close: 'M4 4l8 8M12 4l-8 8',
  up: 'M8 12.5v-9M4.5 7L8 3.5 11.5 7',
  down: 'M8 3.5v9M4.5 9L8 12.5 11.5 9',
  archive: 'M2.5 5.5h11M3.5 5.5v7h9v-7M6.5 8.5h3',
  expand: 'M6 4l4 4-4 4',
  collapse: 'M4 6l4 4 4-4',
} as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * What a pending destructive action needs in order to be confirmed.
 *
 * Held as data rather than a callback closure alone so the dialog can quote the
 * exact subject back to the user — a confirm prompt that does not name what it
 * is about to destroy is one people learn to click through.
 */
export interface PendingConfirm {
  /** Dialog heading, e.g. "Delete task". */
  title: string
  /** The sentence explaining the consequence. */
  message: string
  /** The thing being destroyed, quoted verbatim. Omitted for bulk actions. */
  subject?: string
  /** Label for the destructive button. */
  confirmLabel: string
  /** Performed when the user confirms. */
  onConfirm: () => void
}

/**
 * A modal confirmation for destructive actions.
 *
 * Shares the task modal's portal and z-index reasoning: it renders into
 * `document.body` to escape the list's `overflow-y: auto` scroller, and stays
 * below DSH Desktop's window-drag strip, which swallows clicks regardless of
 * z-index.
 *
 * Focus opens on CANCEL, not the destructive button, so a stray Enter dismisses
 * the dialog instead of confirming the deletion it was meant to guard.
 */
export function ConfirmDialog({
  pending,
  onClose,
}: {
  pending: PendingConfirm
  onClose: () => void
}): React.JSX.Element {
  const panel = React.useRef<HTMLDivElement | null>(null)
  const cancel = React.useRef<HTMLButtonElement | null>(null)

  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancel.current?.focus()
    return () => previous?.focus?.()
  }, [])

  const confirm = (): void => {
    pending.onConfirm()
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // The shell binds global shortcuts; a dialog must not leak keys to them.
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const focusable = panel.current?.querySelectorAll<HTMLElement>('button')
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="dshtd-modal-backdrop" onClick={onClose} onKeyDown={onKeyDown}>
      <div
        className="dshtd-modal dshtd-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={pending.title}
        tabIndex={-1}
        ref={panel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dshtd-confirm-body">
          <span className="dshtd-confirm-title">{pending.title}</span>
          <span className="dshtd-confirm-text">{pending.message}</span>
          {pending.subject ? (
            <span className="dshtd-confirm-subject">{pending.subject}</span>
          ) : null}
        </div>
        <div className="dshtd-confirm-foot">
          <button className="dshtd-btn" ref={cancel} onClick={onClose}>
            Cancel
          </button>
          <button className="dshtd-btn danger" onClick={confirm}>
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The full task detail dialog.
 *
 * Portalled to `document.body` because the tab's list is an `overflow-y: auto`
 * scroll container: rendered in place, the dialog would be clipped by it.
 *
 * Text fields commit on blur (and the dialog force-commits title/description on
 * exit), so typing does not put one host round-trip on the wire per keystroke.
 *
 * **Done saves; everything else dismisses.** Done is the only control that
 * refuses to proceed while a label is invalid — the backdrop, Escape and the X
 * always let you out, discarding the unsaved label rather than trapping you in
 * a dialog because one field is half-typed.
 */
export function TodoModal({
  item,
  store,
  onClose,
  knownReleases,
  knownSprints,
}: {
  item: TodoItem
  store: TodoStore
  onClose: () => void
  knownReleases: string[]
  knownSprints: string[]
}): React.JSX.Element {
  const [title, setTitle] = React.useState(item.title)
  const [desc, setDesc] = React.useState(item.description ?? '')
  const panel = React.useRef<HTMLDivElement | null>(null)
  const releaseRef = React.useRef<HTMLInputElement | null>(null)
  const sprintRef = React.useRef<HTMLInputElement | null>(null)
  const [labelErr, setLabelErr] = React.useState<{ release?: boolean; sprint?: boolean }>({})

  // Commit whatever is in the local drafts. Called on close so edits are never
  // lost to a click on the backdrop.
  const flush = React.useCallback(() => {
    const nextTitle = normalizeText(title)
    const nextDesc = normalizeDescription(desc)
    store.update((items) => {
      let out = items
      if (nextTitle && nextTitle !== item.title) out = updateItem(out, item.id, { title: nextTitle })
      if (nextDesc !== (item.description ?? '')) out = updateItem(out, item.id, { description: nextDesc })
      return out
    })
  }, [title, desc, item, store])

  /**
   * Leave WITHOUT saving the labels.
   *
   * A dialog you cannot escape because one field is half-typed is a trap, so
   * the backdrop, Escape and the X always get out. Title and description still
   * flush — those cannot be invalid — while an unsaved invalid label is simply
   * discarded, leaving the stored value untouched.
   */
  const dismiss = React.useCallback(() => {
    flush()
    onClose()
  }, [flush, onClose])

  /**
   * Save and leave. The ONLY control that refuses to proceed on bad data.
   *
   * Labels normally commit on blur, but the refs are re-read here so a value
   * typed and confirmed in one gesture still lands, and so an invalid one is
   * caught even if the blur handler never ran.
   */
  const save = React.useCallback(() => {
    const releaseRaw = releaseRef.current?.value ?? ''
    const sprintRaw = sprintRef.current?.value ?? ''
    const badRelease = labelError(releaseRaw, 'release') !== undefined
    const badSprint = labelError(sprintRaw, 'sprint') !== undefined
    if (badRelease || badSprint) {
      setLabelErr({ release: badRelease, sprint: badSprint })
      // Put the cursor where the problem is, so the message is not something
      // the user has to go hunting for.
      ;(badRelease ? releaseRef.current : sprintRef.current)?.focus()
      return
    }
    store.update((items) => updateItem(items, item.id, { release: releaseRaw, sprint: sprintRaw }))
    flush()
    onClose()
  }, [flush, onClose, store, item.id])

  // Focus the dialog on open and restore focus to whatever opened it on close,
  // so keyboard users are not dumped at the top of the document.
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => previous?.focus?.()
  }, [])

  // Esc closes, and Tab is trapped inside the dialog. The keydown is stopped
  // from propagating because the shell binds its own global shortcuts.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      dismiss()
      return
    }
    if (e.key !== 'Tab') return
    const focusable = panel.current?.querySelectorAll<HTMLElement>(
      'button, input, textarea, select, [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const overdue = isOverdue(item)

  return createPortal(
    <div className="dshtd-modal-backdrop" onClick={dismiss} onKeyDown={onKeyDown}>
      <div
        className="dshtd-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Task: ${item.title}`}
        tabIndex={-1}
        ref={panel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dshtd-modal-head">
          <input
            className="dshtd-modal-title"
            value={title}
            aria-label="Task title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const next = normalizeText(title)
              if (!next || next === item.title) return
              store.update((items) => updateItem(items, item.id, { title: next }))
            }}
          />
          <button className="dshtd-icon" title="Close without saving" aria-label="Close task details without saving" onClick={dismiss}>
            <Icon path={ICON.close} />
          </button>
        </div>

        <div className="dshtd-modal-body">
          <textarea
            className="dshtd-modal-desc"
            value={desc}
            placeholder="Description — acceptance criteria, repro steps, links…"
            aria-label="Task description"
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => {
              const next = normalizeDescription(desc)
              if (next === (item.description ?? '')) return
              store.update((items) => updateItem(items, item.id, { description: next }))
            }}
          />
          <div className="dshtd-modal-grid">
            <label className="dshtd-modal-label">
              Status
              <select
                className="dshtd-select"
                value={item.status}
                onChange={(e) =>
                  store.update((items) => setStatus(items, item.id, e.target.value as TodoStatus))
                }
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label className="dshtd-modal-label">
              Priority
              <select
                className="dshtd-select"
                value={item.priority}
                onChange={(e) =>
                  store.update((items) => setPriority(items, item.id, e.target.value as TodoPriority))
                }
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            </label>
            <label className="dshtd-modal-label">
              Release
              <input
                ref={releaseRef}
                className="dshtd-input"
                list="dshtd-releases"
                defaultValue={item.release ?? ''}
                placeholder="1.5 or 0.5.1"
                inputMode="decimal"
                aria-invalid={labelErr.release === true || undefined}
                onChange={(e) => {
                  e.target.value = sanitizeDecimalInput(e.target.value)
                  if (labelErr.release && labelError(e.target.value, 'release') === undefined) {
                    setLabelErr((prev) => ({ ...prev, release: false }))
                  }
                }}
                onBlur={(e) => {
                  // Refused edits are FLAGGED, not silently reverted: the text
                  // stays so the user sees what was refused and can fix it.
                  if (labelError(e.target.value, 'release') !== undefined) {
                    setLabelErr((prev) => ({ ...prev, release: true }))
                    return
                  }
                  setLabelErr((prev) => ({ ...prev, release: false }))
                  store.update((items) => updateItem(items, item.id, { release: e.target.value }))
                }}
              />
              {labelErr.release ? <span className="dshtd-label-err" role="alert">{RELEASE_ERROR}</span> : null}
            </label>
            <label className="dshtd-modal-label">
              Sprint
              <input
                ref={sprintRef}
                className="dshtd-input"
                list="dshtd-sprints"
                defaultValue={item.sprint ?? ''}
                placeholder="24"
                inputMode="decimal"
                aria-invalid={labelErr.sprint === true || undefined}
                onChange={(e) => {
                  e.target.value = sanitizeDecimalInput(e.target.value)
                  if (labelErr.sprint && labelError(e.target.value, 'sprint') === undefined) {
                    setLabelErr((prev) => ({ ...prev, sprint: false }))
                  }
                }}
                onBlur={(e) => {
                  if (labelError(e.target.value, 'sprint') !== undefined) {
                    setLabelErr((prev) => ({ ...prev, sprint: true }))
                    return
                  }
                  setLabelErr((prev) => ({ ...prev, sprint: false }))
                  store.update((items) => updateItem(items, item.id, { sprint: e.target.value }))
                }}
              />
              {labelErr.sprint ? <span className="dshtd-label-err" role="alert">{SPRINT_ERROR}</span> : null}
            </label>
            <label className="dshtd-modal-label">
              Due date
              <input
                className="dshtd-input"
                type="date"
                defaultValue={item.dueDate ?? ''}
                onChange={(e) => store.update((items) => updateItem(items, item.id, { dueDate: e.target.value }))}
              />
            </label>
          </div>
          <datalist id="dshtd-releases">
            {knownReleases.map((r) => <option key={r} value={r} />)}
          </datalist>
          <datalist id="dshtd-sprints">
            {knownSprints.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>

        <div className="dshtd-modal-foot">
          <span>
            Created {fmtAge(item.createdAt)} ago
            {item.completedAt ? ` · completed ${fmtAge(item.completedAt)} ago` : ''}
            {overdue ? ' · overdue' : ''}
          </span>
          <button className="dshtd-btn primary" onClick={save}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The status pill: a real `<select>` so status is one click, not a submenu. */
function StatusPill({ item, store }: { item: TodoItem; store: TodoStore }): React.JSX.Element {
  return (
    <select
      className={`dshtd-status s-${item.status}`}
      value={item.status}
      aria-label={`Status of "${item.title}"`}
      title="Change status"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => store.update((items) => setStatus(items, item.id, e.target.value as TodoStatus))}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  )
}

/**
 * One task row.
 *
 * The collapsed row carries only what can be scanned in a list — title, status,
 * priority, release, due — and everything else lives behind the expander. That
 * split is what lets the item grow to nine fields without the list becoming a
 * wall of text, and it keeps the row on the 40px budget the icon probe asserts.
 */
function TodoRow({
  item,
  index,
  total,
  store,
  knownReleases,
  knownSprints,
  onOpen,
  onDelete,
}: {
  item: TodoItem
  index: number
  total: number
  store: TodoStore
  knownReleases: string[]
  knownSprints: string[]
  onOpen: () => void
  onDelete: () => void
}): React.JSX.Element {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(item.title)
  const [open, setOpen] = React.useState(false)
  const archived = isArchived(item)
  const done = isDone(item)

  const commit = () => {
    const title = normalizeText(draft)
    setEditing(false)
    if (!title || title === item.title) return
    store.update((items) => updateItem(items, item.id, { title }))
  }

  // An archived row is a record of finished work, not a work surface: it is
  // read-only apart from restoring or permanently deleting it.
  if (archived) {
    return (
      <li className="dshtd-row archived">
        <span className="dshtd-badge" aria-hidden="true">
          <Icon path={ICON.check} />
        </span>
        <span className="dshtd-text">{item.title}</span>
        {item.release ? <span className="dshtd-chip rel">{item.release}</span> : null}
        <span className="dshtd-age" title="When this was archived">
          {fmtAge(item.archivedAt ?? 0)}
        </span>
        <span className="dshtd-rowbtns">
          <button
            className="dshtd-icon"
            title="Restore to the active list"
            aria-label={`Restore "${item.title}"`}
            onClick={() => store.update((items) => restoreItem(items, item.id))}
          >
            <Icon path={ICON.restore} />
          </button>
          <button
            className="dshtd-icon danger"
            title="Delete permanently"
            aria-label={`Permanently delete "${item.title}"`}
            onClick={onDelete}
          >
            <Icon path={ICON.close} />
          </button>
        </span>
      </li>
    )
  }

  return (
    <li className="dshtd-item">
      <div className={`dshtd-row${done ? ' done' : ''}`}>
        <input
          type="checkbox"
          className="dshtd-check"
          checked={done}
          aria-label={done ? `Mark "${item.title}" as not done` : `Mark "${item.title}" as done`}
          onChange={() => store.update((items) => toggleItem(items, item.id))}
        />
        {editing ? (
          <input
            className="dshtd-edit"
            value={draft}
            autoFocus
            aria-label="Edit task title"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraft(item.title)
                setEditing(false)
              }
            }}
          />
        ) : (
          <span
            className="dshtd-text"
            title="Click to open · double-click to rename inline"
            onClick={onOpen}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setDraft(item.title)
              setEditing(true)
            }}
          >
            {item.title}
          </span>
        )}
        {!editing ? (
          <span className="dshtd-chips">
            {/* P2 is the default and carries no information, so it is not drawn. */}
            {item.priority !== DEFAULT_PRIORITY ? (
              <span className={`dshtd-chip ${item.priority}`} title={PRIORITY_LABEL[item.priority]}>
                {item.priority.toUpperCase()}
              </span>
            ) : null}
            {item.release ? (
              <span className="dshtd-chip rel" title={`Release ${item.release}`}>
                {item.release}
              </span>
            ) : null}
            {item.sprint ? (
              <span className="dshtd-chip" title={`Sprint ${item.sprint}`}>
                {item.sprint}
              </span>
            ) : null}
            {item.dueDate ? (
              <span
                className={`dshtd-chip${isOverdue(item) ? ' due-over' : isDueToday(item) ? ' due-today' : ''}`}
                title={`Due ${item.dueDate}${isOverdue(item) ? ' — overdue' : ''}`}
              >
                {fmtDue(item.dueDate)}
              </span>
            ) : null}
            <StatusPill item={item} store={store} />
          </span>
        ) : null}
        <span className="dshtd-rowbtns">
          <button
            className="dshtd-icon"
            title={open ? 'Hide details' : 'Show details'}
            aria-label={`${open ? 'Hide' : 'Show'} details for "${item.title}"`}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon path={open ? ICON.collapse : ICON.expand} />
          </button>
          <button
            className="dshtd-icon"
            title="Move up"
            aria-label={`Move "${item.title}" up`}
            disabled={index === 0}
            onClick={() => store.update((items) => moveItem(items, item.id, -1))}
          >
            <Icon path={ICON.up} />
          </button>
          <button
            className="dshtd-icon"
            title="Move down"
            aria-label={`Move "${item.title}" down`}
            disabled={index === total - 1}
            onClick={() => store.update((items) => moveItem(items, item.id, 1))}
          >
            <Icon path={ICON.down} />
          </button>
          {done ? (
            <button
              className="dshtd-icon"
              title="Archive"
              aria-label={`Archive "${item.title}"`}
              onClick={() => store.update((items) => archiveItem(items, item.id))}
            >
              <Icon path={ICON.archive} />
            </button>
          ) : null}
          <button
            className="dshtd-icon danger"
            title="Delete"
            aria-label={`Delete "${item.title}"`}
            onClick={onDelete}
          >
            <Icon path={ICON.close} />
          </button>
        </span>
      </div>
      {open ? (
        <TodoDetail
          item={item}
          store={store}
          knownReleases={knownReleases}
          knownSprints={knownSprints}
        />
      ) : null}
    </li>
  )
}

/**
 * The expanded half of a row: description plus the roadmap fields.
 *
 * Text fields commit on blur rather than per keystroke, because every change
 * goes through the store to the host — committing per keystroke would put one
 * write on the wire per character typed.
 */
function TodoDetail({
  item,
  store,
  knownReleases,
  knownSprints,
}: {
  item: TodoItem
  store: TodoStore
  knownReleases: string[]
  knownSprints: string[]
}): React.JSX.Element {
  const [desc, setDesc] = React.useState(item.description ?? '')
  const [release, setRelease] = React.useState(item.release ?? '')
  const [sprint, setSprint] = React.useState(item.sprint ?? '')
  const [labelErr, setLabelErr] = React.useState<{ release?: boolean; sprint?: boolean }>({})

  return (
    <div className="dshtd-detail">
      <textarea
        className="dshtd-desc"
        value={desc}
        placeholder="Description — acceptance criteria, repro steps, links…"
        aria-label={`Description of "${item.title}"`}
        onChange={(e) => setDesc(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        onBlur={() => {
          const description = normalizeDescription(desc)
          if (description === (item.description ?? '')) return
          store.update((items) => updateItem(items, item.id, { description }))
        }}
      />
      <div className="dshtd-fields">
        <label className="dshtd-field">
          Release
          <span className="dshtd-field-col">
            <input
              className="dshtd-input"
              list="dshtd-releases"
              value={release}
              placeholder="1.5 or 0.5.1"
              inputMode="decimal"
              aria-invalid={labelErr.release === true || undefined}
              onChange={(e) => {
                setRelease(sanitizeDecimalInput(e.target.value))
                if (labelErr.release && labelError(e.target.value, 'release') === undefined) {
                  setLabelErr((prev) => ({ ...prev, release: false }))
                }
              }}
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={() => {
                // Flagged, not silently reverted: the text stays so the user
                // sees what was refused and can fix it.
                if (labelError(release, 'release') !== undefined) { setLabelErr((prev) => ({ ...prev, release: true })); return }
                setLabelErr((prev) => ({ ...prev, release: false }))
                if ((normalizeLabel(release) ?? '') === (item.release ?? '')) return
                store.update((items) => updateItem(items, item.id, { release }))
              }}
            />
            {labelErr.release ? <span className="dshtd-label-err" role="alert">{RELEASE_ERROR}</span> : null}
          </span>
        </label>
        <label className="dshtd-field">
          Sprint
          <span className="dshtd-field-col">
            <input
              className="dshtd-input"
              list="dshtd-sprints"
              value={sprint}
              placeholder="24"
              inputMode="decimal"
              aria-invalid={labelErr.sprint === true || undefined}
              onChange={(e) => {
                setSprint(sanitizeDecimalInput(e.target.value))
                if (labelErr.sprint && labelError(e.target.value, 'sprint') === undefined) {
                  setLabelErr((prev) => ({ ...prev, sprint: false }))
                }
              }}
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={() => {
                if (labelError(sprint, 'sprint') !== undefined) { setLabelErr((prev) => ({ ...prev, sprint: true })); return }
                setLabelErr((prev) => ({ ...prev, sprint: false }))
                if ((normalizeLabel(sprint) ?? '') === (item.sprint ?? '')) return
                store.update((items) => updateItem(items, item.id, { sprint }))
              }}
            />
            {labelErr.sprint ? <span className="dshtd-label-err" role="alert">{SPRINT_ERROR}</span> : null}
          </span>
        </label>
        <label className="dshtd-field">
          Priority
          <select
            className="dshtd-select"
            value={item.priority}
            onChange={(e) =>
              store.update((items) => setPriority(items, item.id, e.target.value as TodoPriority))
            }
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <span className="dshtd-field">Created {fmtAge(item.createdAt)} ago</span>
      </div>
      {/* Shared suggestion lists: decimal labels converge on a vocabulary
          without a releases table to administer. */}
      <datalist id="dshtd-releases">
        {knownReleases.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <datalist id="dshtd-sprints">
        {knownSprints.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}

/**
 * The filter ring. `open` sits first as the default working view, then the two
 * states a standup actually asks about, then the finished/archived tail.
 */
const FILTERS: { id: TodoFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'done', label: 'Done' },
  { id: 'archived', label: 'Archive' },
]

/** The group-by options, in the order the selector lists them. */
const GROUPS: { id: TodoGroupBy; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'status', label: 'Status' },
  { id: 'release', label: 'Release' },
  { id: 'sprint', label: 'Sprint' },
  { id: 'priority', label: 'Priority' },
]

/** Per-filter counts for the ring, so each chip can carry its own number. */
function filterCount(items: TodoItem[], id: TodoFilter, stats: TodoStats): number {
  if (id === 'all') return stats.total
  if (id === 'open') return stats.open
  if (id === 'archived') return stats.archived
  return activeItems(items).filter((i) => i.status === id).length
}

/**
 * The whole todo tab: header, filter ring, add box, and the list. Rendered by
 * the `conversation.view` ring when its tab is active, filling the session pane.
 * @param props - the per-workspace store, or null when no workspace owns the session.
 */
export function TodoView({ store }: { store: TodoStore | null }): React.JSX.Element {
  const [filter, setFilter] = React.useState<TodoFilter>('all')
  const [groupBy, setGroupBy] = React.useState<TodoGroupBy>('none')
  const [draft, setDraft] = React.useState('')
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  // Which task the detail dialog is showing, by id. Held as an id rather than
  // the item itself so the dialog always renders the CURRENT version after a
  // host commit or a conflict adopts another tab's list.
  const [openId, setOpenId] = React.useState<string | null>(null)
  // The destructive action awaiting confirmation, or null. One slot rather than
  // a boolean per call site, so every delete path routes through the same
  // dialog and none can quietly skip the guard.
  const [pending, setPending] = React.useState<PendingConfirm | null>(null)

  React.useEffect(() => {
    injectStyles()
  }, [])

  React.useEffect(() => {
    if (store) void store.ensure()
  }, [store])

  const state = React.useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : getMissingSnapshot,
    store ? store.getSnapshot : getMissingSnapshot,
  )

  if (!store) {
    return (
      <div className="dshtd">
        <div className="dshtd-empty">
          <b>No workspace yet</b>
          Todos are stored per workspace. Open or create one to start a list.
        </div>
      </div>
    )
  }

  const items = state.items
  const add = () => {
    const title = normalizeText(draft)
    if (!title) return
    store.update((list) => [...list, makeItem(title)])
    setDraft('')
    // A new task is 'todo' and unarchived, so those views would swallow it.
    if (filter !== 'all' && filter !== 'open' && filter !== 'todo') setFilter('all')
  }

  const stats = computeStats(items)
  const active = activeItems(items)
  const visible = filterItems(items, filter)
  const groups = groupItems(visible, groupBy)
  const knownReleases = knownLabels(items, 'release')
  const knownSprints = knownLabels(items, 'sprint')
  const openTask = openId === null ? undefined : items.find((i) => i.id === openId)

  /**
   * Ask before removing one task.
   *
   * An archived row is worded as permanent because it truly is; an active row
   * is offered the recoverable alternative instead, so the safe path is the one
   * the dialog names.
   */
  const askDelete = (item: TodoItem): void => {
    const archived = isArchived(item)
    setPending({
      title: archived ? 'Delete permanently' : 'Delete task',
      message: archived
        ? 'This removes the task from the archive for good. This cannot be undone.'
        : 'This deletes the task outright. Archiving keeps it recoverable instead.',
      subject: item.title,
      confirmLabel: 'Delete',
      onConfirm: () => store.update((list) => list.filter((i) => i.id !== item.id)),
    })
  }

  return (
    <div className="dshtd">
      <div className="dshtd-head">
        <span className="dshtd-title">Todo</span>
        <span
          className="dshtd-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={stats.percent}
          aria-label="Todo completion"
        >
          <i style={{ width: `${stats.percent}%` }} />
        </span>
        <span className="dshtd-score">
          {stats.done}/{stats.total} done
          {stats.inProgress > 0 ? ` · ${stats.inProgress} in progress` : ''}
          {stats.blocked > 0 ? ` · ${stats.blocked} blocked` : ''}
        </span>
      </div>

      <div className="dshtd-filters" role="group" aria-label="Filter todos">
        {FILTERS.map((f) => {
          const count = filterCount(items, f.id, stats)
          // A zero-count status chip is hidden rather than disabled: the ring is
          // a working surface, and empty states are noise on a sprint board.
          if (count === 0 && f.id !== 'all' && f.id !== 'open') return null
          return (
            <button
              key={f.id}
              className="dshtd-filter"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {f.id !== 'all' && count > 0 ? ` (${count})` : null}
            </button>
          )
        })}
      </div>

      <div className="dshtd-tools">
        <label htmlFor="dshtd-groupby">Group by</label>
        <select
          id="dshtd-groupby"
          className="dshtd-select"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as TodoGroupBy)}
        >
          {GROUPS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </div>

      <div className="dshtd-addrow">
        <input
          className="dshtd-add"
          value={draft}
          placeholder="What needs doing?"
          aria-label="Add a todo"
          disabled={state.status !== 'ready'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft('')
            }
          }}
        />
        <button
          className="dshtd-addbtn"
          disabled={!normalizeText(draft) || state.status !== 'ready'}
          onClick={add}
        >
          Add
        </button>
      </div>

      <div className="dshtd-scroll">
        {state.status === 'loading' ? (
          <div className="dshtd-empty">Loading…</div>
        ) : state.status === 'error' ? (
          <div className="dshtd-empty">
            <b>Couldn&apos;t load todos</b>
            {state.error}
          </div>
        ) : visible.length === 0 ? (
          <div className="dshtd-empty">
            {filter === 'archived' ? (
              <>
                <b>Nothing archived yet</b>
                Check items off, then use “Archive completed” to file them away. Archived
                items stay here until you delete them.
              </>
            ) : stats.total === 0 ? (
              <>
                <b>No tasks yet</b>
                Add your first one above — this list belongs to the current workspace.
              </>
            ) : filter === 'open' ? (
              <>
                <b>All done 🎉</b>
                Nothing open right now.
              </>
            ) : (
              <>
                <b>Nothing here</b>
                No tasks match this filter.
              </>
            )}
          </div>
        ) : (
          groups.map((group) => {
            const gdone = group.items.filter(isDone).length
            const gpercent = group.items.length === 0 ? 0 : Math.round((gdone / group.items.length) * 100)
            const isCollapsed = collapsed[group.key] === true
            return (
              <section className="dshtd-group" key={group.key}>
                {groupBy !== 'none' ? (
                  <button
                    className="dshtd-ghead"
                    aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed((c) => ({ ...c, [group.key]: !isCollapsed }))}
                  >
                    <Icon path={isCollapsed ? ICON.expand : ICON.collapse} />
                    {group.label}
                    <span className="dshtd-gcount">
                      {gdone}/{group.items.length}
                    </span>
                    <span className="dshtd-gbar" aria-hidden="true">
                      <i style={{ width: `${gpercent}%` }} />
                    </span>
                  </button>
                ) : null}
                {!isCollapsed ? (
                  <ul className="dshtd-list">
                    {group.items.map((item) => (
                      <TodoRow
                        key={item.id}
                        item={item}
                        // Position is expressed in ACTIVE-list space, matching
                        // moveItem, so the up/down end-stops disable on the true
                        // first/last item rather than the first in this group.
                        index={active.indexOf(item)}
                        total={active.length}
                        store={store}
                        knownReleases={knownReleases}
                        knownSprints={knownSprints}
                        onOpen={() => setOpenId(item.id)}
                        onDelete={() => askDelete(item)}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            )
          })
        )}
      </div>

      <div className="dshtd-foot">
        <span>
          {stats.open} open · {stats.done} done
          {stats.archived > 0 ? ` · ${stats.archived} archived` : null}
          {state.saving ? <span className="dshtd-state"> · saving…</span> : null}
          {state.error && state.status === 'ready' ? (
            <span className="dshtd-state err"> · {state.error}</span>
          ) : null}
        </span>
        {filter === 'archived' ? (
          stats.archived > 0 ? (
            <button
              className="dshtd-link danger"
              title="Permanently delete every archived item"
              onClick={() =>
                setPending({
                  title: 'Delete archived tasks',
                  message: `Permanently delete ${stats.archived} archived ${
                    stats.archived === 1 ? 'task' : 'tasks'
                  }? This cannot be undone.`,
                  confirmLabel: 'Delete all',
                  onConfirm: () => store.update(clearArchived),
                })
              }
            >
              Delete archived
            </button>
          ) : null
        ) : stats.done > 0 ? (
          <button
            className="dshtd-link"
            title="Move completed items to the archive — they stay recoverable"
            onClick={() => store.update(archiveCompleted)}
          >
            Archive completed
          </button>
        ) : null}
      </div>

      {/* Looked up per render: if the task is deleted in another tab while the
          dialog is open, it closes itself instead of editing a ghost. */}
      {openTask ? (
        <TodoModal
          item={openTask}
          store={store}
          onClose={() => setOpenId(null)}
          knownReleases={knownReleases}
          knownSprints={knownSprints}
        />
      ) : null}

      {pending ? <ConfirmDialog pending={pending} onClose={() => setPending(null)} /> : null}
    </div>
  )
}

const MISSING: TodoState = { items: [], status: 'ready', error: null, saving: false }
const noopSubscribe = (): (() => void) => () => {}
const getMissingSnapshot = (): TodoState => MISSING

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------

/**
 * Client plugin body: mount the host's todo Remote contract, then register the
 * list as a tab in the conversation view ring beside Chat (0) and Trajectory (10).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // One store per workspace, so every tab viewing the same workspace shares
  // one list and one in-flight write chain.
  const stores = new Map<string, TodoStore>()

  const anyCtx = ctx as never as {
    remote: { $mount: (c: unknown) => Promise<() => Promise<void>> }
    inject: (
      services: readonly string[],
      callback: (scoped: unknown) => void,
    ) => { dispose: () => void }
  }

  // Mount the host contract. `$mount` publishes the namespace as a cordis
  // service named `remote.dshTodo`, ASYNCHRONOUSLY — so nothing may read
  // ctx.remote.dshTodo until that service exists.
  ctx.effect(() => {
    let disposed = false
    let unmount: (() => Promise<void>) | undefined
    void anyCtx.remote
      .$mount(TODO_REMOTE)
      .then((dispose) => {
        if (disposed) return void dispose()
        unmount = dispose
      })
      .catch((error: unknown) => {
        console.error('dsh-todo: failed to mount host remote', error)
      })
    return () => {
      disposed = true
      stores.clear()
      void unmount?.()
    }
  }, 'dsh-todo: mount host remote')

  // Register the tab only once the mounted namespace is actually resolvable.
  //
  // This guard is the whole point: `$mount` above resolves asynchronously, so
  // reading `ctx.remote.dshTodo` directly in apply() captures `undefined` and
  // every call fails with "Cannot read properties of undefined (reading
  // 'list')". `ctx.inject(...)` parks a child fiber until the namespace
  // service exists, then runs the body with a context that can resolve it.
  //
  // The dependency cannot go in this plugin's top-level `inject` array the way
  // dsh's own Remote consumers do: those rely on a separate assembly having
  // already mounted their contract, whereas this plugin mounts its own, which
  // would deadlock apply() against an effect that never runs.
  ctx.effect(() => {
    const fiber = anyCtx.inject(['remote.dshTodo', 'workspaces', 'slots'], (scoped) => {
      const readyCtx = scoped as ClientContext & {
        workspaces: { list: { getSnapshot(): { items: readonly unknown[] } } }
        remote: Record<string, TodoRemote>
      }
      readyCtx.slots.inject('conversation.view', () =>
        readyCtx.slots.register(
          {
            name: 'conversation.view',
            id: 'todo',
            order: 20,
            label: () => 'Todo',
            inject: (sessionId: string) => {
              const workspaces = readyCtx.workspaces.list.getSnapshot().items as readonly {
                workspaceId: string
                sessionIds: readonly string[]
              }[]
              const workspaceId = workspaceIdForSession(workspaces, sessionId)
              if (workspaceId === undefined) return { store: null }
              let store = stores.get(workspaceId)
              if (store === undefined) {
                store = new TodoStore(readyCtx.remote.dshTodo, workspaceId)
                stores.set(workspaceId, store)
              }
              return { store }
            },
          },
          TodoView,
        ),
      )
    })
    return () => {
      fiber.dispose()
    }
  }, 'dsh-todo: conversation.view registration')
}
