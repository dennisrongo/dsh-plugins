#!/usr/bin/env node
/**
 * The launch dialog's picker effect must survive its parent re-rendering.
 *
 * This exists because three green suites, a green context probe and two live
 * browser refreshes all missed the bug it catches, and the failure was SILENT
 * in every one of them — including the browser console.
 *
 * `TodoView` renders through `useSyncExternalStore`, so it re-renders on every
 * todo-store change. Each render passes `LaunchDialog` a FRESH `ctx` object
 * (rebuilt by `launchContext()` in the slot's inject callback) and a FRESH
 * `session` literal (`{ id }`). With `[session, ctx]` as its dependency array,
 * React saw new identities every render and re-ran the effect continuously —
 * and each cycle set `cancelled = true` before the async `load()` could reach
 * `setModels`. The model picker stayed on "Default" forever, and because every
 * diagnostic ran after the cancellation, NOTHING was ever logged.
 *
 * That is why the effect depends on the session ID (a string) and reads `ctx`
 * through a ref: the services are stable for the dialog's lifetime even though
 * the wrapper object is not.
 *
 * The package's own smoke test cannot catch this — its React stub makes
 * `useEffect` a no-op, so no effect ever runs and no dependency array is ever
 * compared. This harness implements enough of React's effect semantics
 * (dependency comparison, cleanup on change, state-driven re-render) to make
 * the loop observable.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * A miniature React that runs effects and compares dependencies.
 *
 * Deliberately NOT a stub that answers undefined: the whole point is to
 * reproduce the identity comparison React actually performs.
 */
function createRuntime() {
  const hooks = []
  let cursor = 0
  let scheduled = false
  let renderComponent = null
  const stats = { renders: 0, effectRuns: 0, cleanups: 0 }

  const scheduleRender = () => {
    if (scheduled || renderComponent === null) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      render(renderComponent)
    })
  }

  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    useRef(initial) {
      const i = cursor++
      hooks[i] ??= { current: initial }
      return hooks[i]
    },
    useState(initial) {
      const i = cursor++
      if (hooks[i] === undefined) {
        hooks[i] = { value: typeof initial === 'function' ? initial() : initial }
      }
      const slot = hooks[i]
      return [
        slot.value,
        (next) => {
          const value = typeof next === 'function' ? next(slot.value) : next
          if (Object.is(value, slot.value)) return
          slot.value = value
          scheduleRender()
        },
      ]
    },
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useEffect(fn, deps) {
      const i = cursor++
      const prev = hooks[i]
      const changed =
        prev === undefined ||
        deps === undefined ||
        prev.deps === undefined ||
        prev.deps.length !== deps.length ||
        deps.some((d, k) => !Object.is(d, prev.deps[k]))
      if (!changed) return
      if (prev?.cleanup) {
        stats.cleanups += 1
        prev.cleanup()
      }
      stats.effectRuns += 1
      const cleanup = fn()
      hooks[i] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
    },
    useSyncExternalStore: (_sub, get) => get(),
  }

  function render(component) {
    renderComponent = component
    cursor = 0
    stats.renders += 1
    component()
  }

  return { react, render, stats }
}

// --- load the BUILT client bundle, exactly as the browser receives it -------
let captured = null
const runtime = createRuntime()
globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      captured = {
        id,
        exports: factory((name) => {
          if (name === 'react') return runtime.react
          if (name === 'react-dom') return { createPortal: (node) => node }
          // The bundle is built with the automatic JSX runtime, so it imports
          // `react/jsx-runtime` rather than calling React.createElement. An
          // absent stub throws "(0, p.jsx) is not a function" BEFORE any
          // assertion runs — which made both the broken and fixed builds look
          // like passes when this was first written.
          if (name === 'react/jsx-runtime' || name === 'react/jsx-dev-runtime') {
            const jsx = (type, props) => ({ type, props: props ?? {} })
            return { jsx, jsxs: jsx, jsxDEV: jsx, Fragment: 'Fragment' }
          }
          return {}
        }),
      }
    },
  },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.document = {
  createElement: () => ({ dataset: {}, style: { setProperty() {} }, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} },
  body: { style: { setProperty() {} }, dataset: {}, appendChild() {} },
  documentElement: { style: { setProperty() {} }, dataset: {} },
  querySelector: () => null,
  addEventListener() {},
  cookie: '',
}

