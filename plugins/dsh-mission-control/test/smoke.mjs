/**
 * Offline smoke test: exercises the pure logic + plugin bootstrap without a
 * browser. Verifies:
 *   1. host half exports apply()
 *   2. buildFleet() builds the root→subagent tree correctly
 *   3. totalBurn() aggregates stats
 *   4. client bundle registers via window.__ModuleLoader__.load
 *   5. apply() registers into shell.overlay through a stub ctx
 *   6. `inject` declares exactly the services the plugin reads — enforced by
 *      running apply() and a full render through a proxy that gates service
 *      access the way cordis does (see section 4/5)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const importLocal = (p) => import(pathToFileURL(join(root, p)).href)

// --- 1) host half: the persisted state cell service
const host = await importLocal("lib/index.js")
assert.equal(typeof host.default, 'function', 'host half default-exports MissionControlService')
assert.equal(host.default.name, 'MissionControlService', 'the service class keeps its name')
assert.equal(typeof host.MAX_STATE_BYTES, 'number', 'exports the state size cap')
const hostSrc = readFileSync(join(root, 'lib/index.js'), 'utf8')
assert.ok(hostSrc.includes('dshMissionControl'), 'host registers the dshMissionControl service key')
assert.ok(hostSrc.includes('dsh-mission-control.json'), 'host persists to the storages cell')
// The Typert manifest is what publishes the endpoints; without it the loader
// silently skips the package and every call 404s.
const typert = await importLocal("lib/typert.host.js")
assert.equal(typert.TYPERT.package, '@dennisrongo/dsh-mission-control', 'typert manifest names the package')
assert.equal(typert.TYPERT.face, 'host', 'typert manifest is the host face')
assert.equal(typert.TYPERT.invocations.length, 2, 'load + save descriptors are published')

// --- 2/3) pure logic from the built client bundle (CJS body under the loader convention)
const registered = []
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      registered.push(entry)
    },
  },
}
await importLocal("lib/client.js") // registers the factory
assert.equal(registered.length, 1, 'client.js registers exactly one module')
const moduleTable = {
  react: require('react'),
  'react/jsx-runtime': require('react/jsx-runtime'),
}
const exports = registered[0].factory((id) => {
  if (!(id in moduleTable)) throw new Error(`unexpected require: ${id}`)
  return moduleTable[id]
})

assert.equal(typeof exports.buildFleet, 'function', 'exports buildFleet')
assert.equal(typeof exports.totalBurn, 'function', 'exports totalBurn')
assert.equal(typeof exports.apply, 'function', 'exports apply')
assert.equal(typeof exports.fmtTokens, 'function', 'exports fmtTokens')
assert.equal(typeof exports.packPomodoroEnvelope, 'function', 'exports packPomodoroEnvelope')
assert.equal(typeof exports.parsePomodoroEnvelope, 'function', 'exports parsePomodoroEnvelope')
const clientSrc = readFileSync(join(root, 'lib/client.js'), 'utf8')
assert.ok(clientSrc.includes('dshMissionControl'), 'client mounts the host state remote')

// The inject list is load-bearing: cordis THROWS on a get of a service the
// plugin did not declare, so an omission is not a soft degradation — it fails
// the loader entry and drops DSH Desktop into startup recovery. `remote`
// regressed exactly this way once. Section 4/5 enforces the real invariant
// (declared set == actually-used set) by driving apply() AND a full render
// through a proxy that reproduces cordis's gating; this is just the shape.
assert.ok(Array.isArray(exports.inject), 'exports an inject list')
// The namespace this plugin mounts ITSELF must stay out of the list, or apply()
// parks forever waiting on a service only apply() can create.
assert.ok(
  !exports.inject.includes('remote.dshMissionControl'),
  'inject omits the self-mounted remote namespace',
)

// buildFleet: subagents come from the durable per-parent catalogs, NOT from
// ids/byId. The host list carries root sessions only; byId gains a subagent row
// solely as a navigation side effect (the single currently-addressed child), so
// these fixtures mirror that real shape rather than a fully-populated byId.
const list = {
  ids: ['a', 'd'],
  byId: {
    a: { id: 'a', displayTitle: 'Coordinator', running: true, projectionValues: { tokenUsage: { outputTokens: 42 } } },
    d: { id: 'd', displayTitle: 'Docs', completed: true },
    // navigation side effect: one addressed child happens to be resident
    c: { id: 'c', displayTitle: 'Bug 2 (live)', parentId: 'a', origin: 'subagent', pendingInteraction: 'approval' },
  },
  current: 'a',
  subagentsByParent: {
    a: {
      state: 'ready',
      parentAvailable: true,
      entries: [
        { kind: 'child', id: 'b', mode: 'continuable', label: 'Bug 1', activity: 'running', hasChildren: false },
        { kind: 'child', id: 'c', mode: 'continuable', label: 'Bug 2', activity: 'inactive', hasChildren: false },
      ],
    },
  },
}
const fleet = exports.buildFleet(list)
assert.equal(fleet.length, 2, 'two roots (subagents never appear as roots)')
assert.equal(fleet[0].children.length, 2, 'coordinator children come from its catalog')
// Siblings are ordered by urgency, not catalog position: 'c' is parked on an
// approval, so it outranks running 'b' even though the catalog lists it second.
assert.deepEqual(fleet[0].children.map((r) => r.id), ['c', 'b'], 'waiting child sorts above a running one')
const byId = Object.fromEntries(fleet[0].children.map((r) => [r.id, r]))
assert.equal(byId.b.title, 'Bug 1', 'catalog label titles a non-resident child')
assert.equal(byId.b.running, true, 'catalog activity drives running when byId has no row')
assert.equal(byId.c.title, 'Bug 2 (live)', 'resident byId row wins over the catalog label')
assert.equal(byId.c.pending, 'approval', 'pending kind read off the resident row')
assert.equal(fleet[1].children.length, 0, 'a root with no catalog has no children')

// A collapsed root must inherit "waiting on you" from its subtree, so the fleet
// row paints amber for a subagent parked on an approval. Root 'a' is running and
// not itself pending; its child 'c' holds the approval.
assert.equal(fleet[0].pending, undefined, 'the root itself is not pending')
assert.equal(
  exports.treePending(fleet[0]),
  'approval',
  'a waiting subagent lifts its collapsed root to waiting',
)
assert.equal(
  exports.treePending(fleet[1]),
  undefined,
  'a tree with nothing waiting stays un-coloured',
)

// Host contract (dsh-client-runtime sessions/pending.d.ts):
//   type PendingInteractionStatus = 'approval' | 'plan-review' | 'question'
// It is a BARE STRING. Reading .kind off it yields undefined and silently
// paints every waiting session green. Pin all three variants at the root.
for (const kind of ['approval', 'question', 'plan-review']) {
  const one = {
    ids: ['r'],
    byId: { r: { id: 'r', displayTitle: 'Root', running: true, pendingInteraction: kind } },
  }
  const row = exports.buildFleet(one)[0]
  assert.equal(row.pending, kind, `root carries bare-string pendingInteraction '${kind}'`)
  assert.equal(exports.treePending(row), kind, `'${kind}' marks the root as waiting`)
}
assert.equal(
  exports.buildFleet({ ids: ['r'], byId: { r: { id: 'r', displayTitle: 'R', running: true } } })[0].pending,
  undefined,
  'a plain running root stays un-pending',
)
assert.equal(fleet[0].outTokens, 42, 'row carries the session output-token projection')

// The regression this guards: with children derived by filtering ids on
// parentId, a full swarm collapsed to at most the one addressed child ('always 1').
{
  const many = {
    ids: ['root'],
    byId: { root: { id: 'root', displayTitle: 'Swarm', running: true } },
    current: 'root',
    subagentsByParent: {
      root: {
        state: 'ready',
        entries: Array.from({ length: 7 }, (_, i) => ({
          kind: 'child', id: `w${i}`, mode: 'one-shot', activity: 'running', hasChildren: false,
        })),
      },
    },
  }
  const rows = exports.buildFleet(many)
  assert.equal(rows[0].children.length, 7, 'all seven catalog children render')
  assert.deepEqual(
    exports.countFleet(rows),
    { sessions: 1, running: 1, subagents: 7, active: 8 },
    'subagent count reflects the whole swarm; running counts the root only',
  )
}

// Nested swarms: hasChildren drives recursion into the grandchild catalog.
{
  const nested = {
    ids: ['r'],
    byId: { r: { id: 'r', displayTitle: 'Lead', running: true } },
    current: 'r',
    subagentsByParent: {
      r: { state: 'ready', entries: [{ kind: 'child', id: 'm', mode: 'continuable', label: 'Mid', activity: 'running', hasChildren: true }] },
      m: { state: 'ready', entries: [{ kind: 'child', id: 'leaf', mode: 'one-shot', activity: 'inactive', hasChildren: false }] },
    },
  }
  const rows = exports.buildFleet(nested)
  assert.equal(rows[0].children[0].children.length, 1, 'grandchildren resolve through the nested catalog')
  // 'm' is running, 'leaf' is inactive: the tree still RENDERS both, but the
  // stat counts only what is live right now.
  assert.equal(exports.countFleet(rows).subagents, 1, 'only the live nested subagent counts')
}

// Diagnostic rows are skipped; loading/absent catalogs mean 'unknown', not 'empty'.
{
  const edge = {
    ids: ['x', 'y'],
    byId: { x: { id: 'x', displayTitle: 'X', running: false }, y: { id: 'y', displayTitle: 'Y', running: false } },
    current: 'x',
    subagentsByParent: {
      x: { state: 'ready', entries: [
        { kind: 'child', id: 'ok', mode: 'one-shot', activity: 'inactive', hasChildren: false },
        { kind: 'diagnostic', id: 'bad', reason: 'corrupt' },
      ] },
      y: { state: 'loading' },
    },
  }
  const rows = exports.buildFleet(edge)
  assert.deepEqual(rows[0].children.map((r) => r.id), ['ok'], 'diagnostic catalog rows are not rendered as agents')
  assert.equal(rows[1].children.length, 0, 'a loading catalog yields no rows without throwing')
}

// A cyclic/shared catalog must not infinitely recurse.
{
  const cyclic = {
    ids: ['p'],
    byId: { p: { id: 'p', displayTitle: 'P', running: false } },
    current: 'p',
    subagentsByParent: {
      p: { state: 'ready', entries: [{ kind: 'child', id: 'q', mode: 'one-shot', activity: 'inactive', hasChildren: true }] },
      q: { state: 'ready', entries: [{ kind: 'child', id: 'q', mode: 'one-shot', activity: 'inactive', hasChildren: true }] },
    },
  }
  const rows = exports.buildFleet(cyclic)
  assert.equal(rows[0].children.length, 1, 'cycle guard stops re-expansion')
  assert.equal(rows[0].children[0].children.length, 0, 'a repeated id is not walked twice')
}

// The actual 'always 1' bug: during a live run the host merges spawned children
// into byId with origin:'subagent' + parentId, while the durable catalog stays
// EMPTY until something requests it. Reading either source alone undercounts.
{
  const live = {
    ids: ['root'],
    byId: {
      root: { id: 'root', displayTitle: 'Lead', running: true },
      s1: { id: 's1', displayTitle: 'W1', origin: 'subagent', parentId: 'root', running: true },
      s2: { id: 's2', displayTitle: 'W2', origin: 'subagent', parentId: 'root', running: true },
      s3: { id: 's3', displayTitle: 'W3', origin: 'subagent', parentId: 'root', running: false },
    },
    current: 'root',
    subagentsByParent: {},
  }
  const rows = exports.buildFleet(live)
  assert.equal(rows[0].children.length, 3, 'live byId children render without any catalog')
  // All three RENDER; s3 is not running, so only the two live ones COUNT.
  assert.equal(exports.countFleet(rows).subagents, 2, 'count reflects the live swarm, not the roster')
}

// Union: catalog (cold, durable) + byId (live) with no double-counting.
{
  const mixed = {
    ids: ['r'],
    byId: {
      r: { id: 'r', displayTitle: 'Lead', running: true },
      c1: { id: 'c1', displayTitle: 'Shared', origin: 'subagent', parentId: 'r', running: true },
      live1: { id: 'live1', displayTitle: 'Fresh', origin: 'subagent', parentId: 'r', running: true },
    },
    current: 'r',
    subagentsByParent: {
      r: { state: 'ready', entries: [
        { kind: 'child', id: 'c1', mode: 'continuable', label: 'Shared', activity: 'running', hasChildren: false },
        { kind: 'child', id: 'cold', mode: 'one-shot', activity: 'inactive', hasChildren: false },
      ] },
    },
  }
  const rows = exports.buildFleet(mixed)
  const ids = rows[0].children.map((c) => c.id)
  // Union membership is what matters here; ORDER is now urgency-based, so the
  // live-only row surfaces above the cold roster entry.
  assert.deepEqual(ids, ['live1', 'c1', 'cold'], 'live rows lead, cold roster entries sink, no duplicates')
  assert.equal(new Set(ids).size, ids.length, 'no id appears twice')
  // The union RENDERS three (cold included); the stat counts only the live two.
  assert.equal(exports.countFleet(rows).subagents, 2, 'cold roster entries do not inflate the live count')
}

// Live grandchildren resolve even when the durable hasChildren hint is false.
{
  const deep = {
    ids: ['r'],
    byId: {
      r: { id: 'r', displayTitle: 'Lead', running: true },
      mid: { id: 'mid', displayTitle: 'Mid', origin: 'subagent', parentId: 'r', running: true },
      leaf: { id: 'leaf', displayTitle: 'Leaf', origin: 'subagent', parentId: 'mid', running: true },
    },
    current: 'r',
    subagentsByParent: {
      r: { state: 'ready', entries: [{ kind: 'child', id: 'mid', mode: 'continuable', label: 'Mid', activity: 'running', hasChildren: false }] },
    },
  }
  const rows = exports.buildFleet(deep)
  assert.equal(rows[0].children[0].children.length, 1, 'stale hasChildren:false still finds a live grandchild')
  assert.equal(exports.countFleet(rows).subagents, 2, 'both depths counted')
}

// --- REGRESSION: multi-subagent swarm must light up without a remount.
// A root is primed while still childless. The host does NOT push catalog
// updates for a parent whose catalog it never loaded, so a burst of subagents
// dispatched afterwards was invisible until the panel remounted. A RUNNING
// parent must therefore re-poll its catalog.
assert.equal(typeof exports.shouldPullCatalog, 'function', 'exports shouldPullCatalog')
assert.equal(typeof exports.CATALOG_REPOLL_MS, 'number', 'exports CATALOG_REPOLL_MS')
{
  const iv = exports.CATALOG_REPOLL_MS
  assert.equal(exports.shouldPullCatalog(undefined, false, 1_000), true, 'never-pulled parent pulls')
  assert.equal(exports.shouldPullCatalog(undefined, true, 1_000), true, 'never-pulled running parent pulls')
  assert.equal(exports.shouldPullCatalog(0, false, 10 * iv), false, 'settled parent never re-polls')
  assert.equal(exports.shouldPullCatalog(0, true, iv - 1), false, 'running parent waits out the interval')
  assert.equal(exports.shouldPullCatalog(0, true, iv), true, 'running parent re-polls after interval')
  assert.equal(exports.shouldPullCatalog(0, true, iv * 3), true, 'running parent keeps re-polling')
}

{
  const swarm = {
    ids: ['root'],
    byId: { root: { id: 'root', displayTitle: 'Lead', running: true } },
    current: 'root',
    subagentsByParent: {
      root: { state: 'ready', entries: [
        { kind: 'child', id: 'a', mode: 'continuable', label: 'one', activity: 'running', hasChildren: false },
        { kind: 'child', id: 'b', mode: 'continuable', label: 'two', activity: 'running', hasChildren: false },
        { kind: 'child', id: 'c', mode: 'continuable', label: 'three', activity: 'running', hasChildren: false },
      ] },
    },
  }
  const rows = exports.buildFleet(swarm)
  assert.equal(rows[0].children.length, 3, 'all three concurrent subagents render')
  assert.deepEqual(rows[0].children.map((c) => c.running), [true, true, true], 'each lights up as running')
  assert.equal(exports.countFleet(rows).subagents, 3, 'counts all three')
  assert.equal(exports.countFleet(rows).running, 1, 'running counts the root, NOT the swarm')
  assert.equal(exports.countFleet(rows).active, 4, 'active is root + three children')
  assert.equal(exports.treeRunning(rows[0]), true, 'root inherits running from the swarm')
}

{
  const loading = {
    ids: ['root'],
    byId: { root: { id: 'root', displayTitle: 'Lead', running: true } },
    current: 'root',
    subagentsByParent: { root: { state: 'loading' } },
  }
  const rows = exports.buildFleet(loading)
  assert.equal(rows[0].children.length, 0, 'loading catalog yields no rows yet')
  assert.equal(
    exports.shouldPullCatalog(0, rows[0].running, exports.CATALOG_REPOLL_MS),
    true,
    'but a running parent re-polls, so the swarm arrives on a later tick',
  )
}

// totalBurn aggregates
const burn = exports.totalBurn([
  { steps: 10, llmMs: 5_000, decodeTokens: 1_200 },
  { steps: 7, llmMs: 3_000, decodeTokens: 800 },
  undefined,
])
assert.deepEqual(burn, { steps: 17, llmMs: 8_000, decodeTokens: 2_000 })

// countFleet: stats must count exactly what renders
{
  const c = exports.countFleet([
    { id: 'a', title: 'Coordinator', running: true, children: [
      { id: 'b', title: 'Worker 1', running: true, children: [] },
      { id: 'c', title: 'Worker 2', running: false, pending: 'approval', children: [] },
    ] },
    { id: 'd', title: 'Docs', running: false, children: [] },
  ])
  assert.deepEqual(
    c,
    { sessions: 2, running: 1, subagents: 2, active: 3 },
    'roots and subagents counted on separate axes; active is the union',
  )
}

// --- REGRESSION: reported as "3 subagents running but shows 4", and the count
// never returning to 0. Two distinct defects in countFleet:
//   1. the ROOT was counted in `running` alongside its children (3 -> 4)
//   2. `subagents` counted the durable roster, so finished children kept
//      inflating it forever (a high-water mark that never decayed)
{
  const swarm = [{ id: 'root', title: 'Lead', running: true, children: [
    { id: 'a', title: 'one', running: true, children: [] },
    { id: 'b', title: 'two', running: true, children: [] },
    { id: 'c', title: 'three', running: true, children: [] },
  ] }]
  const live = exports.countFleet(swarm)
  assert.equal(live.subagents, 3, 'three running subagents count as exactly 3')
  assert.equal(live.running, 1, 'the parent is not double-counted into the swarm')
  assert.equal(live.active, 4, 'active still sees the whole tree (burn stays lit)')

  // All three finish. The catalog still lists them (durable roster), the tree
  // still renders them, but the stat must fall back to zero.
  const settled = [{ id: 'root', title: 'Lead', running: false, children: [
    { id: 'a', title: 'one', running: false, completed: true, children: [] },
    { id: 'b', title: 'two', running: false, completed: true, children: [] },
    { id: 'c', title: 'three', running: false, completed: true, children: [] },
  ] }]
  const done = exports.countFleet(settled)
  assert.equal(done.subagents, 0, 'subagents returns to 0 when none are live')
  assert.equal(done.running, 0, 'nothing running once the root settles')
  assert.equal(done.active, 0, 'burn indicator goes dark')

  // A child waiting on YOU is still live — it needs to stay visible.
  const waiting = [{ id: 'root', title: 'Lead', running: false, children: [
    { id: 'a', title: 'one', running: false, pending: 'approval', children: [] },
    { id: 'b', title: 'two', running: false, completed: true, children: [] },
  ] }]
  const w = exports.countFleet(waiting)
  assert.equal(w.subagents, 1, 'a subagent awaiting approval counts as live')
  assert.equal(w.active, 1, 'and keeps the panel lit')

  // Deep swarm: liveness is counted at every depth, staleness at none.
  const deep = [{ id: 'root', title: 'Lead', running: true, children: [
    { id: 'm', title: 'Mid', running: true, children: [
      { id: 'g1', title: 'G1', running: true, children: [] },
      { id: 'g2', title: 'G2', running: false, completed: true, children: [] },
    ] },
  ] }]
  const d = exports.countFleet(deep)
  assert.equal(d.subagents, 2, 'live mid + live grandchild; the finished one is excluded')
  assert.equal(d.running, 1, 'still one root')
}

// --- Newest subagents surface first. The durable catalog arrives oldest-first,
// which buries a freshly dispatched swarm under every agent that ran before it.
{
  const { orderSubagents } = exports
  assert.equal(typeof orderSubagents, 'function', 'exports orderSubagents')

  // Live before settled; within a tier, newest first.
  const mixed = [
    { id: 'a', title: 'a', running: false, updatedAt: 100, children: [] },
    { id: 'b', title: 'b', running: false, updatedAt: 300, children: [] },
    { id: 'c', title: 'c', running: true, children: [] },
    { id: 'd', title: 'd', running: false, pending: 'approval', children: [] },
  ]
  assert.deepEqual(
    orderSubagents(mixed).map((r) => r.id),
    ['d', 'c', 'b', 'a'],
    'waiting, then running, then settled newest-first',
  )

  // Purity: sorting must not reorder the caller's array in place.
  const orig = [
    { id: 'x', title: 'x', running: false, children: [] },
    { id: 'y', title: 'y', running: true, children: [] },
  ]
  const before = orig.map((r) => r.id)
  orderSubagents(orig)
  assert.deepEqual(orig.map((r) => r.id), before, 'input array is not mutated')

  // Cold catalog rows have NO updatedAt: catalog position is the fallback
  // ordinal (later in the catalog = created later = shown higher).
  const cold = [
    { id: 'first', title: 'first', running: false, children: [] },
    { id: 'second', title: 'second', running: false, children: [] },
    { id: 'third', title: 'third', running: false, children: [] },
  ]
  assert.deepEqual(
    orderSubagents(cold).map((r) => r.id),
    ['third', 'second', 'first'],
    'undated rows reverse catalog order so the newest lands on top',
  )

  // A real timestamp must never be outranked by a missing one via a bogus 0.
  const partial = [
    { id: 'dated', title: 'dated', running: false, updatedAt: 500, children: [] },
    { id: 'undated', title: 'undated', running: false, children: [] },
  ]
  assert.equal(
    orderSubagents(partial).length,
    2,
    'mixed dated/undated rows still sort without throwing',
  )
}

// A live swarm surfaces above older finished agents in the real tree.
{
  const list = {
    ids: ['sess'],
    byId: { sess: { id: 'sess', displayTitle: 'S', running: true, updatedAt: 9 } },
    current: 'sess',
    subagentsByParent: {
      sess: { state: 'ready', entries: [
        { kind: 'child', id: 'old1', mode: 'continuable', label: 'old1', activity: 'inactive', hasChildren: false },
        { kind: 'child', id: 'old2', mode: 'continuable', label: 'old2', activity: 'inactive', hasChildren: false },
        { kind: 'child', id: 'new1', mode: 'continuable', label: 'new1', activity: 'running', hasChildren: false },
        { kind: 'child', id: 'new2', mode: 'continuable', label: 'new2', activity: 'running', hasChildren: false },
      ] },
    },
  }
  const kids = exports.buildFleet(list)[0].children
  assert.deepEqual(
    kids.map((c) => c.id),
    ['new2', 'new1', 'old2', 'old1'],
    'the newest running agents lead; finished history sinks below them',
  )
}

// --- Per-session subagent collapse: toggle state + hidden-subtree size.
{
  const { toggleInSet, countDescendants } = exports
  assert.equal(typeof toggleInSet, 'function', 'exports toggleInSet')
  assert.equal(typeof countDescendants, 'function', 'exports countDescendants')

  // toggleInSet is immutable: React must see a new identity to re-render.
  const empty = new Set()
  const one = toggleInSet(empty, 'a')
  assert.notEqual(one, empty, 'returns a NEW set, never mutates in place')
  assert.equal(empty.size, 0, 'the original set is untouched')
  assert.deepEqual([...one], ['a'], 'adds a missing id')
  assert.deepEqual([...toggleInSet(one, 'a')], [], 'removes a present id')
  assert.deepEqual([...toggleInSet(one, 'b')].sort(), ['a', 'b'], 'independent ids coexist')

  // countDescendants walks the WHOLE subtree, not just direct children —
  // the badge on a folded row stands in for everything hidden beneath it.
  const flat = { id: 'r', title: 'R', running: true, children: [
    { id: 'a', title: 'A', running: true, children: [] },
    { id: 'b', title: 'B', running: true, children: [] },
  ] }
  assert.equal(countDescendants(flat), 2, 'counts direct children')

  const deep = { id: 'r', title: 'R', running: true, children: [
    { id: 'm', title: 'M', running: true, children: [
      { id: 'g1', title: 'G1', running: true, children: [] },
      { id: 'g2', title: 'G2', running: true, children: [
        { id: 'gg', title: 'GG', running: true, children: [] },
      ] },
    ] },
  ] }
  assert.equal(countDescendants(deep), 4, 'counts every depth, not just the first')
  assert.equal(
    countDescendants({ id: 'leaf', title: 'L', running: false, children: [] }),
    0,
    'a childless row has no descendants (no toggle is rendered)',
  )
}

// stageRows: running/waiting/recent roots, descendant activity qualifies the root
{
  const now = 1_000_000
  const stage = exports.stageRows([
    { id: 'a', title: 'Running', running: true, children: [] },
    { id: 'b', title: 'Waiting', running: false, pending: 'approval', updatedAt: now - 3_600_000, children: [] },
    { id: 'c', title: 'Recent', running: false, updatedAt: now - 10 * 60_000, children: [] },
    { id: 'd', title: 'Stale', running: false, updatedAt: now - 90 * 60_000, children: [] },
    { id: 'e', title: 'Quiet tree parent', running: false, updatedAt: now - 90 * 60_000, children: [
      { id: 'e1', title: 'Busy subagent', running: true, children: [] },
    ] },
  ], now, 30 * 60_000)
  assert.deepEqual(
    new Set(stage.map((r) => r.id)),
    new Set(['a', 'b', 'c', 'e']),
    'membership: running, waiting, recent, descendant-active',
  )
  const wide = exports.stageRows([
    { id: 'd', title: 'Stale', running: false, updatedAt: now - 90 * 60_000, children: [] },
  ], now, 120 * 60_000)
  assert.equal(wide.length, 1, 'widening the window admits older sessions')
}

// stageRank: waiting beats running beats recent, and a tree inherits its best child
{
  const mk = (over) => ({ id: 'x', title: 'x', running: false, children: [], ...over })
  assert.equal(exports.stageRank(mk({ pending: 'approval', running: true })), 0, 'waiting outranks running')
  assert.equal(exports.stageRank(mk({ running: true })), 1, 'running outranks recent')
  assert.equal(exports.stageRank(mk({ updatedAt: 5 })), 2, 'merely recent is last')
  assert.equal(
    exports.stageRank(mk({ children: [mk({ children: [mk({ pending: 'approval' })] })] })),
    0,
    'a quiet root inherits a deep waiting descendant',
  )
  assert.equal(
    exports.stageRank(mk({ children: [mk({ running: true })] })),
    1,
    'a quiet root inherits a running subagent',
  )
}

// stageRows ordering: most active first (far left), recency then input order break ties
{
  const now = 1_000_000
  const ordered = exports.stageRows([
    { id: 'recent-old', title: 'Recent', running: false, updatedAt: now - 20 * 60_000, children: [] },
    { id: 'run-a', title: 'Running A', running: true, updatedAt: now - 9 * 60_000, children: [] },
    { id: 'recent-new', title: 'Recent', running: false, updatedAt: now - 1 * 60_000, children: [] },
    { id: 'wait', title: 'Waiting', running: false, pending: 'approval', updatedAt: now - 25 * 60_000, children: [] },
    { id: 'run-b', title: 'Running B', running: true, updatedAt: now - 2 * 60_000, children: [] },
    { id: 'quiet-parent', title: 'Quiet parent', running: false, updatedAt: now - 25 * 60_000, children: [
      { id: 'busy-kid', title: 'Busy kid', running: true, updatedAt: now - 30_000, children: [] },
    ] },
  ], now, 30 * 60_000)
  assert.deepEqual(
    ordered.map((r) => r.id),
    ['wait', 'quiet-parent', 'run-b', 'run-a', 'recent-new', 'recent-old'],
    'ordering: waiting, then running by recency (subagent activity lifts its root), then recent',
  )

  // Stability: equal rank AND equal recency keeps the incoming grouped order.
  const tied = exports.stageRows([
    { id: 'first', title: 'A', running: true, updatedAt: now, children: [] },
    { id: 'second', title: 'B', running: true, updatedAt: now, children: [] },
  ], now, 30 * 60_000)
  assert.deepEqual(tied.map((r) => r.id), ['first', 'second'], 'full ties keep input order')
}

// sessions-per-workspace limit: default 3, expansion, "All", untrusted input
{
  assert.equal(exports.DEFAULT_SESSIONS_PER_WORKSPACE, 3, 'defaults to last 3 sessions')
  assert.equal(exports.SESSIONS_PER_WORKSPACE_ALL, 0, '0 is the "All" sentinel')

  const mkRows = (n, prefix) =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, title: `S${i}`, running: false, children: [] }))
  const groups = [
    { key: 'w1', title: 'Big', rows: mkRows(7, 'a') },
    { key: 'w2', title: 'Small', rows: mkRows(2, 'b') },
  ]

  const def = exports.limitGroups(groups, exports.DEFAULT_SESSIONS_PER_WORKSPACE)
  assert.equal(def[0].visible.length, 3, 'trims to the limit')
  assert.equal(def[0].hidden, 4, 'reports how many are hidden')
  assert.deepEqual(def[0].visible.map((r) => r.id), ['a0', 'a1', 'a2'], 'keeps the head (already sorted)')
  assert.equal(def[0].rows.length, 7, 'full rows are retained so counts stay honest')
  assert.equal(def[1].visible.length, 2, 'groups under the limit are untouched')
  assert.equal(def[1].hidden, 0, 'nothing hidden when everything fits')

  const expanded = exports.limitGroups(groups, 3, new Set(['w1']))
  assert.equal(expanded[0].visible.length, 7, 'expanded group shows every session')
  assert.equal(expanded[0].hidden, 0, 'expanded group hides nothing')
  assert.equal(expanded[1].visible.length, 2, 'expansion is per group')

  const all = exports.limitGroups(groups, exports.SESSIONS_PER_WORKSPACE_ALL)
  assert.equal(all[0].visible.length, 7, '"All" disables trimming')
  assert.equal(all[0].hidden, 0)

  // normalizeSessionLimit hardens the persisted (user-editable) value
  assert.equal(exports.normalizeSessionLimit(5), 5)
  assert.equal(exports.normalizeSessionLimit('10'), 10, 'numeric strings coerce')
  assert.equal(exports.normalizeSessionLimit(3.7), 3, 'floors fractions')
  assert.equal(exports.normalizeSessionLimit(-4), 0, 'negatives collapse to All')
  assert.equal(exports.normalizeSessionLimit('nonsense'), 3, 'garbage falls back to the default')
  assert.equal(exports.normalizeSessionLimit(undefined), 3, 'missing falls back to the default')
  assert.equal(exports.limitGroups(groups, 'nonsense')[0].visible.length, 3, 'bad limit still trims to default')
}

// parseSettings: defensive persisted-preference decoding
{
  const perWs = (raw) => exports.parseSettings(raw).sessionsPerWorkspace
  assert.equal(perWs(null), 3, 'missing prefs use defaults')
  assert.equal(perWs('{"sessionsPerWorkspace":10}'), 10)
  assert.equal(perWs('{"sessionsPerWorkspace":0}'), 0, 'All persists')
  assert.equal(perWs('not json'), 3, 'corrupt JSON falls back')
  assert.equal(perWs('[]'), 3, 'wrong shape falls back')
  assert.equal(perWs('{}'), 3, 'missing key falls back')
}

// computeRate: tok/s between samples
assert.equal(exports.computeRate(1000, 2000, 5000), 200)
assert.equal(exports.computeRate(undefined, 2000, 5000), 0)
assert.equal(exports.computeRate(2000, 1000, 5000), 0, 'negative deltas floor at 0')

// newWaitKeys: dedup across calls
{
  const seen = new Set()
  const w1 = { key: 'a:1', title: 'x' }
  assert.deepEqual(exports.newWaitKeys([w1], seen), ['a:1'], 'first sighting is fresh')
  assert.deepEqual(exports.newWaitKeys([w1], seen), [], 'second sighting is deduped')
  assert.deepEqual(exports.newWaitKeys([{ key: 'a:2', title: 'y' }], seen), ['a:2'])

  // Regression: the inbox builds { wait, title } wrappers, but the notifier
  // keys off the CARRIER (wait.key). Reading a top-level `key` primed
  // `undefined` as seen, so every later wait looked already-notified and
  // desktop notifications silently never fired. Assert the mapping the hook
  // now performs, and that an unmapped wrapper is still the broken case.
  const wrappers = [{ wait: { key: 'b:1' }, title: 'Session A' }]
  const keyed = wrappers.map((w) => ({ key: w.wait.key, title: w.title }))
  const seen2 = new Set()
  assert.deepEqual(exports.newWaitKeys(keyed, seen2), ['b:1'], 'carrier key is what dedups')
  assert.deepEqual(
    exports.newWaitKeys([{ wait: { key: 'b:2' }, title: 'B' }], new Set()),
    [undefined],
    'unmapped wrappers yield undefined keys — the bug this mapping prevents',
  )
}

// priceRowFor / estimateCost
assert.equal(exports.priceRowFor('anthropic/claude-sonnet-4-6')?.in, 3)
assert.ok(exports.estimateCost({ uncachedInputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, { in: 3, out: 15 }) === 3)
assert.equal(exports.estimateCost(undefined, { in: 3, out: 15 }), 0)


assert.equal(exports.fmtTokens(2_400_000), '2.4M')
assert.equal(exports.fmtTokens(15_000), '15.0k')
assert.equal(exports.fmtMs(90_000), '1.5m')
{
  const now = Date.now()
  assert.equal(exports.fmtRelative(now - 30_000, now), 'now')
  assert.equal(exports.fmtRelative(now - 12 * 60_000, now), '12m')
  assert.equal(exports.fmtRelative(now - 3 * 3_600_000, now), '3h')
  assert.equal(exports.fmtRelative(now - 2 * 86_400_000, now), '2d')
  assert.equal(exports.fmtRelative(undefined, now), '')
}

// elapsedSince: clamped elapsed primitive — the single source of elapsed truth
{
  const NOW = 1_769_000_000_000
  assert.equal(exports.elapsedSince(undefined, NOW), 0, 'undefined start → 0')
  assert.equal(exports.elapsedSince(NaN, NOW), 0, 'NaN start → 0')
  assert.equal(exports.elapsedSince(1.7e9, NOW), 0, 'epoch-SECONDS start (<1e12) → 0, never normalized')
  assert.equal(exports.elapsedSince(NOW + 5 * 60_000, NOW), 0, 'future/skewed start → 0')
  assert.equal(exports.elapsedSince(NOW - 90_000, NOW), 90_000, 'normal start → positive delta')
  assert.equal(exports.elapsedSince(NOW - 5_000, NOW - 10_000), 0, 'settled-duration clamp: end before start → 0')
  assert.equal(exports.fmtMs(-265_000), '0ms', 'fmtMs render net clamps negative input')
}

// buildGroups: blank+archived filtered, workspace rows + loose bucket
{
  const list2 = {
    ids: ['a', 'b', 'c', 'd'],
    byId: {
      a: { id: 'a', displayTitle: 'Real session', running: false, blank: false, updatedAt: 10 },
      b: { id: 'b', displayTitle: 'blank placeholder', running: false, blank: true, updatedAt: 9 },
      c: { id: 'c', displayTitle: 'Archived session', running: false, blank: false, updatedAt: 8 },
      d: { id: 'd', displayTitle: 'Loose session', running: false, blank: false, updatedAt: 7 },
    },
    current: undefined,
    subagentsByParent: {},
  }
  const workspaces = {
    items: [{ workspaceId: 'w1', path: 'C:/x', title: 'proj', sessionIds: ['a', 'c'] }],
    archivedSessionIds: ['c'],
  }
  const groups = exports.buildGroups(list2, workspaces)
  const w1 = groups.find((g) => g.key === 'w1')
  const ungrouped = groups.find((g) => g.key === '__ungrouped__')
  assert.ok(w1 && w1.rows.length === 1 && w1.rows[0].id === 'a', 'workspace group keeps only non-blank non-archived')
  assert.ok(ungrouped && ungrouped.rows.length === 1 && ungrouped.rows[0].id === 'd', 'loose rows land in the ungrouped bucket')
  assert.equal(w1.rows[0].workspace, 'proj', 'grouped rows carry their workspace title (Stage tile label)')
  assert.equal(ungrouped.rows[0].workspace, undefined, 'ungrouped rows carry no workspace title')
  // The Stage grid consumes flattened group rows — the tag must survive stageRows.
  const staged = exports.stageRows(groups.flatMap((g) => g.rows), 100, 1_000)
  assert.equal(staged.find((r) => r.id === 'a')?.workspace, 'proj', 'workspace survives stage filtering')
}

// Fleet sort order: attention rank first, then the configured order
{
  const row = (id, patch) => ({
    id, title: id, running: false, pending: undefined, completed: false,
    updatedAt: 0, outTokens: 0, children: [], ...patch,
  })

  // normalizeFleetSort hardens the persisted (user-editable) value
  assert.equal(exports.normalizeFleetSort('name'), 'name')
  assert.equal(exports.normalizeFleetSort('burn'), 'burn')
  assert.equal(exports.normalizeFleetSort('nonsense'), 'recent', 'unknown falls back to the default')
  assert.equal(exports.normalizeFleetSort(undefined), 'recent', 'missing falls back to the default')
  assert.equal(exports.normalizeFleetSort(null), 'recent')
  assert.equal(exports.DEFAULT_FLEET_SORT, 'recent', 'default is most-recently-active')
  assert.ok(
    exports.FLEET_SORT_CHOICES.some((c) => c.value === exports.DEFAULT_FLEET_SORT),
    'the default is offered by the settings UI',
  )

  const sorted = (rows, order) => [...rows].sort((a, b) => exports.compareFleetRows(a, b, order)).map((r) => r.id)

  // Recency (default): newest first.
  const byTime = [row('old', { updatedAt: 1 }), row('new', { updatedAt: 9 }), row('mid', { updatedAt: 5 })]
  assert.deepEqual(sorted(byTime), ['new', 'mid', 'old'], 'default orders most recently active first')
  assert.deepEqual(sorted(byTime, 'recent'), ['new', 'mid', 'old'])
  assert.deepEqual(sorted(byTime, 'oldest'), ['old', 'mid', 'new'], 'oldest reverses recency')

  // Attention rank outranks every order — a pending prompt never sinks.
  const mixed = [
    row('idle', { updatedAt: 100 }),
    row('pending', { updatedAt: 1, pending: {} }),
    row('running', { updatedAt: 2, running: true }),
    row('done', { updatedAt: 50, completed: true }),
  ]
  for (const order of ['recent', 'oldest', 'name', 'burn']) {
    assert.deepEqual(
      sorted(mixed, order),
      ['pending', 'running', 'done', 'idle'],
      `attention rank wins the first cut under ${order}`,
    )
  }

  // Name order is case-insensitive; burn is highest-first.
  const named = [row('b', { title: 'beta' }), row('A', { title: 'Alpha' }), row('c', { title: 'charlie' })]
  assert.deepEqual(sorted(named, 'name'), ['A', 'b', 'c'], 'name sorts case-insensitively')
  const burned = [row('lo', { outTokens: 5 }), row('hi', { outTokens: 900 }), row('mid', { outTokens: 50 })]
  assert.deepEqual(sorted(burned, 'burn'), ['hi', 'mid', 'lo'], 'burn puts the most expensive first')

  // Ties fall back to recency so ordering stays deterministic.
  const ties = [row('older', { title: 'same', updatedAt: 1 }), row('newer', { title: 'same', updatedAt: 9 })]
  assert.deepEqual(sorted(ties, 'name'), ['newer', 'older'], 'equal names tie-break on recency')
  assert.deepEqual(sorted(ties, 'burn'), ['newer', 'older'], 'equal burn ties-break on recency')

  // buildGroups threads the order through, and defaults to recency.
  const list3 = {
    ids: ['x', 'y'],
    byId: {
      x: { id: 'x', displayTitle: 'zulu', running: false, blank: false, updatedAt: 100 },
      y: { id: 'y', displayTitle: 'alpha', running: false, blank: false, updatedAt: 1 },
    },
    current: undefined,
    subagentsByParent: {},
  }
  const ws = { items: [{ workspaceId: 'w1', path: 'C:/x', title: 'proj', sessionIds: ['x', 'y'] }], archivedSessionIds: [] }
  assert.deepEqual(
    exports.buildGroups(list3, ws)[0].rows.map((r) => r.id), ['x', 'y'],
    'buildGroups defaults to most recently active first',
  )
  assert.deepEqual(
    exports.buildGroups(list3, ws, 'oldest')[0].rows.map((r) => r.id), ['y', 'x'],
    'buildGroups honours the requested order',
  )
  assert.deepEqual(
    exports.buildGroups(list3, ws, 'name')[0].rows.map((r) => r.id), ['y', 'x'],
    'buildGroups honours name order',
  )

  // Groups themselves are ordered by activity, not host registry order.
  {
    const mkList = (specs) => ({
      ids: specs.map((s) => s.id),
      byId: Object.fromEntries(specs.map((s) => [s.id, {
        id: s.id, displayTitle: s.id, running: s.running ?? false, blank: false,
        pendingInteraction: s.pending, completed: s.completed ?? false, updatedAt: s.updatedAt,
      }])),
      current: undefined,
      subagentsByParent: {},
    })

    // The reported case: two workspaces hold the newest sessions but the host
    // lists them last. They must surface at the top.
    const list = mkList([
      { id: 'stale1', updatedAt: 20 },
      { id: 'stale2', updatedAt: 10 },
      { id: 'dsh1', updatedAt: 900 },
      { id: 'mc1', updatedAt: 800 },
    ])
    const wsRegistryOrder = {
      items: [
        { workspaceId: 'w-old', path: 'C:/old', title: 'old-project', sessionIds: ['stale1'] },
        { workspaceId: 'w-older', path: 'C:/older', title: 'older-project', sessionIds: ['stale2'] },
        { workspaceId: 'w-dsh', path: 'C:/dsh', title: 'dsh', sessionIds: ['dsh1'] },
        { workspaceId: 'w-mc', path: 'C:/mc', title: 'dsh-mission-control', sessionIds: ['mc1'] },
      ],
      archivedSessionIds: [],
    }
    assert.deepEqual(
      exports.buildGroups(list, wsRegistryOrder).map((g) => g.title),
      ['dsh', 'dsh-mission-control', 'old-project', 'older-project'],
      'workspaces with the newest sessions sort to the top regardless of registry order',
    )

    // Ungrouped is pinned last even when it holds the newest session.
    const looseList = mkList([{ id: 'g1', updatedAt: 5 }, { id: 'loose', updatedAt: 9999 }])
    const looseWs = {
      items: [{ workspaceId: 'w1', path: 'C:/x', title: 'proj', sessionIds: ['g1'] }],
      archivedSessionIds: [],
    }
    assert.deepEqual(
      exports.buildGroups(looseList, looseWs).map((g) => g.key),
      ['w1', '__ungrouped__'],
      'the Ungrouped bucket stays last even holding the newest session',
    )

    // A pending prompt lifts its whole group above a more recently active one.
    const attnList = mkList([
      { id: 'busy', updatedAt: 9000 },
      { id: 'asking', updatedAt: 1, pending: {} },
    ])
    const attnWs = {
      items: [
        { workspaceId: 'w-busy', path: 'C:/b', title: 'busy', sessionIds: ['busy'] },
        { workspaceId: 'w-ask', path: 'C:/a', title: 'asking', sessionIds: ['asking'] },
      ],
      archivedSessionIds: [],
    }
    assert.deepEqual(
      exports.buildGroups(attnList, attnWs).map((g) => g.title), ['asking', 'busy'],
      'a group needing attention outranks a more recently active one',
    )

    // Name order sorts the groups by title too.
    assert.deepEqual(
      exports.buildGroups(list, wsRegistryOrder, 'name').map((g) => g.title),
      ['dsh', 'dsh-mission-control', 'old-project', 'older-project'],
      'name order sorts groups alphabetically',
    )
    // ...but a session-level order like "oldest" must NOT bury the live workspace.
    assert.deepEqual(
      exports.buildGroups(list, wsRegistryOrder, 'oldest').map((g) => g.title)[0], 'dsh',
      'session-level orders leave group ranking on activity',
    )
  }

  // The setting round-trips through persisted prefs.
  assert.equal(exports.parseSettings('{"fleetSort":"burn"}').fleetSort, 'burn', 'the order persists')
  assert.equal(exports.parseSettings('{}').fleetSort, 'recent', 'legacy prefs gain the default order')
  assert.equal(exports.parseSettings('{"fleetSort":"bogus"}').fleetSort, 'recent', 'corrupt order falls back')
}

// diffFleetEvents: prime, edge-triggered transitions, precedence, gone
{
  const mk = (entries) => new Map(entries)
  const A = { running: false, pending: undefined, completed: false, title: 'A' }
  assert.deepEqual(exports.diffFleetEvents(null, mk([['a', A]]), 1), [], 'prime emits nothing')

  let ev = exports.diffFleetEvents(
    mk([['a', A]]),
    mk([['a', { ...A }], ['b', { running: true, pending: undefined, completed: false, title: 'B' }]]),
    2,
  )
  assert.equal(ev.length, 1)
  assert.equal(ev[0].kind, 'new')

  ev = exports.diffFleetEvents(
    mk([['a', { running: false, pending: undefined, completed: false, title: 'A' }]]),
    mk([['a', { running: true, pending: undefined, completed: false, title: 'A' }]]),
    3,
  )
  assert.equal(ev.length, 1)
  assert.equal(ev[0].kind, 'run')

  ev = exports.diffFleetEvents(
    mk([['a', { running: true, pending: undefined, completed: false, title: 'A' }]]),
    mk([['a', { running: false, pending: 'approval', completed: false, title: 'A' }]]),
    4,
  )
  assert.equal(ev.length, 1)
  assert.equal(ev[0].kind, 'wait')
  assert.equal(ev[0].detail, 'approval')

  ev = exports.diffFleetEvents(
    mk([['a', { running: true, pending: undefined, completed: false, title: 'A' }]]),
    mk([['a', { running: false, pending: undefined, completed: false, title: 'A' }]]),
    5,
  )
  assert.equal(ev[0].kind, 'idle')

  ev = exports.diffFleetEvents(
    mk([['a', { running: true, pending: undefined, completed: false, title: 'A' }]]),
    mk([['a', { running: false, pending: undefined, completed: true, title: 'A' }]]),
    6,
  )
  assert.equal(ev[0].kind, 'done')

  ev = exports.diffFleetEvents(
    mk([['a', { running: false, pending: 'question', completed: false, title: 'A' }]]),
    mk([['a', { running: true, pending: undefined, completed: false, title: 'A' }]]),
    7,
  )
  assert.equal(ev[0].kind, 'wait-done')
  assert.equal(ev[0].detail, 'resumed')

  ev = exports.diffFleetEvents(mk([['a', A]]), mk([]), 8)
  assert.equal(ev.length, 1)
  assert.equal(ev[0].kind, 'gone')
}

  // mountAt suppression: pre-existing sessions hydrated late stay silent
  const mk = (entries) => new Map(entries)
  const OLD = { running: false, pending: undefined, completed: false, title: 'Old', updatedAt: 100 }
  const FRESH = { running: false, pending: undefined, completed: false, title: 'Fresh', updatedAt: 900 }
  const ev2 = exports.diffFleetEvents(mk([]), mk([['old', OLD], ['fresh', FRESH]]), 1000, 500)
  assert.equal(ev2.length, 1, 'only the post-mount session emits new')
  assert.equal(ev2[0].kind, 'new')
  assert.equal(ev2[0].sessionId, 'fresh')
  // default mountAt=0 keeps legacy behavior (samples without updatedAt)
  const ev3 = exports.diffFleetEvents(mk([]), mk([['old', OLD]]), 1000)
  assert.equal(ev3.length, 1)
  assert.equal(ev3[0].kind, 'new')

// lastErrorOf: trailing-node rule
{
  const nodes = new Map([
    ['n1', { kind: 'user', content: [{ type: 'text', text: 'hi' }] }],
    ['n2', { kind: 'turn-error', message: 'boom' }],
  ])
  const hit = exports.lastErrorOf({ chat: { order: ['n1', 'n2'], nodes } })
  assert.equal(hit.kind, 'error')
  assert.equal(hit.text, 'boom')
  const handled = exports.lastErrorOf({
    chat: { order: ['n1', 'n2', 'n3'], nodes: new Map([...nodes, ['n3', { kind: 'assistant', blocks: [] }]]) },
  })
  assert.equal(handled, null, 'a later node means the error was handled')
  assert.equal(exports.lastErrorOf({ chat: null, lastAgentError: 'late' })?.text, 'late')
  assert.equal(exports.lastErrorOf(undefined), null)
  assert.equal(exports.lastErrorOf({ chat: { order: [], nodes: new Map() } }), null, 'empty assembled chat')
}

// extractTail: real chat view-node shape — payloads under `data`, kinds
// user / assistant-step / tool-call; chrome kinds and hidden nodes skipped
{
  const nodes = new Map([
    ['n1', { key: 'n1', kind: 'user', visibility: 'visible', data: { content: [{ type: 'text', text: 'fix the bug' }] } }],
    ['n2', { key: 'n2', kind: 'assistant-step', visibility: 'visible', data: { blocks: [
      { kind: 'reasoning', text: 'thinking…' },
      { kind: 'text', text: 'on it' },
      { kind: 'tool-call', callId: 'c1', name: 'pwsh', argsRaw: '{}' },
    ] } }],
    ['n3', { key: 'n3', kind: 'tool-call', visibility: 'visible', data: { root: { callId: 'c1', name: 'pwsh', argsRaw: '{"command":"dir"}', time: 500, subCalls: [] } } }],
    ['n4', { key: 'n4', kind: 'turn-tail', visibility: 'visible', data: { turn: 1, seq: 9, time: 1 } }],
    ['n5', { key: 'n5', kind: 'assistant-step', visibility: 'hidden', data: { blocks: [{ kind: 'text', text: 'secret' }] } }],
  ])
  const tail = exports.extractTail({ chat: { order: ['n1', 'n2', 'n3', 'n4', 'n5'], nodes } }, 30)
  assert.deepEqual(tail.map((t) => t.kind), ['user', 'assistant', 'tool'], 'view-node kinds map to tile kinds')
  assert.equal(tail[0].text, 'fix the bug', 'user text from data.content')
  assert.ok(tail[1].text.includes('thinking…') && tail[1].text.includes('on it'), 'assistant text+reasoning from data.blocks')
  assert.equal(tail[2].text, 'pwsh', 'tool label from data.root.name')
  assert.equal(tail[2].tool?.running, true, 'tool detail marks the in-flight call')
  assert.equal(tail[2].tool?.argsRaw, '{"command":"dir"}', 'tool detail carries the call args')
  assert.equal(tail[2].tool?.startedAt, 500, 'tool detail carries the call time')
  assert.ok(!tail.some((t) => t.text === 'secret'), 'hidden nodes skipped')
}

// lastErrorOf: view-node payloads live under data; turn-tail chrome never handles an error
{
  const nodes = new Map([
    ['n1', { kind: 'user', data: { content: [{ type: 'text', text: 'hi' }] } }],
    ['n2', { kind: 'turn-error', data: { message: 'boom' } }],
    ['n3', { kind: 'turn-tail', data: { turn: 1, seq: 5, time: 1 } }],
  ])
  const hit = exports.lastErrorOf({ chat: { order: ['n1', 'n2', 'n3'], nodes } })
  assert.equal(hit.kind, 'error')
  assert.equal(hit.text, 'boom', 'error text read from data.message past trailing turn-tail')
}

// llmActivityOf: LLM phase from partial blocks, turn timings, running calls
// (fixtures on epoch-ms — elapsedSince rejects sub-1e12 starts as corrupt)
{
  const NOW = 1_769_000_000_000
  assert.equal(exports.llmActivityOf(undefined, NOW), null, 'no snapshot → null')
  assert.equal(exports.llmActivityOf({ running: false }, NOW), null, 'idle → null')

  // waiting: running, nothing visible yet; elapsed from the newest open turn
  const timings = new Map([
    [2, { startTime: NOW - 60_000, endTime: NOW - 50_000 }],
    [3, { startTime: NOW - 2_500 }],
  ])
  const w = exports.llmActivityOf({ running: true, turnTimings: timings }, NOW)
  assert.equal(w.phase, 'waiting')
  assert.equal(w.elapsedMs, 2_500, 'elapsed from the newest open turn')

  // streaming: last visible block is text; elapsed from the partial's turn
  const s = exports.llmActivityOf({
    running: true,
    turnTimings: new Map([[4, { startTime: NOW - 1_000 }]]),
    partial: { turn: 4, step: 1, blocks: [{ kind: 'text', text: 'hello' }] },
  }, NOW)
  assert.equal(s.phase, 'streaming')
  assert.equal(s.elapsedMs, 1_000)

  // reasoning: last visible block is reasoning; no timing → zero elapsed
  const r = exports.llmActivityOf({
    running: true,
    partial: { turn: 4, step: 1, blocks: [{ kind: 'text', text: 'x' }, { kind: 'reasoning', text: 'hmm' }] },
  }, NOW)
  assert.equal(r.phase, 'reasoning')
  assert.equal(r.elapsedMs, 0, 'no timing for the turn → zero elapsed')

  // tools: running calls win; names deduped, elapsed from the oldest call
  const t = exports.llmActivityOf({
    running: true,
    partial: { turn: 4, step: 1, blocks: [{ kind: 'text', text: 'x' }] },
    runningCalls: [
      { name: 'pwsh', time: NOW - 800 },
      { name: 'pwsh', time: NOW - 500 },
      { name: 'fs', time: NOW - 300 },
    ],
  }, NOW)
  assert.equal(t.phase, 'tools')
  assert.equal(t.detail, 'pwsh + fs')
  assert.equal(t.elapsedMs, 800)

  const t3 = exports.llmActivityOf({ running: true, runningCalls: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }, NOW)
  assert.equal(t3.detail, 'a + b +1', 'third+ names collapse into a count')
}

// toolDetailOf: running call vs settled result details
{
  const run = exports.toolDetailOf({ callId: 'c1', name: 'pwsh', argsRaw: '{"command":"dir"}', time: 500, subCalls: [{}, {}] })
  assert.equal(run.running, true)
  assert.equal(run.name, 'pwsh')
  assert.equal(run.argsRaw, '{"command":"dir"}')
  assert.equal(run.startedAt, 500)
  assert.equal(run.subCalls, 2)
  assert.equal(run.endedAt, undefined, 'no end while running')

  const ok = exports.toolDetailOf({
    kind: 'tool-result',
    callId: 'c2',
    time: 5_000,
    callTime: 4_800,
    call: { name: 'fs', argsRaw: '{"path":"x"}' },
    content: [{ type: 'text', text: 'ok' }, { type: 'image' }],
    isError: false,
    subCalls: [],
  })
  assert.equal(ok.running, false)
  assert.equal(ok.name, 'fs', 'settled name from the paired call head')
  assert.equal(ok.startedAt, 4_800)
  assert.equal(ok.endedAt, 5_000)
  assert.equal(ok.resultText, 'ok', 'text blocks joined, non-text skipped')
  assert.equal(ok.isError, false)

  const err = exports.toolDetailOf({
    kind: 'tool-result',
    callId: 'c3',
    time: 7_000,
    callTime: 6_900,
    call: { name: 'bash', argsRaw: '{}' },
    content: [],
    isError: true,
    error: { name: 'ENOENT', code: '404' },
  })
  assert.equal(err.isError, true)
  assert.equal(err.error, 'ENOENT 404')
  assert.equal(err.resultText, undefined, 'no text content → no result block')

  assert.equal(exports.toolDetailOf({}).name, 'tool', 'unknown root falls back to the generic label')
}

// shouldOpenHistory: off-stage tiles must hydrate their own history window.
// Regression — the host only calls session.open() for the STAGED session, so
// cold sessions rendered "status only" with an empty chat.
{
  const { shouldOpenHistory, extractTail } = exports
  assert.equal(typeof shouldOpenHistory, 'function', 'exports shouldOpenHistory')
  assert.equal(shouldOpenHistory('cold'), true, 'cold (never staged) → we open it')
  assert.equal(shouldOpenHistory(undefined), true, 'missing field → treat as cold (open is idempotent)')
  assert.equal(shouldOpenHistory('loading'), false, 'in-flight open is not duplicated')
  assert.equal(shouldOpenHistory('open'), false, 'already open → no refetch')
  assert.equal(shouldOpenHistory('error'), false, 'failed open is not retried every flush')

  // the cold snapshot really is empty — this is what produced the fallback
  assert.deepEqual(
    extractTail({ openState: 'cold', chat: { order: [], nodes: new Map() } }, 30),
    [],
    'a cold window has no chat nodes (the status-only cause)',
  )
  // and once opened, the same tile renders the conversation
  const opened = {
    openState: 'open',
    chat: {
      order: ['n1'],
      nodes: new Map([['n1', { key: 'n1', kind: 'user', visibility: 'visible', data: { content: [{ type: 'text', text: 'hello' }] } }]]),
    },
  }
  assert.equal(extractTail(opened, 30).length, 1, 'an opened window yields conversation entries')
}

// --- 4/5) apply() against a stub ctx registering into shell.overlay
//
// The stub is wrapped in a Proxy that reproduces cordis's REAL gating rule:
// reading a service the plugin did not declare in `inject` THROWS rather than
// returning undefined. A permissive plain-object stub is what let the missing
// `remote` declaration pass this suite while failing the desktop loader — the
// test handed over any service asked for, the harness does not. Anything the
// plugin touches must therefore appear in `exports.inject` or this blows up,
// which makes the guard cover services added in the future, not just today's.

/** Context members cordis always exposes; these are framework, not services. */
const CTX_FRAMEWORK = new Set(['effect', 'inject'])

