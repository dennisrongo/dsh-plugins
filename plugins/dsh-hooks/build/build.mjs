/**
 * Build script: emits the host half and its Typert manifest.
 *
 * There is no client half — this plugin has no UI of its own; a configuration
 * surface reads it through the `dshHooks/describe` and `dshHooks/recent`
 * endpoints.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = join(root, 'lib')
mkdirSync(outdir, { recursive: true })

/**
 * Host-half externals. These resolve from the running dsh install at load time;
 * bundling copies would produce a second cordis/zod instance, and Typert's
 * `@Remote` marker table is a module-level WeakMap — a second copy means
 * markers the harness's registry cannot read.
 */
const HOST_EXTERNAL = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/dsh-workspace',
  'zod',
]

/**
 * Two settings are load-bearing, both tied to the Typert `@Remote` marker:
 *
 *   * `minify: false` — the gateway discovers a @Remote method's wire fields by
 *     reading its PARAMETER NAMES out of Function.prototype.toString().
 *     Minifying renames `request` to `e` and silently changes the wire
 *     contract, producing a "missing wire field" failure at call time.
 *
 *   * `target: es2021` — @Remote is a TC39 standard decorator. Node 22 cannot
 *     parse native decorator syntax, and esbuild only downlevels decorators
 *     when the target predates them. es2022+ emits them verbatim and the host
 *     half fails to load outright.
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

await build({
  ...hostOptions,
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(outdir, 'index.js'),
})

// The `./typert` subpath the loader imports to discover and publish this
// service's @Remote methods. Without this file the loader silently skips the
// package and every dshHooks call 404s.
await build({
  ...hostOptions,
  entryPoints: [join(root, 'src/typert.host.ts')],
  outfile: join(outdir, 'typert.host.js'),
})
