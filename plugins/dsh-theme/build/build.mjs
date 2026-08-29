/**
 * Build script: emits the dual-face plugin.
 *
 * - lib/index.js  — host half: an empty apply() plus the catalogue and token
 *   builder as plain ESM, which is what test/themes.mjs imports.
 * - lib/client.js — browser bundle in dsh's client-module convention:
 *   `window.__ModuleLoader__.load({ id, factory })` where the factory receives
 *   the loader's `require` (module table: react, @deepseek-ai/* are external).
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = join(root, 'lib')
mkdirSync(outdir, { recursive: true })

const EXTERNAL = ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/cordis']

// 1) host half — plain ESM, importable under Node
await build({
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(outdir, 'index.js'),
  logLevel: 'info',
})

// 1b) host type declarations — package.json's `.` export advertises
// lib/types/index.d.ts, and esbuild does not emit declarations. tsc is invoked
// through its resolved bin rather than npx so CI does not re-resolve the
// package on every build.
{
  // tsc does not prune its outDir, so a deleted source leaves its .d.ts behind
  // and `files: ["lib"]` publishes it. That shipped declarations for themes
  // that no longer exist (dracula, and contrast before its rename), which a
  // consumer would see as real exports. Clearing the directory first makes the
  // emitted set exactly the current source set.
  rmSync(join(outdir, 'types'), { recursive: true, force: true })
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
  execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.types.json')], {
    stdio: 'inherit',
  })
  console.log('  lib/types/index.d.ts (host declarations)')
}

// 2) client half — CJS body wrapped in the __ModuleLoader__ load call
await build({
  entryPoints: [join(root, 'src/client.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: EXTERNAL,
  // The bundled OFL faces ride inside client.js as data URLs: the harness
  // serves no route for a .woff2, so a font that ships with this plugin has to
  // travel in the bundle. Keeps the binaries out of the repo, pinned to the
  // lockfile instead.
  loader: { '.woff2': 'dataurl' },
  outfile: join(outdir, 'client.body.cjs'),
  logLevel: 'info',
})

const body = readFileSync(join(outdir, 'client.body.cjs'), 'utf8')
const client = [
  'window.__ModuleLoader__.load({',
  '\tid: "@dennisrongo/dsh-theme",',
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