/**
 * Gate `target` the way a cordis fiber gates a context, recording every
 * service actually reached.
 * @param target - the stub context object.
 * @param declared - the plugin's own `inject` list.
 * @param touched - set that collects each service name read.
 * @returns a proxy throwing on any undeclared service get.
 */
function guardCtx(target, declared, touched = new Set()) {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      // Symbols and framework members are never service lookups.
      if (typeof prop === 'symbol' || CTX_FRAMEWORK.has(prop)) {
        return Reflect.get(obj, prop, receiver)
      }
      touched.add(prop)
      if (!declared.includes(prop)) {
        // Same shape as the harness error, so a failure here reads like the
        // real one: `cannot get property "remote" without inject`.
        throw new Error(`cannot get property "${prop}" without inject`)
      }
      return Reflect.get(obj, prop, receiver)
    },
  })
}

/** Minimal ObservableSnapshot<T> double — what `useObservable` binds to. */
const stubObservable = (value) => ({ getSnapshot: () => value, subscribe: () => () => {} })

/**
 * Build a fresh stub context plus a handle on whatever slot it registers.
 * Every service the panel consumes is present, so a render exercises the real
 * read paths rather than dying on a missing double.
 * @returns the stub and a getter for the registered slot entry.
 */
function makeStubCtx() {
  let slot = null
  const ctx = {
    effect(fn, label) {
      fn()
      return () => {}
    },
    // The host state bridge: $mount resolves, but the namespace never becomes
    // injectable — the panel must stay on localStorage without hanging.
    remote: { $mount: async () => async () => {} },
    inject(services, callback) {
      return { dispose() {} }
    },
    slots: {
      inject(key, callback) {
        // test double: declaration exists immediately, so run the effect now
        return callback()
      },
      register(spec, component) {
        slot = { spec, component }
      },
    },
    sessions: {
      list: stubObservable({ ids: [], byId: {}, current: undefined, subagentsByParent: {} }),
      scope: stubObservable({}),
      binding: stubObservable({}),
      sessionOf: () => undefined,
      subagentAddress: () => undefined,
      open: () => {},
      openSubagent: () => {},
      fork: () => {},
      refreshSubagents: () => {},
      setSubagentCatalogOpen: () => {},
    },
    workspaces: { list: stubObservable({ items: [] }) },
    modelDirectories: { list: stubObservable({ items: [] }) },
  }
  return { ctx, getSlot: () => slot }
}

