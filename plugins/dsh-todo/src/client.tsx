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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { TODO_REMOTE } from './remote.ts'
import { MAX_TEXT, type TodoItem } from './types.ts'

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

export type { TodoItem }

export interface TodoStats {
  total: number
  done: number
  open: number
  /** 0–100, rounded. 0 when the list is empty. */
  percent: number
  /** How many items are archived. Excluded from total/done/open/percent. */
  archived: number
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
  const done = active.filter((i) => i.done).length
  const open = total - done
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return { total, done, open, percent, archived: items.length - active.length }
}

/** The item the user should look at next: first not-done and not archived, in list order. */
export function nextOpen(items: TodoItem[]): TodoItem | undefined {
  return items.find((i) => !i.done && !isArchived(i))
}

/** Normalize free text into a storable todo title. Returns '' when unusable. */
export function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
}

/** Create an item. `now`/`rand` are injectable to keep the function pure-testable. */
export function makeItem(text: string, now = Date.now(), rand = Math.random): TodoItem {
  return {
    id: `t${now.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`,
    text,
    done: false,
    createdAt: now,
  }
}

/** Toggle one item's done flag, stamping/clearing completedAt. */
export function toggleItem(items: TodoItem[], id: string, now = Date.now()): TodoItem[] {
  return items.map((i) => {
    if (i.id !== id) return i
    const done = !i.done
    return done ? { ...i, done, completedAt: now } : { ...i, done, completedAt: undefined }
  })
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
    if (!i.done || isArchived(i)) return i
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
  return items.filter((i) => !i.done)
}

/** Which subset of the list the view is showing. */
export type TodoFilter = 'all' | 'open' | 'done' | 'archived'

/**
 * Apply the view's filter ring. Every filter except `archived` operates on the
 * active list, so archived items stay out of sight until asked for. Unknown
 * filters fall back to the active list.
 */
export function filterItems(items: TodoItem[], filter: TodoFilter): TodoItem[] {
  if (filter === 'archived') return archivedItems(items)
  const active = activeItems(items)
  if (filter === 'open') return active.filter((i) => !i.done)
  if (filter === 'done') return active.filter((i) => i.done)
  return active
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
    if (typeof e.id !== 'string' || typeof e.text !== 'string') continue
    out.push({
      id: e.id,
      text: e.text.slice(0, MAX_TEXT),
      done: e.done === true,
      createdAt: typeof e.createdAt === 'number' ? e.createdAt : 0,
      completedAt: typeof e.completedAt === 'number' ? e.completedAt : undefined,
      // Presence of a number is the archived flag, so anything else must decay
      // to undefined rather than survive as a truthy marker.
      archivedAt: typeof e.archivedAt === 'number' ? e.archivedAt : undefined,
    })
  }
  return out
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
  font: 400 13px/1.5 var(--dsw-font-family, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
  font-variant-numeric: tabular-nums;
}
.dshtd *, .dshtd *::before, .dshtd *::after { box-sizing: border-box; }

/* ---- header ---- */
.dshtd-head {
  flex: none;
  display: flex; align-items: center; gap: 12px;
  padding: 14px 20px 10px;
}
.dshtd-title { font-size: 14px; font-weight: 600; color: var(--td-primary); flex: none; }
.dshtd-progress {
  flex: 1 1 auto; max-width: 260px; height: 5px; border-radius: 999px;
  background: var(--td-hover); overflow: hidden;
}
.dshtd-progress > i {
  display: block; height: 100%; border-radius: 999px;
  background: var(--td-accent); transition: width 180ms ease;
}
.dshtd-score { flex: none; color: var(--td-caption); font-size: 12px; }

