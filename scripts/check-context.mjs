#!/usr/bin/env node
/**
 * Every client plugin must mount on a REAL cordis context and hand its view a
 * store — with only the services it actually declares in `inject` present.
 *
 * This exists because the per-package suites cannot see the bug it catches. A
 * cordis context is a PROXY: inside a plugin fiber, reading a property for a
 * service the fiber did not declare THROWS
 * `cannot get property "x" without inject` — it does NOT return undefined.
 * Every plugin's smoke test renders against PLAIN STUB OBJECTS, and a stub
 * returns undefined for a missing key, so the whole class of bug is invisible
 * there.
 *
 * That is not hypothetical. dsh-todo shipped it: `launchContext()` read
 * `ctx.sessions` (deliberately NOT injected, so the tab would still work on a
 * profile without it), the read threw inside the `conversation.view` slot's
 * inject callback, no store ever reached the view, and every task vanished from
 * a tab that still drew its own header and footer. Four green suites, a green
 * icon probe and a green modal probe all passed while the feature was dead.
 *
 * The check mounts each built client bundle on a real `Context`, provides ONLY
 * what that plugin declares, then calls every registered slot's `inject`
 * callback — which is the deferred path where the failure actually lands.
 *
 * It also CALLS the borrowed handles a slot hands back, because a third failure
 * mode is invisible to every existence check: a service that RESOLVES but
 * cannot be CALLED. `modelDirectories.directoryFor()` runs
 * `this.ctx.remote.session` inside dsh-client-ui-model-selection under a proxy
 * bound to the CALLING fiber, so a plugin that never declared `remote.session`
 * gets a handle that passes every guard and throws on first use — naming a
 * service its own source never mentions. That was dsh-todo outage number three.
 *
 * Three rules worth knowing before "fixing" a failure here:
 *   - `ctx.get(name)` is the SAFE probe and yields undefined; the bare property
 *     read is the trap. Guard optional reads with try/catch.
 *   - A missing KEY on an already-injected service object (`ctx.remote?.foo`)
 *     is safe. The NAMESPACED service form (`ctx['remote.foo']`) throws.
 *   - A resolved service is not a callable one. Wrap a borrowed handle ONCE at
 *     the boundary so it degrades to undefined, rather than guarding each call
 *     site — the raw handle outlives the guards you remember to write.
 *
 * With no harness installed the check SKIPS rather than fails, matching
 * check-tokens.mjs — a clean CI checkout must not be blocked by a missing
 * dev-preview dependency.
 *
 * Usage:
 *   node scripts/check-context.mjs
 *   node scripts/check-context.mjs --verbose
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDsh } from './host-deps.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pluginRoot = join(repoRoot, 'plugins')
const verbose = process.argv.includes('--verbose')

const resolved = resolveDsh(process.env.DSH_HOST_DEPS)
if (resolved?.hostDeps == null) {
  console.log('check-context: no dsh install found — skipping (install @deepseek-ai/dsh to enable)')
  process.exit(0)
}

// cordis resolves through a PACKAGE's own path (each plugin junctions its own
// @deepseek-ai/* at the dsh install), never from the repo root — a bare import
// here skips on a perfectly healthy checkout.
let Context
{
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  let entry = null
  for (const name of readdirSync(pluginRoot)) {
    const candidate = join(pluginRoot, name, 'lib/index.js')
    if (existsSync(candidate)) { entry = candidate; break }
  }
  try {
    const require = createRequire(entry ?? join(repoRoot, 'package.json'))
    const cordis = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
    Context = cordis.Context
  } catch {
    console.log('check-context: @deepseek-ai/cordis not resolvable — skipping')
    process.exit(0)
  }
}

/** Minimal stand-ins for the shell services a plugin may declare. */
function stubs(ctx) {
  return {
    slots: { inject: (_name, fn) => fn(), register: () => () => {} },
    workspaces: {
      list: {
        getSnapshot: () => ({ items: [{ workspaceId: 'w1', sessionIds: ['s1'] }] }),
        subscribe: () => () => {},
      },
      create: async () => ({ workspaceId: 'w1' }),
    },
    sessions: {
      list: {
        getSnapshot: () => ({ ids: ['s1'], byId: { s1: { id: 's1', cwd: '/x' } }, current: 's1' }),
        subscribe: () => () => {},
      },
      binding: () => undefined, open: () => {}, create: async () => 's1',
      scope: () => undefined, subagentAddress: () => undefined,
    },
    // A BORROWED service: present and probeable, but its methods re-enter a
    // service the CALLING fiber never declared. The real
    // `modelDirectories.directoryFor` runs `this.ctx.remote.session`
    // (dsh-client-ui-model-selection/lib/client.js:301), so calling it from a
    // fiber that declares only remote.dshTodo/workspaces/slots throws
    // `cannot get property "remote.session" without inject` — from INSIDE the
    // callee, on a service name the caller's source never mentions.
    //
    // This is a DIFFERENT bug class from an unguarded property read, and the
    // earlier plain stub could not express it: existence guards
    // (probeNamespaced, launchContext) all pass, then the first method call
    // detonates. It crashed conversation.view a THIRD time. Guarding the
    // CALL SITE is the fix; a present service is not a callable one.
    modelDirectories: {
      directoryFor: () => {
        throw new Error('cannot get property "remote.session" without inject')
      },
    },
    theme: { overrideTokens: () => () => {} },
    // `bind` is borrowed like directoryFor, so it can throw from inside the
    // callee rather than returning. It also commonly ECHOES an unknown key
    // back, so a consumer that trusts the result renders the raw key
    // ("presetCordisName") as a label. Both are modelled here.
    locale: {
      register: () => () => {},
      bind: (ns) => {
        if (ns === 'check-context.throws') throw new Error('cannot get property "locale" without inject')
        return (k) => k
      },
    },
    settingsScope: { bind: () => ({}), describe: () => ({}) },
    uiWorkspace: { archiveSession: async () => {}, startSession: async () => {} },
    // The real `remote` is a PROXY that THROWS on an unknown sub-name. A plain
    // object answers `undefined` instead, and that difference hid a shipped
    // outage: `ctx.remote?.agentPresets` looked like a safe optional read,
    // passed every stub-based test, and crashed the conversation.view slot in
    // the browser. Symbols pass through — cordis probes its own tracker
    // symbols, and throwing on those breaks the fiber before apply() runs.
    remote: new Proxy(
      {
        $mount: async () => async () => {},
        $on: () => () => {},
        // A plugin's OWN mounted namespace is a legitimate key here: $mount
        // publishes it and the plugin reads it back through `remote`.
        ...Object.fromEntries(
          MOUNTED_NAMESPACES.map((name) => [
            name,
            new Proxy({}, { get: () => async () => ({ ok: true, value: { list: { items: [], revision: 0, updatedAt: 0 } } }) }),
          ]),
        ),
      },
      {
        get(target, prop) {
          if (prop in target) return target[prop]
          if (typeof prop === 'symbol') return undefined
          throw new Error(`cannot get property "remote.${String(prop)}" without inject`)
        },
      },
    ),
  }
}

