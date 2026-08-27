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
// Native decorator syntax cannot be parsed by Node 22; it must be downleveled.
assert.ok(!/^\s*@Remote\s*$/m.test(hostSource), 'decorators were emitted natively instead of downleveled')

// --- host half --------------------------------------------------------------
const host = await import(pathToFileURL(join(root, 'lib/index.js')).href)
assert.equal(typeof host.TodoService, 'function', 'host half must export TodoService')
// The legacy storage-domain export is kept as a versioned marker; the SQLite
// path no longer uses a domain unit.
assert.equal(host.todoDomainSpec.name, 'dsh_todo', 'unexpected storage domain name')
assert.match(String(host.todoDomainSpec.name), /^[a-z][a-z0-9_]*$/, 'domain name must satisfy the unit grammar')
assert.equal(host.todoDomainSpec.version, 2, 'unexpected storage domain version')

// The @Remote markers are what publish these methods to the browser.
const svc = new host.TodoService(new Context())
const marked = remoteMethods(svc).map((m) => m.method).sort()
assert.deepEqual(marked, ['list', 'replace'], 'host must export exactly list + replace as Remote')
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
    items: [{ id: 'a', text: 'one', done: false, createdAt: 1 }],
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
      { id: 'x', text: 'y'.repeat(900), done: false, createdAt: 2 },
      { id: 'x', text: 'duplicate id', done: false, createdAt: 3 },
      { id: 'z', text: 'open', done: false, createdAt: 4, completedAt: 99 },
      'garbage',
      null,
    ],
    ifRevision: 2,
  })
  assert.equal(dirty.ok, true)
  assert.equal(dirty.list.items.length, 2, 'malformed and duplicate entries must be dropped')
  assert.equal(dirty.list.items[0].text.length, 500, 'stored text must be capped at 500 chars')
  assert.equal(dirty.list.items[1].completedAt, undefined, 'completedAt must not survive on an open item')

  // Archived state must survive the durable boundary, and a non-numeric marker
  // must not sneak through as a truthy "archived" flag.
  const arch = await service.replace({
    workspaceId: 'ws-1',
    items: [
      { id: 'a', text: 'archived', done: true, createdAt: 1, completedAt: 2, archivedAt: 3 },
      { id: 'b', text: 'bad marker', done: true, createdAt: 1, completedAt: 2, archivedAt: 'yes' },
    ],
    ifRevision: 3,
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

// --- evaluate the client bundle to reach the exported pure logic ------------
let captured = null
const react = {
  createElement: () => ({}),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useSyncExternalStore: (_s, get) => get(),
}
const storage = new Map()
globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      captured = { id, exports: factory((name) => (name === 'react' ? react : {})) }
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
  assert.deepEqual(methods, ['list', 'replace'], 'contribution must cover both host methods')

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
    items: [{ id: 'a', text: 't', done: true, createdAt: 1, completedAt: 2 }],
    ifRevision: 3,
  })
  // Strict codecs strip unnamed fields, so the wire schema must carry
  // archivedAt explicitly or archiving would never reach the host.
  const withArchive = replaceDesc.parameters[0].codec.schema.parse({
    workspaceId: 'w1',
    items: [{ id: 'a', text: 't', done: true, createdAt: 1, completedAt: 2, archivedAt: 4 }],
    ifRevision: 3,
  })
  assert.equal(withArchive.items[0].archivedAt, 4, 'archivedAt must survive the request codec')
  const backArchive = replaceDesc.result.schema.parse({
    ok: true,
    list: { items: [{ id: 'a', text: 't', done: true, createdAt: 1, archivedAt: 4 }], revision: 1, updatedAt: 1 },
  })
  assert.equal(backArchive.list.items[0].archivedAt, 4, 'archivedAt must survive the result codec')
  replaceDesc.result.schema.parse({ ok: true, list: { items: [], revision: 1, updatedAt: 1 } })
  replaceDesc.result.schema.parse({
    ok: false,
    code: 'revision-conflict',
    list: { items: [], revision: 9, updatedAt: 2 },
  })
}

// computeStats
assert.deepEqual(m.computeStats([]), { total: 0, done: 0, open: 0, percent: 0, archived: 0 })
const sample = [
  { id: 'a', text: 'one', done: true, createdAt: 1 },
  { id: 'b', text: 'two', done: false, createdAt: 2 },
  { id: 'c', text: 'three', done: false, createdAt: 3 },
]
assert.deepEqual(m.computeStats(sample), { total: 3, done: 1, open: 2, percent: 33, archived: 0 })

// nextOpen
assert.equal(m.nextOpen(sample).id, 'b', 'nextOpen returns the first undone item')
assert.equal(m.nextOpen([{ id: 'x', text: 'x', done: true, createdAt: 0 }]), undefined)

// normalizeText
assert.equal(m.normalizeText('  hello   world  '), 'hello world')
assert.equal(m.normalizeText('\n\t '), '')
assert.equal(m.normalizeText('x'.repeat(900)).length, 500, 'text is capped at 500 chars')

