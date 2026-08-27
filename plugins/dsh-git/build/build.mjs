/**
 * Build script: emits the dual-face plugin.
 *
 * - lib/index.js  — host half (the git service, Node-side)
 * - lib/client.js — browser bundle in dsh's client-module convention:
 *   `window.__ModuleLoader__.load({ id, factory })`.
 *
 * Mirrors the dsh-todo build, whose constraints are load-bearing here too.
 */
import { build } from 'esbuild'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = join(root, 'lib')
mkdirSync(outdir, { recursive: true })

const EXTERNAL = ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/cordis']

/**
 * Host-half externals, resolved from the running dsh install at load time.
 * Bundling copies would create a second cordis/zod instance and break service
 * registration outright.
 */
const HOST_EXTERNAL = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-workspace',
  'zod',
]

// 1) host half — plain ESM.
//
// Two settings are load-bearing, both tied to the Typert @Remote marker:
//
//   * `minify: false` — the gateway discovers a @Remote method's wire fields by
//     reading its PARAMETER NAMES from Function.prototype.toString(). Minifying
//     renames `request` to `e` and silently breaks the wire contract.
//
//   * `target: es2021` — @Remote is a TC39 standard decorator. Node 22 cannot
//     parse native decorator syntax, and esbuild only downlevels decorators when
//     the target predates them. es2022+ emits them verbatim and the half fails
//     to load at all.
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
// to discover and publish this service's @Remote methods. Without this file the
// loader silently skips the package and every dshGit call 404s.
//
// Same externals and `minify: false` / `target: es2021` reasoning as the host
// half: it re-exports src/remote.ts's descriptors, so its zod schemas must come
// from the running install's zod instance, not a bundled copy.
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

// 2) client half — CJS body wrapped in the __ModuleLoader__ load call.
//
// Bundles zod, because the client `$mount` rejects any descriptor whose codecs
// are not strict zod schemas. Minifying is safe here: nothing reads parameter
// names off this code.
await build({
  entryPoints: [join(root, 'src/client.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: EXTERNAL,
  minify: true,
  outfile: join(outdir, 'client.body.cjs'),
  logLevel: 'info',
})

// 3) test face — the client's pure logic as plain ESM.
//
// Node's type stripper cannot parse JSX, so the smoke test cannot import
// client.tsx directly. This emits an importable ESM build whose react imports
// stay external and are never evaluated by the exported pure functions.
await build({
  entryPoints: [join(root, 'src/client.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  jsx: 'automatic',
  external: EXTERNAL,
  minify: false,
  outfile: join(outdir, 'client.test.mjs'),
  logLevel: 'silent',
})

const body = readFileSync(join(outdir, 'client.body.cjs'), 'utf8')
const client = [
  'window.__ModuleLoader__.load({',
  '\tid: "@dennisrongo/dsh-git",',
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
