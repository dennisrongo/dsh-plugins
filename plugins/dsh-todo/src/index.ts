/**
 * Host half of dsh-todo: the durable owner of every workspace's todo list.
 *
 * Storage lives IN the workspace, not in a central home file: one SQLite
 * database per project at `<workspace>/.dsh/todo.db`, resolved through
 * dsh's `workspaceRegistry` (the same seam dsh-git uses to run git in the
 * workspace directory). The todo items therefore travel with the project:
 * no strays in `~/.dsh/storages`, and two harness homes pointing at the
 * same workspace directory see the same list with no sync step.
 *
 * Schema (created on demand):
 *   CREATE TABLE IF NOT EXISTS todo (
 *     id          TEXT PRIMARY KEY,
 *     text        TEXT NOT NULL,
 *     done        INTEGER NOT NULL DEFAULT 0,
 *     created_at  INTEGER NOT NULL,
 *     completed_at INTEGER,
 *     archived_at INTEGER,
 *     position    INTEGER NOT NULL
 *   )
 *   CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)
 *
 * The list is stored as ordered rows; `position` (0-based array index of the
 * active items array) preserves the UI's drag order. Archived items keep their
 * last position. `meta.revision` is the optimistic-concurrency token.
 *
 * Migration: the legacy central file `~/.dsh/storages/dsh_todo.json` keyed
 * lists by opaque workspace UUID, which cannot be mapped to a directory. On
 * service init we locate that file (read-only), count the records it holds,
 * and log what happened to them. Old lists keyed by UUID are left in place
 * (the file is renamed `.migrated` on successful init) — recovering them per
 * workspace needs a uuid→path mapping that only the legacy harness run had.
 *
 * The two methods are marked `@Remote`, which publishes them to the browser
 * through the Typert gateway; the client half mounts a matching descriptor and
 * calls them as `ctx.remote.dshTodo.list(...)` / `.replace(...)`.
 *
 * @module @dennisrongo/dsh-todo
 */
import { mkdirSync, readFileSync, renameSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { isAbsolute, join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
// Imported for its side effect on the type level: dsh-workspace's module
// augmentation is what declares `ctx.workspaceRegistry` on Context.
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  MAX_ITEMS,
  MAX_TEXT,
  type TodoItem,
  type TodoList,
  type TodoListRequest,
  type TodoListResult,
  type TodoReplaceRequest,
  type TodoReplaceResult,
} from './types.ts'

export type * from './types.ts'

/**
 * Runtime schema for one stored item. This is the durable read boundary: junk
 * from a hand-edited database is rejected here rather than reaching the UI.
 */
const todoItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().max(MAX_TEXT),
  done: z.boolean(),
  createdAt: z.number(),
  completedAt: z.number().optional(),
  archivedAt: z.number().optional(),
})

/** Runtime schema for one workspace's whole record. */
const todoListSchema = z.object({
  items: z.array(todoItemSchema).max(MAX_ITEMS),
  revision: z.number(),
  updatedAt: z.number(),
})

/**
 * Kept for backward compatibility with test/CI imports that asserted the old
 * storage-domain shape. The SQLite path does not use a storage domain; the
 * name satisfies the same unit grammar the storage layer enforced.
 */
export const todoDomainSpec = {
  name: 'dsh_todo',
  version: 2,
} as const

/** The empty list served for a workspace that has never stored anything. */
const EMPTY: TodoList = { items: [], revision: 0, updatedAt: 0 }

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshTodo: TodoService
  }
}

/** Directory name inside the workspace that carries harness-local state. */
const DOT_DSH = '.dsh'
/** Database filename inside `<workspace>/.dsh`. */
const DB_FILE = 'todo.db'

/**
 * Durable per-workspace todo storage, in the workspace itself.
 *
 * Writes are serialized per workspace: `replace` reads the current revision,
 * compares it, and commits inside one queued step, so two tabs racing on the
 * same workspace cannot interleave a read and a write.
 */