/* ---- filter ring ---- */
.dshtd-filters { flex: none; display: flex; gap: 4px; padding: 0 20px 10px; }
.dshtd-filter {
  border: 1px solid transparent; background: transparent; cursor: pointer;
  color: var(--td-caption); font: inherit; font-size: 12px;
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
.dshtd-add:focus { outline: none; border-color: var(--dsw-alias-border-focus, #6b7280); }
.dshtd-addbtn {
  flex: none; border: 1px solid var(--td-border); border-radius: 8px;
  background: var(--td-hover); color: var(--td-primary); font: inherit; font-weight: 500;
  padding: 8px 16px; cursor: pointer;
}
.dshtd-addbtn:hover:not(:disabled) { border-color: var(--dsw-alias-border-focus, #6b7280); }
.dshtd-addbtn:disabled { opacity: 0.4; cursor: default; }

/* ---- list ---- */
.dshtd-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 20px 16px; }
.dshtd-list { list-style: none; margin: 0; padding: 0; }
.dshtd-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 9px 10px; border-radius: 8px;
  border: 1px solid transparent;
}
.dshtd-row + .dshtd-row { margin-top: 2px; }
.dshtd-row:hover { background: var(--td-hover); border-color: var(--td-border); }
.dshtd-row.done .dshtd-text { color: var(--td-caption); text-decoration: line-through; }
/* Archived rows read as a quiet log: dimmed, no strikethrough, no edit affordance. */
.dshtd-row.archived .dshtd-text { color: var(--td-caption); cursor: default; }
.dshtd-badge {
  flex: none; margin-top: 1px; width: 15px; text-align: center;
  color: var(--td-accent); font-size: 11px; line-height: 1.5;
}
.dshtd-check {
  flex: none; margin-top: 2px; width: 15px; height: 15px;
  accent-color: var(--td-accent); cursor: pointer;
}
.dshtd-text {
  flex: 1 1 auto; min-width: 0; color: var(--td-secondary);
  overflow-wrap: anywhere; cursor: text;
}
.dshtd-age { flex: none; color: var(--td-caption); font-size: 11px; margin-top: 2px; }
.dshtd-edit {
  flex: 1 1 auto; min-width: 0;
  border: 1px solid var(--dsw-alias-border-focus, #6b7280); border-radius: 6px;
  background: transparent; color: var(--td-primary); font: inherit; padding: 3px 8px;
}
.dshtd-edit:focus { outline: none; }
.dshtd-rowbtns { flex: none; display: flex; gap: 1px; opacity: 0; transition: opacity 100ms ease; }
.dshtd-row:hover .dshtd-rowbtns, .dshtd-row:focus-within .dshtd-rowbtns { opacity: 1; }
.dshtd-icon {
  border: 0; background: transparent; cursor: pointer; color: var(--td-caption);
  font-size: 11px; line-height: 1; padding: 4px 5px; border-radius: 5px;
}
.dshtd-icon:hover { background: var(--td-hover); color: var(--td-primary); }
.dshtd-icon.danger:hover { color: var(--td-danger); }
.dshtd-icon:disabled { opacity: 0.3; cursor: default; }
.dshtd-icon:disabled:hover { background: transparent; color: var(--td-caption); }

/* ---- empty + footer ---- */
.dshtd-empty {
  padding: 40px 20px; text-align: center; color: var(--td-caption);
}
.dshtd-empty b { display: block; color: var(--td-secondary); font-weight: 500; margin-bottom: 4px; }
.dshtd-foot {
  flex: none;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 20px; border-top: 1px solid var(--td-border);
  color: var(--td-caption); font-size: 12px;
}
.dshtd-link {
  border: 0; background: transparent; cursor: pointer; color: var(--td-caption);
  font: inherit; padding: 3px 8px; border-radius: 6px;
}
.dshtd-link:hover { background: var(--td-hover); color: var(--td-primary); }
.dshtd-link.danger:hover { color: var(--td-danger); }
.dshtd-state { color: var(--td-caption); font-size: 11px; }
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
// Component
// ---------------------------------------------------------------------------

function TodoRow({
  item,
  index,
  total,
  store,
}: {
  item: TodoItem
  index: number
  total: number
  store: TodoStore
}): React.JSX.Element {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(item.text)
  const archived = isArchived(item)

  const commit = () => {
    const text = normalizeText(draft)
    setEditing(false)
    if (!text || text === item.text) return
    store.update((items) => items.map((i) => (i.id === item.id ? { ...i, text } : i)))
  }

  // An archived row is a record of finished work, not a work surface: it is
  // read-only apart from restoring or permanently deleting it.
  if (archived) {
    return (
      <li className="dshtd-row archived">
        <span className="dshtd-badge" aria-hidden="true">
          ✓
        </span>
        <span className="dshtd-text">{item.text}</span>
        <span className="dshtd-age" title="When this was archived">
          {fmtAge(item.archivedAt ?? 0)}
        </span>
        <span className="dshtd-rowbtns">
          <button
            className="dshtd-icon"
            title="Restore to the active list"
            aria-label={`Restore "${item.text}"`}
            onClick={() => store.update((items) => restoreItem(items, item.id))}
          >
            ↩
          </button>
          <button
            className="dshtd-icon danger"
            title="Delete permanently"
            aria-label={`Permanently delete "${item.text}"`}
            onClick={() => store.update((items) => items.filter((i) => i.id !== item.id))}
          >
            ✕
          </button>
        </span>
      </li>
    )
  }

  return (
    <li className={`dshtd-row${item.done ? ' done' : ''}`}>
      <input
        type="checkbox"
        className="dshtd-check"
        checked={item.done}
        aria-label={item.done ? `Mark "${item.text}" as not done` : `Mark "${item.text}" as done`}
        onChange={() => store.update((items) => toggleItem(items, item.id))}
      />
      {editing ? (
        <input
          className="dshtd-edit"
          value={draft}
          autoFocus
          aria-label="Edit todo text"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(item.text)
              setEditing(false)
            }
          }}
        />
      ) : (
        <span
          className="dshtd-text"
          title="Click to edit"
          onClick={() => {
            setDraft(item.text)
            setEditing(true)
          }}
        >
          {item.text}
        </span>
      )}
      {!editing ? <span className="dshtd-age">{fmtAge(item.createdAt)}</span> : null}
      <span className="dshtd-rowbtns">
        <button
          className="dshtd-icon"
          title="Move up"
          aria-label={`Move "${item.text}" up`}
          disabled={index === 0}
          onClick={() => store.update((items) => moveItem(items, item.id, -1))}
        >
          ▲
        </button>
        <button
          className="dshtd-icon"
          title="Move down"
          aria-label={`Move "${item.text}" down`}
          disabled={index === total - 1}
          onClick={() => store.update((items) => moveItem(items, item.id, 1))}
        >
          ▼
        </button>
        {item.done ? (
          <button
            className="dshtd-icon"
            title="Archive"
            aria-label={`Archive "${item.text}"`}
            onClick={() => store.update((items) => archiveItem(items, item.id))}
          >
            ⌸
          </button>
        ) : null}
        <button
          className="dshtd-icon danger"
          title="Delete"
          aria-label={`Delete "${item.text}"`}
          onClick={() => store.update((items) => items.filter((i) => i.id !== item.id))}
        >
          ✕
        </button>
      </span>
    </li>
  )
}

const FILTERS: { id: TodoFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'archived', label: 'Archive' },
]

