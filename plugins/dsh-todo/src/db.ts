/**
 * The durable storage layer, shared by the host service and the CLI.
 *
 * This module exists so there is exactly ONE implementation of the schema, the
 * v1 -> v2 migration, and the row<->item mapping. A second copy of
 * {@link migrateSchema} living in the CLI is the one duplication that could
 * genuinely corrupt a user's database: the two would drift, and a half-migrated
 * table is not something the revision token can protect against.
 *
 * It is deliberately free of cordis and of any harness import, so the CLI can
 * use it without loading a profile.
 *
 * ## Concurrency
 *
 * SQLite is a multi-process database and its file lock is the real guard here:
 * a writer that lands inside another process's transaction is refused rather
 * than allowed to interleave. {@link openDb} therefore sets a `busy_timeout` so
 * that a CLI write racing the running harness WAITS for the commit instead of
 * failing immediately (the default is 0, i.e. fail fast).
 *
 * What the lock does not cover is the `revision` token, which is an OPTIMISTIC
 * concurrency check held in memory by each reader. A CLI write bumps it, so a
 * browser tab holding the previous value gets a `revision-conflict` on its next
 * write and adopts the authoritative list. That is the designed behaviour, not
 * a failure — the cost of an out-of-band edit is a stale tab, never lost data.
 *
 * @module @dennisrongo/dsh-todo/db
 */
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'
import {
  normalizeDueDate,
  normalizeLabel,
  toPriority,
  toStatus,
  type TodoItem,
  type TodoList,
} from './types.ts'

/** Directory name inside the workspace that carries harness-local state. */
export const DOT_DSH = '.dsh'
/** Database filename inside `<workspace>/.dsh`. */
export const DB_FILE = 'todo.db'

/**
 * How long a write waits for another process's transaction before giving up.
 *
 * The SQLite default is 0 — a writer that arrives mid-transaction fails
 * instantly with SQLITE_BUSY. Since the harness commits in microseconds, a
 * short wait turns the one genuine cross-process race into a non-event.
 */
export const BUSY_TIMEOUT_MS = 5000

/** The empty list served for a workspace that has never stored anything. */
export const EMPTY_LIST: TodoList = { items: [], revision: 0, updatedAt: 0 }

/** Resolve the database path for a workspace directory. */
export function dbPath(dir: string): string {
  return join(resolve(dir), DOT_DSH, DB_FILE)
}

/**
 * Open (creating if needed) the database under a workspace directory.
 *
 * `mkdir -p` runs on every open because the `.dsh` directory is cheap to create
 * and the workspace may have been cloned since.
 * @param dir - the workspace directory.
 * @returns an open handle with the schema present and migrated.
 */
export function openDb(dir: string): DatabaseSync {
  const resolved = resolve(dir)
  mkdirSync(join(resolved, DOT_DSH), { recursive: true })
  const db = new DatabaseSync(join(resolved, DOT_DSH, DB_FILE))
  // Wait out a concurrent writer rather than failing fast; see the module note.
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  // The v1 shape. Kept verbatim so an existing database still matches it and is
  // upgraded by migrateSchema() rather than being recreated.
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
  migrateSchema(db)
  return db
}

/**
 * Bring an existing database up to the v2 task shape.
 *
 * `CREATE TABLE IF NOT EXISTS` does NOT add columns to a table that already
 * exists, so a user upgrading the plugin would otherwise keep a v1 table and
 * every write would fail on the unknown columns. Each column is added
 * individually and idempotently by consulting `PRAGMA table_info`.
 *
 * The v1 columns `text` and `done` are the source of the backfill: `text`
 * becomes `title`, and `done = 1` becomes `status = 'done'`. They are left in
 * place rather than dropped — a stale column is harmless, whereas dropping one
 * makes a downgrade lose data outright.
 */
