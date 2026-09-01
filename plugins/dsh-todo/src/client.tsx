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
  composePrompt,
  discardSession,
  flattenModels,
  launchSession,
  presetOptions,
  sessionTitleFor,
  type LaunchContext,
  type ModelChoice,
  type ModelOption,
  type PresetOption,
  type RawCatalogGroup,
} from './launch.ts'
import { composeScanPrompt } from './suggest.ts'
import {
  DEFAULT_PRIORITY,
  DEFAULT_STATUS,
  MAX_DESC,
  MAX_TEXT,
  PRIORITIES,
  STATUSES,
  compareVersionsDesc,
  makeRunId,
  normalizeDueDate,
  normalizeLabel,
  normalizeVersionLabel,
  toPriority,
  toStatus,
  type LabelField,
  type ReadSuggestionsResult,
  type ScanDigestResult,
  type Suggestion,
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
      sessionId: typeof e.sessionId === 'string' && e.sessionId.length > 0 ? e.sessionId : undefined,
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

  /**
   * The host handle this store already holds.
   *
   * Exposed so the suggest dialog can reach `scanDigest`/`readSuggestions`
   * without re-probing the cordis context. Re-probing would mean a second
   * guarded read of `remote.dshTodo` from a fiber that may not declare it —
   * the exact class of failure AGENTS.md records three outages for — when the
   * view already has a handle that provably resolved.
   */
  get remoteFace(): TodoRemote {
    return this.remote
  }

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
   *
   * Returns whether the write was APPLIED, which is not a formality: this drops
   * the transform silently when the store is not `ready`, and a caller that
   * treats calling as succeeding will act on a write that never happened. The
   * suggest dialog is the case that matters — it closed unconditionally, so a
   * store in `error` swallowed five checked suggestions and dismissed the only
   * copy of them, unrecoverable without another 180s scan.
   *
   * `false` also covers a no-op transform (the same array back). Callers that
   * close on success want that too: nothing changed, so nothing was lost.
   *
   * @param fn - pure transform over the current items.
   * @returns true when the new list was published and queued for persistence.
   */
  update(fn: (items: TodoItem[]) => TodoItem[]): boolean {
    if (this.state.status !== 'ready') return false
    const next = fn(this.state.items)
    if (next === this.state.items) return false
    this.publish({ ...this.state, items: next, saving: true })
    void this.commit(next)
    return true
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

/** The host calls this half needs, as the generated Remote face shapes them. */
export interface TodoRemote {
  list: (request: { workspaceId: string }) => Promise<RemoteReply<{ list: StoredList }>>
  replace: (request: {
    workspaceId: string
    items: TodoItem[]
    ifRevision: number | null
  }) => Promise<RemoteReply<ReplaceReply>>
  /**
   * Build the bounded workspace evidence a scan session reasons over.
   *
   * BLOCKS THE HOST EVENT LOOP: `buildDigest` is fully synchronous and `async`
   * does not yield, so every other RPC stalls for its duration (~3s on a
   * 1200-file workspace). Render the loading state BEFORE issuing this call,
   * never after it resolves.
   */
  scanDigest: (request: { workspaceId: string }) => Promise<RemoteReply<ScanDigestResult>>
  /**
   * Poll for what THIS scan run has written, if anything yet.
   *
   * `runId` is required, and the host reads only that run's file. Archiving a
   * scan session does not cancel it, so a timed-out or abandoned run still
   * writes eventually; a shared path would let that late write be read back as
   * the current run's answer.
   */
  readSuggestions: (request: {
    workspaceId: string
    runId: string
  }) => Promise<RemoteReply<ReadSuggestionsResult>>
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
/* Always visible, unlike .dshtd-rowbtns: launching work on a task is a primary
   action, and one hidden until hover is one nobody finds. Dimmed at rest so a
   list of them does not shout, full strength on hover/focus. */
.dshtd-rowlead { flex: none; opacity: 0.55; transition: opacity 100ms ease; }
.dshtd-row:hover .dshtd-rowlead, .dshtd-rowlead:hover, .dshtd-rowlead:focus-visible { opacity: 1; }
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

/* ---- launch dialog ----
   Sized between the confirm prompt and the task modal: it carries two pickers
   and a prompt preview, but never the full field grid. */
.dshtd-launch { width: min(560px, 100%); }
.dshtd-launch-body {
  padding: 16px; display: flex; flex-direction: column; gap: 14px;
  overflow-y: auto; min-height: 0;
}
.dshtd-launch-title { color: var(--td-primary); font-size: 16px; line-height: 24px; font-weight: 600; }
.dshtd-launch-sub { color: var(--td-caption); font-size: 12px; line-height: 18px; }
.dshtd-launch-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.dshtd-launch-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; line-height: 18px; color: var(--td-caption); }
/* The prompt is editable, so it is a real textarea: a preview you cannot
   correct is worse than no preview at all. */
.dshtd-launch-prompt {
  width: 100%; min-height: 140px; resize: vertical;
  border: 1px solid var(--td-border); border-radius: 8px; background: transparent;
  color: var(--td-secondary); font: inherit; font-size: 12px; line-height: 18px;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  padding: 8px 10px;
}
.dshtd-launch-prompt:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #6b7280); }
.dshtd-launch-foot {
  flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 16px; border-top: 1px solid var(--td-border);
  color: var(--td-caption); font-size: 12px; line-height: 18px;
}
.dshtd-launch-err { color: var(--td-danger); font-size: 12px; line-height: 18px; }

/* Overdue is the one state worth colouring in the list: it is the thing a
   standup escalates. Due-today is warned, not alarmed. */
.dshtd-chip.due-over { color: var(--td-danger); border-color: currentColor; font-weight: 500; }
.dshtd-chip.due-today { color: var(--dsw-alias-state-warn-primary, #f59e0b); border-color: currentColor; }

/* ---- toolbar (group-by) ---- */
.dshtd-tools { flex: none; display: flex; align-items: center; gap: 6px; padding: 0 20px 10px; }
.dshtd-tools label { color: var(--td-caption); font-size: 12px; line-height: 18px; }
/* Pushed to the trailing edge so it reads as a tab-level action rather than a
   third control on the group-by cluster. Smaller than .dshtd-btn, which is
   sized for a dialog footer, but on the same 12px caption rung as the toolbar
   it sits in. */
.dshtd-suggest {
  margin-left: auto;
  border: 1px solid var(--td-border); border-radius: 999px; background: transparent;
  color: var(--td-primary); font: inherit; font-size: 12px; line-height: 18px;
  padding: 3px 12px; cursor: pointer;
}
.dshtd-suggest:hover { background: var(--td-hover); }
.dshtd-suggest:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #6b7280); outline-offset: 1px; }

/* ---- loading skeleton ----
   Shaped like the real list rather than a centred spinner, because the tab is a
   large surface and a spinner blanks it. Geometry is copied from .dshtd-row —
   the same 9px/10px padding, 20px line box and 10px gap — so the swap to real
   rows does not lurch. The lead square stands in for the checkbox (16px, the
   icon column) and the bar for the title.

   Bar heights are their own properties, not calc() off a font size: arithmetic
   on a scale step lands between rungs, and these are box dimensions rather than
   text anyway. */
/* Visually hidden, still announced. */
.dshtd-sronly {
  position: absolute; width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
.dshtd-skel { list-style: none; margin: 0; padding: 0; }
.dshtd-skel-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 9px 10px; border-radius: 8px;
  border: 1px solid transparent;
  line-height: 20px;
}
.dshtd-skel-row + .dshtd-skel-row { margin-top: 2px; }
/* Centred on the 20px line box the same way .dshtd-check is, so the square sits
   on the first text line and stays put regardless of bar width. */
.dshtd-skel-lead {
  flex: none; width: 16px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
}
.dshtd-skel-lead > i { display: block; width: 16px; height: 16px; border-radius: 4px; }
.dshtd-skel-bar { height: 10px; border-radius: 3px; align-self: center; }
/* The shimmer animates BACKGROUND-POSITION over an oversized gradient, never a
   transform or a box dimension, so it cannot nudge layout while it sweeps. */
.dshtd-skel-lead > i, .dshtd-skel-bar {
  background: linear-gradient(
    90deg,
    var(--td-border) 0%,
    var(--td-hover) 40%,
    var(--td-border) 80%
  );
  background-size: 300% 100%;
  animation: dshtd-shimmer 1.4s ease-in-out infinite;
}
@keyframes dshtd-shimmer {
  0% { background-position: 180% 0; }
  100% { background-position: -80% 0; }
}

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

/* ---- suggestion rows ----
   Geometry is copied by .dshtd-sug-skel below — change both together or the
   swap to real content will lurch. */
.dshtd-sug-row {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid transparent;
}
.dshtd-sug-row:hover { background: var(--td-hover); border-color: var(--td-border); }
.dshtd-sug-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.dshtd-sug-title { font-size: 14px; line-height: 20px; color: var(--td-primary); }
.dshtd-sug-why {
  font-size: 12px; line-height: 18px; color: var(--td-caption);
  margin-top: 2px;
}
/* The evidence pointer is a file:line, so it follows the CODE font — the same
   token the launch dialog's prompt uses. Clipped rather than wrapped: it is a
   reference, and a wrapped path costs a whole row to say nothing more. */
.dshtd-sug-eviden {
  font-size: 12px; line-height: 18px; color: var(--td-caption);
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshtd-sug-empty {
  font-size: 14px; line-height: 22px; color: var(--td-caption);
  padding: 24px 12px; text-align: center;
}
.dshtd-sug-status { font-size: 12px; line-height: 18px; color: var(--td-caption); }
/* The scan's elapsed-time caption. Same rung as .dshtd-sug-status above — the
   small-surface caption rule, 12px on an 18px line in the tertiary tone — so
   the pane gains a sign of life without gaining a second visual weight.
   Indented to the skeleton's own 12px gutter so it hangs under the bars rather
   than under the pane edge. */
.dshtd-sug-elapsed {
  display: block; font-size: 12px; line-height: 18px; color: var(--td-caption);
  padding: 6px 12px 0;
}
/* The suggestion checkbox rides the 20px title line the way .dshtd-check rides
   the row's, so a long title cannot drag it off the first line. */
.dshtd-sug-row > input[type="checkbox"] {
  flex: none; width: 16px; height: 16px; margin: 2px 0;
  accent-color: var(--td-accent); cursor: pointer;
}

/* Skeleton: the SAME padding, line boxes and gaps as .dshtd-sug-row, so nothing
   moves when the real rows arrive. Bar heights are box dimensions stated
   directly — never calc() off a font size, which lands between scale rungs. */
.dshtd-sug-skel { display: flex; gap: 10px; padding: 10px 12px; }
.dshtd-sug-skel > i {
  display: block; height: 16px; border-radius: 4px; flex: 0 0 16px;
  margin: 2px 0;
  background: var(--td-hover);
}
.dshtd-sug-skel-body { flex: 1 1 auto; min-width: 0; }
.dshtd-sug-skel-bar {
  display: block; height: 12px; border-radius: 4px; margin: 4px 0;
  background: linear-gradient(
    90deg, var(--td-hover) 0%, var(--td-border) 50%, var(--td-hover) 100%
  );
  background-size: 300% 100%;
  animation: dshtd-sug-shimmer 1.4s ease-in-out infinite;
}
/* background-position, never transform/width/opacity: those either reflow or
   move the bar relative to the text it stands in for, which is the lurch a
   skeleton exists to prevent.

   Named *-shimmer deliberately. scripts/check-progress.mjs matches a sweep
   keyframe as [a-z-]*shimmer, so a name like "-sweep" would ship this skeleton
   with the timing, property and reduced-motion invariants silently UNCHECKED. */
@keyframes dshtd-sug-shimmer {
  0% { background-position: 180% 0; }
  100% { background-position: -80% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .dshtd-progress > i, .dshtd-rowbtns { transition: none; }
  /* Hold the bars at a flat mid-tone: the skeleton still communicates "loading"
     by being there, without the sweep. */
  .dshtd-skel-lead > i, .dshtd-skel-bar { animation: none; background: var(--td-border); }
  .dshtd-sug-skel-bar { animation: none; background: var(--td-border); }
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
  // A paper plane: "send this off to an agent". Drawn on the same 16-unit grid
  // as the rest, so it needs no viewBox of its own.
  launch: 'M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5L14 2z',
  // A speech bubble: the session already talking about this task.
  session: 'M13.5 10.5a1.5 1.5 0 0 1-1.5 1.5H6l-3 2.5v-2.5H4a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 4 3h8a1.5 1.5 0 0 1 1.5 1.5v6z',
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
 * The launch dialog: pick a model and a mode, review the prompt, start a session.
 *
 * The session is created by the CALLER before this renders, and its id arrives
 * as a prop. That is what lets the model picker bind to the session's own
 * directory and offer only models it can actually route to — a catalog read
 * without a session can list one the session would then refuse. The cost is
 * that dismissing has to discard the unused session, which the caller does.
 *
 * Shares the portal and z-index reasoning of the other two dialogs: it renders
 * into `document.body` to escape the list's scroller, and stays below DSH
 * Desktop's window-drag strip, which swallows clicks regardless of z-index.
 */
export function LaunchDialog({
  item,
  session,
  ctx,
  onClose,
  onLaunched,
}: {
  item: TodoItem
  /** The blank session created for this dialog, or null while it is being made. */
  session: { id: string } | null
  ctx: LaunchContext
  onClose: () => void
  /**
   * Called once the prompt is away, with the session now working the task, so
   * the caller can advance it and record where the work went.
   */
  onLaunched: (sessionId: string) => void
}): React.JSX.Element {
  const panel = React.useRef<HTMLDivElement | null>(null)
  const [prompt, setPrompt] = React.useState(() => composePrompt(item))
  const [models, setModels] = React.useState<ModelOption[]>([])
  const [modelKey, setModelKey] = React.useState('')
  const [presets, setPresets] = React.useState<PresetOption[]>([])
  const [presetId, setPresetId] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Load both pickers once the session exists. Failures are reported but never
  // block the launch: a session with no explicit pick runs the deployment
  // default, which is the same thing the New Session screen would have done.
  //
  // DEPEND ON THE SESSION ID, NOT THE OBJECTS. `ctx` is rebuilt by
  // `launchContext()` on every slot render and `session` is a fresh
  // `{ id }` literal, so both change identity on EVERY render of TodoView —
  // which re-renders on every todo-store change via useSyncExternalStore.
  // Depending on them re-ran this effect continuously, and each cycle set
  // `cancelled = true` before the async load() could call setModels, so the
  // picker stayed empty and NOTHING was ever logged. That silence is what made
  // it look like the effect was never running: it was running constantly and
  // cancelling itself every time.
  //
  // The ref keeps the latest ctx reachable without making it a dependency: the
  // services it carries are stable for the dialog's lifetime even though the
  // wrapper object is not.
  const ctxRef = React.useRef(ctx)
  ctxRef.current = ctx
  const sessionId = session?.id ?? null

  React.useEffect(() => {
    if (sessionId === null) return
    const ctx = ctxRef.current
    let cancelled = false
    const cleanups: (() => void)[] = []

    /**
     * Load the model list for the picker.
     *
     * Read the CATALOG RPC directly rather than the per-session model
     * directory. The directory is the shell's own path, but it cannot serve a
     * BLANK session: its syncInputs() needs the session's `modelSelection`
     * projection, and that store is seeded only when a history PAGE loads
     * (`installWindow` -> `projections.seed`). A session created seconds ago
     * has no history, so the projection stays undefined, `status` stays
     * "loading" and `groups` stays empty — permanently, with nothing thrown
     * and nothing rejected. This dialog always launches a brand-new session,
     * so that path could never have worked here.
     *
     * `remote.session.modelCatalog()` takes no arguments, is session
     * independent, and returns the same `{ groups, default }` shape the
     * directory would eventually have exposed.
     */
    const loadCatalog = async (): Promise<void> => {
      const catalog = ctx.modelCatalog
      if (catalog === undefined) return
      try {
        const reply = await catalog()
        if (cancelled) return
        const value = (reply as { ok?: boolean; value?: unknown } | undefined)?.ok === true
          ? (reply as { value: unknown }).value
          : reply
        const shaped = value as { groups?: RawCatalogGroup[]; default?: ModelChoice } | undefined
        const options = flattenModels(shaped?.groups ?? [])
        if (options.length === 0) {
          if (typeof console !== 'undefined') {
            console.warn('dsh-todo: modelCatalog() returned no model groups.')
          }
          return
        }
        const fallback = shaped?.default ?? null
        // Mark the option a launch would use anyway. For a freshly created
        // session this IS the deployment default: the durable projection is
        // `pending ?? lastUsed`, and a blank session has neither.
        setModels(
          fallback === null
            ? options
            : options.map((m) =>
                m.provider === fallback.provider && m.model === fallback.model
                  ? { ...m, label: `${m.label} (default)` }
                  : m,
              ),
        )
        if (fallback !== null) setModelKey(`${fallback.provider}/${fallback.model}`)
        else if (options[0]) setModelKey(`${options[0].provider}/${options[0].model}`)
      } catch (cause) {
        if (cancelled) return
        setError(describe(cause))
        if (typeof console !== 'undefined') {
          console.warn('dsh-todo: modelCatalog() failed —', cause)
        }
      }
    }
    void loadCatalog()

    // `ctx` here is a LaunchContext, NOT a cordis context: launchContext()
    // already probed the namespaced service and parked the result on a PLAIN
    // object (`remote: { agentPresets }`). So this read touches no proxy and
    // cannot throw. Reaching for a cordis ctx here instead would reintroduce
    // the `ctx.remote.agentPresets` trap AGENTS.md forbids — the dotted service
    // is not a key on `remote`, and `remote` is itself a Proxy.
    //
    // The CALL is still guarded: the handle came from another fiber, and a
    // present service is not a callable one (see directoryFor above).
    let listing
    try {
      listing = ctx.remote.agentPresets?.list()
    } catch {
      listing = undefined
    }
    void listing
      ?.then((reply) => {
        if (cancelled || !reply.ok) return
        const { options, defaultId } = presetOptions(reply.value.presets, ctx.presetLabel)
        setPresets(options)
        if (defaultId !== undefined) setPresetId(defaultId)
      })
      .catch(() => {
        // A deployment may compose no presets at all; that is not an error.
      })

    return () => {
      cancelled = true
      // The catalog subscription outlives a fast dialog dismissal otherwise.
      for (const dispose of cleanups) dispose()
    }
  }, [sessionId])

  const launch = (): void => {
    if (session === null || busy) return
    const text = prompt.trim()
    if (!text) {
      setError('The prompt is empty.')
      return
    }
    setBusy(true)
    setError(null)
    const chosen = models.find((m) => `${m.provider}/${m.model}` === modelKey)
    void launchSession(ctx, {
      sessionId: session.id,
      presetId: presetId === '' ? undefined : presetId,
      model: chosen === undefined ? undefined : { provider: chosen.provider, model: chosen.model },
      prompt: text,
      // Name the session after the task. Without this the shell's
      // first-prompt-LLM provider invents a paraphrase of the prompt, which is
      // how a launched session ends up with a vague name for work that already
      // had an exact one.
      title: sessionTitleFor(item),
    }).then(
      (launchedSessionId) => {
        onLaunched(launchedSessionId)
        onClose()
      },
      (cause: unknown) => {
        setBusy(false)
        setError(describe(cause))
      },
    )
  }

  // Dismissing is always allowed, matching the task modal: a dialog you cannot
  // leave because a picker failed to load is a trap.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return createPortal(
    <div className="dshtd-modal-backdrop" onClick={onClose} onKeyDown={onKeyDown}>
      <div
        className="dshtd-modal dshtd-launch"
        role="dialog"
        aria-modal="true"
        aria-label={`Launch a session for "${item.title}"`}
        tabIndex={-1}
        ref={panel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dshtd-launch-body">
          <span className="dshtd-launch-title">Launch a session</span>
          <span className="dshtd-launch-sub">
            {session === null
              ? 'Preparing a session…'
              : 'A new session starts with the prompt below.'}
          </span>

          <div className="dshtd-launch-grid">
            <label className="dshtd-launch-label">
              Model
              <select
                className="dshtd-select"
                value={modelKey}
                disabled={session === null || models.length === 0}
                onChange={(e) => setModelKey(e.target.value)}
              >
                {models.length === 0 ? <option value="">Default</option> : null}
                {models.map((m) => (
                  <option key={`${m.provider}/${m.model}`} value={`${m.provider}/${m.model}`}>
                    {m.group ? `${m.group} · ${m.label}` : m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="dshtd-launch-label">
              Mode
              <select
                className="dshtd-select"
                value={presetId}
                disabled={session === null || presets.length === 0}
                onChange={(e) => setPresetId(e.target.value)}
              >
                {presets.length === 0 ? <option value="">Default</option> : null}
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="dshtd-launch-label">
            Prompt
            <textarea
              className="dshtd-launch-prompt"
              value={prompt}
              spellCheck={false}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>

          {error ? <span className="dshtd-launch-err">{error}</span> : null}
        </div>

        <div className="dshtd-launch-foot">
          <span>Marks the task as in progress.</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="dshtd-btn" onClick={onClose}>Cancel</button>
            <button
              className="dshtd-btn primary"
              disabled={session === null || busy}
              onClick={launch}
            >
              {busy ? 'Starting…' : 'Launch'}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** How long to wait for a scan session before giving up and offering a retry. */
const SCAN_TIMEOUT_MS = 180_000
/** How often to ask the host whether the result file has landed. */
const SCAN_POLL_MS = 1_500

/**
 * Which half of the `scanning` phase is running.
 *
 * The client knows exactly two things about a scan in progress, and they are
 * genuinely different waits: `digest` is the host walking the workspace (a
 * synchronous RPC with no session behind it yet), and `polling` is a real
 * background session working while the modal reads for its result file. Only
 * `polling` has a session to open, so this drives both the caption and whether
 * the button can exist at all.
 *
 * Deliberately derived from what THIS component did — not from the session's
 * own progress. Reading a live conversation would mean `uiConversation`'s
 * binding snapshot (a view registry, not messages, and it throws on an unknown
 * session) or `owner.eventSource`, which no client bundle defines. Both are
 * unpublished internals, and betting on those is the single cause of every
 * outage this package's AGENTS.md records.
 */
type ScanStage = 'digest' | 'polling'

/**
 * One workspace's in-flight scan, held OUTSIDE the component that renders it.
 *
 * `TodoView` registers into `conversation.view`, which is a PER-SESSION view
 * ring: navigating to another session swaps the ring, so the view unmounts
 * entirely. That is not a side trip, it is a teardown — and the modal's own
 * **Open scan session** button causes it. Every `useState` in `SuggestDialog`
 * (`suggestions`, `phase`, `checked`, `addError`), every ref (`seenRef`,
 * `sessionRef`, `adoptedRef`, `cancelledRef`), the `suggesting` boolean that
 * renders the dialog at all, and the poll loop itself all died with it. The
 * user had no way back: returning to the Todo tab built a fresh empty dialog
 * while the real scan ran on unwatched, and its result file was collected by
 * nobody.
 *
 * These are the ONLY fields a resume needs, and each earns its place:
 *
 * - `runId` — the poll address. Without it the result file cannot be found at
 *   all, since `readSuggestions` reads only the named run's path.
 * - `sessionId` — so **Open scan session** and adoption still work after the
 *   remount, rather than the button vanishing mid-scan.
 * - `startedAt` — so the timeout and the elapsed caption stay honest across
 *   the round trip. The deadline belongs to the RUN, not to the mount.
 * - `adopted` — a session the user opened must never be archived, and that
 *   claim has to outlive the component that recorded it.
 * - `seen` — so Refresh after a return still excludes what was already
 *   proposed and returns genuinely new ideas.
 *
 * **`suggestions` are deliberately NOT here.** Results are not cached: a scan
 * that completed while the user was away and was never collected must not
 * resurface later dressed as fresh, which is the same stale-answer failure the
 * per-run rendezvous path exists to prevent one layer down.
 */
interface ScanEntry {
  /** This run's rendezvous token; the only way back to its result file. */
  runId: string
  /** The scan session, so the Open button survives a remount. */
  sessionId: string | null
  /** When the run began, so the deadline and the caption do not restart. */
  startedAt: number
  /** True once the user opened the session; suppresses the archive forever. */
  adopted: boolean
  /** Titles already proposed, so a post-return Refresh still returns new ideas. */
  seen: string[]
}

/**
 * In-flight scans, keyed by workspace.
 *
 * Module scope on purpose, following the same shape `stores` uses for
 * `TodoStore` in `apply()`: the slot's component tree is torn down on every
 * navigation, so anything that must survive one cannot live inside it.
 *
 * KEYED BY WORKSPACE, never a single module-level `let`. The tab is
 * per-workspace and two workspaces must not share a scan — one bare current
 * scan would let a run started in workspace A be resumed, polled and adopted
 * from workspace B, against B's exclusion set.
 */
const scans = new Map<string, ScanEntry>()

/** The in-flight scan for one workspace, or undefined when none is running. */
export function scanFor(workspaceId: string): ScanEntry | undefined {
  return scans.get(workspaceId)
}

/** Record or replace a workspace's in-flight scan. */
function putScan(workspaceId: string, entry: ScanEntry): void {
  scans.set(workspaceId, entry)
}

/**
 * Forget a workspace's in-flight scan.
 *
 * Called only when the scan genuinely ENDS — ready, error, timeout — or when
 * the user closes the modal deliberately. Never from the unmount teardown,
 * which cannot tell a close from a navigation.
 */
function clearScan(workspaceId: string): void {
  scans.delete(workspaceId)
}

/**
 * Name a scan session so it is identifiable once the user opens it.
 *
 * A scan session is created, prompted and never navigated to, so without a name
 * it takes whatever `session-title-first-prompt-llm` invents from a 17KB
 * evidence digest — which is the worst possible input for a one-line summary.
 * The moment the modal offers to open it, that name is what the user has to
 * find in the sidebar.
 *
 * Normalisation mirrors what the connection does on receipt (`trim`, collapse
 * whitespace runs), exactly as `sessionTitleFor` does in launch.ts and for the
 * same reason: a blank title is refused with `title-invalid`, so a workspace
 * with no usable name falls back to a fixed label rather than spending a
 * round-trip to be told no. Kept short — the sidebar row is narrow.
 *
 * @param workspaceName - the workspace being scanned, when it has a name.
 * @returns the title to set; never blank, so the caller never sends one the
 *   wire would refuse.
 */
export function scanSessionTitle(workspaceName: string | undefined): string {
  const normalized = (workspaceName ?? '').replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) return 'Scan: workspace'
  return `Scan: ${normalized.slice(0, MAX_SCAN_TITLE_NAME)}`
}

/** How much of a workspace name a scan title keeps. The sidebar row is narrow. */
const MAX_SCAN_TITLE_NAME = 48

/**
 * Scan the workspace and offer the results as checkable proposals.
 *
 * The scan is a background session: created, prompted, never navigated to, and
 * archived when it finishes or the dialog closes. That lifecycle is the same
 * one LaunchDialog uses, minus the `sessions.open()` call.
 *
 * `phase` is an EXPLICIT flag, never inferred from `suggestions.length === 0`.
 * Conflating "we have not looked" with "there is nothing" is what made
 * dsh-plan-board claim a workspace had no plans during every read.
 *
 * An error is NOT terminal. `readSuggestions` classifies an unknown errno as a
 * terminal `error`, which slightly over-reports — `EMFILE`/`EBUSY` are
 * transient — so Refresh stays enabled in every phase but `scanning`, and
 * nothing here may disable it permanently.
 */
export function SuggestDialog({
  launch,
  remote,
  store,
  items,
  workspaceName,
  onClose,
}: {
  launch: LaunchContext & { workspaceId: string }
  /** The store's own host handle — never a fresh probe of the cordis context. */
  remote: TodoRemote
  store: TodoStore
  items: TodoItem[]
  /**
   * OPTIONAL. The workspace's display name, for the scan session's title. Read
   * from the SAME `workspaces.list` snapshot the slot already consults, so this
   * costs no new service read; absent on a projection that carries no title,
   * where the session gets a fixed label instead.
   */
  workspaceName?: string
  onClose: () => void
}): React.JSX.Element {
  /**
   * The scan already running for this workspace, read ONCE at mount.
   *
   * Read during the first render rather than in an effect, because the initial
   * state below depends on it: a resumed scan must come back on screen already
   * showing the session it holds and counting from when it truly began, not
   * flash an empty dialog for a frame first.
   */
  const resumedRef = React.useRef<ScanEntry | undefined>(undefined)
  if (resumedRef.current === undefined) resumedRef.current = scanFor(launch.workspaceId)
  const resumed = resumedRef.current

  const [phase, setPhase] = React.useState<'scanning' | 'ready' | 'error'>('scanning')
  /**
   * Which half of `scanning` is running, for an honest caption.
   *
   * Two states because the client genuinely knows two things and no more: it is
   * waiting on the host's digest walk, or it has handed a prompt to a real
   * session and is polling for the result file. Everything finer would mean
   * reading the session's own conversation, which is unpublished internals.
   */
  const [stage, setStage] = React.useState<ScanStage>(
    // A resumed scan is past the digest by definition — the digest is a single
    // synchronous RPC with no session behind it, so a run that reached the
    // registry with a session is already polling. Saying "Reading the
    // workspace…" here would be the caption claiming a wait that finished.
    resumed !== undefined && resumed.sessionId !== null ? 'polling' : 'digest',
  )
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([])
  const [checked, setChecked] = React.useState<Set<string>>(new Set())
  const [error, setError] = React.useState<string | null>(null)
  /**
   * A REFUSED promotion, kept apart from `error`.
   *
   * `error` belongs to the scan and is rendered by the `phase === 'error'`
   * branch, which replaces the rows. A failed "Add selected" must leave the
   * rows and their checkboxes exactly where they are — suggestions are never
   * stored, so blanking them costs another 180s scan — hence a second slot
   * rather than reusing the first.
   */
  const [addError, setAddError] = React.useState<string | null>(null)
  /**
   * Titles already proposed, so Refresh returns new ideas.
   *
   * Seeded from the resumed entry: a Refresh after returning to the tab must
   * still exclude what the earlier run proposed, or the same ideas come back.
   */
  const seenRef = React.useRef<string[]>(resumed?.seen ?? [])
  /**
   * The scan session, held in a REF and blanked in the same step it is read.
   *
   * A render-closure copy is exactly as stale as the one that archived a
   * just-prompted session in the launch flow; blanking on read is what makes
   * cleanup idempotent when two paths both try to clean up.
   */
  const sessionRef = React.useRef<string | null>(resumed?.sessionId ?? null)
  /**
   * True once the user has OPENED the scan session, which hands it to them.
   *
   * `cleanup()` archives the scan session on every exit path, and that is what
   * keeps an abandoned scan out of the sidebar. But the moment the user clicks
   * through to watch the conversation, the next poll would archive the very
   * session they are reading — the modal offering a door and then removing the
   * room behind it. Adoption is the flag that makes the archive skip.
   *
   * A REF, not state, for the same reason `sessionRef` is one: adoption and the
   * cleanup it gates can both happen inside a single handler, before React
   * commits anything, and a mirror refreshed only at render time would be
   * exactly as stale as the render closure that archived a just-prompted
   * session in the launch flow.
   *
   * It is only ever set, never cleared by cleanup — the user's claim on a
   * session outlives the poll loop that created it. `runScan` clears it when a
   * NEW scan starts, because that run owns a different session entirely.
   */
  const adoptedRef = React.useRef(resumed?.adopted ?? false)
  /**
   * The scan session id AS RENDERED, which is deliberately not `sessionRef`.
   *
   * A ref cannot render a button into existence, and the two need different
   * lifetimes: `sessionRef` is blanked on read so cleanup stays idempotent,
   * while the button must survive that blanking — on the error path cleanup has
   * already nulled the ref, and the session is exactly what the user needs to
   * open to find out what went wrong. Null means NO button, never a button that
   * fails on click: during the digest stage no session exists yet, and a run
   * that never got one has nothing to offer.
   *
   * Nothing here resurrects an archived session. Adoption is what prevents the
   * archive in the first place, so an id offered here is one the modal has not
   * discarded.
   */
  const [scanSessionId, setScanSessionId] = React.useState<string | null>(
    resumed?.sessionId ?? null,
  )
  /**
   * When THIS run began, for a deadline and a caption that survive a remount.
   *
   * Seeded from the resumed entry, so a scan that has already burnt 170s of
   * `SCAN_TIMEOUT_MS` times out in 10s rather than being granted a fresh 180
   * every time the user navigates back. Measuring from the mount would also
   * mean a wedged scan could be kept alive indefinitely by returning to the tab.
   */
  const startedAtRef = React.useRef(resumed?.startedAt ?? Date.now())
  const cancelledRef = React.useRef(false)
  /**
   * The live items, for a Refresh that must exclude what the backlog holds NOW.
   *
   * `runScan` is deliberately not re-created when the list changes — a scan is
   * started by opening the dialog or by Refresh, never by a re-render — so the
   * list is read through a ref rather than captured in the closure.
   */
  const itemsRef = React.useRef(items)
  itemsRef.current = items

  /**
   * Archive the scan session, exactly once, whoever asks — unless it was ADOPTED.
   *
   * The shape is unchanged and must stay unchanged: take the id, blank the ref,
   * and only then decide. Blanking on READ is what makes this idempotent across
   * the five paths that call it (ready, error, timeout, the catch, and unmount),
   * and it is the same discipline that stopped a stale render closure archiving
   * a just-prompted session in the launch flow. The adoption branch sits AFTER
   * the blank, deliberately: an adopted cleanup must still leave the ref null,
   * or a later caller sees a live id and the idempotency is gone.
   *
   * Adoption suppresses only the discard. It does not cancel the run, does not
   * un-archive anything, and does not stop the poll loop — the user watching a
   * scan session still gets its suggestions in the modal.
   */
  const cleanup = React.useCallback((): void => {
    const id = sessionRef.current
    sessionRef.current = null
    if (id !== null && !adoptedRef.current) void discardSession(launch, id)
  }, [launch])

  /**
   * Hand the scan session to the user and navigate to it.
   *
   * `sessions.open` is the same public call the launch flow ends on, and this
   * is the whole reason the feature is public-calls-only: watching the real
   * conversation view is how the user tells "working" from "stuck", and it
   * needs no access to a session's internal event stream.
   *
   * ADOPTION IS RECORDED FIRST. A poll can land between this line and the
   * navigation — `readSuggestions` runs every 1.5s — and cleanup consults the
   * ref, so setting it after the open would leave a window in which the session
   * being navigated to is archived on the way.
   */
  const openScanSession = (): void => {
    if (scanSessionId === null) return
    adoptedRef.current = true
    // Adoption must survive the very navigation this call causes. Opening the
    // session swaps the conversation.view ring and unmounts this dialog, so a
    // claim recorded only in the ref would die on the way — and the scan would
    // come back resumable but archivable, which is the bug adoption exists to
    // stop. Persisted BEFORE navigating, for the same reason the ref is.
    const entry = scanFor(launch.workspaceId)
    if (entry !== undefined) putScan(launch.workspaceId, { ...entry, adopted: true })
    launch.sessions.open(scanSessionId)
  }

  /**
   * End the scan DELIBERATELY: forget it, and archive as today.
   *
   * This is the half that distinguishes closing from navigating, and the two
   * are otherwise indistinguishable from inside the component — both unmount
   * `SuggestDialog` and run the same teardown. So the difference is recorded by
   * the deliberate ACT rather than inferred from the teardown: every user-driven
   * close (the X, Escape, the backdrop, a successful "Add selected") routes
   * through here BEFORE the unmount, while navigation reaches the teardown
   * alone and leaves the entry standing.
   *
   * Getting this the other way round fails in both directions: a close that
   * preserves strands a scan that is never collected, and a navigation that
   * clears loses the one the user just left to watch.
   */
  const endScan = React.useCallback((): void => {
    clearScan(launch.workspaceId)
    cancelledRef.current = true
    cleanup()
  }, [cleanup, launch])

  /**
   * Poll one run's rendezvous file until it lands, fails, or runs out of time.
   *
   * Extracted so a RESUMED scan takes exactly the same path as a fresh one:
   * the alternative — a second loop for the resume case — is two copies of the
   * ready/error/timeout handling that can drift, and this is the code that
   * decides whether a scan session gets archived.
   *
   * **The deadline is derived from `startedAt`, not from now.** A scan that has
   * already burnt 170s of `SCAN_TIMEOUT_MS` must expire in 10s; recomputing the
   * budget here would hand every remount a fresh 180s and let a wedged scan be
   * kept alive indefinitely by navigating back and forth. On every terminal
   * outcome the registry entry is dropped, because the run is genuinely over.
   *
   * @param runId - the run whose file to read; only ever this run's path.
   * @param startedAt - when the run began, which owns the deadline.
   */
  const pollUntilDone = React.useCallback(
    async (runId: string, startedAt: number): Promise<void> => {
      const deadline = startedAt + SCAN_TIMEOUT_MS
      for (;;) {
        if (cancelledRef.current) return
        await new Promise((r) => setTimeout(r, SCAN_POLL_MS))
        if (cancelledRef.current) return
        // Only THIS run's file. A previous scan that timed out is archived but
        // still running, and its late write must never be read as this one's.
        const reply = await remote.readSuggestions({ workspaceId: launch.workspaceId, runId })
        if (!reply.ok) throw new Error(reply.error.message)
        const result = reply.value
        if (result.status === 'ready') {
          const found = result.suggestions ?? []
          seenRef.current = [...seenRef.current, ...found.map((s) => s.title)]
          setSuggestions(found)
          setPhase('ready')
          // Genuinely finished: nothing left to resume, and the file is gone.
          clearScan(launch.workspaceId)
          cleanup()
          return
        }
        if (result.status === 'error') {
          setError(result.error ?? 'the scan produced unusable output')
          setPhase('error')
          clearScan(launch.workspaceId)
          cleanup()
          return
        }
        if (Date.now() > deadline) {
          setError('the scan did not finish in time')
          setPhase('error')
          clearScan(launch.workspaceId)
          cleanup()
          return
        }
      }
    },
    [cleanup, launch, remote],
  )

  const runScan = React.useCallback(async (): Promise<void> => {
    cleanup()
    // Safe to un-cancel only because no earlier loop can still be live: the
    // sole re-entry point is the Refresh button, which carries
    // `disabled={phase === 'scanning'}`. That invariant is ENFORCED IN THE JSX
    // and consumed here, with nothing in between linking the two — dropping
    // that `disabled` would let a second scan clear the flag the first is
    // polling on, leaving both loops writing into the same state.
    cancelledRef.current = false
    // This run's identity, minted BEFORE anything is issued so the prompt and
    // every poll below name the same file. Held as a local, not a ref: a
    // superseded run must keep polling its OWN path until its loop exits, and
    // a ref would repoint it at the new run's file mid-flight.
    const runId = makeRunId()
    // This run's clock, which owns its deadline from here on. Recorded before
    // the digest so the 180s budget covers the whole run the user is waiting
    // through, not just the polling half.
    const startedAt = Date.now()
    startedAtRef.current = startedAt
    // A fresh run supersedes whatever the registry held: this workspace now has
    // exactly one scan in flight, and it is this one. Registered with no
    // session yet — the digest stage has none — so a remount during the digest
    // resumes correctly rather than offering a button that fails on click.
    putScan(launch.workspaceId, {
      runId,
      sessionId: null,
      startedAt,
      adopted: false,
      seen: seenRef.current,
    })
    // `suggestions` and `checked` deliberately survive a Refresh, so the old
    // rows stay put until the new set lands rather than blanking the pane. The
    // consequence is that a title in BOTH sets arrives pre-checked — harmless:
    // it is the same suggestion the user already chose, and it is one row and
    // one Set member either way now that parseSuggestions dedupes titles.
    setPhase('scanning')
    // Back to the first half of the wait: this run has no session yet, so the
    // caption must not claim to be waiting on one and the button must not offer
    // the PREVIOUS run's session. Adoption resets with it — the user's claim was
    // on that other session, and this run creates its own.
    setStage('digest')
    setScanSessionId(null)
    adoptedRef.current = false
    setError(null)
    // A refusal from the previous set must not sit over a fresh one.
    setAddError(null)

    try {
      // Issued only after the phase above is armed: this call blocks the host
      // event loop for the whole digest, so the placeholder must already be on
      // screen or the tab looks frozen rather than busy.
      const digestReply = await remote.scanDigest({ workspaceId: launch.workspaceId })
      if (cancelledRef.current) return
      // RemoteReply, exactly as list/replace answer: the payload is under
      // `.value`, and a failure carries `.error.message`. Reading the result at
      // the top level would silently yield undefined.
      if (!digestReply.ok) throw new Error(digestReply.error.message)
      const { digest } = digestReply.value

      // An empty digest means the walk found NOTHING TO LOOK AT — a workspace
      // directory that is missing, is not a directory, is genuinely empty, or
      // holds only ignored/dot directories. Stop here, BEFORE sessions.create,
      // which is what makes this cheap: no session is spent and no tokens are
      // burnt on evidence that does not exist.
      //
      // Continuing would put an empty "## Evidence" section directly under an
      // instruction not to speculate about unseen code. A compliant model then
      // writes `[]`, and the modal reports "Nothing new to suggest — the
      // backlog already covers what the scan found" — a FALSE CLAIM about the
      // user's workspace, since the scan found nothing because it could not
      // look. That is dsh-plan-board's "there is nothing" conflated with "we
      // could not look", one layer up: the loading flag is right and the empty
      // state is the lie. A non-compliant model instead writes prose, and the
      // user watches the skeleton for the full 180s.
      //
      // `phase: 'error'` is deliberately the recoverable state — Refresh is
      // disabled only while scanning — so a workspace that was merely being
      // remounted retries with one click.
      if (digest.trim() === '') {
        setError('this workspace has no scannable files — it may have been moved or is empty')
        setPhase('error')
        // No session was ever spent and no file will ever land, so there is
        // nothing to resume: leaving the entry behind would make a remount poll
        // a path that cannot appear.
        clearScan(launch.workspaceId)
        return
      }

      // Titles only: descriptions would multiply the cost of every scan to
      // restate the very work the model is being told to avoid.
      const exclude = [
        ...activeItems(itemsRef.current)
          .filter((i) => !isDone(i))
          .map((i) => i.title),
        ...seenRef.current,
      ]

      const sessionId = await launch.sessions.create({ workspaceId: launch.workspaceId })
      if (cancelledRef.current) {
        void discardSession(launch, sessionId)
        return
      }
      sessionRef.current = sessionId
      // The session reaches the registry as soon as it reaches the ref, so a
      // remount can offer the Open button and honour an adoption made against
      // it. `seen` is re-read rather than reused: the entry above was written
      // before this await.
      putScan(launch.workspaceId, {
        runId,
        sessionId,
        startedAt,
        adopted: adoptedRef.current,
        seen: seenRef.current,
      })

      const binding = launch.sessions.binding(sessionId)
      if (binding === undefined) throw new Error('the scan session is not addressable yet')
      const sent = await binding.session.prompt(
        [{ type: 'text', text: composeScanPrompt(digest, exclude, runId) }],
        'queue',
      )
      if (!sent.ok) throw new Error(sent.error?.message ?? 'the scan session refused the prompt')

      // Name the scan session, AFTER the prompt for the same reason launch.ts
      // renames late: there is no blank-session window to beat — the connection
      // just appends a `session/title` event — and a run that failed above
      // leaves no renamed session behind to explain.
      //
      // NOT fatal, and both the call and the await are guarded: `rename` is a
      // borrowed face that may be absent on an older binding, and a scan the
      // user is waiting on must never fail over a cosmetic title. Without it
      // the session is titled by an LLM summarising a 17KB evidence digest,
      // which is precisely the name nobody can find in a sidebar.
      if (typeof binding.session.rename === 'function') {
        try {
          await binding.session.rename(scanSessionTitle(workspaceName))
        } catch {
          // The scan is running and has its brief; the title is cosmetic.
        }
      }

      // The prompt is away, so the wait is now on a real session — which is
      // both what the caption should say and what makes an Open button
      // meaningful. Set together, because they describe the same fact.
      if (cancelledRef.current) return
      setStage('polling')
      setScanSessionId(sessionId)

      await pollUntilDone(runId, startedAt)
    } catch (cause) {
      if (cancelledRef.current) return
      setError(describe(cause))
      setPhase('error')
      clearScan(launch.workspaceId)
      cleanup()
    }
  }, [cleanup, launch, pollUntilDone, remote, workspaceName])

  /**
   * Rejoin a scan that was already running when this dialog mounted.
   *
   * Starts NO session and issues NO digest: the run it is resuming already has
   * both, and creating a second would spend another session and leave the first
   * orphaned — the exact waste this whole fix exists to remove. It only picks up
   * the poll loop at the persisted `runId`, on that run's original deadline.
   */
  const resumeScan = React.useCallback(
    async (entry: ScanEntry): Promise<void> => {
      cancelledRef.current = false
      setPhase('scanning')
      setError(null)
      setAddError(null)
      try {
        await pollUntilDone(entry.runId, entry.startedAt)
      } catch (cause) {
        if (cancelledRef.current) return
        setError(describe(cause))
        setPhase('error')
        clearScan(launch.workspaceId)
        cleanup()
      }
    },
    [cleanup, launch, pollUntilDone],
  )

  React.useEffect(() => {
    // RESUME, never restart. Returning to the tab after navigating to the scan
    // session must rejoin the run in flight — starting a fresh one would spend
    // a second session, orphan the first, and hand the user results computed
    // against a stale exclusion set.
    const inFlight = resumedRef.current
    if (inFlight !== undefined) void resumeScan(inFlight)
    else void runScan()
    return (): void => {
      // Stop THIS component's poll loop, and nothing more.
      //
      // Deliberately NOT `clearScan` and NOT `cleanup`. This teardown runs on
      // both a deliberate close and a navigation, and it cannot tell them
      // apart — that is precisely the bug being fixed. Clearing here would
      // discard the scan the user navigated away to watch, and archiving here
      // would remove the session under them. The deliberate close routes
      // through `endScan()` BEFORE unmounting, which is where both belong.
      cancelledRef.current = true
    }
    // Deliberately once: a scan is started by opening the dialog or by
    // Refresh, never by a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * The DELIBERATE close: the X, Escape, the backdrop, and a completed add.
   *
   * The single door every user-driven exit goes through, so "the user closed
   * it" is recorded exactly once and in one place. It ends the scan — forgetting
   * the entry and archiving an unadopted session — and only then closes.
   *
   * Navigation reaches none of this. It unmounts the dialog directly, so the
   * entry survives and the modal reopens on return. That asymmetry IS the fix,
   * and it is why the archive lives here rather than in the effect teardown
   * that both paths share.
   */
  const dismiss = (): void => {
    endScan()
    onClose()
  }

  const toggle = (title: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  /**
   * Promote the checked suggestions to real tasks.
   *
   * ONE store.update for the whole batch, not one per row: the store treats
   * each call as a reason to write, so a per-row loop would put a round-trip
   * on the wire for every checkbox.
   *
   * The close is GATED on the write applying. `store.update` drops the
   * transform and returns false when the store is not `ready`, and closing
   * anyway destroys the only copy of the picks: suggestions are never stored,
   * so a dismissed dialog costs another 180s scan to get them back. Gating here
   * rather than disabling the button is deliberate — the button's `disabled`
   * tracks `phase`, which is the SCAN's state and says nothing about the
   * store's, so the two can disagree; and leaving the dialog open with the rows
   * still checked lets the user retry the moment the list reloads.
   */
  const addSelected = (): void => {
    const picked = suggestions.filter((s) => checked.has(s.title))
    if (picked.length === 0) return
    // NOTE the signature: makeItem(title, now, rand, fields) — `fields` is the
    // FOURTH parameter. Passing the options object second would silently make
    // it the `now` timestamp, producing a garbage id and createdAt with no
    // error anywhere.
    const applied = store.update((current) => [
      ...current,
      ...picked.map((s) =>
        makeItem(normalizeText(s.title), Date.now(), Math.random, {
          description: s.rationale,
          priority: s.priority,
          status: 'backlog',
        }),
      ),
    ])
    if (!applied) {
      // Reported through its OWN state, deliberately not `phase`. Setting
      // phase='error' would stop the rows rendering — they are gated on
      // phase==='ready' — and blanking the picks is precisely the loss this
      // guard exists to prevent. The dialog stays open, ready, and checked.
      setAddError('the task list is not loaded — reopen the tab and try again')
      return
    }
    // The picks are safely in the list, so this is a deliberate finish: the run
    // is over and its session must not be left in the sidebar.
    dismiss()
  }

  // Dismissing is always allowed, matching every other dialog here: a modal you
  // cannot leave because a scan is still running is a trap. Every one of these
  // is a DELIBERATE close, so all three route through `dismiss`.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      dismiss()
    }
  }

  return createPortal(
    <div className="dshtd-modal-backdrop" onClick={dismiss} onKeyDown={onKeyDown}>
      <div
        className="dshtd-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Suggested work"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dshtd-modal-head">
          <strong className="dshtd-launch-title">Suggested work</strong>
          <button className="dshtd-icon" onClick={dismiss} aria-label="Close">
            <Icon path={ICON.close} />
          </button>
        </div>

        <div className="dshtd-modal-body">
          {phase === 'scanning' ? (
            <SuggestSkeleton stage={stage} startedAt={startedAtRef.current} />
          ) : null}

          {phase === 'error' ? (
            <p className="dshtd-sug-empty">{error ?? 'the scan failed'}</p>
          ) : null}

          {phase === 'ready' && suggestions.length === 0 ? (
            <p className="dshtd-sug-empty">
              Nothing new to suggest — the backlog already covers what the scan found.
            </p>
          ) : null}

          {phase === 'ready' && suggestions.length > 0
            ? suggestions.map((s) => (
                // KEYED BY TITLE, and that is only safe because
                // parseSuggestions() in suggest.ts dedupes titles
                // case-insensitively before this list ever exists. The title is
                // the identity here three times over — this key, the `checked`
                // Set member below, and that dedupe key. Do not "fix" one side
                // alone: switching to an index key would silence a React
                // warning while leaving one checkbox toggling two rows and "Add
                // selected" writing the same task twice.
                <label className="dshtd-sug-row" key={s.title}>
                  <input
                    type="checkbox"
                    checked={checked.has(s.title)}
                    onChange={() => toggle(s.title)}
                  />
                  <span className="dshtd-sug-body">
                    <span className="dshtd-sug-title">{s.title}</span>
                    {s.rationale ? <span className="dshtd-sug-why">{s.rationale}</span> : null}
                    {s.evidence ? <span className="dshtd-sug-eviden">{s.evidence}</span> : null}
                  </span>
                  <span className="dshtd-chip">{PRIORITY_LABEL[s.priority]}</span>
                </label>
              ))
            : null}
        </div>

        <div className="dshtd-modal-foot">
          {/* The refusal takes the status line rather than a slot of its own:
              it is the answer to the click that just happened, and it must sit
              where the user is already looking. `role="alert"` because it
              reports a failed action, not ambient state. */}
          <span className="dshtd-sug-status" {...(addError !== null ? { role: 'alert' } : {})}>
            {addError !== null
              ? addError
              : phase === 'ready' && checked.size > 0
                ? `${checked.size} selected`
                : ''}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            {/* The scan is a real session, and this is the door to it. A skeleton
                plus a counter cannot distinguish "working" from "stuck"; the
                conversation view can, and it costs one PUBLIC call.

                Rendered only when an id is actually held — during the digest
                stage there is no session yet, and a run that never got one must
                show nothing rather than a button that fails on click. It stays
                on the ERROR phase deliberately: that is exactly when the user
                needs to see what the session did. Opening ADOPTS the session,
                so cleanup will not archive what they are reading. */}
            {scanSessionId !== null && (phase === 'scanning' || phase === 'error') ? (
              <button
                className="dshtd-btn"
                onClick={openScanSession}
                /* The tooltip says the return trip is safe, because the button
                   navigates AWAY from this tab and the modal disappears with
                   it. Before the scan was persisted that really was one-way —
                   the run was orphaned and its result collected by nobody — so
                   a user who had been bitten once would not click it twice.
                   Kept to one line: the reassurance is worth more than the
                   detail. */
                title="Watch the scan session — come back to this tab to collect the results"
              >
                Open scan session
              </button>
            ) : null}
            {/* Disabled only WHILE a scan runs. An error must stay recoverable:
                readSuggestions reports a transient errno as terminal, so a
                Refresh that latched off would dead-end the modal. */}
            <button
              className="dshtd-btn"
              onClick={() => void runScan()}
              disabled={phase === 'scanning'}
            >
              Refresh
            </button>
            <button
              className="dshtd-btn primary"
              onClick={addSelected}
              disabled={phase !== 'ready' || checked.size === 0}
            >
              Add selected
            </button>
          </span>
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
  onLaunch,
}: {
  item: TodoItem
  store: TodoStore
  onClose: () => void
  knownReleases: string[]
  knownSprints: string[]
  /** Absent when the harness services a launch needs did not resolve. */
  onLaunch?: () => void
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
          <span style={{ display: 'flex', gap: 8 }}>
            {onLaunch && !isDone(item) ? (
              <button
                className="dshtd-btn"
                title="Start a session for this task"
                onClick={() => {
                  // Commit the open edits first: the prompt is composed from the
                  // STORED task, so launching on an uncommitted title would send
                  // the old text.
                  flush()
                  onLaunch()
                  onClose()
                }}
              >
                Launch session
              </button>
            ) : null}
            <button className="dshtd-btn primary" onClick={save}>Done</button>
          </span>
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

/* Varied widths so the placeholder reads as a list of different tasks rather
   than a stack of identical blocks. Eight rows fills the pane without implying
   a specific count. */
const SKELETON_WIDTHS = [62, 45, 78, 53, 70, 38, 66, 49]

/**
 * Placeholder shown while the list is being read.
 *
 * A skeleton rather than a spinner: the tab is a large surface, and bars in the
 * list's own shape read as "this content is arriving" instead of blanking the
 * area. The wrapper carries the live region so a screen reader is told the list
 * is loading without narrating eight decorative rows.
 * @returns the loading placeholder.
 */
function TodoSkeleton(): React.JSX.Element {
  return (
    <ul className="dshtd-skel" role="status" aria-live="polite" aria-busy="true">
      <span className="dshtd-sronly">Loading tasks…</span>
      {SKELETON_WIDTHS.map((width, i) => (
        <li className="dshtd-skel-row" key={i} aria-hidden="true">
          <span className="dshtd-skel-lead">
            <i />
          </span>
          <span
            className="dshtd-skel-bar"
            /* Staggering the shimmer makes it sweep down the list instead of
               every bar flashing in lockstep. */
            style={{ width: `${width}%`, animationDelay: `${i * 70}ms` }}
          />
        </li>
      ))}
    </ul>
  )
}

/** Bar widths, varied so the skeleton reads as content rather than a grid. */
const SUG_SKELETON_WIDTHS = [72, 88, 61, 79, 68]

/**
 * What the suggestion skeleton needs to describe the wait honestly.
 *
 * Declared as a named interface rather than inline, so `SuggestSkeleton`'s
 * signature stays on ONE line. Several checks in `smoke.mjs` and
 * `suggest-lifecycle.mjs` delimit this component by matching from its `({` to
 * the next line-start `}`, and a multi-line destructured signature ends that
 * match at the props brace — silently capturing nothing and passing vacuously.
 */
interface SuggestSkeletonProps {
  /** Which half of the wait is running, for an honest caption. */
  stage: ScanStage
  /**
   * When the RUN began — not when this component mounted. A scan resumed after
   * the user navigated away has been running the whole time, and the caption
   * must agree with the deadline about that.
   */
  startedAt: number
}

/**
 * Loading state for the suggestion list.
 *
 * A skeleton rather than a spinner because this is a large content pane — the
 * repo rule assigns a spinner only to a button and a caption row only to a
 * small surface. One `role="status"` announces the whole thing once; the bars
 * are decorative and hidden from assistive tech, or a screen reader narrates
 * five empty rows instead of one status line.
 *
 * It also carries an ELAPSED-TIME caption, because `SCAN_TIMEOUT_MS` is 180s
 * and five motionless bars for three minutes claim "hung" rather than
 * "working" — the loading rule's purpose is that the state must not make a
 * false claim, and the shimmer alone cannot distinguish a running scan from a
 * wedged one. Three properties of that caption are load-bearing:
 *
 * - It sits INSIDE the existing `role="status"` region. A second live region
 *   would compete with the first for the same announcement.
 * - The ticking number is `aria-hidden`, so the announced text stays the one
 *   static sentence while only the visual number moves. Left exposed, a
 *   per-second update would queue 180 announcements at a screen reader.
 * - The interval is owned by THIS component, which is mounted only while
 *   `phase === 'scanning'`. That is what makes "the ticker must not run in any
 *   other phase" structural rather than a condition someone has to remember:
 *   leaving the phase unmounts the component and the cleanup clears it.
 *
 * **The caption NAMES THE STAGE, and the stage is what the client itself did.**
 * `scanning` covers two genuinely different waits — building the digest on the
 * host, and polling for a file a background session has been asked to write —
 * and one static sentence over both is the loading rule's own failure mode: a
 * state making a claim it cannot support. The stage is plain local state, set
 * where each step actually happens; nothing here reads harness conversation
 * internals, which is the bet this package has lost four times.
 *
 * NOTE it is rendered BEFORE the scan is issued, not after. `scanDigest` runs
 * a fully synchronous digest on the single-threaded host, so the first call
 * blocks every other RPC for seconds — with no placeholder up first, the tab
 * simply freezes.
 *
 * @param stage - which half of the wait is running, for an honest caption.
 * @returns the loading placeholder for the suggestion pane.
 */
function SuggestSkeleton({ stage, startedAt }: SuggestSkeletonProps): React.JSX.Element {
  const [elapsed, setElapsed] = React.useState(() => Math.floor((Date.now() - startedAt) / 1000))
  React.useEffect(() => {
    // Off the RUN's start rather than this component's mount, and rather than
    // by incrementing a counter. Two separate reasons, both about not
    // under-reporting the wait: a throttled background tab fires intervals late
    // and irregularly, so counting ticks lies exactly when the wait is longest;
    // and a scan resumed after the user navigated away has genuinely been
    // running the whole time, so restarting at zero would tell them it is
    // younger than it is — while the deadline it is measured against did not
    // reset. The caption and the timeout must agree about when the run began.
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [startedAt])

  // Two captions, one per thing the client genuinely knows. The digest half
  // never shows a session button because there is no session yet, so the copy
  // must not promise one either.
  const caption =
    stage === 'digest' ? 'Reading the workspace…' : 'Waiting for the scan session…'

  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="dshtd-sronly">Scanning the workspace for suggestions…</span>
      {SUG_SKELETON_WIDTHS.map((w, i) => (
        <div className="dshtd-sug-skel" key={i} aria-hidden="true">
          <i />
          <div className="dshtd-sug-skel-body">
            <span
              className="dshtd-sug-skel-bar"
              /* Staggered so the sweep travels down the list instead of every
                 bar flashing in lockstep, matching TodoSkeleton. */
              style={{ width: `${w}%`, animationDelay: `${i * 70}ms` }}
            />
            <span
              className="dshtd-sug-skel-bar"
              style={{ width: `${w - 18}%`, animationDelay: `${i * 70}ms` }}
            />
          </div>
        </div>
      ))}
      {/* aria-hidden covers the WHOLE caption, not just the number: the
          sr-only line above already says what is happening, so re-announcing
          the same sentence every second adds nothing but noise. */}
      <span className="dshtd-sug-elapsed" aria-hidden="true">
        {caption} {elapsed}s
      </span>
    </div>
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
  onLaunch,
  onOpenSession,
}: {
  item: TodoItem
  index: number
  total: number
  store: TodoStore
  knownReleases: string[]
  knownSprints: string[]
  onOpen: () => void
  onDelete: () => void
  /** Absent when the harness services a launch needs did not resolve. */
  onLaunch?: () => void
  /** Present only when this task's recorded session still resolves. */
  onOpenSession?: () => void
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
        {/* OUTSIDE .dshtd-rowbtns, which is opacity: 0 until the row is hovered.
            That is right for move/delete — destructive or fiddly controls that
            would clutter a list — but wrong for this one: starting work on a
            task is a PRIMARY action, and an affordance nobody can see does not
            exist. It shipped hidden and was reported as a missing feature.
            Open replaces Launch rather than joining it: the row is at its 40px
            budget and the two are mutually exclusive anyway. A task whose
            recorded session no longer resolves falls back to Launch — never a
            button that errors on click. */}
        {onOpenSession ? (
          <button
            className="dshtd-icon dshtd-rowlead"
            title="Open the session working this task"
            aria-label={`Open the session for "${item.title}"`}
            onClick={onOpenSession}
          >
            <Icon path={ICON.session} />
          </button>
        ) : onLaunch && !done ? (
          <button
            className="dshtd-icon dshtd-rowlead"
            title="Start a session for this task"
            aria-label={`Start a session for "${item.title}"`}
            onClick={onLaunch}
          >
            <Icon path={ICON.launch} />
          </button>
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
export function TodoView({
  store,
  launch,
  workspaceName,
}: {
  store: TodoStore | null
  /** The harness services a launch needs; absent when they did not resolve. */
  launch?: LaunchContext & { workspaceId: string }
  /**
   * OPTIONAL. The workspace's display name, used to title a scan session so it
   * is findable in the sidebar once opened. Comes off the SAME workspace list
   * projection the slot already reads to resolve `workspaceId` — one more
   * field on a snapshot in hand, not a new service read.
   */
  workspaceName?: string
}): React.JSX.Element {
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
  // Whether the suggest dialog is open.
  //
  // SEEDED FROM THE SCAN REGISTRY, which is what makes returning to the tab
  // reopen the modal. This view lives in the per-session `conversation.view`
  // ring, so navigating to the scan session unmounts it and this boolean with
  // it; initialising from `false` is what left the user with no way back to a
  // scan they had opened. An in-flight scan for this workspace means the dialog
  // was open when they left, so it comes back open and resumes polling.
  const [suggesting, setSuggesting] = React.useState(
    () => launch !== undefined && scanFor(launch.workspaceId) !== undefined,
  )
  // The task being launched, plus the blank session created to receive it. The
  // session is made when the dialog OPENS so the model picker can bind to it,
  // which is why cancelling has to discard it again.
  const [launching, setLaunching] = React.useState<{
    item: TodoItem
    session: { id: string } | null
  } | null>(null)
  // A LIVE mirror of `launching`, because `closeLaunch` runs TWICE on a
  // successful launch and must not act on a value captured before the first
  // call cleared it. See closeLaunch for the outage this prevents; a ref rather
  // than the setter's updater form because discarding is a side effect, and
  // React may invoke an updater more than once per commit.
  const launchingRef = React.useRef<{ item: TodoItem; session: { id: string } | null } | null>(null)
  launchingRef.current = launching

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

  /**
   * Open the launch dialog, creating the session it will configure.
   *
   * The dialog opens immediately with a null session and fills in once the
   * create resolves, so a slow host shows a disabled dialog rather than a
   * frozen row with no feedback.
   */
  const askLaunch = (item: TodoItem): void => {
    if (!launch) return
    setLaunching({ item, session: null })
    void launch.sessions.create({ workspaceId: launch.workspaceId }).then(
      (sessionId) => setLaunching((cur) => (cur?.item.id === item.id ? { item, session: { id: sessionId } } : cur)),
      () => setLaunching(null),
    )
  }

  /**
   * A handler that opens this task's recorded session, or undefined.
   *
   * The id is a HINT: sessions get deleted, and `binding()` answering
   * undefined is how the harness reports one that no longer exists. Checking it
   * here is what keeps a dangling id from rendering a button that errors on
   * click. The stored id is deliberately NOT cleared on a miss — an archived
   * session can be restored, and this is the only record work ever started.
   */
  const openSessionFor = (item: TodoItem): (() => void) | undefined => {
    const id = item.sessionId
    if (!launch || id === undefined) return undefined
    if (launch.sessions.binding(id) === undefined) return undefined
    return () => launch.sessions.open(id)
  }

  /**
   * Close the launch dialog, discarding a session that never got its prompt.
   *
   * **Read the open dialog from the live ref, not the render closure.** A
   * successful launch calls BOTH of the dialog's callbacks — `onLaunched(id)`
   * then `onClose()` — so this runs twice, as `(true)` then `(false)`. Captured
   * as `const open = launching`, the second call still saw the session the
   * first had just cleared, took the `!launched` branch, and archived the
   * session that had at that moment received its prompt: a session that
   * started, opened, and then died, with the task left flipped to
   * `in-progress` pointing at it. Nothing surfaced, because `discardSession()`
   * swallows failures by design.
   *
   * The ref is what makes it correct, and it is cleared HERE rather than at the
   * next render: both calls happen in one handler, before React commits
   * anything, so a mirror that only refreshed on render would be just as stale
   * as the closure was. Taking the value and blanking the ref in the same step
   * makes the close idempotent — the second call sees `null` and discards
   * nothing, while a real dismissal still discards its live session exactly
   * once.
   */
  const closeLaunch = (launched: boolean): void => {
    const open = launchingRef.current
    launchingRef.current = null
    setLaunching(null)
    if (!launched && launch && open?.session) void discardSession(launch, open.session.id)
  }

  return (
    <div className="dshtd">
      <div className="dshtd-head">
        <span className="dshtd-title">Tasks</span>
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
        {/* Gated on the SAME launch context the rocket button uses: a scan runs
            in a real session, and `sessions` is the one service it cannot fake.
            launchContext() already yields undefined when it is unreachable. */}
        {launch !== undefined ? (
          <button
            className="dshtd-suggest"
            onClick={() => setSuggesting(true)}
            title="Scan the workspace and propose new tasks"
          >
            Suggest
          </button>
        ) : null}
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
          <TodoSkeleton />
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
                        onLaunch={launch ? () => askLaunch(item) : undefined}
                        onOpenSession={openSessionFor(item)}
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
          onLaunch={launch ? () => askLaunch(openTask) : undefined}
        />
      ) : null}

      {launching && launch ? (
        <LaunchDialog
          item={launching.item}
          session={launching.session}
          ctx={launch}
          onClose={() => closeLaunch(false)}
          onLaunched={(sessionId) => {
            // Only after the prompt is away: a failed launch must not leave the
            // task claiming work that never started. Both facts about a launch
            // land in ONE update, so the status and the session can never
            // disagree about whether work started.
            store.update((list) =>
              setStatus(list, launching.item.id, 'in-progress').map((i) =>
                i.id === launching.item.id ? { ...i, sessionId } : i,
              ),
            )
            closeLaunch(true)
          }}
        />
      ) : null}

      {suggesting && launch !== undefined ? (
        <SuggestDialog
          launch={launch}
          // The store's OWN handle, not a fresh probe of the cordis context:
          // this one provably resolved, and re-probing would mean another
          // guarded read from a fiber that may not declare remote.dshTodo.
          remote={store.remoteFace}
          store={store}
          items={state.items}
          workspaceName={workspaceName}
          onClose={() => setSuggesting(false)}
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
/**
 * Resolve the launch services off a context, or undefined when the deployment
 * does not compose them.
 *
 * Read through `ctx.get` rather than a top-level inject so a profile without
 * model selection or agent presets still gets a working todo list — the launch
 * button simply does not appear. `uiWorkspace` is optional even among these:
 * it is only needed to tidy up a cancelled dialog.
 *
 * @param ctx - a context on which the launch services may be registered.
 * @param workspaceId - the workspace a launched session belongs to.
 * @returns the launch context, or undefined when a required service is missing.
 */
/**
 * Read a NAMESPACED cordis service (a name containing a dot) without throwing.
 *
 * These cannot be reached through the parent object — `ctx.remote.agentPresets`
 * is undefined no matter what is composed — only as `ctx['remote.agentPresets']`,
 * which throws when the fiber never declared it. Both halves of that are
 * counter-intuitive, so this is one guarded helper rather than a rule to
 * remember at each call site.
 *
 * @param ctx - the (proxied) context to read from.
 * @param name - the dotted service name.
 * @returns the service, or undefined when it is absent or undeclared.
 */
function probeNamespaced(ctx: unknown, name: string): unknown {
  const c = ctx as Record<string, unknown> & { get?: (n: string) => unknown }
  // ORDER MATTERS: ctx.get(name) FIRST, the bare read only as a fallback.
  // `c[name] ?? c.get?.(name)` looks like it tries both, and does not: the
  // bare read THROWS on an undeclared service, which aborts the whole
  // expression before ?? is ever evaluated, and the catch then swallows it.
  // Measured in a live browser: bare=THREW get()=ok for every service, so the
  // fallback that was supposed to rescue the read could never run.
  try {
    const viaGet = c.get?.(name)
    if (viaGet !== undefined) return viaGet
  } catch {
    // fall through to the bare read
  }
  try {
    return c[name]
  } catch {
    return undefined
  }
}

function launchContext(
  ctx: unknown,
  workspaceId: string,
  modelCtxOf: () => unknown = () => ctx,
): (LaunchContext & { workspaceId: string }) | undefined {
  const c = ctx as {
    get?: (name: string) => unknown
    sessions?: unknown
    modelDirectories?: unknown
    remote?: Record<string, unknown>
    uiWorkspace?: unknown
  }
  // A cordis context is a PROXY: reading a property for a service this fiber
  // did not declare in `inject` THROWS "cannot get property X without inject"
  // — it does not yield undefined. Since these services are deliberately
  // optional, every read must be guarded, or a profile that composes none of
  // them takes the whole tab down with it. `ctx.get(name)` is the safe probe;
  // the bare property read is the trap. test/context-probe.mjs pins both.
  const probe = (name: 'sessions' | 'modelDirectories' | 'uiWorkspace' | 'locale'): unknown =>
    probeNamespaced(c, name)
  const sessions = probe('sessions')
  // Resolved LAZILY, and from the model fiber rather than the root context.
  //
  // Two separate traps meet here. `directoryFor()` re-enters `remote.session`,
  // so the handle must come from a fiber that DECLARES it or every call throws
  // forever. And the model fiber may not have resolved yet when this runs —
  // the slot's inject callback fires on first render and its result is cached
  // — so reading eagerly pins the picker to undefined for good.
  const modelDirectories = {
    directoryFor(sessionId: string): unknown {
      const svc = probeNamespaced(modelCtxOf(), 'modelDirectories') as
        | { directoryFor?: (id: string) => unknown }
        | undefined
      if (svc === undefined || typeof svc.directoryFor !== 'function') return undefined
      try {
        return svc.directoryFor(sessionId)
      } catch (cause) {
        if (typeof console !== 'undefined') {
          console.warn('dsh-todo: directoryFor() threw —', cause)
        }
        return undefined
      }
    },
  }
  // agentPresets is a NAMESPACED SERVICE, reachable only as
  // `ctx['remote.agentPresets']` — it is NOT a key on the `remote` object, and
  // `c.remote?.agentPresets` is permanently undefined however the deployment is
  // composed. Reading the key form is what hid this button on a harness that
  // had the service loaded the whole time, and an earlier comment here asserted
  // the opposite. The namespaced read still needs its guard: a profile without
  // ui-agent-preset never provides the service, and an undeclared read throws.
  //
  // There is deliberately NO `?? c.remote?.agentPresets` fallback. On the real
  // (proxied) remote service that read THROWS rather than yielding undefined —
  // it escapes the guard above and crashes the whole conversation.view slot,
  // which is what emptied the tab. The namespaced form is the only correct
  // access, so the fallback bought nothing and cost the outage twice.
  const agentPresets = probeNamespaced(c, 'remote.agentPresets')

  // ONLY `sessions` is required. It is the one service a launch cannot fake:
  // without it there is no session to create, configure or open.
  //
  // `modelDirectories` and `agentPresets` are OPTIONAL, and requiring them was the
  // mistake that kept this button invisible. They supply the two PICKERS, and a
  // launch with no pick is a launch on the deployment defaults — exactly what
  // the sidebar's own New Session does. Gating the whole feature on them meant
  // one absent service silently removed the BUTTON rather than a dropdown, and
  // that failure is indistinguishable from the feature being broken. The dialog
  // already renders 'Default' for an empty picker.
  if (!sessions) {
    if (typeof console !== 'undefined') {
      // Report WHAT was tried, not just that it failed. 'no sessions service'
      // on a harness that plainly HAS sessions is a dead end; the per-read
      // detail is what separates 'absent' from 'present but unreachable from
      // this fiber'.
      const seen: string[] = []
      for (const key of ['sessions', 'modelDirectories', 'uiWorkspace']) {
        let bare = 'undefined'
        try {
          bare = (c as Record<string, unknown>)[key] === undefined ? 'undefined' : 'ok'
        } catch {
          bare = 'THREW'
        }
        let viaGet = 'undefined'
        try {
          viaGet = c.get?.(key) === undefined ? 'undefined' : 'ok'
        } catch {
          viaGet = 'THREW'
        }
        seen.push(key + ': bare=' + bare + ' get()=' + viaGet)
      }
      console.warn(
        'dsh-todo: launch hidden — sessions did not resolve from this fiber.\n  ' +
          seen.join('\n  '),
      )
    }
    return undefined
  }
  return {
    workspaceId,
    sessions,
    // Hand back a handle that is SAFE TO CALL, not merely one that exists.
    // `directoryFor` re-enters `remote.session` inside the model-selection
    // plugin, under a proxy bound to THIS fiber — which never declared it — so
    // the service resolves and the first call throws. Guarding here means no
    // consumer can get it wrong; guarding at each call site is how the third
    // conversation.view outage happened, because the raw handle travelled
    // further than the guards did. scripts/check-context.mjs calls this handle
    // directly for exactly that reason.
    // Already lazy and already guarded — see the `modelDirectories` binding
    // above. Wrapping again here would only re-swallow the reported error.
    modelDirectories,
    remote: { agentPresets },
    uiWorkspace: probe('uiWorkspace'),
    presetLabel: presetLabelLookup(probe('locale')),
    // Resolved LAZILY from the model fiber, for the same two reasons as
    // modelDirectories: `remote.session` is only reachable from a fiber that
    // DECLARES it, and that fiber may resolve after this context is built and
    // cached by the slot.
    modelCatalog: (): Promise<unknown> => {
      const session = probeNamespaced(modelCtxOf(), 'remote.session') as
        | { modelCatalog?: () => Promise<unknown> }
        | undefined
      if (session === undefined || typeof session.modelCatalog !== 'function') {
        return Promise.reject(new Error('remote.session.modelCatalog is unavailable'))
      }
      return session.modelCatalog()
    },
  } as LaunchContext & { workspaceId: string }
}

/**
 * Build a locale lookup for the shipped presets' display names.
 *
 * A shipped preset's name is TRANSLATED COPY, not file metadata: the roster row
 * carries an internal `name` that is Chinese in this build, and the shell's own
 * picker never shows it — it resolves `t('presetCordisName')` instead. Reading
 * the raw field is what put "创造模式" in the mode picker on an English UI.
 *
 * `locale` is optional and borrowed like every other launch service, so both
 * the READ and the CALL are guarded: `bind()` runs under a proxy bound to this
 * fiber and can throw from inside the callee. Yielding undefined simply falls
 * the caller back to the roster's own metadata.
 *
 * @param inner - the locale service, or undefined when absent.
 * @returns a key lookup, or undefined when unavailable.
 */
function presetLabelLookup(inner: unknown): ((key: string) => string | undefined) | undefined {
  if (inner === undefined || inner === null) return undefined
  const svc = inner as { bind?: (ns: string) => (key: string) => string }
  if (typeof svc.bind !== 'function') return undefined
  let bound: ((key: string) => string) | undefined
  try {
    // The namespace ui-agent-preset registers its own bundle under; binding it
    // here reuses those keys rather than shipping a second copy that would
    // drift from the shell's wording at the next upgrade.
    bound = svc.bind('settings.agentPreset')
  } catch {
    return undefined
  }
  if (typeof bound !== 'function') return undefined
  return (key: string): string | undefined => {
    try {
      return bound(key)
    } catch {
      return undefined
    }
  }
}

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
      // The scan registry is torn down with the stores, and for the same
      // reason: both are module-scope caches keyed by workspace, and neither
      // may outlive the plugin that owns them. Without this a scan would
      // survive its workspace closing and be resumed against a store that no
      // longer exists.
      scans.clear()
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
  // A context that DECLARES what `modelDirectories.directoryFor()` re-enters.
  //
  // The borrowed method reads `this.ctx.remote.session`, and a cordis proxy
  // resolves a service only for a fiber that declared it — so calling it from
  // this plugin's fiber throws `cannot get property "remote.session" without
  // inject` on every attempt, permanently. Declaring it in a SEPARATE child
  // fiber is the fix: this one is allowed to sit unresolved forever on a
  // profile without ui-model-selection, and the tab never waits on it.
  //
  // Deliberately NOT added to the tab's own inject list — that would park the
  // whole Todo view until an optional service appeared, which is the mistake
  // the comment in the slot's inject callback warns about.
  let modelCtx: unknown
  ctx.effect(() => {
    const fiber = anyCtx.inject(
      ['sessions', 'modelDirectories', 'remote', 'remote.session'],
      (scoped) => {
        modelCtx = scoped
      },
    )
    return () => {
      modelCtx = undefined
      fiber.dispose()
    }
  }, 'dsh-todo: model-selection fiber')
  const modelFiberCtx = (): unknown => modelCtx

  ctx.effect(() => {
    // The launch services are NOT listed here: a profile that composes none of
    // them must still get a todo tab. They are read opportunistically via
    // launchContext(), which yields undefined and hides the button instead.
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
            label: () => 'Tasks',
            inject: (sessionId: string) => {
              // `title` rides the SAME projection rows as workspaceId/sessionIds
              // (the shell's own sidebar labels its groups from it), so reading
              // it costs no new service and no new guarded read — it is one more
              // field on a snapshot already in hand. Typed optional because this
              // package does not own that projection: a build that stops
              // carrying a title must fall back, not crash the slot.
              const workspaces = readyCtx.workspaces.list.getSnapshot().items as readonly {
                workspaceId: string
                sessionIds: readonly string[]
                title?: string
              }[]
              const workspaceId = workspaceIdForSession(workspaces, sessionId)
              if (workspaceId === undefined) return { store: null }
              const workspaceName = workspaces.find((w) => w.workspaceId === workspaceId)?.title
              let store = stores.get(workspaceId)
              if (store === undefined) {
                store = new TodoStore(readyCtx.remote.dshTodo, workspaceId)
                stores.set(workspaceId, store)
              }
              // Read the launch services off the ROOT ctx, not the nested
              // fiber. A cordis fiber resolves a service only if IT declared the
              // dependency; the nested inject lists remote.dshTodo/workspaces/
              // slots, so `sessions` is invisible there however well the shell
              // provides it — which is exactly what hid this button. Adding it
              // to that inject list is the wrong fix: it would park the whole
              // TAB until an optional service appears. The root ctx sees every
              // registered service, and launchContext() still guards each read.
              //
              // `modelCtx` is separate and load-bearing: `directoryFor()` runs
              // `this.ctx.remote.session` under a proxy bound to the CALLING
              // fiber, so a fiber that never declared `remote.session` gets
              // `cannot get property "remote.session" without inject` on every
              // call, forever. It is a DECLARATION problem, not a timing one —
              // retrying cannot fix it. modelFiberCtx() declares exactly what
              // the shell's own ui-model-selection declares, in a child fiber
              // that is allowed to stay unresolved, so the tab never waits on
              // it and the picker works when the services are present.
              // Pass the ACCESSOR, not its current value. The slot's inject
              // callback runs when the conversation view first renders, which
              // can be BEFORE the model fiber's callback has assigned its
              // scoped context — and the result is cached, so an early read
              // pinned `modelDirectories` to undefined for the dialog's whole
              // life. Reading it lazily lets a fiber that resolves a moment
              // later still supply the picker.
              return {
                store,
                launch: launchContext(ctx, workspaceId, modelFiberCtx),
                workspaceName,
              }
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
