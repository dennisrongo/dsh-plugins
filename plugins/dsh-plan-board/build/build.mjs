/**
 * Build script: emits the host half, its Typert manifest, and the browser bundle.
 *
 * The client half follows dsh's client-module convention:
 * `window.__ModuleLoader__.load({ id, factory })`, where the factory receives
 * the loader's `require` (react and every `@deepseek-ai/*` come from the shell's
 * module table, never from this bundle).
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = join(root, 'lib')
mkdirSync(outdir, { recursive: true })

/** Supplied by the shell's client module table. */
const CLIENT_EXTERNAL = ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/cordis']

/**
 * Host-half externals. Resolved from the running dsh install at load time;
 * bundling copies would produce a second cordis/zod instance, and Typert's
 * `@Remote` marker table is a module-level WeakMap — a second copy means
 * markers the harness's registry cannot read.
 */
const HOST_EXTERNAL = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/dsh-workspace',
  'zod',
]

/**
 * Two settings are load-bearing, both tied to the Typert `@Remote` marker:
 *
 *   * `minify: false` — the gateway derives a @Remote method's wire fields from
 *     its PARAMETER NAMES via `Function.prototype.toString()`. Minifying renames
 *     `request` to `e` and silently changes the wire contract.
 *   * `target: es2021` — @Remote is a TC39 standard decorator. Node 22 cannot
 *     parse native decorator syntax and esbuild only downlevels when the target
 *     predates decorators; es2022+ emits them verbatim and the half fails to load.
 */
const hostOptions = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2021',
  external: HOST_EXTERNAL,
  minify: false,
  keepNames: true,
  logLevel: 'info',
}

await build({ ...hostOptions, entryPoints: [join(root, 'src/index.ts')], outfile: join(outdir, 'index.js') })

// The `./typert` subpath the loader imports to publish the @Remote methods.
// Without it the loader silently skips the package: plans are still captured to
// disk, but every dshPlans call 404s and the tab renders empty.
await build({
  ...hostOptions,
  entryPoints: [join(root, 'src/typert.host.ts')],
  outfile: join(outdir, 'typert.host.js'),
})

// Client half. Minifying is safe here — unlike the host half, nothing reads
// parameter names off this code — and zod is bundled because the client
// `$mount` rejects any descriptor whose codecs are not strict zod schemas.
await build({
  entryPoints: [join(root, 'src/client.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: CLIENT_EXTERNAL,
  minify: true,
  outfile: join(outdir, 'client.body.cjs'),
  logLevel: 'info',
})

const body = readFileSync(join(outdir, 'client.body.cjs'), 'utf8')
const client = [
  'window.__ModuleLoader__.load({',
  '\tid: "@dennisrongo/dsh-plan-board",',
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
