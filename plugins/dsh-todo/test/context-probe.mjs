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

// --- a NAMESPACED service is not a key on its parent object -----------------
// This is the rule an earlier version of this file got exactly backwards, and
// the mistake cost a shipped feature: the launch button never appeared on a
// harness that had ui-agent-preset loaded the whole time.
//
// The harness registers `remote.agentPresets` as a SERVICE whose name contains
// a dot. It is reachable ONLY as `ctx['remote.agentPresets']`. It is NOT a key
// on the `remote` object: `ctx.remote.agentPresets` is permanently undefined
// however the deployment is composed — so a gate reading the key form fails
// closed forever, silently, with no error anywhere.
//
// The namespaced read still needs a guard, because an undeclared one throws
// like any other service. Both halves are pinned, with the service PRESENT —
// the previous version tested only the absent case, which is why it passed
// while encoding the wrong conclusion.
{
  let keyForm = 'not-run'
  let namespacedForm = 'not-run'
  let undeclaredThrew = false
  const ctx = new Context()
  ctx.provide('slots'); ctx.provide('remote')
  ctx.slots = {}
  ctx.remote = { $mount: async () => {} }
  // Registered the way the harness registers it: a dotted SERVICE name.
  ctx.provide('remote.agentPresets')
  ctx['remote.agentPresets'] = { list: async () => ({ ok: true }) }

  ctx.plugin({
    inject: ['slots', 'remote', 'remote.agentPresets'],
    apply(scoped) {
      try { keyForm = scoped.remote.agentPresets } catch { keyForm = 'threw' }
      try { namespacedForm = scoped['remote.agentPresets'] } catch { namespacedForm = 'threw' }
    },
  })
  // An undeclared read is VISIBLE while the service is provided, and throws only
  // when it is absent — which is the case a slim profile hits, so the guard has
  // to stay. Exercised on a context that never provides it at all.
  const bare = new Context()
  bare.provide('slots')
  bare.slots = {}
  bare.plugin({
    inject: ['slots'],
    apply(scoped) {
      try { void scoped['remote.agentPresets'] } catch { undeclaredThrew = true }
    },
  })
  await new Promise((r) => setTimeout(r, 200))

  assert.equal(keyForm, undefined,
    'ctx.remote.agentPresets must stay undefined — reading the KEY form is what hid the launch button')
  assert.ok(namespacedForm && namespacedForm !== 'threw',
    "ctx['remote.agentPresets'] is the ONLY way to reach a namespaced service")
  assert.equal(undeclaredThrew, true,
    'a namespaced read on a profile that never provides the service throws — the guard must stay')
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
  // The harness registers this as a NAMESPACED SERVICE, never as a key on
  // `remote`. Stubbing the key form is what let this matrix pass green while the
  // launch button was invisible in the real UI, so 'agentPresets' now means the
  // namespaced registration and 'agentPresetsKey' is kept only to prove the
  // legacy shape still works.
  // Kept only to prove the key form does NOT enable the button — see the matrix.
  if (have.includes('agentPresetsKey')) {
    remote.agentPresets = { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) }
  }
  // THE REAL `remote` IS A PROXY THAT THROWS on an unknown sub-name — a plain
  // object silently answers `undefined` instead, which is exactly why this
  // matrix passed green while the browser console showed
  // `cannot get property "remote.agentPresets" without inject` and the tab was
  // empty. Symbols pass through: cordis probes its own tracker symbols and
  // throwing on those breaks the fiber before the plugin ever runs.
  ctx.remote = new Proxy(remote, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop === 'symbol') return undefined
      throw new Error(`cannot get property "remote.${String(prop)}" without inject`)
    },
  })
  if (have.includes('sessions')) {
    ctx.provide('sessions')
    ctx.sessions = { binding: () => undefined, open: () => {}, create: async () => 'n' }
  }
  if (have.includes('modelDirectories')) {
    ctx.provide('modelDirectories')
    // FAITHFUL to the shipped service: directoryFor() re-enters
    // `this.ctx.remote.session`, so it throws unless the CALLING fiber
    // declared that service. A stub that always returns an object cannot
    // express the failure that kept the model picker on "Default" — the
    // handle resolved, every existence guard passed, and only the call threw.
    ctx.modelDirectories = {
      directoryFor: () => {
        if (!have.includes('remote.session')) {
          throw new Error('cannot get property "remote.session" without inject')
        }
        return {
          load: async () => {},
          select: async () => {},
          store: {
            getSnapshot: () => ({ current: null, groups: [], status: 'ready', error: null }),
            subscribe: () => () => {},
          },
        }
      },
    }
  }
  if (have.includes('remote.session')) {
    ctx.provide('remote.session')
    ctx['remote.session'] = { modelCatalog: async () => ({ ok: true, value: {} }) }
  }
  if (have.includes('uiWorkspace')) {
    ctx.provide('uiWorkspace')
    ctx.uiWorkspace = { archiveSession: async () => {} }
  }
  if (have.includes('agentPresets')) {
    ctx.provide('remote.agentPresets')
    ctx['remote.agentPresets'] = {
      list: async () => ({ ok: true, value: { presets: [] } }),
      select: async () => ({ ok: true }),
    }
  }
  ctx.plugin(plugin)
  await new Promise((r) => setTimeout(r, 400))
  assert.ok(registered, `the conversation.view slot must register (composing: ${have.join(',') || 'nothing'})`)
  assert.equal(registered.desc.id, 'todo')
  return registered
}

