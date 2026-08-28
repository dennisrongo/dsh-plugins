/**
 * The load-bearing contracts between this package and the harness.
 *
 * Every failure mode covered here is SILENT in production: the plugin loads,
 * nothing throws, and calls simply 404 or the package is skipped outright. They
 * cannot be caught by exercising the panel's logic, which is why smoke.mjs —
 * 1800 lines of it — never saw any of them.
 *
 *   - the @Remote marker table drifting from the published descriptors
 *   - the gateway resolving parameters by NAME off Function.prototype.toString,
 *     so a minified host half silently stops matching
 *   - a non-strict codec, which makes the browser's $mount throw
 *   - an exports subpath that resolves to a file the build never emitted
 *   - a `files` list that omits something the exports map points at
 *   - a bundle patch with a bare id:, which no-ops instead of inserting
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const local = (p) => import(pathToFileURL(join(root, p)).href)
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const PACKAGE = '@dennisrongo/dsh-mission-control'
const SERVICE = 'dshMissionControl'

// Importing at all proves the decorators were downleveled: Node cannot parse
// native decorator syntax, so an es2021-target regression fails right here.
const { default: MissionControlService } = await local('lib/index.js')
const { TYPERT } = await local('lib/typert.host.js')
const service = new MissionControlService(new Context())

// --- 1) Module identity. Typert's marker table is a module-level WeakMap, so
// markers are only visible to code holding the SAME copy of the protocol
// package. An empty table here means the anchor links drifted and the harness
// registry would be just as blind — every call 404s with nothing in the log.
const markers = remoteMethods(service)
assert.ok(markers.length > 0, 'the @Remote marker table is readable (one shared protocol copy)')

// --- 2) Markers and published descriptors must agree in BOTH directions.
// An unpublished @Remote method is dead code; a descriptor with no method
// behind it is a 404 the client only discovers at runtime.
const markedMethods = markers.map((m) => m.method).sort()
const publishedMethods = TYPERT.invocations.map((d) => d.method).sort()
assert.deepEqual(publishedMethods, markedMethods, '@Remote methods == published descriptors')
assert.deepEqual(markedMethods, ['load', 'save'], 'the service publishes exactly load + save')

// --- 3) Every descriptor is backed by a real method, and is well formed.
for (const d of TYPERT.invocations) {
  assert.equal(typeof service[d.method], 'function', `${d.method} exists on the service`)
  assert.equal(d.service, SERVICE, `${d.method}.service is the cordis key`)
  assert.equal(d.namespace, SERVICE, `${d.method}.namespace matches the client mount point`)
  assert.equal(d.id, `${PACKAGE}#${SERVICE}/${d.method}`, `${d.method}.id is fully qualified`)
  assert.equal(d.invocation.kind, 'direct', `${d.method} is a direct invocation`)

  // A non-strict codec makes the browser's $mount throw and the tab vanish.
  assert.equal(d.parameters.length, 1, `${d.method} takes exactly one request parameter`)
  const [param] = d.parameters
  assert.equal(param.codec.mode, 'strict', `${d.method} request codec is strict`)
  assert.equal(param.source, 'json', `${d.method} request travels as json`)
  assert.equal(d.result.mode, 'strict', `${d.method} result codec is strict`)
  assert.equal(typeof param.codec.schema.safeParse, 'function', `${d.method} request has a zod schema`)
  assert.equal(typeof d.result.schema.safeParse, 'function', `${d.method} result has a zod schema`)
}

// --- 4) THE MINIFY GUARD. The gateway performs source-mode discovery: it reads
// the host method's parameter NAMES out of Function.prototype.toString() and
// matches them against each descriptor's `wire`. Turning on minify (or dropping
// keepNames) renames `request` to `a` and every call silently stops resolving,
// with a green build and a green smoke test. Comparing the real parsed name to
// the declared wire name is what makes that regression loud.
for (const d of TYPERT.invocations) {
  const src = service[d.method].toString()
  const params = src
    .slice(src.indexOf('(') + 1, src.indexOf(')'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  assert.equal(params.length, 1, `${d.method} still takes one declared parameter`)
  assert.equal(
    params[0],
    d.parameters[0].wire,
    `${d.method}'s real parameter name matches its wire name (host build must stay unminified)`,
  )
  assert.equal(d.parameters[0].name, d.parameters[0].wire, `${d.method} name/wire agree`)
}

// --- 5) The schemas must actually accept what the host returns and reject what
// it never produces — a schema that validates nothing passes every other check
// in this file while rejecting real traffic at runtime.
const byMethod = Object.fromEntries(TYPERT.invocations.map((d) => [d.method, d]))

const loadResult = byMethod.load.result.schema
assert.ok(loadResult.safeParse({ state: 'payload' }).success, 'load result accepts a string cell')
assert.ok(loadResult.safeParse({ state: null }).success, 'load result accepts an empty cell')
assert.ok(!loadResult.safeParse({ state: 42 }).success, 'load result rejects a non-string cell')
assert.ok(!loadResult.safeParse({}).success, 'load result requires the state key')
assert.ok(byMethod.load.parameters[0].codec.schema.safeParse({}).success, 'load takes an empty request')

const saveRequest = byMethod.save.parameters[0].codec.schema
assert.ok(saveRequest.safeParse({ state: 'payload' }).success, 'save accepts a string payload')
assert.ok(!saveRequest.safeParse({ state: null }).success, 'save rejects a null payload')
assert.ok(!saveRequest.safeParse({ state: 42 }).success, 'save rejects a non-string payload')
assert.ok(!saveRequest.safeParse({}).success, 'save requires the state key')
assert.ok(byMethod.save.result.schema.safeParse({ ok: true }).success, 'save result is { ok: true }')
assert.ok(!byMethod.save.result.schema.safeParse({ ok: false }).success, 'save result pins ok to true')

// --- 6) The real host output must satisfy its own published schemas. This is
// the seam where an implementation change (say, load returning undefined for an
// absent cell) diverges from the contract the client validates against.
{
  const prior = process.env.DSH_HOME
  delete process.env.DSH_HOME // no cell => the documented null result
  try {
    const result = await service.load({})
    assert.ok(loadResult.safeParse(result).success, 'a real load() result satisfies the published schema')
  } finally {
    if (prior !== undefined) process.env.DSH_HOME = prior
  }
}

// --- 7) The host-face manifest. dsh-typert-loader resolves the `./typert`
// subpath to find this; a package without one is SKIPPED SILENTLY.
assert.equal(TYPERT.package, PACKAGE, 'manifest names the package')
assert.equal(TYPERT.face, 'host', 'manifest is the host face')
assert.ok(Array.isArray(TYPERT.schemas), 'manifest carries a schemas array')
const [modelService] = TYPERT.model.services
assert.equal(modelService.key, SERVICE, 'model key is the cordis service key')
assert.equal(modelService.exportName, 'MissionControlService', 'model names the exported class')
// The export the manifest advertises has to be the one the module really has.
const hostModule = await local('lib/index.js')
assert.equal(
  typeof hostModule[modelService.exportName],
  'function',
  'the advertised exportName exists on the host module',
)
assert.equal(
  hostModule[modelService.exportName],
  MissionControlService,
  'the advertised export is the default export',
)
assert.deepEqual(
  modelService.members.map((m) => m.name).sort(),
  markedMethods,
  'the model documents exactly the @Remote methods',
)

// --- 8) The exports map is the only way the loader reaches this package. Each
// subpath must resolve to a file the build actually emitted.
for (const [subpath, entry] of Object.entries(pkg.exports)) {
  const targets = typeof entry === 'string' ? [entry] : Object.values(entry)
  for (const target of targets) {
    assert.ok(
      existsSync(join(root, target)),
      `exports["${subpath}"] -> ${target} exists (missing means a silently skipped package)`,
    )
  }
}
assert.ok(pkg.exports['./typert'], 'the ./typert subpath is declared')
assert.equal(pkg.main, 'lib/index.js', 'main points at the host half')
assert.ok(existsSync(join(root, pkg.main)), 'main resolves')

// --- 9) `files` decides what npm actually ships. An exports target outside it
// publishes a package that is broken only once installed from the registry.
assert.ok(pkg.files.includes('lib'), 'files ships lib/')
assert.ok(pkg.files.includes('cordis.patch.yml'), 'files ships the bundle patch')
assert.ok(pkg.files.includes('!lib/client.body.cjs'), 'files excludes the intermediate CJS body')
// npm ships these regardless of `files`, so they need no entry.
const ALWAYS_PUBLISHED = /^(package\.json|readme|licen[sc]e)/i
for (const [subpath, entry] of Object.entries(pkg.exports)) {
  const targets = typeof entry === 'string' ? [entry] : Object.values(entry)
  for (const target of targets) {
    const clean = target.replace(/^\.\//, '')
    if (ALWAYS_PUBLISHED.test(clean)) continue
    const shipped = pkg.files.some((f) => !f.startsWith('!') && (clean === f || clean.startsWith(`${f}/`)))
    assert.ok(shipped, `exports["${subpath}"] -> ${target} is inside the published files list`)
  }
}
for (const negation of pkg.files.filter((f) => f.startsWith('!'))) {
  const excluded = negation.slice(1).replace(/^\.\//, '')
  for (const entry of Object.values(pkg.exports)) {
    const targets = typeof entry === 'string' ? [entry] : Object.values(entry)
    for (const target of targets) {
      assert.notEqual(target.replace(/^\.\//, ''), excluded, `${target} is exported but also excluded`)
    }
  }
}

// --- 10) The bundle patch. Both id: AND name: are required — a bare id: is an
// id-targeted override of an existing row and silently no-ops, so the plugin
// never joins the layer stack and the panel simply never appears.
const patchPath = join(root, pkg.dsh.bundle.patch.replace(/^\.\//, ''))
assert.ok(existsSync(patchPath), 'the declared bundle patch file exists')
const patch = readFileSync(patchPath, 'utf8')
assert.match(patch, /id:\s*dsh-mission-control/, 'patch carries the plugin id')
assert.match(patch, new RegExp(`name:\\s*'${PACKAGE}'`), 'patch carries the package name (a bare id no-ops)')
assert.match(patch, /insert:/, 'patch inserts rather than overrides')

// --- 11) The client half is declared for the web surface, injected with the
// runtime it compiles against, and eager: a lazily-loaded overlay never mounts.
assert.equal(pkg.dsh.client.platform, 'web', 'client half targets the web surface')
assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'), 'client injects the runtime')
assert.equal(pkg.dsh.client.immediately, true, 'the overlay loads eagerly')
assert.ok(pkg.peerDependencies['@deepseek-ai/cordis'], 'cordis stays a peer (one copy per install)')
assert.ok(
  pkg.peerDependencies['@deepseek-ai/dsh-typert-protocol'],
  'the typert protocol stays a peer (shared marker table)',
)

console.log('CONTRACT_OK — %d descriptors, %d exports subpaths verified',
  TYPERT.invocations.length, Object.keys(pkg.exports).length)