// eslint-disable-next-line no-eval
eval(readFileSync(join(root, 'lib/client.js'), 'utf8'))
const { LaunchDialog } = captured.exports
assert.equal(typeof LaunchDialog, 'function', 'the bundle must export LaunchDialog')

// --- a model directory that resolves ASYNCHRONOUSLY, like the real one ------
// The real load() awaits a host round-trip. Resolving synchronously here would
// hide the bug entirely: the whole failure is that the effect is torn down
// before an async resolution lands.
const CATALOG = {
  current: { provider: 'deepseek', model: 'deepseek-chat' },
  groups: [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'Chat' }] },
    { id: 'anthropic', name: 'Anthropic', models: [{ id: 'claude-opus-4', name: 'Opus' }] },
  ],
  status: 'ready',
  error: null,
}

let loadCalls = 0
const makeCtx = () => ({
  // A FRESH object every call — exactly what launchContext() returns on each
  // slot render, and the identity change that drove the loop.
  workspaceId: 'w1',
  sessions: { create: async () => 's1', open() {}, binding: () => ({ session: {} }) },
  // The picker reads the SESSION-INDEPENDENT catalog RPC, not the per-session
  // directory: the directory waits on a `modelSelection` projection that is
  // only seeded when a history page loads, so it can never settle for the
  // blank session this dialog creates.
  modelCatalog: async () => {
    loadCalls += 1
    await new Promise((r) => setTimeout(r, 5))
    return { groups: CATALOG.groups, default: CATALOG.current }
  },
  modelDirectories: {
    directoryFor: () => ({
      load: async () => {
        await new Promise((r) => setTimeout(r, 5))
        return CATALOG
      },
      select: async () => {},
      store: { getSnapshot: () => CATALOG, subscribe: () => () => {} },
    }),
  },
  remote: { agentPresets: undefined },
  uiWorkspace: undefined,
})

const item = {
  id: 't1',
  title: 'Probe',
  status: 'todo',
  priority: 'p2',
  createdAt: Date.now(),
}

// --- the actual check -------------------------------------------------------
{
  // Render repeatedly with fresh ctx/session objects, exactly as TodoView does
  // on every store change, then let the async load settle.
  const renderOnce = () =>
    runtime.render(() =>
      LaunchDialog({
        item,
        session: { id: 's1' },
        ctx: makeCtx(),
        onClose() {},
        onLaunched() {},
      }),
    )

  renderOnce()
  const afterFirst = runtime.stats.effectRuns
  assert.equal(afterFirst, 1, 'the picker effect must run on the first render')

  // Five more parent re-renders, each with brand-new ctx and session objects.
  for (let i = 0; i < 5; i += 1) renderOnce()

  assert.equal(
    runtime.stats.effectRuns,
    1,
    'the picker effect must NOT re-run when only the ctx/session OBJECT IDENTITY changes — ' +
      `it ran ${runtime.stats.effectRuns} times across 6 renders, so each cycle cancels the ` +
      'in-flight catalog load and the model list can never arrive',
  )
  assert.equal(
    runtime.stats.cleanups,
    0,
    'a re-render must not tear down the in-flight catalog load',
  )

  // Let the async load resolve, then confirm the models actually landed.
  await new Promise((r) => setTimeout(r, 40))
  renderOnce()

  assert.equal(loadCalls, 1, 'the catalog must be loaded exactly once, not once per render')
}

console.log('launch-effect OK (picker survives parent re-renders)')