export function migrateSchema(db: DatabaseSync): void {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(todo)').all() as Array<{ name: unknown }>).map((c) => String(c.name)),
  )
  const add = (name: string, ddl: string): boolean => {
    if (columns.has(name)) return false
    db.exec(`ALTER TABLE todo ADD COLUMN ${ddl}`)
    columns.add(name)
    return true
  }

  // `title` is NOT NULL-by-convention rather than by constraint: SQLite cannot
  // add a NOT NULL column without a default, and a default would mask a failed
  // backfill behind an empty string.
  const addedTitle = add('title', 'title TEXT')
  const addedStatus = add('status', 'status TEXT')
  add('description', 'description TEXT')
  add('priority', 'priority TEXT')
  add('release', 'release TEXT')
  add('sprint', 'sprint TEXT')
  add('due_date', 'due_date TEXT')

  // Backfill from the v1 columns, but only where they still exist.
  if (addedTitle && columns.has('text')) {
    db.exec('UPDATE todo SET title = text WHERE title IS NULL')
  }
  if (addedStatus && columns.has('done')) {
    db.exec("UPDATE todo SET status = CASE WHEN done = 1 THEN 'done' ELSE 'todo' END WHERE status IS NULL")
  }
  // Any row still missing a status/priority (a hand-edited db, or a v1 table
  // with no `done`) gets the defaults rather than failing the read schema.
  db.exec("UPDATE todo SET status = 'todo' WHERE status IS NULL OR status = ''")
  db.exec("UPDATE todo SET priority = 'p2' WHERE priority IS NULL OR priority = ''")
  db.exec("UPDATE todo SET title = '' WHERE title IS NULL")
}

/**
 * Read the whole list from the database, ordered by `position`.
 *
 * Rows are coerced rather than trusted: a hand-edited database yields defaults
 * instead of junk reaching the caller.
 */
export function readList(db: DatabaseSync): TodoList {
  const revision = Number(db.prepare("SELECT value FROM meta WHERE key = 'revision'").get()?.value ?? 0)
  const updatedAt = Number(db.prepare("SELECT value FROM meta WHERE key = 'updatedAt'").get()?.value ?? 0)
  const rows = db
    .prepare(
      `SELECT id, title, description, status, priority, release, sprint, due_date,
              created_at, completed_at, archived_at
       FROM todo ORDER BY position ASC`,
    )
    .all()
  const text = (v: unknown): string | undefined =>
    v === null || v === undefined ? undefined : String(v)
  const items: TodoItem[] = []
  for (const row of rows) {
    items.push({
      id: String(row.id),
      title: String(row.title ?? ''),
      status: toStatus(row.status),
      priority: toPriority(row.priority),
      ...(text(row.description) !== undefined ? { description: text(row.description) } : {}),
      ...(normalizeLabel(row.release) !== undefined ? { release: normalizeLabel(row.release) } : {}),
      ...(normalizeLabel(row.sprint) !== undefined ? { sprint: normalizeLabel(row.sprint) } : {}),
      ...(normalizeDueDate(row.due_date) !== undefined ? { dueDate: normalizeDueDate(row.due_date) } : {}),
      createdAt: Number(row.created_at),
      ...(row.completed_at !== null && row.completed_at !== undefined
        ? { completedAt: Number(row.completed_at) }
        : {}),
      ...(row.archived_at !== null && row.archived_at !== undefined
        ? { archivedAt: Number(row.archived_at) }
        : {}),
    })
  }
  return { items, revision, updatedAt }
}

/**
 * Replace every row inside ONE transaction and stamp the meta tokens.
 *
 * The whole-list rewrite is what makes `position` authoritative: order is the
 * array index, so a reorder needs no separate bookkeeping.
 */
export function writeList(
  db: DatabaseSync,
  items: TodoItem[],
  revision: number,
  updatedAt = Date.now(),
): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM todo').run()
    // `text` and `done` are still written alongside their v2 replacements: a v1
    // table keeps them NOT NULL, so omitting them would fail the insert, and
    // keeping them current means a downgrade still reads a sane list.
    const insert = db.prepare(
      `INSERT INTO todo (id, title, description, status, priority, release, sprint, due_date,
                         text, done, created_at, completed_at, archived_at, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    items.forEach((item, index) => {
      insert.run(
        item.id,
        item.title,
        item.description ?? null,
        item.status,
        item.priority,
        item.release ?? null,
        item.sprint ?? null,
        item.dueDate ?? null,
        item.title,
        item.status === 'done' ? 1 : 0,
        item.createdAt,
        item.completedAt ?? null,
        item.archivedAt ?? null,
        index,
      )
    })
    db.prepare(`INSERT INTO meta (key, value) VALUES ('revision', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(revision))
    db.prepare(`INSERT INTO meta (key, value) VALUES ('updatedAt', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(updatedAt))
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