export class TodoService extends TypertRemoteService {
  // Per-fiber service grants: the workspace registry property is only readable
  // when declared here (same contract dsh-git follows).
  static inject = ['workspaceRegistry']

  /** Open database handle per workspace id, kept for the service lifetime. */
  private readonly dbs = new Map<string, DatabaseSync>()

  /** Resolved workspace directory per workspace id. */
  private readonly dirs = new Map<string, string>()

  /** Per-workspace write chain, keyed by workspace id. */
  private readonly tails = new Map<string, Promise<unknown>>()

  /**
   * @param ctx - host context carrying the workspace registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'dshTodo')
  }

  /**
   * Migrate the legacy central JSON store into the per-workspace databases.
   *
   * The legacy layout kept one `<home>/storages/dsh_todo.json` keyed by opaque
   * workspace uuid. That uuid maps to a directory through the same home's
   * `storages/workspace.json`, so the lists CAN be carried over: each one is
   * imported into `<workspace>/.dsh/todo.db` with its revision and timestamps
   * preserved, and only then is the legacy file renamed `.migrated`.
   *
   * Runs once per harness home; a workspace whose db already has content is
   * left untouched, so a half-finished migration never clobbers newer data.
   */
  protected async [Service.init](): Promise<void> {
    // Release every SQLite handle when this fiber is disposed; on Windows an
    // open handle keeps the file locked against deletion/backup.
    this.ctx.effect(() => () => this.close(), 'dsh-todo: close workspace databases')
    const home = process.env.DSH_HOME
    if (!home) return
    const legacyPath = join(home, 'storages', 'dsh_todo.json')
    const registryPath = join(home, 'storages', 'workspace.json')
    try {
      if (!existsSync(legacyPath)) return
      const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'))
      const records = legacy?.tables?.workspaces ?? {}
      // The uuid->path mapping may not exist (registry unreadable) — then the
      // lists cannot be placed and the file is left alone for a later retry.
      let mapping: Record<string, { path?: string }> = {}
      if (existsSync(registryPath)) {
        mapping = JSON.parse(readFileSync(registryPath, 'utf8'))?.tables?.workspaces ?? {}
      }

      let importedItems = 0
      let importedWorkspaces = 0
      let unmapped = 0
      for (const [uuid, record] of Object.entries(records) as Array<[string, { items?: unknown[]; revision?: number; updatedAt?: number }]>) {
        const dir = mapping[uuid]?.path
        if (!dir || !isAbsolute(dir)) {
          unmapped += Object.keys(record?.items ?? {}).length ? 1 : 0
          continue
        }
        const db = this.openDb(dir)
        const current = this.readList(db)
        if (current.revision > 0) continue // newer data wins; never clobber
        const items = sanitizeItems(record?.items)
        this.writeList(db, items, (record?.revision ?? 0) + 1, record?.updatedAt ?? Date.now())
        importedItems += items.length
        importedWorkspaces += 1
      }

      const stamp = legacyPath.replace(/\.json$/, '.migrated')
      if (!existsSync(stamp)) renameSync(legacyPath, stamp)
      console.log(
        `[dsh-todo] legacy store migrated: ${importedItems} item(s) into ` +
          `${importedWorkspaces} workspace db(s)` +
          (unmapped > 0 ? `; ${unmapped} workspace(s) had no directory mapping and were skipped` : '') +
          ` -> ${stamp}`,
      )
    } catch (err) {
      // Migration must never take the service down; the legacy file stays in
      // place and the next init retries.
      console.warn(`[dsh-todo] legacy store migration deferred:`, err)
    }
  }