/** Browser globals the bundles touch at module scope. */
function installDom(onLoad) {
  const el = () => ({ dataset: {}, style: { setProperty() {} }, setAttribute() {}, appendChild() {} })
  globalThis.window = {
    __ModuleLoader__: { load: onLoad },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    addEventListener: () => {}, removeEventListener: () => {},
    location: { origin: 'http://localhost' },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  }
  globalThis.document = {
    createElement: el, head: { appendChild: () => {} },
    body: { style: { setProperty() {} }, dataset: {}, appendChild: () => {} },
    documentElement: { style: { setProperty() {} }, dataset: {} },
    querySelector: () => null, addEventListener: () => {}, cookie: '',
  }
}

const jsx = (type, props) => ({ type: typeof type === 'function' ? type.name : type, props })
const reactStub = {
  createElement: (t, p) => ({ t, p }), useRef: () => ({ current: null }),
  useCallback: (f) => f, useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {}, useMemo: (f) => f(), useSyncExternalStore: (_s, get) => get(),
  Fragment: 'Fragment',
}
const moduleTable = {
  react: reactStub,
  'react-dom': { createPortal: (n) => n },
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
}

/**
 * Remote namespaces the plugins mount for themselves via `remote.$mount`.
 * Each is a cordis service only that plugin provides, and its slot registration
 * is parked on it — so the check must supply them or it measures nothing.
 */
