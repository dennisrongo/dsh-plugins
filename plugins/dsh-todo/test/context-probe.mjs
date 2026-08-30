/**
 * Deployment-matrix probe: the Todo tab must survive EVERY combination of the
 * optional launch services, on a REAL cordis context.
 *
 * Why this file exists, and why smoke.mjs cannot replace it:
 *
 * A cordis context is a PROXY. Inside a plugin fiber, reading a property for a
 * service the fiber did not declare in `inject` THROWS
 * `cannot get property "x" without inject` — it does NOT return undefined.
 * smoke.mjs renders against PLAIN STUB OBJECTS, which return undefined for a
 * missing key and pass happily. That gap shipped a broken tab once already:
 * launchContext() read `ctx.sessions` unguarded, the slot's inject callback
 * threw, no store reached the view, and every task vanished from a tab that
 * still rendered its chrome. Four green suites, zero tasks on screen.
 *
 * `ctx.get(name)` is the SAFE probe and yields undefined; the bare property
 * read is the trap. Both are pinned below, and the matrix is deliberately
 * exhaustive rather than testing only the all-absent case: with the guard
 * removed, THREE separate rows fail, including a fully-configured deployment
 * that still dies on the `uiWorkspace` read. Testing one row would have caught
 * one of them.
 *
 * The invariant, stated once: whatever a deployment composes, a STORE MUST
 * REACH THE VIEW. `launch` may be undefined — that only hides a button.
 *
 * Run: node test/context-probe.mjs   (part of pnpm test)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// --- the trap itself, pinned so this file cannot rot into a tautology --------
// If cordis ever stops throwing on an undeclared read, the guards in
// launchContext() become dead weight and this test says so explicitly.
{
  let bareThrew = false
  let safeProbe = 'not-run'
  const ctx = new Context()
  ctx.provide('slots')
  ctx.slots = {}
  ctx.plugin({
    inject: ['slots'],
    apply(scoped) {
      try { void scoped.sessions } catch { bareThrew = true }
      try { safeProbe = scoped.get('sessions') } catch { safeProbe = 'threw' }
    },
  })
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(bareThrew, true,
    'a bare read of an undeclared service must THROW — if this changes, the guards in launchContext are pointless')
  assert.equal(safeProbe, undefined,
    'ctx.get(name) must stay the safe probe that yields undefined')
}

// --- the SUB-KEY rule, which is the opposite of the property rule -----------
// Reading a missing key off an ALREADY-INJECTED service object is safe and
// yields undefined — which is why launchContext can read `c.remote?.agentPresets`
// directly. But the NAMESPACED form the harness uses to register that same
// service, `ctx['remote.agentPresets']`, is a service name and DOES throw.
// The two look interchangeable and are not; anyone "tidying" the first into the
// second reintroduces the outage. Pinned in both directions.
{
  let subKey = 'not-run'
  let namespacedThrew = false
  const ctx = new Context()
  ctx.provide('slots'); ctx.provide('remote')
  ctx.slots = {}
  ctx.remote = { $mount: async () => {} } // deliberately no agentPresets
  ctx.plugin({
    inject: ['slots', 'remote'],
    apply(scoped) {
      try { subKey = scoped.remote.agentPresets } catch { subKey = 'threw' }
      try { void scoped['remote.agentPresets'] } catch { namespacedThrew = true }
    },
  })
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(subKey, undefined,
    'a missing key on an injected service object must yield undefined, not throw')
  assert.equal(namespacedThrew, true,
    'the NAMESPACED service form still throws — never swap c.remote?.agentPresets for ctx["remote.agentPresets"]')
}

// --- load the real built bundle ---------------------------------------------
let captured = null
const reactDom = { createPortal: (n) => n }
const jsx = (t, p) => ({ type: typeof t === 'function' ? t.name : t, props: p })
const jsxRuntime = { jsx, jsxs: jsx, Fragment: 'Fragment' }
const react = {
  createElement: (t, p) => ({ t, p }), useRef: () => ({ current: null }),
  useCallback: (f) => f, useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {}, useMemo: (f) => f(), useSyncExternalStore: (_s, get) => get(),
}
globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      captured = { id, exports: factory((n) =>
        n === 'react' ? react : n === 'react-dom' ? reactDom
        : n === 'react/jsx-runtime' ? jsxRuntime : {}) }
    },
  },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}
globalThis.document = {
  createElement: () => ({ dataset: {}, style: {} }),
  head: { appendChild: () => {} }, body: {}, querySelector: () => null,
}
eval(readFileSync(join(root, 'lib/client.js'), 'utf8'))
const plugin = captured.exports

/**
 * Mount the plugin on a real Context composing exactly `have`.
 * @param have - optional service names this deployment provides.
 * @returns what the conversation.view slot handed the view.
 */
