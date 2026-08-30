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
 * Two rules worth knowing before "fixing" a failure here:
 *   - `ctx.get(name)` is the SAFE probe and yields undefined; the bare property
 *     read is the trap. Guard optional reads with try/catch.
 *   - A missing KEY on an already-injected service object (`ctx.remote?.foo`)
 *     is safe. The NAMESPACED service form (`ctx['remote.foo']`) throws.
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
    modelDirectories: {
      directoryFor: () => ({
        load: async () => {},
        select: async () => {},
        store: { getSnapshot: () => ({ groups: [], current: null }), subscribe: () => () => {} },
      }),
    },
    theme: { overrideTokens: () => () => {} },
    locale: { register: () => () => {}, bind: () => (k) => k },
    settingsScope: { bind: () => ({}), describe: () => ({}) },
    uiWorkspace: { archiveSession: async () => {}, startSession: async () => {} },
    remote: { $mount: async () => async () => {}, $on: () => () => {} },
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
const REMOTE_NAMESPACES = [
  'remote.dshTodo', 'remote.dshGit', 'remote.dshPlans',
  'remote.dshMemory', 'remote.dshMissionControl', 'remote.agentPresets',
]

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
    try {
      desc.inject('s1')
    } catch (error) {
      failures.push(`${name}: slot "${desc.id}" inject threw — ${error.message.split('\n')[0]}`)
    }
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