/** Bare namespace names a plugin publishes for itself through `remote.$mount`. */
const MOUNTED_NAMESPACES = ['dshTodo', 'dshGit', 'dshPlans', 'dshMemory', 'dshMissionControl']

const REMOTE_NAMESPACES = [
  'remote.dshTodo', 'remote.dshGit', 'remote.dshPlans',
  'remote.dshMemory', 'remote.dshMissionControl',
]
/**
 * Optional services a plugin reads off the ROOT ctx without declaring them.
 *
 * The shell registers these; a plugin that reads one opportunistically must
 * cope with it being absent AND with it being present-but-unusable. Providing
 * them here is what lets the check reach a borrowed method call — the failure
 * mode an absent-service matrix structurally cannot see.
 */
const OPTIONAL_ROOT_SERVICES = ['sessions', 'modelDirectories', 'uiWorkspace', 'locale']

// NOTE: 'remote.agentPresets' is deliberately NOT provided. It is an OPTIONAL
// service no plugin declares, and providing it here would mean the check never
// exercises the absent case — which is the case that threw and emptied the Todo
// tab. A stub that supplies everything cannot catch an unguarded optional read.

/**
 * Call the borrowed-service methods a slot handed back, and fail if one throws.
 *
 * A guard that proves a service EXISTS proves nothing about whether its methods
 * can run from this fiber. `modelDirectories.directoryFor()` resolves, then
 * throws `cannot get property "remote.session" without inject` from inside
 * dsh-client-ui-model-selection, because the proxy carrying the call is bound to
 * the CALLER's fiber. Existence guards all pass; the first call detonates.
 *
 * Only zero-argument-safe read methods are probed, and only ones whose contract
 * is a plain lookup — never a method that would mutate or start work.
 */
function exerciseHandles(plugin, desc, injected, out) {
  if (injected === null || typeof injected !== 'object') return
  const probes = [
    ['modelDirectories', 'directoryFor', ['s1']],
    ['uiWorkspace', 'archiveSession', null],
    ['sessions', 'binding', ['s1']],
  ]
  // The launch context is nested one level under the slot's return value, so
  // look at both the object itself and its direct object-valued properties.
  const scopes = [injected, ...Object.values(injected).filter((v) => v && typeof v === 'object')]
  for (const scope of scopes) {
    for (const [service, method, args] of probes) {
      if (args === null) continue
      const handle = scope[service]
      if (!handle || typeof handle[method] !== 'function') continue
      try {
        handle[method](...args)
      } catch (error) {
        out.push(
          `${plugin}: slot "${desc.id}" handed back ${service}, but ` +
            `${service}.${method}() threw — ${error.message.split('\n')[0]}\n` +
            `      A present service is not a callable one: guard the CALL SITE, not just the read.`,
        )
      }
    }
  }
}

const failures = []
const checked = []