async function mount(have) {
  let registered = null
  const ctx = new Context()
  ctx.provide('slots'); ctx.provide('workspaces'); ctx.provide('remote')
  ctx.slots = {
    inject: (_name, fn) => fn(),
    register: (desc, view) => { registered = { desc, view }; return () => {} },
  }
  ctx.workspaces = { list: { getSnapshot: () => ({ items: [{ workspaceId: 'w1', sessionIds: ['s1'] }] }) } }
  const dshTodo = {
    list: async () => ({ ok: true, value: { list: { items: [], revision: 0, updatedAt: 0 } } }),
    replace: async () => ({ ok: true, value: {} }),
  }
  const remote = {
    $mount: async () => { ctx.provide('remote.dshTodo'); ctx['remote.dshTodo'] = dshTodo; return async () => {} },
    dshTodo,
  }
  if (have.includes('agentPresets')) {
    remote.agentPresets = { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) }
  }
  ctx.remote = remote
  if (have.includes('sessions')) {
    ctx.provide('sessions')
    ctx.sessions = { binding: () => undefined, open: () => {}, create: async () => 'n' }
  }
  if (have.includes('modelDirectories')) {
    ctx.provide('modelDirectories')
    ctx.modelDirectories = { directoryFor: () => ({}) }
  }
  if (have.includes('uiWorkspace')) {
    ctx.provide('uiWorkspace')
    ctx.uiWorkspace = { archiveSession: async () => {} }
  }
  ctx.plugin(plugin)
  await new Promise((r) => setTimeout(r, 400))
  assert.ok(registered, `the conversation.view slot must register (composing: ${have.join(',') || 'nothing'})`)
  assert.equal(registered.desc.id, 'todo')
  return registered
}

// --- the matrix -------------------------------------------------------------
// Every row was verified to FAIL with the guard removed; rows 1, 2 and 4 each
// trip a DIFFERENT undeclared read, which is why one case is not enough.
const MATRIX = [
  { label: 'nothing composed', have: [], launch: 'absent' },
  { label: 'sessions only', have: ['sessions'], launch: 'absent' },
  { label: 'sessions + modelDirectories, no agentPresets', have: ['sessions', 'modelDirectories'], launch: 'absent' },
  { label: 'all three, no uiWorkspace', have: ['sessions', 'modelDirectories', 'agentPresets'], launch: 'present' },
  { label: 'everything', have: ['sessions', 'modelDirectories', 'agentPresets', 'uiWorkspace'], launch: 'present' },
]

for (const row of MATRIX) {
  const registered = await mount(row.have)
  let props
  // THE regression: this call is what threw and emptied the tab.
  assert.doesNotThrow(
    () => { props = registered.desc.inject('s1') },
    `slot inject must not throw when composing [${row.have.join(', ') || 'nothing'}] — a throw here empties the tab`,
  )
  assert.ok(props.store,
    `a store must reach the view when composing [${row.have.join(', ') || 'nothing'}]`)
  if (row.launch === 'absent') {
    assert.equal(props.launch, undefined,
      `incomplete launch services must degrade to undefined (composing [${row.have.join(', ')}]), so the button just hides`)
  } else {
    assert.ok(props.launch,
      `a complete deployment must get a launch context (composing [${row.have.join(', ')}])`)
    assert.equal(props.launch.workspaceId, 'w1', 'the launch context must carry its workspace')
  }
}

// A workspace the session does not belong to still yields no store — the
// pre-existing neutral state, not a crash.
{
  const registered = await mount(['sessions', 'modelDirectories', 'agentPresets'])
  const props = registered.desc.inject('session-in-no-workspace')
  assert.equal(props.store, null, 'an unaccounted session must yield a null store, not throw')
}

console.log(`context-probe OK (${MATRIX.length} deployment combinations)`)
