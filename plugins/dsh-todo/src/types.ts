/**
 * Shared todo vocabulary, imported by both halves.
 *
 * This module is deliberately dependency-free (no cordis, no react, no zod) so
 * the host half, the client half, and the smoke test can all import it without
 * dragging a runtime into the browser bundle.
 *
 * @module @dennisrongo/dsh-todo/types
 */

/** One todo entry as stored on disk and rendered in the UI. */
export interface TodoItem {
  id: string
  text: string
  done: boolean
  /** Epoch ms. */
  createdAt: number
  /** Epoch ms, set when `done` flips true. */
  completedAt?: number
  /**
   * Epoch ms, set when the item is archived. Presence — not a separate boolean
   * — IS the archived state, so there is one source of truth and no way to
   * store an archived item with no archive date.
   *
   * An archived item is hidden from the All / Open / Done views but is never
   * deleted; it stays in the same `items` array and is reachable through the
   * Archive view, where it can be restored or permanently removed.
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

/** Hard cap on stored text length; enforced on both sides. */
export const MAX_TEXT = 500

/** Hard cap on stored items per workspace, so a runaway client cannot bloat the file. */
export const MAX_ITEMS = 1000
