/**
 * Build script: emits the dual-face plugin.
 *
 * - lib/index.js  — host half (apply() no-op)
 * - lib/client.js — browser bundle in dsh's client-module convention:
 *   `window.__ModuleLoader__.load({ id, factory })` where the factory receives
 *   the loader's `require` (module table: react, @deepseek-ai/* are external).
 *
 * Mirrors the dsh-weather build.
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
]

/**
 * Host-half externals. These are resolved from the running dsh install at
 * load time, so bundling copies of them would produce a second, unrelated
 * cordis/zod instance and break service registration.
 */
const HOST_EXTERNAL = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-typert-protocol',
  'zod',
]

// 1) host half — plain ESM.
//
// Two settings here are load-bearing, both tied to the Typert @Remote marker:
//
//   * `minify: false` — the gateway discovers a @Remote method's wire fields
//     by reading its PARAMETER NAMES out of Function.prototype.toString().
//     Minifying would rename `request` to `e` and silently change the wire
//     contract, producing a "missing wire field" failure at call time.
//
//   * `target: es2021` — @Remote is a TC39 standard decorator. Node 22 cannot
//     yet PARSE native decorator syntax, and esbuild only downlevels
//     decorators when the target predates them. Leaving the target at es2022+
//     emits decorators verbatim and the host half fails to load outright.
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
// loader silently skips the package and every dshTodo call 404s.
//
// Same externals and the same `minify: false` / `target: es2021` reasoning as
// the host half: this module re-exports the descriptors from src/remote.ts, so
// its zod schemas must be the running install's zod instance, not a copy.
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

// 1c) CLI — a plain node ESM executable.
//
// Bundled with NO externals beyond node builtins: it imports only ./db.ts and
// ./types.ts, so it must run with no profile, no server and no @deepseek-ai
// package present. Keeping zod out of this path is deliberate — the CLI
// validates through the dependency-free helpers in types.ts, so the binary
// works in a bare checkout.
await build({
  entryPoints: [join(root, 'src/bin.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  minify: false,
  outfile: join(outdir, 'bin.js'),
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
})

// 1d) CLI as a library, for callers that want run()/parseArgs() in-process
// (the smoke test drives every command through this, with no shell).
await build({
  entryPoints: [join(root, 'src/cli.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  minify: false,
  outfile: join(outdir, 'cli.js'),
  logLevel: 'info',
})

// 1e) the launch helpers as a plain ESM module.
//
// Bundled separately so the smoke test can import the SHIPPED pure logic
// (composePrompt/flattenModels/presetOptions) under plain Node. The client
// bundle inlines the same source, but minified — asserting against that would
// mean matching renamed identifiers, so the test reads this build for behaviour
// and src/launch.ts for the ordering wiring.
//
// No externals: this module deliberately imports nothing but ./types.ts, which
// keeps React and the harness packages out of the test's import path.
await build({
  entryPoints: [join(root, 'src/launch.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  minify: false,
  outfile: join(outdir, 'launch.js'),
  logLevel: 'info',
})

// 2) client half — CJS body wrapped in the __ModuleLoader__ load call.
//
// This half bundles zod, because the client `$mount` rejects any descriptor
// whose codecs are not strict zod schemas (dsh's own api-remotes client bundle
// inlines zod for the same reason). Minifying is safe here — unlike the host
// half, nothing reads parameter names off this code — and keeps the browser
// payload reasonable.
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

const body = readFileSync(join(outdir, 'client.body.cjs'), 'utf8')
const client = [
  'window.__ModuleLoader__.load({',
  '\tid: "@dennisrongo/dsh-todo",',
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