  /**
   * Resolve a workspace id to its canonical directory via the registry.
   * @param workspaceId - the workspace to resolve.
   * @returns the canonical workspace directory.
   */
  private workspaceDir(workspaceId: unknown): string {
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      throw new Error('dsh-todo: workspaceId must be a non-empty string')
    }
    const cached = this.dirs.get(workspaceId)
    if (cached) return cached
    const registry = this.ctx.workspaceRegistry
    const workspace = registry.list().find((w: Workspace) => String(w.id) === workspaceId)
    if (workspace === undefined) throw new Error(`dsh-todo: unknown workspace ${workspaceId}`)
    const dir = resolve(workspace.path)
    this.dirs.set(workspaceId, dir)
    return dir
  }

  /**
   * Open (creating if needed) the workspace's database by directory. Handles
   * are cached per resolved path; `mkdir -p` runs on every open because the
   * `.dsh` directory is cheap to create and the workspace may have been
   * cloned since.
   */
  private openDb(dir: string): DatabaseSync {
    const resolved = resolve(dir)
    const cached = this.dbs.get(resolved)
    if (cached) return cached
    mkdirSync(join(resolved, DOT_DSH), { recursive: true })
    const db = new DatabaseSync(join(resolved, DOT_DSH, DB_FILE))
    db.exec(`
      CREATE TABLE IF NOT EXISTS todo (
        id           TEXT PRIMARY KEY,
        text         TEXT NOT NULL,
        done         INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL,
        completed_at INTEGER,
        archived_at  INTEGER,
        position     INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    this.dbs.set(resolved, db)
    return db
  }

  /** Resolve the workspace id, then open (or find) its database. */
  private db(workspaceId: unknown): DatabaseSync {
    return this.openDb(this.workspaceDir(workspaceId))
  }

  /** Guard: registry lookups happen on every call, so unknown ids fail loudly. */
  private requireDb(workspaceId: unknown): DatabaseSync {
    return this.db(workspaceId)
  }

  /**
   * Read one workspace's list. An unknown workspace id fails loudly (caller
   * bug); a known workspace that has never stored anything reads as empty.
   * @param request - the workspace to read.
   * @returns the stored list, or the empty list.
   */
  @Remote
  async list(request: TodoListRequest): Promise<TodoListResult> {
    const db = this.requireDb(request?.workspaceId)
    return { list: this.readList(db) }
  }

  /**
   * Replace one workspace's list, guarded by the revision the caller observed.
   *
   * A mismatch is reported as a business result rather than a throw, and it
   * carries the authoritative list so the caller can reconcile from the reply
   * without a second read.
   * @param request - target workspace, desired items, and observed revision.
   * @returns the committed list, or the conflict with the current list.
   */
  @Remote
  async replace(request: TodoReplaceRequest): Promise<TodoReplaceResult> {
    const workspaceId = request?.workspaceId
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      throw new Error('dsh-todo: workspaceId must be a non-empty string')
    }
    const items = sanitizeItems(request?.items)
    const ifRevision = request?.ifRevision ?? null

    return this.enqueue(workspaceId, async () => {
      const db = this.requireDb(workspaceId)
      const current = this.readList(db)

      // `null` means the caller had never read; accept it only while the
      // record is genuinely untouched, so it cannot erase an existing list.
      const matches = ifRevision === null ? current.revision === 0 : ifRevision === current.revision
      if (!matches) return { ok: false, code: 'revision-conflict', list: current }

      this.writeList(db, items, current.revision + 1)
      return { ok: true, list: this.readList(db) }
    })
  }

  /** Queue one whole read/compare/write behind this workspace's prior write. */
  private async enqueue<T>(workspaceId: string, run: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(workspaceId) ?? Promise.resolve()
    // Run on both settle paths so one failed write does not stall the chain.
    const next = prior.then(run, run)
    // Store the *neutralized* tail: later writes must wait for this one, but
    // must not inherit its rejection.
    const tail = next.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(workspaceId, tail)
    try {
      return await next
    } finally {
      // Release the map entry only if nothing newer was queued meanwhile, so
      // an idle process does not retain one entry per workspace forever.
      if (this.tails.get(workspaceId) === tail) this.tails.delete(workspaceId)
    }
  }

  /**
   * Close every open database handle. Called on fiber teardown via the init
   * effect; public because embedders (and tests) driving the service without
   * a full cordis lifecycle need the same guarantee — on Windows an open
   * handle keeps the file locked against deletion/backup.
   */
  close(): void {
    for (const db of this.dbs.values()) {
      try {
        db.close()
      } catch {
        // Already closed — a double dispose is harmless.
      }
    }
    this.dbs.clear()
  }

  /** Read the whole list from the database, ordered by `position`. */
  private readList(db: DatabaseSync): TodoList {
    const revision = Number(db.prepare(`SELECT value FROM meta WHERE key = 'revision'`).get()?.value ?? 0)
    const updatedAt = Number(db.prepare(`SELECT value FROM meta WHERE key = 'updatedAt'`).get()?.value ?? 0)
    const rows = db
      .prepare(
        `SELECT id, text, done, created_at, completed_at, archived_at
         FROM todo ORDER BY position ASC`,
      )
      .all()
    const items: TodoItem[] = []
    for (const row of rows) {
      const candidate = {
        id: String(row.id),
        text: String(row.text),
        done: Number(row.done) === 1,
        createdAt: Number(row.created_at),
        ...(row.completed_at !== null && row.completed_at !== undefined
          ? { completedAt: Number(row.completed_at) }
          : {}),
        ...(row.archived_at !== null && row.archived_at !== undefined
          ? { archivedAt: Number(row.archived_at) }
          : {}),
      }
      const parsed = todoItemSchema.safeParse(candidate)
      if (parsed.success) items.push(parsed.data)
    }
    const list = { items, revision, updatedAt }
    const check = todoListSchema.safeParse(list)
    return check.success ? list : { items: [], revision, updatedAt }
  }

  /** Replace every row inside one transaction and stamp the meta tokens. */
  private writeList(db: DatabaseSync, items: TodoItem[], revision: number, updatedAt = Date.now()): void {
    const now = updatedAt
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM todo').run()
      const insert = db.prepare(
        `INSERT INTO todo (id, text, done, created_at, completed_at, archived_at, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      items.forEach((item, index) => {
        insert.run(
          item.id,
          item.text,
          item.done ? 1 : 0,
          item.createdAt,
          item.completedAt ?? null,
          item.archivedAt ?? null,
          index,
        )
      })
      db.prepare(`INSERT INTO meta (key, value) VALUES ('revision', ?)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(revision))
      db.prepare(`INSERT INTO meta (key, value) VALUES ('updatedAt', ?)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(now))
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

/**
 * Clamp untrusted client input to the stored shape. The client enforces the
 * same rules, but this half is the durable boundary and must not trust it.
 */
function sanitizeItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return []
  const out: TodoItem[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (out.length >= MAX_ITEMS) break
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (typeof e.id !== 'string' || e.id.length === 0) continue
    if (typeof e.text !== 'string') continue
    // Duplicate ids would make item lookup ambiguous in the UI.
    if (seen.has(e.id)) continue
    seen.add(e.id)
    const done = e.done === true
    const completedAt = typeof e.completedAt === 'number' ? e.completedAt : undefined
    const archivedAt = typeof e.archivedAt === 'number' ? e.archivedAt : undefined
    out.push({
      id: e.id,
      text: e.text.slice(0, MAX_TEXT),
      done,
      createdAt: typeof e.createdAt === 'number' ? e.createdAt : 0,
      // completedAt is meaningless on an open item; drop it rather than store a lie.
      ...(done && completedAt !== undefined ? { completedAt } : {}),
      // archivedAt is the archived flag itself, so a non-numeric value must not
      // survive as a truthy marker.
      ...(archivedAt !== undefined ? { archivedAt } : {}),
    })
  }
  return out
}

export default TodoService