// --- the SHELL's real context: bare reads throw, ctx.get() works ------------
// Measured in a live browser, and it is the shape every earlier stub got wrong:
//
//   sessions:         bare=THREW  get()=ok
//   modelDirectories: bare=THREW  get()=ok
//   uiWorkspace:      bare=THREW  get()=ok
//
// The services were present the whole time. The probe read
// `c[name] ?? c.get?.(name)`, which LOOKS like it tries both and does not: the
// bare read throws, aborting the expression before `??` is evaluated, and the
// surrounding catch swallows it. The get() fallback could never run.
//
// So ctx.get(name) must be tried FIRST. Pinned against a context that behaves
// exactly as the shell's does.
{
  const services = {
    sessions: { binding: () => undefined, open() {}, create: async () => 'n' },
    modelDirectories: { directoryFor: () => ({}) },
  }
  const shellLike = new Proxy({ get: (name) => services[name] }, {
    get(target, prop) {
      if (prop === 'get') return target.get
      if (typeof prop === 'symbol') return undefined
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  })

  const probe = (ctx, name) => {
    try {
      const viaGet = ctx.get?.(name)
      if (viaGet !== undefined) return viaGet
    } catch { /* fall through */ }
    try { return ctx[name] } catch { return undefined }
  }
  assert.ok(probe(shellLike, 'sessions'),
    'a probe must reach a service the shell exposes only through ctx.get()')

  // The ORDER is the whole point: the naive form resolves to undefined.
  const naive = (ctx, name) => {
    try { return ctx[name] ?? ctx.get?.(name) } catch { return undefined }
  }
  assert.equal(naive(shellLike, 'sessions'), undefined,
    'the ?? form must still be broken here — if it starts working, this test stops proving the order matters')

  const source = readFileSync(join(root, 'src/client.tsx'), 'utf8')
  const getAt = source.indexOf('const viaGet = c.get?.(name)')
  assert.ok(getAt !== -1, 'probeNamespaced must try ctx.get(name) first')
  assert.ok(source.indexOf('return c[name]', getAt) > getAt,
    'the bare property read must come AFTER the ctx.get() attempt')
}

// --- the matrix -------------------------------------------------------------
// Every row was verified to FAIL with the guard removed; rows 1, 2 and 4 each
// trip a DIFFERENT undeclared read, which is why one case is not enough.
// ONLY `sessions` is required. `modelDirectories` and `agentPresets` supply the
// two PICKERS, and a launch with no pick runs the deployment defaults — exactly
// what the sidebar's own New Session does. An earlier version of this matrix
// demanded all three, which is the rule that kept the button invisible on a real
// profile: one absent optional service removed the whole FEATURE instead of one
// dropdown, and that is indistinguishable from the feature being broken.
const MATRIX = [
  { label: 'nothing composed', have: [], launch: 'absent' },
  { label: 'sessions ONLY — no pickers, button must still show', have: ['sessions'], launch: 'present' },
  { label: 'sessions + modelDirectories, no agentPresets', have: ['sessions', 'modelDirectories'], launch: 'present' },
  { label: 'sessions + agentPresets, no modelDirectories', have: ['sessions', 'agentPresets'], launch: 'present' },
  { label: 'all three, no uiWorkspace', have: ['sessions', 'modelDirectories', 'agentPresets'], launch: 'present' },
  { label: 'everything', have: ['sessions', 'modelDirectories', 'agentPresets', 'uiWorkspace'], launch: 'present' },
  // A key on `remote` is not how the harness registers the service — only the
  // namespaced form is — but with sessions present the button shows either way,
  // because the pickers are optional.
  { label: 'key-on-remote agentPresets (not the harness shape)', have: ['sessions', 'modelDirectories', 'agentPresetsKey'], launch: 'present' },
  // The REAL deployment: modelDirectories is present AND `remote.session` is
  // composed, so directoryFor() is callable from a fiber that declares it.
  {
    label: 'modelDirectories + remote.session (the real shell)',
    have: ['sessions', 'modelDirectories', 'agentPresets', 'remote.session'],
    launch: 'present',
    callableDirectory: true,
  },
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

  // THE model-picker regression. A handle that merely EXISTS is not enough:
  // directoryFor() re-enters `remote.session`, so it must be taken from a
  // fiber that declares it. Read off the root ctx instead and every call
  // throws forever, which is what left the picker greyed out on "Default"
  // while the console stayed silent.
  if (row.callableDirectory === true) {
    const directory = props.launch.modelDirectories?.directoryFor('s1')
    assert.ok(
      directory,
      'directoryFor() must be CALLABLE when remote.session is composed — ' +
        'the handle has to come from a fiber that declares it, not from the root ctx',
    )
    assert.equal(typeof directory.load, 'function', 'a usable directory exposes load()')
  }
}

// --- the model fiber may resolve AFTER the slot's inject callback ----------
// The slot's inject runs on the conversation view's first render and its
// result is CACHED for the dialog's lifetime. The model fiber — a separate
// cordis inject declaring `remote.session` — can resolve a moment later. Read
// eagerly and `modelDirectories` is pinned to undefined for good: the picker
// shows "Default", greyed out, with NOTHING in the console, because nothing
// threw. That is the state this whole investigation kept returning to.
//
// So the launch context must resolve the model context LAZILY, at
// directoryFor() time.
{
  // Mount with modelDirectories present but WITHOUT remote.session, so the
  // model fiber cannot resolve at first. The tab must still work.
  const registered = await mount(['sessions', 'modelDirectories', 'agentPresets'])
  const props = registered.desc.inject('s1')
  assert.ok(props.launch, 'the launch button must still appear while the model fiber is unresolved')
  assert.ok(
    props.launch.modelDirectories !== undefined,
    'the launch context must always expose a modelDirectories facade, even before the model ' +
      'fiber resolves — an eager read pins the picker to undefined for the dialog\'s whole life',
  )
  assert.doesNotThrow(
    () => props.launch.modelDirectories.directoryFor('s1'),
    'directoryFor must yield undefined rather than throwing when the model fiber is unresolved',
  )
}

// A workspace the session does not belong to still yields no store — the
// pre-existing neutral state, not a crash.
{
  const registered = await mount(['sessions', 'modelDirectories', 'agentPresets'])
  const props = registered.desc.inject('session-in-no-workspace')
  assert.equal(props.store, null, 'an unaccounted session must yield a null store, not throw')
}

console.log(`context-probe OK (${MATRIX.length} deployment combinations)`)