const { ctx: stubCtx, getSlot } = makeStubCtx()
const guardedCtx = guardCtx(stubCtx, exports.inject)
exports.apply(guardedCtx)
const slotRegistered = getSlot()
assert.ok(slotRegistered, 'apply() registered a slot entry')
assert.equal(slotRegistered.spec.name, 'shell.overlay', 'registered into shell.overlay')
assert.equal(typeof slotRegistered.component, 'function', 'component is renderable')

// React.createElement smoke on the registered component
const React = require('react')
const element = slotRegistered.component()
assert.equal(element.type.name, 'MissionControl', 'renders MissionControl')

// --- REGRESSION (startup): the declared inject list must EQUAL the set of
// services the plugin actually reads.
//
// apply() alone only reaches `slots` and `remote`; the panel reads `sessions`,
// `workspaces` and `modelDirectories` from its render path. So drive a real
// server render through the same cordis-faithful proxy and compare the two
// sets. Under-declaring throws inside the proxy (the bug that broke desktop
// startup); over-declaring leaves a stale name the equality check catches.
//
// Scanning the source for `ctx.<name>` was rejected as the mechanism: it reads
// commented-out mentions as real uses and misses cast accesses like
// `(ctx as unknown as {...}).modelDirectories`. Executing the code cannot lie.
{
  // A second instance is needed because the plugin calls the 2-argument
  // useSyncExternalStore, which React's server renderer rejects outright. The
  // test owns module resolution, so hand this instance a uSES that reads the
  // snapshot directly. Isolated from `exports` so no other assertion shifts.
  const ssrRegistered = []
  const priorWindow = globalThis.window
  globalThis.window = { __ModuleLoader__: { load: (e) => ssrRegistered.push(e) } }
  await import(`${pathToFileURL(join(root, 'lib/client.js')).href}?ssr=1`)
  globalThis.window = priorWindow
  assert.equal(ssrRegistered.length, 1, 'ssr instance registers exactly one module')

  const ssrReact = Object.create(require('react'))
  ssrReact.useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot()
  const ssrTable = { react: ssrReact, 'react/jsx-runtime': require('react/jsx-runtime') }
  const ssrExports = ssrRegistered[0].factory((id) => {
    if (!(id in ssrTable)) throw new Error(`unexpected require: ${id}`)
    return ssrTable[id]
  })

  const touched = new Set()
  const { ctx: ssrCtx, getSlot: getSsrSlot } = makeStubCtx()
  // Throws `cannot get property "X" without inject` on the first undeclared
  // read, in apply() or anywhere down the render tree.
  ssrExports.apply(guardCtx(ssrCtx, ssrExports.inject, touched))

  const { renderToStaticMarkup } = require('react-dom/server')
  const html = renderToStaticMarkup(getSsrSlot().component())
  assert.ok(html.length > 0, 'the panel server-renders through the guarded ctx')

  assert.deepEqual(
    [...touched].sort(),
    [...ssrExports.inject].sort(),
    'inject declares exactly the services the plugin reads (no missing, no stale)',
  )
}