// makeItem — deterministic with injected now/rand
const made = m.makeItem('write tests', 1700000000000, () => 0.5)
assert.equal(made.text, 'write tests')
assert.equal(made.done, false)
assert.equal(made.createdAt, 1700000000000)
assert.ok(typeof made.id === 'string' && made.id.length > 1, 'item id must be a string')

// toggleItem
const toggled = m.toggleItem(sample, 'b', 555)
assert.equal(toggled[1].done, true)
assert.equal(toggled[1].completedAt, 555, 'completedAt is stamped on completion')
assert.equal(m.toggleItem(toggled, 'b')[1].completedAt, undefined, 'completedAt clears on un-toggle')
assert.equal(toggled[0].done, true, 'other items are untouched')
assert.notEqual(toggled, sample, 'toggleItem must not mutate its input')

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
  assert.deepEqual(m.computeStats(archived), { total: 2, done: 0, open: 2, percent: 0, archived: 1 })
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
  assert.equal(m.archiveCompleted([{ id: 'o', text: 'open', done: false, createdAt: 1 }], 1).length, 1)

  // Archiving preserves data, unlike clearCompleted which destroys it.
  assert.equal(bulk.length, 3, 'archiveCompleted must keep every item in the record')
  assert.equal(m.clearCompleted(sample).length, 2, 'clearCompleted still deletes outright')

  // clearArchived is the one destructive bulk action.
  assert.deepEqual(m.clearArchived(bulk).map((i) => i.id), ['b', 'c'])
  assert.equal(m.clearArchived(sample), sample, 'nothing archived means nothing to delete')

  // Archived items sort newest-first so the Archive view reads as a log.
  const log = m.archiveCompleted(
    [
      { id: 'p', text: 'p', done: true, createdAt: 1, archivedAt: 10 },
      { id: 'q', text: 'q', done: true, createdAt: 2, archivedAt: 30 },
      { id: 'r', text: 'r', done: true, createdAt: 3, archivedAt: 20 },
    ],
    0,
  )
  assert.deepEqual(m.archivedItems(log).map((i) => i.id), ['q', 'r', 'p'], 'newest archive first')

  // Reordering happens in active-list space, so a hidden archived entry between
  // two visible ones cannot swallow a move.
  const mixed = [
    { id: 'a', text: 'a', done: false, createdAt: 1 },
    { id: 'h', text: 'hidden', done: true, createdAt: 2, archivedAt: 5 },
    { id: 'b', text: 'b', done: false, createdAt: 3 },
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
    { id: 'a', text: 'hi', done: true, createdAt: 7, completedAt: 9, archivedAt: 11 },
  ]))
  assert.equal(round[0].archivedAt, 11, 'archivedAt must survive parseItems')
  const junk = m.parseItems('[{"id":"a","text":"hi","archivedAt":"soon"}]')
  assert.equal(junk[0].archivedAt, undefined, 'a non-numeric archivedAt must not mark an item archived')
  assert.equal(m.isArchived(junk[0]), false)
}

// parseItems — defensive against junk
assert.deepEqual(m.parseItems(null), [])
assert.deepEqual(m.parseItems('not json'), [])
assert.deepEqual(m.parseItems('{"a":1}'), [], 'non-array JSON yields an empty list')
assert.deepEqual(m.parseItems('[1,null,"x",{"id":"a"}]'), [], 'malformed entries are dropped')
const parsed = m.parseItems(JSON.stringify([{ id: 'a', text: 'hi', done: true, createdAt: 7, completedAt: 9 }]))
// coerceItems normalizes the optional stamps to an explicit undefined, exactly
// as it already did for completedAt.
assert.deepEqual(parsed, [
  { id: 'a', text: 'hi', done: true, createdAt: 7, completedAt: 9, archivedAt: undefined },
])
assert.equal(m.parseItems('[{"id":"a","text":"hi"}]')[0].done, false, 'missing done defaults to false')

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
assert.equal(firstTake[0].text, 'legacy')
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
  stored = { items: [{ id: 'other', text: 'from another tab', done: false, createdAt: 9 }], revision: 99, updatedAt: 2 }
  store.update((items) => [...items, m.makeItem('doomed')])
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(store.getSnapshot().items.length, 1, 'a conflict must adopt the authoritative list')
  assert.equal(store.getSnapshot().items[0].text, 'from another tab')
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
assert.equal(registered.label(), 'Todo', 'wrong tab label')

// The slot injects a per-workspace store, and refuses to guess when a session
// belongs to no workspace.
const injected = registered.inject('s1')
assert.ok(injected.store, 'a session in a workspace must receive a store')
assert.equal(registered.inject('s1').store, injected.store, 'the same workspace must share one store')
assert.equal(registered.inject('unknown').store, null, 'an unaccounted session must get no store')

console.log('smoke OK')