/**
 * The whole todo tab: header, filter ring, add box, and the list. Rendered by
 * the `conversation.view` ring when its tab is active, filling the session pane.
 * @param props - the per-workspace store, or null when no workspace owns the session.
 */
export function TodoView({ store }: { store: TodoStore | null }): React.JSX.Element {
  const [filter, setFilter] = React.useState<TodoFilter>('all')
  const [draft, setDraft] = React.useState('')

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
    const text = normalizeText(draft)
    if (!text) return
    store.update((list) => [...list, makeItem(text)])
    setDraft('')
    // A new item is neither done nor archived, so those views would swallow it.
    if (filter === 'done' || filter === 'archived') setFilter('all')
  }

  const stats = computeStats(items)
  const active = activeItems(items)
  const visible = filterItems(items, filter)

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
        </span>
      </div>

      <div className="dshtd-filters" role="group" aria-label="Filter todos">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className="dshtd-filter"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {f.id === 'open' && stats.open > 0 ? ` (${stats.open})` : null}
            {f.id === 'done' && stats.done > 0 ? ` (${stats.done})` : null}
            {f.id === 'archived' && stats.archived > 0 ? ` (${stats.archived})` : null}
          </button>
        ))}
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
                <b>No todos yet</b>
                Add your first one above — this list belongs to the current workspace.
              </>
            ) : filter === 'open' ? (
              <>
                <b>All done 🎉</b>
                Nothing open right now.
              </>
            ) : (
              <>
                <b>Nothing completed yet</b>
                Check something off to see it here.
              </>
            )}
          </div>
        ) : (
          <ul className="dshtd-list">
            {visible.map((item) => (
              <TodoRow
                key={item.id}
                item={item}
                // Position is expressed in ACTIVE-list space, matching moveItem,
                // so the ▲/▼ end-stops disable on the true first/last item.
                index={active.indexOf(item)}
                total={active.length}
                store={store}
              />
            ))}
          </ul>
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
              onClick={() => {
                if (confirmDelete(stats.archived)) store.update(clearArchived)
              }}
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
    </div>
  )
}

/**
 * Guard the one bulk action that cannot be undone. Archiving is recoverable, so
 * it asks nothing; deleting the archive destroys the record and must.
 *
 * A host without `confirm` (or one that throws) proceeds rather than trapping
 * the user with a button that silently does nothing.
 */
function confirmDelete(count: number): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true
    const noun = count === 1 ? 'item' : 'items'
    return window.confirm(`Permanently delete ${count} archived ${noun}? This cannot be undone.`)
  } catch {
    return true
  }
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