// --- REGRESSION: the panel must SUBSCRIBE to catalog membership.
// The host refetches a parent's catalog on host/session-added only when that
// parent is the SELECTED session or is registered via setSubagentCatalogOpen.
// Mission Control selects nothing, so without registering every visible root it
// is never told a swarm spawned and the subagent count stays frozen.
{
  const { openCatalogSubscriptions } = exports
  assert.equal(typeof openCatalogSubscriptions, 'function', 'exports openCatalogSubscriptions')

  // Registers every watched root, and reports exactly what it opened.
  const calls = []
  const sessions = {
    setSubagentCatalogOpen: (id, open) => calls.push([String(id), open]),
  }
  const res = openCatalogSubscriptions(sessions, ['r1', 'r2', 'r3'], true)
  assert.deepEqual(res.opened, ['r1', 'r2', 'r3'], 'reports every registered root')
  assert.equal(res.supported, true, 'seam present')
  assert.deepEqual(
    calls,
    [['r1', true], ['r2', true], ['r3', true]],
    'subscribes each visible root — this is what makes a spawned swarm arrive',
  )

  // Cleanup closes precisely what was opened.
  calls.length = 0
  openCatalogSubscriptions(sessions, res.opened, false)
  assert.deepEqual(
    calls,
    [['r1', false], ['r2', false], ['r3', false]],
    'deregisters exactly the opened set',
  )

  // A throwing parent (vanished mid-pass) must not abort the rest.
  const partial = openCatalogSubscriptions(
    { setSubagentCatalogOpen: (id) => { if (String(id) === 'bad') throw new Error('gone') } },
    ['ok1', 'bad', 'ok2'],
    true,
  )
  assert.deepEqual(partial.opened, ['ok1', 'ok2'], 'a failing parent is skipped, others still register')

  // Older host without the seam: degrade quietly, never throw.
  const legacy = openCatalogSubscriptions({}, ['r1'], true)
  assert.deepEqual(legacy, { opened: [], supported: false }, 'missing seam degrades gracefully')
  assert.doesNotThrow(() => openCatalogSubscriptions(undefined, ['r1'], true), 'undefined service is safe')
}

