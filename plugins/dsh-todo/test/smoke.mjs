/**
 * Smoke test: the built artifacts exist, the host half exposes its durable
 * Remote surface, the client bundle registers itself with the module loader,
 * and the exported pure logic behaves.
 *
 * Runs offline against the BUILT lib/ output via a stub `__ModuleLoader__` and
 * a stub `require` module table, so build before testing.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

assert.ok(existsSync(join(root, 'lib/index.js')), 'lib/index.js missing — run pnpm build')
assert.ok(existsSync(join(root, 'lib/client.js')), 'lib/client.js missing — run pnpm build')

// --- artifact-level assertions ---------------------------------------------
const client = readFileSync(join(root, 'lib/client.js'), 'utf8')
assert.ok(client.includes('__ModuleLoader__.load'), 'client bundle missing loader call')
assert.ok(client.includes('@dennisrongo/dsh-todo'), 'client bundle missing package id')
assert.ok(client.includes('conversation.view'), 'client bundle missing slot registration')
assert.ok(!client.includes('conversation.input.dock'), 'stale dock registration still present')
assert.ok(client.includes('dshTodo'), 'client bundle missing the host remote namespace')
assert.ok(!/#[0-9a-fA-F]{6}\s*;/.test(client.replace(/var\(--dsw[^)]*,\s*#[0-9a-fA-F]{3,8}\)/g, '')),
  'unexpected hardcoded color outside a --dsw-* fallback')

const hostSource = readFileSync(join(root, 'lib/index.js'), 'utf8')
// The Typert gateway reads wire field names out of Function.prototype.toString(),
// so a minified host half would silently break the wire contract.
assert.ok(/async list\(request\)/.test(hostSource), 'host list() lost its `request` parameter name')
assert.ok(/async replace\(request\)/.test(hostSource), 'host replace() lost its `request` parameter name')
assert.ok(/async scanDigest\(request\)/.test(hostSource), 'host scanDigest() lost its `request` parameter name')
assert.ok(
  /async readSuggestions\(request\)/.test(hostSource),
  'host readSuggestions() lost its `request` parameter name',
)
// Native decorator syntax cannot be parsed by Node 22; it must be downleveled.
assert.ok(!/^\s*@Remote\s*$/m.test(hostSource), 'decorators were emitted natively instead of downleveled')

// --- host half --------------------------------------------------------------
const host = await import(pathToFileURL(join(root, 'lib/index.js')).href)
// The launch helpers ship as their own module so this suite can exercise the
// BUILT pure logic without dragging React or the harness packages in.
const launch = await import(pathToFileURL(join(root, 'lib/launch.js')).href)
assert.equal(typeof host.TodoService, 'function', 'host half must export TodoService')
// The legacy storage-domain export is kept as a versioned marker; the SQLite
// path no longer uses a domain unit.
assert.equal(host.todoDomainSpec.name, 'dsh_todo', 'unexpected storage domain name')
assert.match(String(host.todoDomainSpec.name), /^[a-z][a-z0-9_]*$/, 'domain name must satisfy the unit grammar')
assert.equal(host.todoDomainSpec.version, 2, 'unexpected storage domain version')

// The @Remote markers are what publish these methods to the browser.
const svc = new host.TodoService(new Context())
const marked = remoteMethods(svc).map((m) => m.method).sort()
assert.deepEqual(
  marked,
  ['list', 'readSuggestions', 'replace', 'scanDigest'],
  'host must export exactly list + replace + scanDigest + readSuggestions as Remote',
)
assert.equal(svc.typertRemote.namespace, 'dshTodo', 'wrong Remote namespace')

// --- host storage behavior --------------------------------------------------
// Drive the service against a REAL SQLite database in a temp workspace, wired
// through a stub workspaceRegistry — the same seam the host uses in production.
{
  const { mkdtempSync, rmSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const workspaceDir = mkdtempSync(join(tmpdir(), 'dsh-todo-ws-'))
  const ctx = new Context()
  const service = new host.TodoService(ctx)
  // The stub registry resolves both ids to the same directory (one workspace
  // db) — isolation between workspaces is asserted via a second directory.
  const secondDir = mkdtempSync(join(tmpdir(), 'dsh-todo-ws2-'))
  const workspaces = [
    { id: 'ws-1', path: workspaceDir },
    { id: 'ws-2', path: secondDir },
  ]
  service.ctx.workspaceRegistry = { list: () => workspaces }
  const dbPath = join(workspaceDir, '.dsh', 'todo.db')

  // An unseen workspace reads as empty rather than failing.
  const empty = await service.list({ workspaceId: 'ws-1' })
  assert.deepEqual(empty.list.items, [], 'unseen workspace must read empty')
  assert.equal(empty.list.revision, 0, 'unseen workspace must be revision 0')
  assert.ok(existsSync(dbPath), 'the workspace database must be created on first access')

  // First write from a client that has not read yet.
  const first = await service.replace({
    workspaceId: 'ws-1',
    items: [{ id: 'a', title: 'one', status: 'todo', priority: 'p2', createdAt: 1 }],
    ifRevision: null,
  })
  assert.equal(first.ok, true, 'first write should commit')
  assert.equal(first.list.revision, 1, 'revision must advance on commit')

  // The same stale token must now be refused.
  const stale = await service.replace({ workspaceId: 'ws-1', items: [], ifRevision: null })
  assert.equal(stale.ok, false, 'a stale write must be refused')
  assert.equal(stale.code, 'revision-conflict', 'refusal must be a revision conflict')
  assert.equal(stale.list.revision, 1, 'conflict must carry the authoritative list')
  assert.equal(stale.list.items.length, 1, 'a refused write must not erase stored items')

  // Writing against the observed revision succeeds.
  const second = await service.replace({ workspaceId: 'ws-1', items: [], ifRevision: 1 })
  assert.equal(second.ok, true, 'write against the current revision should commit')
  assert.equal(second.list.revision, 2, 'revision must advance again')

  // Workspaces are isolated from one another: each directory holds its own db.
  const other = await service.list({ workspaceId: 'ws-2' })
  assert.equal(other.list.revision, 0, 'a different workspace must have its own record')
  assert.ok(existsSync(join(secondDir, '.dsh', 'todo.db')), 'the second workspace must get its own database')
  assert.notEqual(dbPath, join(secondDir, '.dsh', 'todo.db'))

  // Untrusted input is clamped at the durable boundary.
  const dirty = await service.replace({
    workspaceId: 'ws-3-does-not-exist'.replace('ws-3-does-not-exist', 'ws-1'),
    items: [
      { id: 'x', title: 'y'.repeat(900), status: 'todo', priority: 'p2', createdAt: 2 },
      { id: 'x', title: 'duplicate id', status: 'todo', priority: 'p2', createdAt: 3 },
      { id: 'z', title: 'open', status: 'todo', priority: 'p2', createdAt: 4, completedAt: 99 },
      // Unknown status/priority must decay to the defaults, not be stored raw.
      { id: 'w', title: 'junk enums', status: 'nonsense', priority: 'p9', createdAt: 5 },
      'garbage',
      null,
    ],
    ifRevision: 2,
  })
  assert.equal(dirty.ok, true)
  assert.equal(dirty.list.items.length, 3, 'malformed and duplicate entries must be dropped')
  assert.equal(dirty.list.items[0].title.length, 500, 'stored title must be capped at 500 chars')
  assert.equal(dirty.list.items[1].completedAt, undefined, 'completedAt must not survive on an unfinished item')
  assert.equal(dirty.list.items[2].status, 'todo', 'an unknown status must fall back to the default')
  assert.equal(dirty.list.items[2].priority, 'p2', 'an unknown priority must fall back to the default')

  // The roadmap fields must survive the durable boundary intact.
  const roadmap = await service.replace({
    workspaceId: 'ws-1',
    items: [
      {
        id: 'r1',
        title: 'ship login',
        description: 'AC: user can sign in\nAC: bad password shows an error',
        status: 'in-progress',
        priority: 'p0',
        release: 'v1.2.0',
        sprint: 'Sprint 24',
        createdAt: 6,
      },
      // Blank labels must clear rather than store an empty string, so "no
      // release" has exactly one representation on disk.
      { id: 'r2', title: 'blank labels', status: 'todo', priority: 'p2', release: '   ', sprint: '', createdAt: 7 },
    ],
    ifRevision: 3,
  })
  assert.equal(roadmap.ok, true)
  const [r1, r2] = roadmap.list.items
  assert.equal(r1.status, 'in-progress', 'status must survive the host sanitizer')
  assert.equal(r1.priority, 'p0', 'priority must survive the host sanitizer')
  assert.equal(r1.release, 'v1.2.0', 'release must survive the host sanitizer')
  assert.equal(r1.sprint, 'Sprint 24', 'sprint must survive the host sanitizer')
  assert.match(r1.description, /bad password/, 'description must survive the host sanitizer')
  assert.equal(r2.release, undefined, 'a whitespace-only release must be stored as absent')
  assert.equal(r2.sprint, undefined, 'an empty sprint must be stored as absent')

  // Due dates are stored as calendar days, and junk must not reach the UI.
  const dues = await service.replace({
    workspaceId: 'ws-1',
    items: [
      { id: 'd1', title: 'has due', status: 'todo', priority: 'p2', dueDate: '2025-03-14', createdAt: 8 },
      { id: 'd2', title: 'impossible', status: 'todo', priority: 'p2', dueDate: '2025-02-31', createdAt: 9 },
      { id: 'd3', title: 'garbage', status: 'todo', priority: 'p2', dueDate: 'soon', createdAt: 10 },
    ],
    ifRevision: 4,
  })
  assert.equal(dues.ok, true)
  assert.equal(dues.list.items[0].dueDate, '2025-03-14', 'a valid due date must survive the host sanitizer')
  assert.equal(dues.list.items[1].dueDate, undefined, 'an impossible calendar date must be dropped')
  assert.equal(dues.list.items[2].dueDate, undefined, 'a non-ISO due date must be dropped')

  // Archived state must survive the durable boundary, and a non-numeric marker
  // must not sneak through as a truthy "archived" flag.
  const arch = await service.replace({
    workspaceId: 'ws-1',
    items: [
      { id: 'a', title: 'archived', status: 'done', priority: 'p2', createdAt: 1, completedAt: 2, archivedAt: 3 },
      { id: 'b', title: 'bad marker', status: 'done', priority: 'p2', createdAt: 1, completedAt: 2, archivedAt: 'yes' },
    ],
    ifRevision: 5,
  })
  assert.equal(arch.ok, true)
  assert.equal(arch.list.items[0].archivedAt, 3, 'archivedAt must survive the host sanitizer')
  assert.equal(arch.list.items[1].archivedAt, undefined, 'a non-numeric archivedAt must be dropped')

  // Order is durable: positions are assigned by array index and survive a
  // fresh read from disk (a second service instance against the same dir).
  const service2 = new host.TodoService(new Context())
  service2.ctx.workspaceRegistry = { list: () => workspaces }
  const reread = await service2.list({ workspaceId: 'ws-1' })
  assert.deepEqual(reread.list.items.map((i) => i.id), ['a', 'b'], 'row order must survive a fresh handle')

  // A missing workspace id is a caller bug, not a silent global write.
  await assert.rejects(() => service.list({}), /workspaceId/, 'missing workspaceId must reject')
  await assert.rejects(
    () => service.list({ workspaceId: 'ghost' }),
    /unknown workspace/,
    'an unregistered workspace must reject rather than create a stray db',
  )

  // Handles hold Windows locks - release before the temp dirs can be removed.
  service.close()
  service2.close()
  rmSync(workspaceDir, { recursive: true, force: true })
  rmSync(secondDir, { recursive: true, force: true })
}

// --- the two scan endpoints -------------------------------------------------
// Driven against a REAL temp workspace through the same stub-registry seam as
// the storage tests above, so the workspace resolution and the file handling
// are the shipped ones rather than a re-implementation.
{
  const { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-todo-scan-'))
  const service = new host.TodoService(new Context())
  service.ctx.workspaceRegistry = { list: () => [{ id: 'ws', path: dir }] }
  const resultPath = join(dir, '.dsh', 'suggestions.json')

  // --- scanDigest ----------------------------------------------------------
  writeFileSync(join(dir, 'README.md'), '# Fixture\n\nA workspace to scan.\n')
  writeFileSync(join(dir, 'a.ts'), 'const x = 1\n// TODO: wire the retry\n')
  const scanned = await service.scanDigest({ workspaceId: 'ws' })
  assert.equal(typeof scanned.digest, 'string', 'scanDigest must return digest text')
  assert.equal(typeof scanned.truncated, 'boolean', 'scanDigest must return the truncation flag')
  assert.ok(scanned.digest.includes('a.ts'), 'the digest must name the files it walked')
  assert.ok(scanned.digest.includes('wire the retry'), 'the digest must carry the TODO comments it found')
  // Read-only: a scan must not create the todo database or write a result file.
  assert.ok(!existsSync(resultPath), 'scanDigest must not write a suggestions file')
  await assert.rejects(
    () => service.scanDigest({ workspaceId: 'ghost' }),
    /unknown workspace/,
    'an unregistered workspace must reject rather than scan a stray directory',
  )

  // --- readSuggestions: pending --------------------------------------------
  // No file yet is the ORDINARY case while a scan session works, so it must be
  // a status rather than a throw.
  const pending = await service.readSuggestions({ workspaceId: 'ws' })
  assert.deepEqual(pending, { status: 'pending' }, 'a missing result file must read as pending')

  // --- readSuggestions: ready, and the file is consumed --------------------
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  writeFileSync(resultPath, JSON.stringify([
    { title: 'Add retry', rationale: 'Network calls are unguarded', priority: 'p1', evidence: 'a.ts:2' },
  ]))
  const ready = await service.readSuggestions({ workspaceId: 'ws' })
  assert.equal(ready.status, 'ready', 'a well-formed result must read as ready')
  assert.equal(ready.suggestions.length, 1)
  assert.equal(ready.suggestions[0].title, 'Add retry')
  assert.equal(ready.suggestions[0].evidence, 'a.ts:2')
  assert.equal(ready.error, undefined, 'a ready result must carry no error')
  assert.ok(!existsSync(resultPath), 'a consumed result file must be deleted')
  // Consuming it is what stops a previous run's answers showing while a new
  // scan is still working: the next poll must report pending, not the same list.
  assert.deepEqual(
    await service.readSuggestions({ workspaceId: 'ws' }),
    { status: 'pending' },
    'a second read must not replay the consumed result',
  )

  // --- readSuggestions: error, and the file is consumed ANYWAY -------------
  // This endpoint is POLLED. A malformed result left on disk would be re-read
  // on every tick and pin the modal to the same error forever, with no way out
  // but deleting the file by hand — so the error path must delete too.
  writeFileSync(resultPath, 'not json at all {{{')
  const failed = await service.readSuggestions({ workspaceId: 'ws' })
  assert.equal(failed.status, 'error', 'unusable output must report an error status')
  assert.equal(typeof failed.error, 'string', 'an error status must carry a message')
  assert.ok(failed.error.length > 0, 'the error message must not be empty')
  assert.equal(failed.suggestions, undefined, 'an error result must carry no suggestions')
  assert.ok(!existsSync(resultPath), 'a MALFORMED result file must be deleted too, or the poll pins forever')
  // The recovery this buys: the very next poll is pending again, so a Refresh
  // can actually retry instead of re-reading the same broken file.
  assert.deepEqual(
    await service.readSuggestions({ workspaceId: 'ws' }),
    { status: 'pending' },
    'after a malformed result is consumed the next poll must be pending again',
  )

  // A model that writes a valid but empty array is not an error: it is a scan
  // that found nothing, and the modal says so rather than offering a retry.
  writeFileSync(resultPath, '[]')
  const none = await service.readSuggestions({ workspaceId: 'ws' })
  assert.equal(none.status, 'ready', 'an empty array is a ready result, not an error')
  assert.deepEqual(none.suggestions, [], 'an empty scan must report zero suggestions')

  // --- readSuggestions: a TERMINAL read failure is an error, not pending ----
  // Only ENOENT means "no file yet". Every other errno is permanent: a
  // directory at the path (a bad `mkdir -p`, or a user creating it by hand)
  // yields EISDIR and an EACCES volume yields EACCES, and NEITHER resolves by
  // waiting. Reported as `pending` they would poll forever — the modal spins on
  // "Scanning...", never offers Refresh, and never terminates. So the catch
  // must branch on the code rather than treat every failure as "not yet".
  mkdirSync(resultPath, { recursive: true })
  const blocked = await service.readSuggestions({ workspaceId: 'ws' })
  assert.equal(blocked.status, 'error', 'a directory at the result path must be an error, not pending')
  assert.equal(typeof blocked.error, 'string', 'a terminal read failure must carry a message')
  assert.ok(
    blocked.error.includes('EISDIR'),
    `the message must name the errno so the failure is diagnosable, got: ${blocked.error}`,
  )
  assert.equal(blocked.suggestions, undefined, 'an error result must carry no suggestions')
  rmSync(resultPath, { recursive: true, force: true })

  // ...and the fix must not over-correct: a genuinely ABSENT file is still the
  // ordinary case while a scan session is working, and must stay `pending`.
  assert.deepEqual(
    await service.readSuggestions({ workspaceId: 'ws' }),
    { status: 'pending' },
    'a genuinely absent file must still read as pending, not error',
  )

  // --- both scan endpoints: a MISSING request is a domain error ------------
  // `request?.workspaceId` exists so a call with no argument produces the same
  // clear domain error as an empty id, rather than a TypeError on reading
  // `workspaceId` of undefined. A TypeError crosses the wire as an opaque
  // fault; this message names the parameter the caller got wrong.
  for (const method of ['scanDigest', 'readSuggestions']) {
    await assert.rejects(
      () => service[method](),
      (err) => {
        assert.ok(!(err instanceof TypeError), `${method}() with no request must not throw a TypeError`)
        assert.match(err.message, /workspaceId must be a non-empty string/, `${method}() must name the bad field`)
        return true
      },
      `${method}() with no request must reject with the domain error`,
    )
  }

  service.close()
  rmSync(dir, { recursive: true, force: true })
}

// --- v1 -> v2 schema migration ----------------------------------------------
// CREATE TABLE IF NOT EXISTS does NOT add columns, so a database written by the
// old version must be upgraded in place. Getting this wrong breaks the plugin
// for every existing user, and only for them — which a fresh-install test would
// never catch.
{
  const { mkdtempSync, rmSync, mkdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { DatabaseSync } = await import('node:sqlite')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-todo-v1-'))
  mkdirSync(join(dir, '.dsh'), { recursive: true })

  // Write a genuine v1 database: the old columns, and nothing else.
  const legacy = new DatabaseSync(join(dir, '.dsh', 'todo.db'))
  legacy.exec(`
    CREATE TABLE todo (
      id           TEXT PRIMARY KEY,
      text         TEXT NOT NULL,
      done         INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      completed_at INTEGER,
      archived_at  INTEGER,
      position     INTEGER NOT NULL
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  legacy.prepare('INSERT INTO todo VALUES (?,?,?,?,?,?,?)').run('v1a', 'old open task', 0, 100, null, null, 0)
  legacy.prepare('INSERT INTO todo VALUES (?,?,?,?,?,?,?)').run('v1b', 'old done task', 1, 101, 102, null, 1)
  legacy.prepare("INSERT INTO meta VALUES ('revision', '7')").run()
  legacy.close()

  const svc = new host.TodoService(new Context())
  svc.ctx.workspaceRegistry = { list: () => [{ id: 'w', path: dir }] }
  const read = await svc.list({ workspaceId: 'w' })

  assert.equal(read.list.items.length, 2, 'a v1 database must still read its rows after upgrade')
  const [a, b] = read.list.items
  assert.equal(a.title, 'old open task', 'v1 text must be backfilled into title')
  assert.equal(a.status, 'todo', 'a v1 unfinished row must become status todo')
  assert.equal(a.priority, 'p2', 'a migrated row must get the default priority')
  assert.equal(b.title, 'old done task')
  assert.equal(b.status, 'done', 'v1 done=1 must become status done, not silently reopen')
  assert.equal(b.completedAt, 102, 'the completion stamp must survive migration')
  assert.equal(read.list.revision, 7, 'the revision token must survive migration')

  // And the upgraded database must still accept writes carrying new fields.
  const wrote = await svc.replace({
    workspaceId: 'w',
    items: [{ id: 'v1a', title: 'now with a release', status: 'blocked', priority: 'p1', release: 'v2.0.0', createdAt: 100 }],
    ifRevision: 7,
  })
  assert.equal(wrote.ok, true, 'a migrated database must accept v2 writes')
  assert.equal(wrote.list.items[0].release, 'v2.0.0', 'new fields must persist into a migrated table')
  assert.equal(wrote.list.items[0].status, 'blocked')

  svc.close()
  rmSync(dir, { recursive: true, force: true })
}


// --- v2 -> v3 schema migration (the sessionId column) ------------------------
// Same defect class as v1 -> v2, and same blind spot: it breaks ONLY for users
// who already have a v2 database, so a fresh-install test cannot see it.
{
  const { mkdtempSync, rmSync, mkdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { DatabaseSync } = await import('node:sqlite')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-todo-v2-'))
  mkdirSync(join(dir, '.dsh'), { recursive: true })

  // A genuine v2 table: every v2 column, and deliberately NO session_id.
  const v2 = new DatabaseSync(join(dir, '.dsh', 'todo.db'))
  v2.exec(`
    CREATE TABLE todo (
      id           TEXT PRIMARY KEY,
      text         TEXT NOT NULL,
      done         INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      completed_at INTEGER,
      archived_at  INTEGER,
      position     INTEGER NOT NULL,
      title        TEXT,
      status       TEXT,
      description  TEXT,
      priority     TEXT,
      release      TEXT,
      sprint       TEXT,
      due_date     TEXT
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  v2.prepare('INSERT INTO todo (id, text, done, created_at, position, title, status, priority) VALUES (?,?,?,?,?,?,?,?)')
    .run('v2a', 'pre-session task', 0, 200, 0, 'pre-session task', 'todo', 'p1')
  v2.prepare("INSERT INTO meta VALUES ('revision', '3')").run()
  v2.close()

  const svc = new host.TodoService(new Context())
  svc.ctx.workspaceRegistry = { list: () => [{ id: 'w', path: dir }] }
  const read = await svc.list({ workspaceId: 'w' })
  assert.equal(read.list.items.length, 1, 'a v2 database must still read after the v3 upgrade')
  assert.equal(read.list.items[0].title, 'pre-session task')
  assert.equal(read.list.items[0].sessionId, undefined,
    'a pre-v3 row correctly has no session — the column is backfill-free')

  // The upgraded table must accept and persist the new column.
  const wrote = await svc.replace({
    workspaceId: 'w',
    items: [{ id: 'v2a', title: 'pre-session task', status: 'in-progress', priority: 'p1', sessionId: 'sess-xyz', createdAt: 200 }],
    ifRevision: 3,
  })
  assert.equal(wrote.ok, true, 'a migrated database must accept a v3 write')
  assert.equal(wrote.list.items[0].sessionId, 'sess-xyz',
    'sessionId must persist into a migrated table — missing the ALTER TABLE drops it silently')

  // And it must survive a genuine reopen, not just the in-memory echo.
  svc.close()
  const reopened = new host.TodoService(new Context())
  reopened.ctx.workspaceRegistry = { list: () => [{ id: 'w', path: dir }] }
  const again = await reopened.list({ workspaceId: 'w' })
  assert.equal(again.list.items[0].sessionId, 'sess-xyz', 'sessionId must survive a reopen')
  reopened.close()
  rmSync(dir, { recursive: true, force: true })
}

// --- evaluate the client bundle to reach the exported pure logic ------------
let captured = null
const reactDom = { createPortal: (node) => node }
const react = {
  createElement: () => ({}),
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useSyncExternalStore: (_s, get) => get(),
}
const storage = new Map()
globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      // react-dom is supplied by the shell's module table, exactly as the
    // shipped ui-trajectory / ui-renderer bundles receive it. The modal
    // portals through createPortal, so an absent stub would fail at import.
    captured = {
      id,
      exports: factory((name) =>
        name === 'react' ? react : name === 'react-dom' ? reactDom : {},
      ),
    }
    },
  },
  localStorage: {
    getItem(k) { return storage.has(k) ? storage.get(k) : null },
    setItem(k, v) { storage.set(k, String(v)) },
  },
  addEventListener: () => {},
}
globalThis.document = {
  head: { appendChild: () => {} },
  createElement: () => ({ dataset: {}, textContent: '' }),
}

new Function(client)()
assert.ok(captured, 'client bundle did not call __ModuleLoader__.load')
assert.equal(captured.id, '@dennisrongo/dsh-todo', 'wrong module id')

const m = captured.exports
assert.deepEqual(m.inject, ['slots', 'remote', 'workspaces'], 'client must inject slots, remote, workspaces')
assert.equal(typeof m.apply, 'function', 'client half must export apply()')

// --- the Remote contribution must satisfy the BROWSER's strictness rule ----
//
// This is the regression that silently removed the Todo tab: the host gateway
// accepts `src-json` codecs, but the client's $mount calls
// requireStrictDescriptor() and throws on anything that is not a strict zod
// codec. A throw there means `remote.dshTodo` never exists, so the tab never
// registers — with no error surfaced in the UI at all.
{
  const contribution = m.TODO_REMOTE
  assert.ok(contribution, 'the client bundle must export TODO_REMOTE')
  assert.equal(contribution.package, '@dennisrongo/dsh-todo')
  const methods = contribution.descriptors.map((d) => d.method).sort()
  assert.deepEqual(
    methods,
    ['list', 'readSuggestions', 'replace', 'scanDigest'],
    'contribution must cover every host method',
  )

  // Mirror of dsh's requireStrictCodec.
  const requireStrict = (codec, where) => {
    assert.equal(codec.mode, 'strict', `${where} must use a strict codec, not ${codec.mode}`)
    assert.equal(typeof codec.schema?.parse, 'function', `${where} strict codec needs a parse()`)
    assert.ok(typeof codec.typeSymbol === 'string' && codec.typeSymbol.length > 0,
      `${where} strict codec needs a non-empty typeSymbol`)
  }
  for (const d of contribution.descriptors) {
    assert.equal(d.namespace, 'dshTodo', 'wrong remote namespace')
    assert.equal(d.service, 'dshTodo', 'wrong host service key')
    assert.equal(d.invocation.kind, 'direct')
    requireStrict(d.result, `${d.method} result`)
    assert.equal(d.parameters.length, 1, `${d.method} must take exactly one request parameter`)
    const [p] = d.parameters
    // Must equal the host method's parameter name; the host resolves this
    // endpoint by reading parameter names off the function source.
    assert.equal(p.wire, 'request', `${d.method} wire field must be "request"`)
    assert.equal(p.source, 'json')
    requireStrict(p.codec, `${d.method} parameter`)
  }

  // The schemas must actually accept the shapes both sides exchange.
  const listDesc = contribution.descriptors.find((d) => d.method === 'list')
  listDesc.parameters[0].codec.schema.parse({ workspaceId: 'w1' })
  listDesc.result.schema.parse({ list: { items: [], revision: 0, updatedAt: 0 } })

  const replaceDesc = contribution.descriptors.find((d) => d.method === 'replace')
  replaceDesc.parameters[0].codec.schema.parse({ workspaceId: 'w1', items: [], ifRevision: null })
  replaceDesc.parameters[0].codec.schema.parse({
    workspaceId: 'w1',
    items: [{ id: 'a', title: 't', status: 'done', priority: 'p2', createdAt: 1, completedAt: 2 }],
    ifRevision: 3,
  })
  // Strict codecs STRIP fields the schema does not name, and do it silently, so
  // every field has to be proven across both directions of the wire or it would
  // simply never reach the host.
  const full = {
    id: 'a', title: 't', description: 'why', status: 'in-progress', priority: 'p0',
    release: 'v1.2.0', sprint: 'Sprint 24', dueDate: '2025-03-14',
    createdAt: 1, completedAt: 2, archivedAt: 4,
  }
  const sent = replaceDesc.parameters[0].codec.schema.parse({
    workspaceId: 'w1', items: [full], ifRevision: 3,
  })
  for (const key of Object.keys(full)) {
    assert.equal(sent.items[0][key], full[key], key + ' must survive the request codec')
  }
  const back = replaceDesc.result.schema.parse({
    ok: true, list: { items: [full], revision: 1, updatedAt: 1 },
  })
  for (const key of Object.keys(full)) {
    assert.equal(back.list.items[0][key], full[key], key + ' must survive the result codec')
  }
  // An unknown status must be REJECTED at the wire, not silently coerced: the
  // codec is a contract check, unlike the tolerant parser used on stored data.
  assert.throws(
    () => replaceDesc.parameters[0].codec.schema.parse({
      workspaceId: 'w1',
      items: [{ id: 'a', title: 't', status: 'nope', priority: 'p2', createdAt: 1 }],
      ifRevision: 3,
    }),
    'an invalid status must not pass the wire codec',
  )
  replaceDesc.result.schema.parse({ ok: true, list: { items: [], revision: 1, updatedAt: 1 } })
  replaceDesc.result.schema.parse({
    ok: false,
    code: 'revision-conflict',
    list: { items: [], revision: 9, updatedAt: 2 },
  })

  // --- the two scan endpoints, on the same terms ---------------------------
  const digestDesc = contribution.descriptors.find((d) => d.method === 'scanDigest')
  digestDesc.parameters[0].codec.schema.parse({ workspaceId: 'w1' })
  // Both fields must survive: a digest that arrives without `truncated` reads
  // as a complete scan of the workspace, which is the exact false claim the
  // flag exists to prevent.
  const digestBack = digestDesc.result.schema.parse({ digest: 'D', truncated: true })
  assert.equal(digestBack.digest, 'D', 'digest must survive the result codec')
  assert.equal(digestBack.truncated, true, 'truncated must survive the result codec')
  assert.throws(
    () => digestDesc.result.schema.parse({ digest: 'D' }),
    'truncated is not optional — a missing flag must be refused, not defaulted',
  )

  const readDesc = contribution.descriptors.find((d) => d.method === 'readSuggestions')
  readDesc.parameters[0].codec.schema.parse({ workspaceId: 'w1' })
  // The ordinary poll: no file yet, and no suggestions key at all.
  assert.equal(readDesc.result.schema.parse({ status: 'pending' }).status, 'pending')
  // A parse failure travels as a MESSAGE, so `error` must be named or the modal
  // would render an error state with nothing in it.
  const errBack = readDesc.result.schema.parse({ status: 'error', error: 'bad json' })
  assert.equal(errBack.error, 'bad json', 'error must survive the result codec')
  // Every Suggestion field has to be proven, for the same reason each TodoItem
  // field is above: a strict codec drops what it does not name, in silence.
  const suggestion = {
    title: 'Add retry', rationale: 'Network calls are unguarded',
    priority: 'p1', evidence: 'src/a.ts:12',
  }
  const readyBack = readDesc.result.schema.parse({ status: 'ready', suggestions: [suggestion] })
  for (const key of Object.keys(suggestion)) {
    assert.equal(readyBack.suggestions[0][key], suggestion[key], key + ' must survive the result codec')
  }
  // `evidence` is genuinely optional — a missing feature has no line number —
  // so a suggestion without it must still pass rather than fail the whole read.
  readDesc.result.schema.parse({
    status: 'ready',
    suggestions: [{ title: 't', rationale: 'r', priority: 'p2' }],
  })
  assert.throws(
    () => readDesc.result.schema.parse({ status: 'nope' }),
    'an unknown status must not pass the wire codec',
  )
  assert.throws(
    () => readDesc.result.schema.parse({
      status: 'ready',
      suggestions: [{ title: 't', rationale: 'r', priority: 'urgent' }],
    }),
    'an invalid priority must not pass the wire codec',
  )
}

// computeStats
assert.deepEqual(m.computeStats([]),
  { total: 0, done: 0, open: 0, percent: 0, archived: 0, inProgress: 0, blocked: 0 })
const sample = [
  { id: 'a', title: 'one', status: 'done', priority: 'p2', createdAt: 1 },
  { id: 'b', title: 'two', status: 'todo', priority: 'p2', createdAt: 2 },
  { id: 'c', title: 'three', status: 'todo', priority: 'p2', createdAt: 3 },
]
assert.deepEqual(m.computeStats(sample),
  { total: 3, done: 1, open: 2, percent: 33, archived: 0, inProgress: 0, blocked: 0 })

// The two states a boolean `done` could never express are counted separately,
// because they are what a standup actually asks about.
{
  const board = [
    { id: 'a', title: 'a', status: 'in-progress', priority: 'p2', createdAt: 1 },
    { id: 'b', title: 'b', status: 'blocked', priority: 'p2', createdAt: 2 },
    { id: 'c', title: 'c', status: 'backlog', priority: 'p2', createdAt: 3 },
  ]
  const st = m.computeStats(board)
  assert.equal(st.inProgress, 1, 'in-progress work must be counted')
  assert.equal(st.blocked, 1, 'blocked work must be counted')
  assert.equal(st.open, 3, 'everything unfinished counts as open')
  assert.equal(st.done, 0)
}

// nextOpen
assert.equal(m.nextOpen(sample).id, 'b', 'nextOpen returns the first unfinished item')
assert.equal(m.nextOpen([{ id: 'x', title: 'x', status: 'done', priority: 'p2', createdAt: 0 }]), undefined)

// normalizeText
assert.equal(m.normalizeText('  hello   world  '), 'hello world')
assert.equal(m.normalizeText('\n\t '), '')
assert.equal(m.normalizeText('x'.repeat(900)).length, 500, 'text is capped at 500 chars')

// makeItem — deterministic with injected now/rand
const made = m.makeItem('write tests', 1700000000000, () => 0.5)
assert.equal(made.title, 'write tests')
assert.equal(made.status, 'todo', 'a new task starts as todo, not backlog')
assert.equal(made.priority, 'p2', 'a new task starts at the default priority')
assert.equal(m.isDone(made), false)
assert.equal(made.createdAt, 1700000000000)
assert.ok(typeof made.id === 'string' && made.id.length > 1, 'item id must be a string')
// Optional fields must be ABSENT rather than present-and-undefined, so "unset"
// has one representation across the wire and the database.
assert.ok(!('release' in made), 'a new task carries no release key')
assert.ok(!('description' in made), 'a new task carries no description key')
const seeded = m.makeItem('seeded', 1, () => 0.5, { status: 'backlog', priority: 'p0', release: ' v9 ' })
assert.equal(seeded.status, 'backlog')
assert.equal(seeded.priority, 'p0')
assert.equal(seeded.release, 'v9', 'a seeded label is normalized')

// toggleItem — still the checkbox's action, now expressed as a status change
const toggled = m.toggleItem(sample, 'b', 555)
assert.equal(toggled[1].status, 'done')
assert.equal(toggled[1].completedAt, 555, 'completedAt is stamped on completion')
assert.equal(m.toggleItem(toggled, 'b')[1].completedAt, undefined, 'completedAt clears on un-toggle')
assert.equal(m.toggleItem(toggled, 'b')[1].status, 'todo', 'un-checking returns a task to todo')
assert.equal(toggled[0].status, 'done', 'other items are untouched')
assert.notEqual(toggled, sample, 'toggleItem must not mutate its input')

// setStatus — the single write path for workflow state
{
  const prog = m.setStatus(sample, 'b', 'in-progress')
  assert.equal(prog[1].status, 'in-progress')
  assert.equal(prog[1].completedAt, undefined, 'moving to in-progress must not stamp completion')
  const fin = m.setStatus(prog, 'b', 'done', 900)
  assert.equal(fin[1].completedAt, 900, 'reaching done stamps the completion time')
  const back = m.setStatus(fin, 'b', 'blocked')
  assert.ok(!('completedAt' in back[1]), 'leaving done must clear the completion stamp, not keep a lie')
  assert.equal(m.setStatus(sample, 'b', 'todo'), sample, 'setting the status it already has is a no-op')
  assert.equal(m.setStatus(sample, 'nope', 'done'), sample, 'unknown id is a no-op')
}

// setPriority / updateItem
{
  const p = m.setPriority(sample, 'b', 'p0')
  assert.equal(p[1].priority, 'p0')
  assert.equal(m.setPriority(p, 'b', 'p0'), p, 'setting the same priority is a no-op')

  const u = m.updateItem(sample, 'b', { title: 'renamed', release: 'v1.0.0', description: 'why' })
  assert.equal(u[1].title, 'renamed')
  assert.equal(u[1].release, 'v1.0.0')
  assert.equal(u[1].description, 'why')
  // Clearing a label must remove the key entirely, so "no release" is one value.
  const cleared = m.updateItem(u, 'b', { release: '  ', description: '' })
  assert.ok(!('release' in cleared[1]), 'a blank release clears the key')
  assert.ok(!('description' in cleared[1]), 'a blank description clears the key')
}

// moveItem
assert.deepEqual(m.moveItem(sample, 'c', -1).map((i) => i.id), ['a', 'c', 'b'])
assert.deepEqual(m.moveItem(sample, 'a', -1).map((i) => i.id), ['a', 'b', 'c'], 'move above top is a no-op')
assert.deepEqual(m.moveItem(sample, 'c', 1).map((i) => i.id), ['a', 'b', 'c'], 'move below bottom is a no-op')
assert.deepEqual(m.moveItem(sample, 'nope', 1).map((i) => i.id), ['a', 'b', 'c'], 'unknown id is a no-op')

// clearCompleted
assert.deepEqual(m.clearCompleted(sample).map((i) => i.id), ['b', 'c'])

// filterItems — the view's filter ring
assert.deepEqual(m.filterItems(sample, 'all').map((i) => i.id), ['a', 'b', 'c'])
assert.deepEqual(m.filterItems(sample, 'open').map((i) => i.id), ['b', 'c'])
assert.deepEqual(m.filterItems(sample, 'done').map((i) => i.id), ['a'])
assert.deepEqual(m.filterItems(sample, 'bogus').map((i) => i.id), ['a', 'b', 'c'], 'unknown filter falls back to all')
assert.deepEqual(m.filterItems([], 'open'), [])

// Every status is directly selectable in the ring.
{
  const board = [
    { id: 'a', title: 'a', status: 'in-progress', priority: 'p2', createdAt: 1 },
    { id: 'b', title: 'b', status: 'blocked', priority: 'p2', createdAt: 2 },
    { id: 'c', title: 'c', status: 'backlog', priority: 'p2', createdAt: 3 },
  ]
  assert.deepEqual(m.filterItems(board, 'in-progress').map((i) => i.id), ['a'])
  assert.deepEqual(m.filterItems(board, 'blocked').map((i) => i.id), ['b'])
  assert.deepEqual(m.filterItems(board, 'backlog').map((i) => i.id), ['c'])
  assert.deepEqual(m.filterItems(board, 'open').map((i) => i.id), ['a', 'b', 'c'],
    'open means everything unfinished, whatever stage it is at')
}

// --- grouping ---------------------------------------------------------------
// Sections are ordered by MEANING, not alphabetically: a board that sorted
// "In Progress" under "Backlog" would misrepresent the sprint.
{
  const roadmap = [
    { id: 'a', title: 'a', status: 'done', priority: 'p1', release: 'v1.0.0', sprint: 'Sprint 1', createdAt: 1 },
    { id: 'b', title: 'b', status: 'in-progress', priority: 'p0', release: 'v1.1.0', createdAt: 2 },
    { id: 'c', title: 'c', status: 'todo', priority: 'p0', release: 'v1.0.0', createdAt: 3 },
    { id: 'd', title: 'd', status: 'backlog', priority: 'p3', createdAt: 4 },
  ]

  assert.deepEqual(m.groupItems(roadmap, 'none').map((g) => g.items.length), [4],
    'grouping by none yields one flat section')

  const byStatus = m.groupItems(roadmap, 'status')
  assert.deepEqual(byStatus.map((g) => g.key), ['backlog', 'todo', 'in-progress', 'done'],
    'status groups follow board order, and empty ones are omitted')

  const byPriority = m.groupItems(roadmap, 'priority')
  assert.deepEqual(byPriority.map((g) => g.key), ['p0', 'p1', 'p3'], 'priority groups run most urgent first')
  assert.equal(byPriority[0].items.length, 2)

  // Releases sort newest-first, with Unassigned pinned last however it collates.
  const byRelease = m.groupItems(roadmap, 'release')
  assert.deepEqual(byRelease.map((g) => g.key), ['v1.1.0', 'v1.0.0', m.UNASSIGNED],
    'releases sort newest first with Unassigned last')
  assert.deepEqual(byRelease[1].items.map((i) => i.id), ['a', 'c'])

  const bySprint = m.groupItems(roadmap, 'sprint')
  assert.deepEqual(bySprint.map((g) => g.key), ['Sprint 1', m.UNASSIGNED])

  // Release and sprint are independent axes: one task can sit in both.
  assert.equal(roadmap[0].release, 'v1.0.0')
  assert.equal(roadmap[0].sprint, 'Sprint 1')

  // knownLabels drives the datalist suggestions that keep labels convergent.
  assert.deepEqual(m.knownLabels(roadmap, 'release'), ['v1.1.0', 'v1.0.0'])
  assert.deepEqual(m.knownLabels(roadmap, 'sprint'), ['Sprint 1'])
  assert.deepEqual(m.knownLabels([], 'release'), [])
}

// Releases sort by VERSION semantics — segment by segment — so 1.10 outranks
// 1.9, and a patch release sits between its own minor and the next one.
{
  const dec = [
    { id: 'a', title: 'a', status: 'todo', priority: 'p2', release: '1.10', createdAt: 1 },
    { id: 'b', title: 'b', status: 'todo', priority: 'p2', release: '1.9', createdAt: 2 },
    { id: 'c', title: 'c', status: 'todo', priority: 'p2', release: '0.5.1', createdAt: 3 },
    { id: 'd', title: 'd', status: 'todo', priority: 'p2', release: '0.5', createdAt: 4 },
  ]
  assert.deepEqual(m.groupItems(dec, 'release').map((g) => g.key), ['1.10', '1.9', '0.5.1', '0.5'],
    'releases sort segment-wise, newest first — 1.10 above 1.9, 0.5.1 above 0.5')
  assert.deepEqual(m.knownLabels(dec, 'release'), ['1.10', '1.9', '0.5.1', '0.5'])
}

// --- decimal input filtering --------------------------------------------------
// The release/sprint inputs admit only the characters a decimal label can
// contain — digits and one-dot material — so invalid text can never be typed
// or pasted in. Whether the result is a VALID label (at most one dot) stays
// the blur gate's job.
{
  assert.equal(m.sanitizeDecimalInput('v1.5'), '1.5')
  assert.equal(m.sanitizeDecimalInput('Sprint 24'), '24')
  assert.equal(m.sanitizeDecimalInput('abc'), '')
  assert.equal(m.sanitizeDecimalInput('1 5'), '15')
  assert.equal(m.sanitizeDecimalInput('1.2.3.4'), '1.2.3.4',
    'segment COUNT is a validity problem, not a character problem — blur decides')
}

// --- numeric label gate -------------------------------------------------------
// The gate decides whether a typed edit may commit, mirroring the CLI's
// "refused, never dropped" rule — and it is FIELD-AWARE: a release carries a
// patch segment (0.5.1), a sprint is a single decimal.
{
  for (const field of ['release', 'sprint']) {
    assert.equal(m.isCommittableLabel('1.5', field), true)
    assert.equal(m.isCommittableLabel('24', field), true)
    assert.equal(m.isCommittableLabel(' 1.5 ', field), true, 'surrounding whitespace is normalized')
    assert.equal(m.isCommittableLabel('', field), true, 'an empty edit clears the field')
    assert.equal(m.isCommittableLabel('   ', field), true, 'a whitespace-only edit clears the field')
    assert.equal(m.isCommittableLabel('v1.5', field), false)
    assert.equal(m.isCommittableLabel('Sprint 24', field), false)
    assert.equal(m.isCommittableLabel('beta', field), false)
    assert.equal(m.isCommittableLabel('1.', field), false, 'a trailing dot is not a number')
    assert.equal(m.isCommittableLabel('1.2.3.4', field), false, 'three segments at most')
  }
  assert.equal(m.isCommittableLabel('0.5.1', 'release'), true, 'a patch release is valid')
  assert.equal(m.isCommittableLabel('0.5.1', 'sprint'), false, 'a sprint is a single decimal')
}

// A refused label edit must SAY so: silently reverting reads as the field being
// broken. labelError() drives the inline message both editors render, and the
// two fields say different things because their rules differ.
{
  assert.equal(m.labelError('1.5', 'release'), undefined)
  assert.equal(m.labelError('0.5.1', 'release'), undefined)
  assert.equal(m.labelError('', 'release'), undefined, 'empty clears — not an error')
  assert.match(m.labelError('1.2.3.4', 'release'), /version/, 'too many segments is an error')
  assert.match(m.labelError('1.', 'release'), /version/)
  assert.equal(m.labelError('1.5', 'sprint'), undefined)
  assert.match(m.labelError('0.5.1', 'sprint'), /decimal/, 'a sprint takes no patch segment')
  assert.ok(typeof m.RELEASE_ERROR === 'string' && m.RELEASE_ERROR.length > 0)
  assert.ok(typeof m.SPRINT_ERROR === 'string' && m.SPRINT_ERROR.length > 0)
}

// The error UI must actually ship in the bundle.
{
  const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')
  assert.ok(bundle.includes('dshtd-label-err'), 'the label error styles must ship')
  assert.ok(bundle.includes('aria-invalid'), 'a refused label must mark its input aria-invalid')
}

// --- archive ----------------------------------------------------------------
// Archiving is the safe alternative to deleting: the item stays in the record
// but leaves every active view.
{
  const archived = m.archiveItem(sample, 'a', 4242)
  assert.equal(archived[0].archivedAt, 4242, 'archiveItem stamps when it happened')
  assert.notEqual(archived, sample, 'archiveItem must not mutate its input')
  assert.equal(m.isArchived(archived[0]), true)
  assert.equal(m.isArchived(sample[0]), false, 'the original item is untouched')

  // Idempotent: re-archiving must not re-stamp and reshuffle the archive order.
  const again = m.archiveItem(archived, 'a', 9999)
  assert.equal(again, archived, 're-archiving is a no-op that preserves identity')
  assert.equal(again[0].archivedAt, 4242, 'the original archive date survives')
  assert.equal(m.archiveItem(sample, 'nope', 1), sample, 'unknown id is a no-op')

  // Archived items disappear from All / Open / Done but are reachable via Archive.
  assert.deepEqual(m.filterItems(archived, 'all').map((i) => i.id), ['b', 'c'],
    'archived items must not appear in the All view')
  assert.deepEqual(m.filterItems(archived, 'done').map((i) => i.id), [],
    'an archived completed item must leave the Done view')
  assert.deepEqual(m.filterItems(archived, 'archived').map((i) => i.id), ['a'])
  assert.deepEqual(m.activeItems(archived).map((i) => i.id), ['b', 'c'])

  // Stats treat the archive as out of scope, so tidying up cannot dent progress.
  assert.deepEqual(m.computeStats(archived),
    { total: 2, done: 0, open: 2, percent: 0, archived: 1, inProgress: 0, blocked: 0 })
  assert.equal(m.computeStats(sample).archived, 0, 'an unarchived list reports zero archived')

  // nextOpen must never point at archived work.
  const archivedOpen = m.archiveItem(sample, 'b', 5)
  assert.equal(m.nextOpen(archivedOpen).id, 'c', 'nextOpen skips archived items')

  // Restore puts it back and removes the marker entirely.
  const restored = m.restoreItem(archived, 'a')
  assert.equal(m.isArchived(restored[0]), false, 'restoreItem clears the archived state')
  assert.ok(!('archivedAt' in restored[0]), 'restore must delete the key, not set it undefined')
  assert.deepEqual(m.filterItems(restored, 'all').map((i) => i.id), ['a', 'b', 'c'])
  assert.equal(m.restoreItem(sample, 'a'), sample, 'restoring a non-archived item is a no-op')

  // The bulk action archives exactly the completed items.
  const bulk = m.archiveCompleted(sample, 77)
  assert.deepEqual(bulk.filter(m.isArchived).map((i) => i.id), ['a'], 'only completed items are archived')
  assert.equal(bulk[0].archivedAt, 77)
  assert.deepEqual(m.filterItems(bulk, 'all').map((i) => i.id), ['b', 'c'])
  assert.equal(m.archiveCompleted(bulk, 88), bulk, 'archiving twice is a no-op')
  assert.equal(
    m.archiveCompleted([{ id: 'o', title: 'open', status: 'todo', priority: 'p2', createdAt: 1 }], 1).length,
    1,
  )

  // Archiving preserves data, unlike clearCompleted which destroys it.
  assert.equal(bulk.length, 3, 'archiveCompleted must keep every item in the record')
  assert.equal(m.clearCompleted(sample).length, 2, 'clearCompleted still deletes outright')

  // clearArchived is the one destructive bulk action.
  assert.deepEqual(m.clearArchived(bulk).map((i) => i.id), ['b', 'c'])
  assert.equal(m.clearArchived(sample), sample, 'nothing archived means nothing to delete')

  // Archived items sort newest-first so the Archive view reads as a log.
  const log = m.archiveCompleted(
    [
      { id: 'p', title: 'p', status: 'done', priority: 'p2', createdAt: 1, archivedAt: 10 },
      { id: 'q', title: 'q', status: 'done', priority: 'p2', createdAt: 2, archivedAt: 30 },
      { id: 'r', title: 'r', status: 'done', priority: 'p2', createdAt: 3, archivedAt: 20 },
    ],
    0,
  )
  assert.deepEqual(m.archivedItems(log).map((i) => i.id), ['q', 'r', 'p'], 'newest archive first')

  // Reordering happens in active-list space, so a hidden archived entry between
  // two visible ones cannot swallow a move.
  const mixed = [
    { id: 'a', title: 'a', status: 'todo', priority: 'p2', createdAt: 1 },
    { id: 'h', title: 'hidden', status: 'done', priority: 'p2', createdAt: 2, archivedAt: 5 },
    { id: 'b', title: 'b', status: 'todo', priority: 'p2', createdAt: 3 },
  ]
  const moved = m.moveItem(mixed, 'b', -1)
  assert.deepEqual(m.activeItems(moved).map((i) => i.id), ['b', 'a'], 'move skips over archived rows')
  assert.deepEqual(moved.map((i) => i.id), ['b', 'h', 'a'], 'archived rows keep their slot')
  assert.equal(m.moveItem(mixed, 'a', -1), mixed, 'move above the active top is a no-op')
  assert.equal(m.moveItem(mixed, 'b', 1), mixed, 'move below the active bottom is a no-op')
  assert.equal(m.moveItem(mixed, 'h', 1), mixed, 'an archived item cannot be reordered')
}

// coerceItems must carry archivedAt across the parse boundary, or archiving
// would silently not survive a reload.
{
  const round = m.parseItems(JSON.stringify([
    { id: 'a', title: 'hi', status: 'done', priority: 'p2', createdAt: 7, completedAt: 9, archivedAt: 11 },
  ]))
  assert.equal(round[0].archivedAt, 11, 'archivedAt must survive parseItems')
  const junk = m.parseItems('[{"id":"a","title":"hi","archivedAt":"soon"}]')
  assert.equal(junk[0].archivedAt, undefined, 'a non-numeric archivedAt must not mark an item archived')
  assert.equal(m.isArchived(junk[0]), false)

  // A list written by the OLD version must survive the upgrade rather than
  // being discarded as malformed — this is the client-side half of the v1 path.
  const v1 = m.parseItems(JSON.stringify([
    { id: 'a', text: 'legacy open', done: false, createdAt: 1 },
    { id: 'b', text: 'legacy done', done: true, createdAt: 2, completedAt: 3 },
  ]))
  assert.equal(v1.length, 2, 'v1 items must not be dropped by the parser')
  assert.equal(v1[0].title, 'legacy open', 'v1 text is read as the title')
  assert.equal(v1[0].status, 'todo', 'a v1 unfinished item becomes todo')
  assert.equal(v1[1].status, 'done', 'a v1 done item stays done')
  assert.equal(v1[1].priority, 'p2', 'a v1 item gets the default priority')

  // Roadmap fields must survive the parse boundary or they would vanish on reload.
  const rich = m.parseItems(JSON.stringify([
    { id: 'r', title: 't', status: 'blocked', priority: 'p0', release: 'v2.0.0', sprint: 'Sprint 9',
      description: 'details', createdAt: 1 },
  ]))
  assert.equal(rich[0].status, 'blocked')
  assert.equal(rich[0].priority, 'p0')
  assert.equal(rich[0].release, 'v2.0.0')
  assert.equal(rich[0].sprint, 'Sprint 9')
  assert.equal(rich[0].description, 'details')
  // Junk enums decay to the defaults rather than reaching the UI.
  const bad = m.parseItems('[{"id":"a","title":"t","status":"wat","priority":"p9"}]')
  assert.equal(bad[0].status, 'todo', 'an unknown status decays to the default')
  assert.equal(bad[0].priority, 'p2', 'an unknown priority decays to the default')
}

// parseItems — defensive against junk
assert.deepEqual(m.parseItems(null), [])
assert.deepEqual(m.parseItems('not json'), [])
assert.deepEqual(m.parseItems('{"a":1}'), [], 'non-array JSON yields an empty list')
assert.deepEqual(m.parseItems('[1,null,"x",{"id":"a"}]'), [], 'malformed entries are dropped')
const parsed = m.parseItems(JSON.stringify([
  { id: 'a', title: 'hi', status: 'done', priority: 'p2', createdAt: 7, completedAt: 9 },
]))
// coerceItems normalizes the optional stamps to an explicit undefined, exactly
// as it already did for completedAt.
assert.deepEqual(parsed, [
  {
    id: 'a', title: 'hi', status: 'done', priority: 'p2', createdAt: 7,
    completedAt: 9, archivedAt: undefined, description: undefined,
    release: undefined, sprint: undefined, dueDate: undefined,
    sessionId: undefined,
  },
])
assert.equal(m.isDone(m.parseItems('[{"id":"a","title":"hi"}]')[0]), false, 'a missing status is not done')


// --- due dates --------------------------------------------------------------
// Dates are calendar days (YYYY-MM-DD), not instants: an epoch would bind the
// due date to a timezone and let the same task read as two different days.
{
  assert.equal(m.today(new Date(2025, 2, 14)), '2025-03-14', 'today() uses the viewer local day')

  const due = (d, status) => ({ id: 'x', title: 't', status: status ?? 'todo', priority: 'p2', createdAt: 1, dueDate: d })
  assert.equal(m.isOverdue(due('2025-03-13'), '2025-03-14'), true, 'a past due date is overdue')
  assert.equal(m.isOverdue(due('2025-03-14'), '2025-03-14'), false, 'due today is not yet overdue')
  assert.equal(m.isOverdue(due('2025-03-15'), '2025-03-14'), false, 'a future due date is not overdue')
  // Shipping late does not leave a task pending.
  assert.equal(m.isOverdue(due('2025-03-13', 'done'), '2025-03-14'), false, 'a finished task is never overdue')
  assert.equal(m.isOverdue({ id: 'y', title: 't', status: 'todo', priority: 'p2', createdAt: 1 }, '2025-03-14'), false,
    'a task with no due date is never overdue')
  assert.equal(m.isDueToday(due('2025-03-14'), '2025-03-14'), true)
  assert.equal(m.isDueToday(due('2025-03-15'), '2025-03-14'), false)

  assert.equal(m.fmtDue('2025-03-14', '2025-03-14'), 'Today')
  assert.equal(m.fmtDue('2025-03-15', '2025-03-14'), 'Tomorrow')
  assert.equal(m.fmtDue('2025-03-20', '2025-03-14'), 'Mar 20')
  // Month rollover must not produce 'Tomorrow' for the wrong day.
  assert.equal(m.fmtDue('2025-04-01', '2025-03-31'), 'Tomorrow', 'tomorrow works across a month boundary')

  // updateItem accepts and clears the date, and rejects impossible ones.
  const list = [{ id: 'a', title: 'a', status: 'todo', priority: 'p2', createdAt: 1 }]
  const set = m.updateItem(list, 'a', { dueDate: '2025-03-14' })
  assert.equal(set[0].dueDate, '2025-03-14')
  assert.ok(!('dueDate' in m.updateItem(set, 'a', { dueDate: '' })[0]), 'a blank due date clears the key')
  // Feb 31 would be silently rolled to Mar 3 by Date; it must be refused.
  assert.ok(!('dueDate' in m.updateItem(list, 'a', { dueDate: '2025-02-31' })[0]),
    'an impossible calendar date must be rejected, not rolled forward')
  assert.ok(!('dueDate' in m.updateItem(list, 'a', { dueDate: '14/03/2025' })[0]), 'a non-ISO date is rejected')

  // And it must survive the parse boundary.
  const parsedDue = m.parseItems('[{"id":"a","title":"t","dueDate":"2025-03-14"}]')
  assert.equal(parsedDue[0].dueDate, '2025-03-14', 'dueDate must survive parseItems')
  const badDue = m.parseItems('[{"id":"a","title":"t","dueDate":"nope"}]')
  assert.equal(badDue[0].dueDate, undefined, 'a malformed dueDate must not reach the UI')
}

// --- the task modal ---------------------------------------------------------
// It portals to document.body because the list is an overflow-y: auto scroll
// container: rendered in place it would be clipped by its own scroller.
{
  assert.equal(typeof m.TodoModal, 'function', 'the client must export TodoModal')
  const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')
  assert.ok(bundle.includes('createPortal'), 'the modal must portal out of the scroll container')
  assert.ok(bundle.includes('require("react-dom")'),
    'react-dom must stay EXTERNAL — bundling a copy would fight the shell React')
  assert.ok(bundle.includes('aria-modal'), 'the dialog must be marked aria-modal for assistive tech')
  assert.ok(bundle.includes('dshtd-modal-backdrop'), 'the modal backdrop class must ship')
  // The desktop drag strip sits at 2147483644 and swallows clicks; the panel
  // must stay below it and clear the 36px band with padding instead.
  assert.ok(bundle.includes('2147483100'), 'the modal must sit below the desktop drag strip')
}

// --- dropdown dark mode -----------------------------------------------------
// A select's popup is painted by the OS OUTSIDE the page, so no descendant CSS
// reaches it: it obeys color-scheme alone.
//
// This block used to assert the OPPOSITE, and was pinning a bug. It required
// `@media (prefers-color-scheme: dark)`, on the premise that the shell "never
// sets a color-scheme to inherit from". ui-layout's ThemePresenter does set
// `documentElement.style.colorScheme` from the resolved theme, and it inherits
// — so the plugin needed nothing, and keying off the OS actively broke the
// case the old comment worried about: a LIGHT theme on a dark-mode machine got
// dark popups. The assertions now pin the corrected behaviour.
{
  const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')
  // The construct, not the word: the shipped CSS must contain no media query
  // on the OS preference. (Prose mentioning it survives into the bundle.)
  assert.ok(!/@media[^{]*prefers-color-scheme/.test(bundle),
    'the OS colour preference must not decide the palette — the app theme does')
  // Option rows still need an explicit pair on platforms that paint them, but
  // gated on the attribute ThemePresenter actually toggles.
  assert.ok(/body\[data-ds-dark-theme\][^{]*\.dshtd-select option/.test(bundle.replace(/\s+/g, ' ')),
    'option rows must follow body[data-ds-dark-theme], not the OS query')
}


// --- the modal's confirm action is the shell's button ------------------------
// It used to be a link-styled button, which read as a bespoke control next to
// dsh's own. Both tokens below follow the active theme AND the accent axis, so
// the button is themed rather than merely dark-coloured.
{
  const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')
  assert.ok(bundle.includes('dshtd-btn primary'),
    "the modal's Done must be a real button, not a link")
  assert.ok(/\.dshtd-btn\.primary[^}]*--dsw-alias-button-primary-fill/.test(bundle.replace(/\s+/g, ' ')),
    'the primary variant must use the shell fill token, not a colour of its own')
  assert.ok(!/className="dshtd-link" onClick=\{close\}/.test(bundle),
    'the old link-styled Done must be gone')
}

// --- destructive actions are guarded ----------------------------------------
// Delete is the only irreversible action in the tab. Every path to it must go
// through the confirm dialog — a call site that filters the list inline would
// silently bypass the guard, which is exactly the regression to catch.
{
  const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')
  assert.equal(typeof m.ConfirmDialog, 'function', 'the client must export ConfirmDialog')
  assert.ok(bundle.includes('dshtd-confirm'), 'the confirm dialog styles must ship')
  // alertdialog, not dialog: this interrupts to demand a decision.
  assert.ok(bundle.includes('alertdialog'), 'a destructive prompt must be role=alertdialog')
  // window.confirm was the old guard for the bulk action; it must be gone, or
  // two different confirmation UIs would ship side by side.
  assert.ok(!bundle.includes('window.confirm'), 'window.confirm must be replaced by the in-app dialog')
  assert.ok(!/function confirmDelete/.test(bundle), 'the old confirmDelete helper must be removed')
  // The dialog must name what it is about to destroy — a prompt that does not
  // quote the subject is one people learn to click through.
  assert.ok(bundle.includes('dshtd-confirm-subject'), 'the dialog must quote the subject')
  assert.ok(bundle.includes('Delete task') && bundle.includes('Delete archived tasks'),
    'both the single and bulk delete prompts must ship')
}

// --- the modal's save vs dismiss split ---------------------------------------
// Asserted on the SOURCE: these are wiring decisions, and minification renames
// the handlers a bundle-level regex would look for.
{
  const source = readFileSync(join(root, 'src/client.tsx'), 'utf8')
  // Done is the SAVE button: it is the only control that refuses to proceed
  // while a label is invalid.
  assert.match(source, /onClick=\{save\}[\s\S]{0,80}Done/, 'the Done button must call save()')
  // Dismissing must always be possible — a dialog you cannot leave because a
  // field is half-typed is a trap. Backdrop, Escape and the X discard instead.
  assert.match(source, /className="dshtd-modal-backdrop" onClick=\{dismiss\}/,
    'a backdrop click must dismiss, not save')
  assert.ok(!/onClick=\{close\}/.test(source), 'no control may call the old blocking close()')
  assert.match(source, /const dismiss = React\.useCallback/, 'dismiss() must exist')
  assert.match(source, /const save = React\.useCallback/, 'save() must exist')
}
// Every delete path routes through the confirm dialog. Asserted on the SOURCE
// rather than the minified bundle: minification renames the callback parameter,
// so a bundle-level regex silently matches nothing and passes vacuously.
{
  const source = readFileSync(join(root, 'src/client.tsx'), 'utf8')
  // A task may be removed in exactly ONE place, and that place must be a
  // confirm handler. Any other occurrence is a button deleting behind the guard.
  const removals = source.match(/filter\(\(i\) => i\.id !== item\.id\)/g) ?? []
  assert.equal(removals.length, 1, 'a task must be removed in exactly one place')
  const guarded = /onConfirm: \(\) => store\.update\(\(list\) => list\.filter\(\(i\) => i\.id !== item\.id\)\)/
  assert.ok(guarded.test(source), 'the single removal must sit inside onConfirm')
  // Both row variants (active and archived) delegate rather than mutate.
  const delegated = source.match(/onClick=\{onDelete\}/g) ?? []
  assert.equal(delegated.length, 2, 'both the active and archived delete buttons must call onDelete')
  assert.ok(/askDelete/.test(source), 'the shared delete prompt builder must exist')
}

// --- the suggest dialog ------------------------------------------------------
// The first point the suggest feature becomes visible, so these markers pin
// that the CSS actually shipped, that the prompt still names the file the host
// reads back, and that a suggestion can only enter the list one way.
{
  const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')
  const source = readFileSync(join(root, 'src/client.tsx'), 'utf8')

  // 1. The CSS shipped — the RULE, not merely the name. Asserting the bare
  //    class name proves nothing: `className="dshtd-sug-row"` in the JSX puts
  //    that literal in the bundle whether or not a stylesheet ever defined it,
  //    so a renamed selector would leave the rows unstyled and still pass.
  //    Verified by sabotage: renaming only the selector must go red.
  const flat = bundle.replace(/\s+/g, ' ')
  assert.ok(/\.dshtd-sug-row \{[^}]*padding: 10px 12px/.test(flat),
    'the suggestion row styles must ship as a real rule, not just a class name')
  assert.ok(/\.dshtd-sug-skel \{[^}]*display: flex/.test(flat),
    'the suggestion skeleton styles must ship as a real rule')
  // The skeleton copies the row's geometry, so the swap to real content cannot
  // lurch. Pinned as one assertion because the two must change TOGETHER.
  const rowPad = /\.dshtd-sug-row \{[^}]*padding: ([^;]+);/.exec(flat)
  const skelPad = /\.dshtd-sug-skel \{[^}]*padding: ([^;]+);/.exec(flat)
  assert.ok(rowPad && skelPad && rowPad[1] === skelPad[1],
    'the skeleton must copy the real row padding — otherwise the swap lurches')

  // 2. The prompt names the output path the host reads back. These are the two
  //    ends of one contract in different files: if composeScanPrompt stopped
  //    naming SUGGESTIONS_FILE, every scan would poll forever on a file the
  //    model was never asked to write, and nothing would throw.
  assert.ok(bundle.includes('suggestions.json'),
    'the scan prompt must name the file the host reads back')

  // 3. THE SINGLE WRITE PATH, mirroring the single-deletion-path rule above.
  //    Deletion is guarded because a second call site would bypass the confirm
  //    dialog; a suggestion is guarded because a second call site would bypass
  //    the ONE batched store.update — the store treats every call as a reason
  //    to write, so a per-row loop puts a host round-trip on the wire per
  //    checkbox. Asserted on the SOURCE: minification renames the callback
  //    parameters a bundle-level regex would look for, so it would match
  //    nothing and pass vacuously.
  //    Counted STRUCTURALLY — every store.update inside SuggestDialog — not by
  //    one spelling of the makeItem call. An earlier version matched the exact
  //    argument text, so a second call site written even slightly differently
  //    slipped straight past it; the sabotage that proved this added
  //    `makeItem(normalizeText(suggestions[0].title), ...)` and the assertion
  //    stayed green.
  const dialog = /export function SuggestDialog\(\{[\s\S]*?\n\}\n\n\/\*\*\n \* The full task detail dialog/.exec(source)
  assert.ok(dialog, 'SuggestDialog must exist and be delimited for this check')
  // Comments are STRIPPED before counting. The prose above the call site names
  // `makeItem(title, now, rand, fields)` to explain the arity trap, and counting
  // that as a second construction made this assertion fail against correct code
  // — a check that cannot distinguish code from a comment about the code is
  // worse than none, because the noise trains you to relax it.
  const code = dialog[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const writes = code.match(/store\.update\(/g) ?? []
  assert.equal(writes.length, 1,
    'a suggestion must become a task in exactly one place — one batched store.update')
  const constructions = code.match(/makeItem\(/g) ?? []
  assert.equal(constructions.length, 1,
    'suggestions must be constructed in exactly one place')
  // ...and that one place must be the batched update, not a loop of them.
  assert.ok(
    /store\.update\(\(current\) => \[\s*\.\.\.current,\s*\.\.\.picked\.map\(/.test(source),
    'the promotion must be ONE batched store.update over the picked rows',
  )
  assert.ok(!/picked\.forEach\([\s\S]{0,120}store\.update/.test(source),
    'suggestions must not be added one store.update per row')

  // 4. `fields` is the FOURTH parameter of makeItem. Called as
  //    makeItem(title, fields) the object silently becomes `now`, yielding a
  //    garbage id and createdAt with no error anywhere — so pin the arity.
  assert.ok(
    /makeItem\(normalizeText\(s\.title\), Date\.now\(\), Math\.random, \{/.test(source),
    'makeItem must receive fields as its FOURTH argument, after now and rand',
  )

  // 5. Loading is its OWN flag, never inferred from an empty collection.
  //    `suggestions.length === 0` means both "the scan found nothing" and "we
  //    have not looked", and rendering the former during the latter is the
  //    false claim that sent dsh-plan-board users hunting for absent plans.
  assert.ok(/setPhase\('scanning'\)/.test(source), 'the scan must arm an explicit phase flag')
  assert.ok(/phase === 'ready' && suggestions\.length === 0/.test(source),
    'the empty state must require the ready phase, never an empty list alone')

  // 6. The skeleton's accessibility contract. check-progress.mjs gates its own
  //    role/aria-hidden checks on a `<prefix>-skel` class name, which
  //    `dshtd-sug-skel` does not match, so this skeleton would otherwise ship
  //    entirely unchecked — pin it here instead of trusting a checker that
  //    cannot see it.
  const skel = /function SuggestSkeleton\(\)[\s\S]*?\n\}/.exec(source)
  assert.ok(skel, 'SuggestSkeleton must exist')
  assert.ok(skel[0].includes('role="status"'), 'the suggestion skeleton root must be a live region')
  assert.ok(skel[0].includes('aria-busy'), 'the suggestion skeleton root must carry aria-busy')
  assert.ok(skel[0].includes('aria-hidden="true"'),
    'the decorative skeleton rows must be hidden from assistive tech')

  // 6b. The skeleton carries an ELAPSED-TIME caption. SCAN_TIMEOUT_MS is 180s,
  //     and five motionless bars for three minutes claim "hung", not "working"
  //     — a loading state making a false claim about state, which is the thing
  //     the repo's loading rule exists to prevent. The ticker must therefore
  //     exist and be visible in the pane.
  assert.ok(/Scanning the workspace/.test(skel[0]),
    'the skeleton must caption what it is waiting for')
  assert.ok(/\{elapsed\}s|\$\{elapsed\}s/.test(skel[0]),
    'the skeleton must show elapsed seconds, or a 180s wait reads as hung')

  //     It lives INSIDE the existing role="status" region — a second live
  //     region would compete with the first — and the ticking number is
  //     aria-hidden, or a per-second update spams a screen reader with 180
  //     announcements. The announced text stays static; only the visual number
  //     moves.
  const statusOpen = skel[0].indexOf('role="status"')
  const captionAt = skel[0].search(/className="dshtd-sug-elapsed"/)
  assert.ok(captionAt !== -1, 'the elapsed caption must ship with its own class')
  assert.ok(statusOpen !== -1 && statusOpen < captionAt,
    'the elapsed caption must sit INSIDE the existing status region, not in a second one')
  assert.equal((skel[0].match(/role="status"/g) ?? []).length, 1,
    'exactly one live region — a second would compete with the first')
  assert.ok(/className="dshtd-sug-elapsed"[^>]*aria-hidden="true"/.test(skel[0]),
    'the ticking caption must be aria-hidden — 180 announcements is not a status')

  //     Caption row styling follows the small-surface rule and the package's
  //     own convention: 12px on an 18px line, tertiary tone, exactly as
  //     .dshtd-sug-status is declared. Pinned as a real RULE for the same
  //     reason as check 1 — the class literal ships either way.
  assert.ok(/\.dshtd-sug-elapsed \{[^}]*font-size: 12px[^}]*line-height: 18px/.test(flat),
    'the elapsed caption must be 12px on an 18px line, like every caption here')
  assert.ok(/\.dshtd-sug-elapsed \{[^}]*color: var\(--td-caption\)/.test(flat),
    'the elapsed caption must use the tertiary caption tone')

  // 6c. The ticker must be cleaned up on unmount and must not run outside the
  //     scanning phase. SuggestSkeleton renders ONLY while scanning, so
  //     unmount-cleanup is what enforces both — an interval without a returned
  //     disposer keeps firing setState on a dead component for three minutes.
  assert.ok(/setInterval\(/.test(skel[0]), 'the elapsed caption needs a ticker')
  assert.ok(/return \(\) => \{?\s*(window\.)?clearInterval\(/.test(skel[0]),
    'the elapsed ticker must be cleared on unmount, or it outlives the scan')

  // 7. The skeleton is rendered BEFORE the blocking call is issued. scanDigest
  //    runs a fully synchronous digest on the single-threaded host, so with the
  //    placeholder armed after the await the tab freezes rather than showing
  //    that it is busy.
  const armed = source.indexOf("setPhase('scanning')")
  const issued = source.indexOf('remote.scanDigest(')
  assert.ok(armed !== -1 && issued !== -1 && armed < issued,
    'the loading phase must be armed BEFORE scanDigest is issued — it blocks the host')

  // 8. Refresh must stay recoverable. readSuggestions reports a transient
  //    errno (EMFILE/EBUSY) as a terminal error, so a Refresh that latched off
  //    after one failure would dead-end the modal on a condition that clears
  //    by itself.
  assert.ok(/disabled=\{phase === 'scanning'\}/.test(source),
    'Refresh may be disabled only WHILE scanning — an error must stay retryable')

  // 9. The scan session is held in a REF blanked on read, which is what makes
  //    cleanup idempotent. A state variable read from a render closure is
  //    exactly what archived a just-prompted session in the launch flow.
  assert.ok(/const id = sessionRef\.current\s*\n\s*sessionRef\.current = null/.test(source),
    'cleanup must take the session id and blank the ref in the SAME step')
}

// --- the launch button must be VISIBLE without hovering ----------------------
// It shipped inside .dshtd-rowbtns, which is `opacity: 0` until the row is
// hovered. Every other check passed — the button rendered, the handler was
// wired, the services resolved — and the feature was still reported as missing,
// because an affordance nobody can see does not exist. Correct behaviour for
// move/delete; wrong for the primary action on a row.
{
  const source = readFileSync(join(root, 'src/client.tsx'), 'utf8')
  assert.ok(/className="dshtd-icon dshtd-rowlead"[\s\S]{0,240}?Start a session for this task/.test(source),
    'the launch button must use .dshtd-rowlead (always visible), not the hover-only group')
  assert.ok(/className="dshtd-icon dshtd-rowlead"[\s\S]{0,240}?Open the session working this task/.test(source),
    'the open-session button must use .dshtd-rowlead too')
  const lead = /\.dshtd-rowlead \{([^}]*)\}/.exec(source)
  assert.ok(lead, '.dshtd-rowlead must be styled')
  assert.ok(!/opacity:\s*0\s*[;}]/.test(lead[1]),
    '.dshtd-rowlead must not be opacity: 0 — that is exactly what hid the feature')
  // Anchored past the ARCHIVED-row branch, which has a .dshtd-rowbtns of its own
  // — comparing against that one measures the wrong group entirely.
  const launchBtn = source.indexOf('Start a session for this task')
  const rowbtns = source.indexOf('<span className="dshtd-rowbtns">', launchBtn)
  assert.ok(launchBtn !== -1 && rowbtns !== -1 && launchBtn < rowbtns,
    'the launch button must render BEFORE the hover-only .dshtd-rowbtns group that follows it')
}

// --- launching a session from a task ----------------------------------------
// The ordering rule here is the one defect in this feature that fails SILENTLY:
// the agent-preset applier drops a pick aimed at a session that is no longer
// blank, and prompting is exactly what un-blanks it. A launch that sends the
// prompt first therefore runs the DEFAULT mode with no error anywhere — no
// rejected promise, no console warning, nothing to notice until the agent
// behaves oddly much later. Asserted on the SOURCE of src/launch.ts, because
// the client bundle is minified and a bundle-level regex would match nothing
// and pass vacuously.
{
  const launchSource = readFileSync(join(root, 'src/launch.ts'), 'utf8')

  // 1. A launch must always try to set the mode. Without this a session joins
  //    no preset and resolves against the empty global layer.
  assert.ok(/agentPresets\.select\(/.test(launchSource),
    'launchSession must select an agent preset')

  // 2. THE ordering invariant: preset and model both precede the prompt.
  const iPreset = launchSource.indexOf('agentPresets.select(')
  // `directoryFor` and `.select(` are no longer one expression: the borrowed
  // service can be unreachable from this fiber, so the handle is null-checked
  // between them (see the remote.session crash). Anchor on directoryFor itself
  // — the ordering invariant is about WHEN the model is applied, not about the
  // call being a single chain, and pinning the chained form made a correct
  // safety fix look like a regression.
  const iModel = launchSource.indexOf('directoryFor(sessionId)')
  const iPrompt = launchSource.search(/binding\.session\.prompt\(/)
  assert.ok(iPreset !== -1 && iModel !== -1 && iPrompt !== -1,
    'launchSession must select a preset, select a model, and send a prompt')
  assert.ok(iPreset < iPrompt,
    'the agent preset must be selected BEFORE the prompt — a non-blank session silently ignores it')
  assert.ok(iModel < iPrompt,
    'the model must be selected BEFORE the prompt')

  // Relaxing the marker above must not let the select itself disappear: assert
  // the directory is still selected on, and still before the prompt.
  const iModelSelect = launchSource.indexOf('.select(model)')
  assert.ok(iModelSelect !== -1 && iModelSelect > iModel && iModelSelect < iPrompt,
    'the resolved model directory must be select()ed, after directoryFor and before the prompt')

  // 3. Exactly one prompt call site, mirroring the single-removal rule: a
  //    second path would bypass the ordering above.
  const prompts = launchSource.match(/\.prompt\(\[\{ type: 'text'/g) ?? []
  assert.equal(prompts.length, 1, 'a launch must send the prompt in exactly one place')

  // 4. Create-on-open is only safe if cancelling cleans up after itself.
  assert.ok(/archiveSession\(/.test(launchSource),
    'discardSession must archive the session a cancelled dialog created')

  // 5. The status flip is gated on the launch succeeding: a failed launch must
  //    not leave the task claiming work that never started.
  const clientSource = readFileSync(join(root, 'src/client.tsx'), 'utf8')
  assert.ok(/onLaunched=\{\(sessionId\) => \{[\s\S]{0,500}?'in-progress'/.test(clientSource),
    "the in-progress flip must happen in onLaunched, after the prompt is away")
  // Status and session id land in ONE update, so they cannot disagree about
  // whether work started.
  assert.ok(/onLaunched=\{\(sessionId\) => \{[\s\S]{0,500}?sessionId \}/.test(clientSource),
    'the launched session id must be recorded in the same update as the status')
  const flips = clientSource.match(/setStatus\(list, launching\.item\.id, 'in-progress'\)/g) ?? []
  assert.equal(flips.length, 1, 'the task status must be advanced in exactly one place')
}

// composePrompt — the brief a launched session opens with
{
  const bare = { id: 'a', title: 'Fix token refresh', status: 'todo', priority: 'p2', createdAt: 1 }
  assert.equal(launch.composePrompt(bare), '# Fix token refresh\n\nPriority: P2',
    'a bare task yields a heading plus its priority')

  const full = {
    ...bare,
    description: 'The refresh token is dropped on 401.',
    release: '1.5',
    sprint: '24',
    dueDate: '2026-03-14',
  }
  const text = launch.composePrompt(full)
  assert.ok(text.startsWith('# Fix token refresh'), 'the title leads as a heading')
  assert.ok(text.includes('The refresh token is dropped on 401.'), 'the description is the brief')
  assert.ok(text.includes('Release: 1.5') && text.includes('Sprint: 24') && text.includes('Due: 2026-03-14'),
    'set roadmap fields are carried as context')

  // Absent fields must not produce empty rows — an empty "Release:" teaches the
  // model the metadata is meaningless.
  assert.ok(!launch.composePrompt(bare).includes('Release:'), 'an unset field is omitted entirely')
  assert.ok(!launch.composePrompt(bare).includes('Due:'), 'an unset due date is omitted entirely')
}

// flattenModels — against the catalog shape the harness ACTUALLY sends.
//
// The previous version of this test invented its own shape (`model.provider`,
// `group.label`, `group.items`) and asserted the code matched the invention. It
// stayed green while the picker rendered EMPTY on every real harness, because a
// group IS a provider: dsh-client-ui-model-selection builds every selection as
// `{ provider: group.id, model: model.id }` with `model.name` as the label, and
// there is no `model.provider` anywhere in that catalog. Requiring one meant
// the guard skipped every row.
//
// So this fixture is copied from the real projection, not imagined. A test that
// makes up its input can only ever prove the code agrees with the test.
{
  const flat = launch.flattenModels([
    {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-chat', name: 'Chat' },
        { id: 'deepseek-reasoner', name: 'Reasoner' },
      ],
    },
    { id: 'anthropic', name: 'Anthropic', models: [{ id: 'claude-opus-4' }] },
  ])
  assert.equal(flat.length, 3, 'every model in every group is offered')
  assert.deepEqual(flat[0], {
    provider: 'deepseek',
    model: 'deepseek-chat',
    label: 'Chat',
    group: 'DeepSeek',
  }, 'the PROVIDER comes from the group id, never from a field on the model')
  assert.equal(flat[2].provider, 'anthropic', 'each group supplies its own provider')
  assert.equal(flat[2].label, 'claude-opus-4', 'a model with no name falls back to its id')

  // The regression that emptied the picker: a row carrying `provider` on the
  // MODEL and nothing on the group must not resurrect the old reading.
  const legacy = launch.flattenModels([
    { models: [{ provider: 'deepseek', model: 'deepseek-chat', label: 'Chat' }] },
  ])
  assert.equal(legacy.length, 0, 'a group with no id yields nothing — the provider is the group')

  assert.equal(launch.flattenModels([{ id: 'p', models: [{ name: 'no id' }] }]).length, 0,
    'a model with no id is skipped')
  assert.equal(launch.flattenModels([]).length, 0)
}

// presetOptions — broken presets are unusable, the default leads, and a SHIPPED
// preset is named in the shell's language rather than from file metadata.
{
  const { options, defaultId } = launch.presetOptions([
    { id: 'standard', label: 'Standard' },
    { id: 'broken', label: 'Broken', broken: { reason: 'bad yml' } },
    { id: 'cordis', label: 'Cordis', isDefault: true },
  ])
  assert.deepEqual(options.map((o) => o.id), ['standard', 'cordis'], 'a broken preset must not be offered')
  assert.equal(defaultId, 'cordis', 'the deployment default is preselected')
  assert.equal(launch.presetOptions([{ id: 'only' }]).defaultId, 'only',
    'with no explicit default the first healthy preset wins')
  assert.equal(launch.presetOptions([]).defaultId, undefined, 'no presets is a valid deployment')

  // A SHIPPED preset's `name` is an internal value — Chinese in this build —
  // and the shell never renders it: presetDisplayText() swaps in t(key) when
  // trust === 'system'. Reading the raw field put "创造模式" in the picker on an
  // English UI, which is what the user saw.
  const t = (key) => ({ presetCordisName: 'Creator mode', presetStandardName: 'Standard mode' })[key]
  const localized = launch.presetOptions([
    { id: 'cordis', name: '创造模式', trust: 'system' },
    { id: 'standard', name: '标准模式', trust: 'system' },
  ], t)
  assert.deepEqual(localized.options.map((o) => o.label), ['Creator mode', 'Standard mode'],
    'a shipped preset is named from the locale, never from its roster metadata')

  // A USER preset's name is the author's own copy and must never be translated.
  const authored = launch.presetOptions([{ id: 'cordis', name: 'My Cordis', trust: 'user' }], t)
  assert.equal(authored.options[0].label, 'My Cordis',
    'a user-authored preset keeps its own name even when its id matches a built-in')

  // Degradation: no locale service, or a lookup that echoes the key back.
  assert.equal(launch.presetOptions([{ id: 'cordis', name: '创造模式', trust: 'system' }]).options[0].label,
    '创造模式', 'with no locale service the roster metadata is the only option')
  assert.equal(
    launch.presetOptions([{ id: 'cordis', name: 'fallback', trust: 'system' }], (k) => k).options[0].label,
    'fallback', 'a lookup that echoes the key back must not surface the raw key')
}

// --- sessionId reaches every face -------------------------------------------
// The field crosses six places (types, wire schema, host schema + sanitizeItems,
// SQLite migration + SQL, client coerceItems, CLI). Missing ANY of them drops it
// silently, so each boundary is pinned rather than trusting one round-trip.
{
  const withSession = {
    id: 's1', title: 'has a session', status: 'in-progress', priority: 'p2',
    sessionId: 'sess-1', createdAt: 1,
  }

  // The wire codec is STRICT: a field it does not name is stripped in transit,
  // which fails silently — the UI would show a session the host never receives.
  const replaceDescriptor = m.TODO_REMOTE.descriptors.find((d) => d.method === 'replace')
  assert.ok(replaceDescriptor, 'the replace descriptor must exist')
  const parsed = replaceDescriptor.parameters[0].codec.schema.parse({
    workspaceId: 'w', items: [withSession], ifRevision: null,
  })
  assert.equal(parsed.items[0].sessionId, 'sess-1',
    'the wire schema must name sessionId or it is stripped off the wire')

  assert.equal(m.coerceItems([withSession])[0].sessionId, 'sess-1',
    'coerceItems must keep sessionId or it is lost on reload')
  assert.equal(m.coerceItems([{ ...withSession, sessionId: 42 }])[0].sessionId, undefined,
    'a non-string session id must decay to undefined, not survive as junk')
  assert.equal(m.coerceItems([{ ...withSession, sessionId: '' }])[0].sessionId, undefined,
    'an empty session id is absence, not a stored empty string')
}

// workspaceIdForSession — the per-workspace routing rule
const wsList = [
  { workspaceId: 'w1', sessionIds: ['s1', 's2'] },
  { workspaceId: 'w2', sessionIds: ['s3'] },
]
assert.equal(m.workspaceIdForSession(wsList, 's2'), 'w1', 'session must resolve to its workspace')
assert.equal(m.workspaceIdForSession(wsList, 's3'), 'w2')
assert.equal(m.workspaceIdForSession(wsList, 'nope'), undefined, 'an unaccounted session has no workspace')
assert.equal(m.workspaceIdForSession([], 's1'), undefined)

// fmtAge
assert.equal(m.fmtAge(0), '')
assert.equal(m.fmtAge(1000, 1000), 'just now')
assert.equal(m.fmtAge(0 + 1, 1 + 5 * 60000), '5m')
assert.equal(m.fmtAge(1, 1 + 3 * 3600000), '3h')
assert.equal(m.fmtAge(1, 1 + 2 * 86400000), '2d')

// --- legacy migration -------------------------------------------------------
// The old browser-only list is imported exactly once, and never re-imported.
storage.set('dsh-todo:items', JSON.stringify([{ id: 'old', text: 'legacy', done: false, createdAt: 5 }]))
const firstTake = m.takeLegacyItems()
assert.equal(firstTake.length, 1, 'legacy todos must be migrated on first read')
assert.equal(firstTake[0].title, 'legacy', 'the legacy text becomes the title')
assert.deepEqual(m.takeLegacyItems(), [], 'legacy todos must not be imported twice')
assert.ok(storage.get('dsh-todo:items'), 'the legacy key must be preserved, not destroyed')

// --- client store: optimistic write + conflict reconciliation ---------------
{
  let stored = { items: [], revision: 0, updatedAt: 0 }
  const remote = {
    list: async () => ({ ok: true, value: { list: stored } }),
    replace: async ({ items, ifRevision }) => {
      if (ifRevision !== stored.revision) {
        return { ok: true, value: { ok: false, code: 'revision-conflict', list: stored } }
      }
      stored = { items, revision: stored.revision + 1, updatedAt: 1 }
      return { ok: true, value: { ok: true, list: stored } }
    },
  }
  const store = new m.TodoStore(remote, 'ws-1')
  await store.ensure()
  assert.equal(store.getSnapshot().status, 'ready', 'store must become ready after load')

  store.update((items) => [...items, m.makeItem('first')])
  assert.equal(store.getSnapshot().items.length, 1, 'update must echo optimistically')
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(stored.items.length, 1, 'update must reach the host')
  assert.equal(store.getSnapshot().saving, false, 'saving must clear once committed')

  // Simulate another tab winning the race, then confirm we adopt its list.
  stored = {
    items: [{ id: 'other', title: 'from another tab', status: 'todo', priority: 'p2', createdAt: 9 }],
    revision: 99, updatedAt: 2,
  }
  store.update((items) => [...items, m.makeItem('doomed')])
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(store.getSnapshot().items.length, 1, 'a conflict must adopt the authoritative list')
  assert.equal(store.getSnapshot().items[0].title, 'from another tab')
}

// --- client store: a host failure surfaces instead of pretending to save ----
{
  const remote = {
    list: async () => ({ ok: false, error: { code: 'boom', message: 'host unavailable' } }),
    replace: async () => ({ ok: false, error: { code: 'boom', message: 'host unavailable' } }),
  }
  const store = new m.TodoStore(remote, 'ws-err')
  await store.ensure()
  const state = store.getSnapshot()
  assert.equal(state.status, 'error', 'a failed load must be reported as an error')
  assert.equal(state.error, 'host unavailable', 'the host message must reach the UI')
}

// apply() registers a tab in the conversation view ring.
//
// The slot must be registered from inside ctx.inject(['remote.dshTodo', ...]),
// NOT directly in apply(): `remote.$mount` resolves asynchronously, so reading
// ctx.remote.dshTodo eagerly captures undefined and every call then fails with
// "Cannot read properties of undefined (reading 'list')". The stub therefore
// exposes dshTodo ONLY through the injected context, mirroring real timing.
let registered = null
let injectedDeps = null
const slotsStub = {
  inject: (_name, fn) => fn(),
  register: (opts) => {
    registered = opts
    return () => {}
  },
}
const ctxStub = {
  effect: (fn) => fn(),
  slots: slotsStub,
  remote: { $mount: async () => async () => {} },
  inject: (deps, callback) => {
    injectedDeps = deps
    callback({
      slots: slotsStub,
      workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'w1', sessionIds: ['s1'] }] }) } },
      remote: { dshTodo: { list: async () => {}, replace: async () => {} } },
    })
    return { dispose: () => {} }
  },
}
m.apply(ctxStub)
assert.ok(injectedDeps, 'apply() must defer registration behind ctx.inject')
assert.ok(
  injectedDeps.includes('remote.dshTodo'),
  'the tab must wait for the mounted remote namespace instead of reading it eagerly',
)
assert.ok(registered, 'apply() did not register a slot entry')
assert.equal(registered.name, 'conversation.view', 'wrong slot name')
assert.equal(registered.id, 'todo', 'wrong slot entry id')
assert.equal(registered.order, 20, 'tab must sort after chat (0) and trajectory (10)')
assert.equal(typeof registered.label, 'function', 'label must be a thunk so it re-reads per projection')
assert.equal(registered.label(), 'Tasks', 'wrong tab label')

// The slot injects a per-workspace store, and refuses to guess when a session
// belongs to no workspace.
const injected = registered.inject('s1')
assert.ok(injected.store, 'a session in a workspace must receive a store')
assert.equal(registered.inject('s1').store, injected.store, 'the same workspace must share one store')
assert.equal(registered.inject('unknown').store, null, 'an unaccounted session must get no store')

console.log('smoke OK')
