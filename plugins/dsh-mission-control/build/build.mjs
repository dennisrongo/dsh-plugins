/**
 * Build script: emits the dual-face plugin.
 *
 * - lib/index.js  — host half (apply() no-op)
 * - lib/client.js — browser bundle in dsh's client-module convention:
 *   `window.__ModuleLoader__.load({ id, factory })` where the factory receives
 *   the loader's `require` (module table: react, @deepseek-ai/* are external).
 *
 * This mirrors the upstream tsdown.client.ts output shape (closure-factory
 * artifact) using esbuild, so the web app's module loader can materialize it.
 */
import { build } from 'esbuild'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = join(root, 'lib')
mkdirSync(outdir, { recursive: true })

const EXTERNAL = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  // Resolved from the host loader's static module table at runtime (optional).
  '@deepseek-ai/dsh-client-ui-primitives',
]

/**
 * Host-half externals, resolved from the running dsh install at load time —
 * bundling copies would produce a second, unrelated cordis/zod instance and
 * break service registration.
 */
const HOST_EXTERNAL = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-typert-protocol',
  'zod',
]

// 1) host half — plain ESM.
//
// `minify: false` + `target: es2021` are load-bearing (same reasoning as
// dsh-todo): the gateway reads @Remote parameter NAMES out of
// Function.prototype.toString(), and Node cannot parse native decorator
// syntax, so decorators must be downleveled.
await build({
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2021',
  external: HOST_EXTERNAL,
  minify: false,
  keepNames: true,
  outfile: join(outdir, 'index.js'),
  logLevel: 'info',
})

// 1b) host Typert manifest — the `./typert` subpath dsh-typert-loader imports
// to publish this service's @Remote methods. Without it the loader silently
// skips the package and every dshMissionControl call 404s.
await build({
  entryPoints: [join(root, 'src/typert.host.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2021',
  external: HOST_EXTERNAL,
  minify: false,
  keepNames: true,
  outfile: join(outdir, 'typert.host.js'),
  logLevel: 'info',
})

// 2) client half — CJS body wrapped in the __ModuleLoader__ load call
await build({
  entryPoints: [join(root, 'src/client.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: EXTERNAL,
  outfile: join(outdir, 'client.body.cjs'),
  logLevel: 'info',
})

const body = readFileSync(join(outdir, 'client.body.cjs'), 'utf8')
const client = [
  'window.__ModuleLoader__.load({',
  '\tid: "@dennisrongo/dsh-mission-control",',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  body,
  '\t\treturn module.exports;',
  '\t}',
  '});',
].join('\n')
writeFileSync(join(outdir, 'client.js'), client)
console.log('wrote lib/client.js (%d bytes)', client.length)