// Cross-TZ invariance: identical formatter output under LA and Shanghai
{
  const { spawnSync } = await import('node:child_process')
  const outs = ['America/Los_Angeles', 'Asia/Shanghai'].map((tz) => {
    const r = spawnSync(process.execPath, ['test/tz-child.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    })
    assert.equal(r.status, 0, `tz-child exited clean under ${tz}: ${r.stderr}`)
    return JSON.parse(r.stdout.trim().split('\n').pop())
  })
  assert.notEqual(outs[0].offset, outs[1].offset, 'control: children really run in different TZs')
  assert.notEqual(outs[0].tz, outs[1].tz, 'control: resolved TZ names differ')
  for (const key of ['elapsed', 'fmtMs', 'fmtRelative']) {
    assert.deepEqual(outs[0][key], outs[1][key], `${key} output is TZ-invariant`)
  }
  for (const e of outs[0].elapsed) assert.ok(e >= 0, 'elapsed never negative')
}

// --- 8) inbox question parsing: real questions + options, 1:1 with the ask
{
  const { questionsOf, waitHeadline, toggleSelection, answerComplete, buildAnswer } = exports
  assert.equal(typeof questionsOf, 'function', 'exports questionsOf')
  assert.equal(typeof waitHeadline, 'function', 'exports waitHeadline')
  assert.equal(typeof buildAnswer, 'function', 'exports buildAnswer')

  const q1 = {
    id: 'mode',
    question: 'Which mode should I use?',
    header: 'Choose Mode',
    options: [{ label: 'Fast', description: 'Less thorough' }, { label: 'Thorough' }],
  }
  const q2 = { id: 'confirm', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }
  const questionWait = { kind: 'question', payload: { questions: [q1, q2] } }

  // the real questions come through verbatim — this is the 1:1 requirement
  assert.deepEqual(questionsOf(questionWait), [q1, q2], 'questionsOf returns the ask verbatim')
  assert.deepEqual(
    questionsOf(questionWait)[0].options.map((o) => o.label),
    ['Fast', 'Thorough'],
    'the real options survive intact',
  )

  // headline shows the question text, not the literal word "question"
  assert.equal(
    waitHeadline(questionWait),
    'Choose Mode: Which mode should I use? (+1 more)',
    'question headline uses real text + batch count',
  )
  assert.equal(
    waitHeadline({ kind: 'question', payload: { questions: [q2] } }),
    'Proceed?',
    'single question headline is the question itself',
  )

  // approvals keep their existing headline behaviour
  assert.equal(
    waitHeadline({ kind: 'approval', payload: { toolName: 'pwsh' } }),
    'pwsh needs approval',
    'approval headline falls back to toolName',
  )
  assert.equal(
    waitHeadline({ kind: 'approval', payload: { reason: 'writes outside workspace' } }),
    'writes outside workspace',
    'approval headline prefers reason',
  )

  // malformed / absent payloads degrade instead of throwing
  assert.deepEqual(questionsOf({ kind: 'question', payload: {} }), [], 'missing questions -> none')
  assert.deepEqual(questionsOf({ kind: 'question' }), [], 'missing payload -> none')
  assert.deepEqual(questionsOf({ kind: 'question', payload: { questions: 'nope' } }), [], 'non-array -> none')
  assert.deepEqual(questionsOf({ kind: 'approval', payload: { questions: [q1] } }), [], 'approval kind -> none')
  assert.deepEqual(
    questionsOf({ kind: 'question', payload: { questions: [q1, null, { id: 'x' }] } }),
    [q1],
    'malformed entries are dropped',
  )

  // pendingOf: the seam that lets a Stage tile render its own waits. Reads the
  // same carriers off the live snapshot, so a question shows up in the tile the
  // operator is already watching instead of only in the inbox.
  const { pendingOf } = exports
  assert.equal(typeof pendingOf, 'function', 'exports pendingOf')
  const approvalCarrier = { kind: 'approval', key: 'w1', sessionId: 'a', payload: { toolName: 'pwsh' }, respond: async () => ({}) }
  const questionCarrier = { kind: 'question', key: 'w2', sessionId: 'a', payload: { questions: [q1] }, respond: async () => ({}) }
  assert.deepEqual(
    pendingOf({ pending: [approvalCarrier, questionCarrier] }),
    [approvalCarrier, questionCarrier],
    'pendingOf returns live carriers verbatim',
  )
  // a tile must survive a face that never reports waits, or reports junk
  assert.deepEqual(pendingOf(undefined), [], 'no snapshot -> no waits')
  assert.deepEqual(pendingOf({}), [], 'snapshot without pending -> no waits')
  assert.deepEqual(pendingOf({ pending: 'nope' }), [], 'non-array pending -> no waits')
  assert.deepEqual(
    pendingOf({ pending: [approvalCarrier, null, { key: 'k' }, { respond: () => {} }] }),
    [approvalCarrier],
    'carriers without key/respond are dropped',
  )
  // the tile routes on the same kind test the inbox uses
  assert.equal(questionsOf(pendingOf({ pending: [questionCarrier] })[0]).length, 1, 'question carrier routes to the question card')
  assert.equal(questionsOf(pendingOf({ pending: [approvalCarrier] })[0]).length, 0, 'approval carrier routes to the approval card')

  // single-select replaces; re-picking clears
  let a = toggleSelection(undefined, 'mode', 'Fast', false)
  assert.deepEqual(a.selected, ['Fast'], 'single-select picks')
  a = toggleSelection(a, 'mode', 'Thorough', false)
  assert.deepEqual(a.selected, ['Thorough'], 'single-select replaces')
  a = toggleSelection(a, 'mode', 'Thorough', false)
  assert.deepEqual(a.selected, [], 'single-select toggles off')

  // multi-select accumulates
  let m = toggleSelection(undefined, 'mode', 'Fast', true)
  m = toggleSelection(m, 'mode', 'Thorough', true)
  assert.deepEqual(m.selected, ['Fast', 'Thorough'], 'multi-select accumulates')
  m = toggleSelection(m, 'mode', 'Fast', true)
  assert.deepEqual(m.selected, ['Thorough'], 'multi-select removes')

  // completeness gates the send button
  assert.equal(answerComplete([q1, q2], {}), false, 'empty draft is incomplete')
  assert.equal(
    answerComplete([q1, q2], { mode: { id: 'mode', selected: ['Fast'] } }),
    false,
    'partial draft is incomplete',
  )
  assert.equal(
    answerComplete([q1, q2], {
      mode: { id: 'mode', selected: ['Fast'] },
      confirm: { id: 'confirm', selected: ['Yes'] },
    }),
    true,
    'every question answered is complete',
  )
  assert.equal(
    answerComplete([q2], { confirm: { id: 'confirm', selected: [], custom: 'maybe later' } }),
    true,
    'custom text alone satisfies a question',
  )
  assert.equal(
    answerComplete([q2], { confirm: { id: 'confirm', selected: [], custom: '   ' } }),
    false,
    'whitespace-only custom text does not satisfy',
  )
  assert.equal(answerComplete([], {}), false, 'no questions is never complete')

  // the wire payload matches the user-questions batch contract
  assert.deepEqual(
    buildAnswer([q1, q2], {
      mode: { id: 'mode', selected: ['Fast'] },
      confirm: { id: 'confirm', selected: ['Yes'], custom: '  ' },
    }),
    { answers: [{ id: 'mode', selected: ['Fast'] }, { id: 'confirm', selected: ['Yes'] }] },
    'buildAnswer emits { answers: [{id, selected}] } and drops blank custom',
  )
  assert.deepEqual(
    buildAnswer([q2], { confirm: { id: 'confirm', selected: [], custom: ' other ' } }),
    { answers: [{ id: 'confirm', selected: [], custom: 'other' }] },
    'buildAnswer trims and keeps real custom text',
  )
}

// --- 10) pomodoro: pure timer reducer + formatting
{
  const {
    normalizeMinutes, phaseDurationMs, nextPhase, initialPomodoro, remainingOf,
    advancePomodoro, startPomodoro, pausePomodoro, resetPomodoro, skipPomodoro, displayNow,
    fmtClock, phaseLabel, phaseProgress, parseSettings, idleSyncKey, serializePomodoroState, parsePomodoroState,
    packPomodoroEnvelope, parsePomodoroEnvelope,
    DEFAULT_WORK_MINUTES, DEFAULT_BREAK_MINUTES, DEFAULT_LONG_BREAK_MINUTES,
    POMODORO_LONG_EVERY, POMODORO_MIN_MINUTES, POMODORO_MAX_MINUTES,
  } = exports

  assert.equal(DEFAULT_WORK_MINUTES, 25, 'default work stretch is 25 minutes')
  assert.equal(DEFAULT_BREAK_MINUTES, 5, 'default break is 5 minutes')
  assert.equal(DEFAULT_LONG_BREAK_MINUTES, 15, 'default long break is 15 minutes')

  // normalizeMinutes clamps untrusted input
  assert.equal(normalizeMinutes(30, 25), 30, 'valid minutes pass through')
  assert.equal(normalizeMinutes('45', 25), 45, 'numeric strings from inputs parse')
  assert.equal(normalizeMinutes(undefined, 25), 25, 'missing falls back')
  assert.equal(normalizeMinutes('abc', 25), 25, 'garbage falls back')
  assert.equal(normalizeMinutes(NaN, 25), 25, 'NaN falls back')
  assert.equal(normalizeMinutes(0, 25), POMODORO_MIN_MINUTES, 'zero clamps up to the minimum')
  assert.equal(normalizeMinutes(-5, 25), POMODORO_MIN_MINUTES, 'negatives clamp up')
  assert.equal(normalizeMinutes(9999, 25), POMODORO_MAX_MINUTES, 'huge values clamp down')
  assert.equal(normalizeMinutes(25.6, 25), 26, 'fractions round to whole minutes')

  const config = { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15 }
  assert.equal(phaseDurationMs('work', config), 25 * 60_000)
  assert.equal(phaseDurationMs('break', config), 5 * 60_000)
  assert.equal(phaseDurationMs('long', config), 15 * 60_000)

  // a fresh timer is parked, not running — it never starts on its own
  const fresh = initialPomodoro(config)
  assert.equal(fresh.running, false, 'timer does not auto-start')
  assert.equal(fresh.phase, 'work', 'starts on a focus stretch')
  assert.equal(remainingOf(fresh, 0), 25 * 60_000, 'full work duration remains')
  assert.equal(fmtClock(remainingOf(fresh, 0)), '25:00')

  // start / pause banks the remainder rather than losing it
  const started = startPomodoro(fresh, 1_000, config)
  assert.equal(started.running, true)
  assert.equal(started.endsAt, 1_000 + 25 * 60_000, 'endsAt is absolute wall-clock')
  assert.equal(remainingOf(started, 1_000 + 60_000), 24 * 60_000, 'one minute in, 24 remain')
  const paused = pausePomodoro(started, 1_000 + 60_000)
  assert.equal(paused.running, false)
  assert.equal(paused.remainingMs, 24 * 60_000, 'pause banks the remainder')
  const resumed = startPomodoro(paused, 500_000, config)
  assert.equal(resumed.endsAt, 500_000 + 24 * 60_000, 'resume continues from the banked remainder')

  // REGRESSION: the shared ticker samples Date.now() once a second, so the
  // render that follows a Start click can still hold a 'now' from up to 999ms
  // BEFORE the phase began. Reading at that stale instant used to report more
  // time than the phase has, and fmtClock's ceil showed "25:01" on a 25:00
  // phase. displayNow clamps to the phase start.
  {
    const tickNow = 10_000
    for (const lag of [0, 1, 200, 500, 800, 999]) {
      const s = startPomodoro(initialPomodoro(config), tickNow + lag, config)
      const at = displayNow(s, tickNow)
      assert.equal(
        fmtClock(remainingOf(s, at)),
        '25:00',
        `a start ${lag}ms after the last tick still reads 25:00`,
      )
      assert.ok(
        remainingOf(s, at) <= phaseDurationMs('work', config),
        'the readout never exceeds the configured duration',
      )
      assert.ok(phaseProgress(s, at, config) >= 0, 'progress never goes negative')
    }
    // resume after a pause has the same hazard: endsAt moves, the tick does not
    const paused = pausePomodoro(startPomodoro(initialPomodoro(config), 0, config), 60_000)
    const resumedLate = startPomodoro(paused, tickNow + 700, config)
    assert.equal(
      fmtClock(remainingOf(resumedLate, displayNow(resumedLate, tickNow))),
      '24:00',
      'resuming mid-tick reports the banked remainder exactly',
    )
    // a fresh (never-started) timer has no phase start to clamp to
    assert.equal(displayNow(initialPomodoro(config), 12_345), 0, 'a parked timer reads at 0')
    // once the clock is genuinely ahead, the real value is used unchanged
    const running = startPomodoro(initialPomodoro(config), tickNow, config)
    assert.equal(displayNow(running, tickNow + 5_000), tickNow + 5_000, 'live time passes through')
    assert.equal(fmtClock(remainingOf(running, displayNow(running, tickNow + 60_000))), '24:00')
  }

  // no boundary crossed before the phase actually elapses
  assert.equal(advancePomodoro(started, 1_000 + 60_000, config).elapsed, null, 'mid-phase yields no event')
  assert.equal(advancePomodoro(fresh, 9e9, config).elapsed, null, 'a paused timer never elapses')

  // work elapses into a break and counts the stretch
  const done = advancePomodoro(started, started.endsAt + 5, config)
  assert.equal(done.elapsed, 'work', 'reports the phase that just ended')
  assert.equal(done.state.phase, 'break', 'work rolls into a break')
  assert.equal(done.state.completed, 1, 'the finished stretch is counted')
  assert.equal(done.state.running, false, 'stops at the boundary so the break is acknowledged')
  assert.equal(done.state.remainingMs, 5 * 60_000, 'break is preloaded with its duration')

  // a backgrounded tab crosses ONE boundary per pass, so a break is never skipped
  const slept = advancePomodoro(started, started.endsAt + 10 * 60 * 60_000, config)
  assert.equal(slept.elapsed, 'work', 'a 10-hour sleep still lands on the break')
  assert.equal(slept.state.phase, 'break', 'does not burn through the break unattended')

  // every POMODORO_LONG_EVERY stretches the break is a long one
  assert.equal(nextPhase('work', 1), 'break')
  assert.equal(nextPhase('work', POMODORO_LONG_EVERY), 'long', 'fourth stretch earns a long break')
  assert.equal(nextPhase('work', POMODORO_LONG_EVERY * 2), 'long', 'and every fourth after')
  assert.equal(nextPhase('break', 3), 'work', 'breaks always return to work')
  assert.equal(nextPhase('long', 4), 'work', 'long breaks return to work')
  assert.equal(nextPhase('work', 0), 'break', 'a zero count is not a long break')

  // full cycle: four stretches land on a long break
  {
    let s = initialPomodoro(config)
    const seen = []
    for (let i = 0; i < 8; i++) {
      s = startPomodoro(s, 0, config)
      const r = advancePomodoro(s, s.endsAt, config)
      s = r.state
      seen.push(s.phase)
    }
    assert.deepEqual(
      seen,
      ['break', 'work', 'break', 'work', 'break', 'work', 'long', 'work'],
      'the fourth break in the cycle is the long one',
    )
    assert.equal(s.completed, 4, 'four focus stretches completed')
  }

  // reset restores the phase but keeps the cycle count; skip advances without crediting
  const mid = startPomodoro(initialPomodoro(config), 0, config)
  const wasReset = resetPomodoro(mid, config)
  assert.equal(wasReset.running, false, 'reset stops the clock')
  assert.equal(wasReset.remainingMs, 25 * 60_000, 'reset restores the full phase')
  assert.equal(wasReset.phase, 'work', 'reset stays on the same phase')
  const skipped = skipPomodoro(initialPomodoro(config), config)
  assert.equal(skipped.phase, 'break', 'skip moves to the next phase')
  assert.equal(skipped.running, false, 'skip does not auto-start the next phase')

  // formatting + progress
  assert.equal(fmtClock(0), '0:00', 'zero renders as 0:00')
  assert.equal(fmtClock(-5_000), '0:00', 'negative time clamps to zero')
  assert.equal(fmtClock(59_000), '0:59')
  assert.equal(fmtClock(60_000), '1:00', 'seconds pad to two digits')
  assert.equal(fmtClock(90_000), '1:30')
  assert.equal(fmtClock(25 * 60_000), '25:00')
  assert.equal(phaseLabel('work'), 'Focus')
  assert.equal(phaseLabel('break'), 'Break')
  assert.equal(phaseLabel('long'), 'Long break')
  assert.equal(phaseProgress(fresh, 0, config), 0, 'an untouched phase shows no progress')
  assert.equal(phaseProgress(started, started.endsAt, config), 1, 'a finished phase is full')
  assert.equal(phaseProgress(started, 1_000 + 12.5 * 60_000, config), 0.5, 'halfway is 0.5')
  assert.ok(phaseProgress(started, started.endsAt + 9e6, config) <= 1, 'progress never exceeds 1')

  // REGRESSION: pausing flipped `running`, which used to re-key the idle
  // duration sync — the effect then "resynced" a freshly parked timer to the
  // full phase duration and the pause looked like a restart. The key must
  // only move when the phase or a configured duration does.
  {
    const runningKey = idleSyncKey(started, config)
    const pausedKey = idleSyncKey(pausePomodoro(started, 1_000 + 60_000), config)
    assert.equal(pausedKey, runningKey, 'pausing must not re-key the idle sync')
    const edited = { ...config, workMinutes: 50 }
    assert.notEqual(idleSyncKey(paused, edited), pausedKey, 'a duration edit re-keys the sync')
    assert.notEqual(
      idleSyncKey({ ...paused, phase: 'break' }, config),
      pausedKey,
      'a phase change re-keys the sync',
    )
  }

  // persistence: the timer survives a UI restart, garbage never does damage
  {
    const roundTrip = (s) => parsePomodoroState(serializePomodoroState(s), config)
    assert.deepEqual(roundTrip(fresh), fresh, 'a fresh timer round-trips')
    assert.deepEqual(roundTrip(started), started, 'a running timer round-trips with its absolute endsAt')
    assert.deepEqual(roundTrip(paused), paused, 'a paused timer keeps its banked remainder')
    assert.deepEqual(parsePomodoroState(null, config), fresh, 'absent storage yields a fresh timer')
    assert.deepEqual(parsePomodoroState('not json', config), fresh, 'corrupt JSON falls back')
    assert.deepEqual(parsePomodoroState('42', config), fresh, 'a non-object falls back')
    assert.deepEqual(parsePomodoroState('{"phase":"lunch"}', config), fresh, 'an unknown phase falls back')
    const clamped = parsePomodoroState('{"phase":"work","remainingMs":999e9,"completed":2.7}', config)
    assert.equal(clamped.remainingMs, 25 * 60_000, 'a stale remainder clamps to the configured duration')
    assert.equal(clamped.completed, 2, 'completed floors to a whole count')
    assert.equal(clamped.running, false, 'a payload without running stays parked')
    const corrupt = parsePomodoroState('{"phase":"work","running":true,"endsAt":0}', config)
    assert.equal(corrupt.running, false, 'running without a deadline is parked, not trusted')
    const legacy = parsePomodoroState(
      serializePomodoroState({ phase: 'break', running: false, endsAt: 0, remainingMs: 3 * 60_000, completed: 3 }),
      config,
    )
    assert.equal(legacy.phase, 'break', 'a mid-cycle phase survives a restart')
    assert.equal(legacy.completed, 3, 'the cycle count survives a restart')
  }

  // the timestamped envelope: reconciles a localStorage seed against the
  // host cell — the NEWER write wins, so a timer that crossed an origin
  // change (Desktop's per-launch port) is adopted, not clobbered.
  {
    const env = parsePomodoroEnvelope(packPomodoroEnvelope(paused, 1234), config)
    assert.equal(env.updatedAt, 1234, 'the envelope keeps its timestamp')
    assert.deepEqual(env.state, paused, 'the envelope round-trips the state')
    // legacy bare state (written before the envelope existed) still loads,
    // reading as updatedAt 0 so any real write outranks it
    const legacy = parsePomodoroEnvelope(serializePomodoroState(paused), config)
    assert.equal(legacy.updatedAt, 0, 'a bare state reads as timestamp 0')
    assert.deepEqual(legacy.state, paused, 'a bare state still parses')
    assert.equal(parsePomodoroEnvelope(null, config), null, 'absent payload yields null, not a reset')
    assert.equal(parsePomodoroEnvelope('not json', config), null, 'corrupt JSON yields null')
    assert.equal(parsePomodoroEnvelope('{"updatedAt":5}', config), null, 'an envelope without state yields null')
    assert.equal(parsePomodoroEnvelope('{"updatedAt":5,"state":{"phase":"lunch"}}', config), null, 'a bogus phase yields null')
    // reconciliation rule: newer host write beats an untouched older seed
    const older = parsePomodoroEnvelope(packPomodoroEnvelope(paused, 100), config)
    const newer = parsePomodoroEnvelope(packPomodoroEnvelope(started, 200), config)
    assert.ok(newer.updatedAt > older.updatedAt, 'timestamps order the two copies')
  }

  // settings persist the durations and degrade safely
  assert.deepEqual(
    parseSettings(null),
    { sessionsPerWorkspace: 3, fleetSort: 'recent', workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, pomodoroEnabled: true },
    'defaults include the pomodoro config',
  )
  assert.equal(parseSettings('{"workMinutes":50}').workMinutes, 50, 'custom work length persists')
  assert.equal(parseSettings('{"workMinutes":"nope"}').workMinutes, 25, 'corrupt duration falls back')
  assert.equal(parseSettings('{"workMinutes":0}').workMinutes, POMODORO_MIN_MINUTES, 'out-of-range persists clamped')
  assert.equal(parseSettings('{"pomodoroEnabled":false}').pomodoroEnabled, false, 'the footer can be turned off')
  assert.equal(parseSettings('{}').pomodoroEnabled, true, 'the footer is on by default')
  // old persisted prefs (written before the pomodoro existed) must still load
  assert.equal(parseSettings('{"sessionsPerWorkspace":10}').workMinutes, 25, 'legacy prefs gain defaults')
  assert.equal(parseSettings('{"sessionsPerWorkspace":10}').sessionsPerWorkspace, 10, 'legacy prefs keep their value')
}

// --- 11) the todos projection reaches fleet rows
// A todo list is not a chat node, so extractTail cannot carry it: the host
// emits it as the per-session 'todos' projection. If this read breaks, a stage
// tile silently shows a todo_write tool row and nothing about the plan.
{
  const withTodos = {
    ids: ['t'],
    byId: {
      t: {
        id: 't',
        displayTitle: 'Planner',
        running: true,
        projectionValues: {
          todos: [
            { content: 'first', status: 'completed' },
            { content: 'second', status: 'in_progress' },
            { content: 'third', status: 'pending' },
          ],
        },
      },
    },
  }
  const row = exports.buildFleet(withTodos)[0]
  assert.equal(row.todos?.length, 3, 'row carries the whole todo projection')
  assert.deepEqual(
    row.todos.map((t) => t.status),
    ['completed', 'in_progress', 'pending'],
    'every status survives the read',
  )
  assert.equal(row.todos[1].content, 'second', 'todo text survives the read')

  // The host writes null to clear the list, and rewrites the whole array each
  // time — both must degrade to "no strip" rather than throwing into the tile.
  const noneCases = [
    { label: 'null clears the list', values: { todos: null } },
    { label: 'a missing projection is fine', values: {} },
    { label: 'an empty list renders nothing', values: { todos: [] } },
    { label: 'a forged non-array is ignored', values: { todos: 'nope' } },
  ]
  for (const { label, values } of noneCases) {
    const r = exports.buildFleet({
      ids: ['x'],
      byId: { x: { id: 'x', displayTitle: 'X', running: true, projectionValues: values } },
    })[0]
    assert.equal(r.todos, undefined, label)
  }

  // A forged entry must not crash the strip: unknown status degrades to
  // pending, and an entry with no usable text is dropped.
  const forged = exports.buildFleet({
    ids: ['f'],
    byId: {
      f: {
        id: 'f',
        displayTitle: 'F',
        running: true,
        projectionValues: {
          todos: [{ content: 'ok', status: 'bogus' }, { status: 'completed' }, { content: '' }],
        },
      },
    },
  })[0]
  assert.equal(forged.todos?.length, 1, 'entries without text are dropped')
  assert.equal(forged.todos[0].status, 'pending', 'an unknown status degrades to pending')
}

console.log('SMOKE_OK — all 11 checks passed')