for (const name of readdirSync(pluginRoot)) {
  const bundle = join(pluginRoot, name, 'lib/client.js')
  if (!existsSync(bundle)) continue

  let captured = null
  installDom(({ id, factory }) => {
    captured = { id, exports: factory((dep) => moduleTable[dep] ?? {}) }
  })
  try {
    // eslint-disable-next-line no-eval
    eval(readFileSync(bundle, 'utf8'))
  } catch (error) {
    failures.push(`${name}: client bundle failed to load — ${error.message.split('\n')[0]}`)
    continue
  }
  const plugin = captured?.exports
  if (typeof plugin?.apply !== 'function') continue

  const declared = plugin.inject ?? []
  const registrations = []
  const ctx = new Context()
  let bootError = null
  ctx.on('internal/error', (error) => {
    bootError ??= String(error?.message ?? error).split('\n')[0]
  })

  const table = stubs(ctx)
  table.slots = {
    inject: (_name, fn) => fn(),
    register: (desc) => { registrations.push(desc); return () => {} },
  }
  for (const service of declared) {
    const base = service.split('.')[0]
    if (!(base in table)) continue
    try { ctx.provide(base); ctx[base] = table[base] } catch { /* already provided */ }
  }
  // ALSO provide the optional launch services a plugin reads off the ROOT ctx
  // without declaring them. Providing only `declared` models a SLIM harness —
  // a real case, and the one the original outage hit — but it can never reach
  // the opposite failure: a service that RESOLVES and then throws when called.
  // With these absent, dsh-todo's launchContext() bails at `!sessions` and
  // hands back no handle at all, so the borrowed-method probe measures nothing.
  // The real browser resolves all three, which is exactly how it reached
  // directoryFor() and crashed.
  for (const optional of OPTIONAL_ROOT_SERVICES) {
    if (declared.includes(optional)) continue
    try { ctx.provide(optional); ctx[optional] = table[optional] } catch { /* already provided */ }
  }
  // A plugin that mounts its OWN contract parks a child fiber on
  // `remote.<namespace>` — a service nothing else provides — so without these
  // its slot never registers and the check passes on ZERO slots. That false
  // pass is the exact failure mode this script exists to prevent, which is why
  // the slot count is also asserted below.
  for (const namespace of REMOTE_NAMESPACES) {
    try {
      ctx.provide(namespace)
      ctx[namespace] = new Proxy({}, {
        get: () => async () => ({ ok: true, value: { list: { items: [], revision: 0, updatedAt: 0 } } }),
      })
    } catch { /* already provided */ }
  }

  try { ctx.plugin(plugin) } catch (error) {
    bootError ??= error.message.split('\n')[0]
  }
  await new Promise((r) => setTimeout(r, 500))

  if (bootError !== null) {
    failures.push(`${name}: apply() failed — ${bootError}`)
    continue
  }

  // A plugin that registered nothing was never actually exercised — the check
  // would then report a confident pass having tested no deferred path at all.
  // That happened while writing this script (a missing remote namespace parked
  // four plugins), so it is a failure rather than a silent skip.
  if (registrations.length === 0) {
    failures.push(`${name}: registered NO slots — the check exercised nothing (missing service stub?)`)
    continue
  }

  // The deferred path: this is where the dsh-todo outage actually landed.
  for (const desc of registrations) {
    if (typeof desc.inject !== 'function') continue
    let injected
    try {
      injected = desc.inject('s1')
    } catch (error) {
      failures.push(`${name}: slot "${desc.id}" inject threw — ${error.message.split('\n')[0]}`)
      continue
    }
    // Returning a service HANDLE is not proof it is usable. A borrowed service
    // resolves fine and then throws from INSIDE its own method, because the
    // method re-enters a service THIS fiber never declared — the
    // `remote.session` crash that emptied the Todo tab a third time. The slot's
    // inject callback merely hands the handle onward, so stopping at the call
    // above measures existence and nothing else.
    exerciseHandles(name, desc, injected, failures)
  }
  checked.push(`${name.padEnd(24)} inject=[${declared.join(', ')}]  ${registrations.length} slot(s)`)
}

if (verbose || failures.length > 0) for (const line of checked) console.log(line)

if (failures.length > 0) {
  console.error('')
  for (const failure of failures) console.error(`  x ${failure}`)
  console.error(`
A cordis context is a Proxy: reading a service this plugin did not declare in
\`inject\` THROWS rather than yielding undefined. Guard optional reads with
try/catch (ctx.get(name) is the safe probe), or declare the service.`)
  process.exit(1)
}

console.log(`ok — ${checked.length} client plugin(s) mount and serve their slots with only declared services`)
