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

// 1) host half — plain ESM
await build({
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(outdir, 'index.js'),
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
