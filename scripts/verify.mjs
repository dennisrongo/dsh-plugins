#!/usr/bin/env node
/**
 * Verify these plugins against the dsh you actually have installed.
 *
 * Written for the question "I upgraded dsh — is anything broken?", which is not
 * answered by `pnpm test`: those tests only prove this repo's lib/ is
 * self-consistent. What breaks on a harness upgrade is resolution and the wire
 * contract, so this checks both.
 *
 * Static checks (no server needed):
 *   1. Reports the dsh version(s) found, CLI and DSH Desktop bundle.
 *   2. For every package, resolves each @deepseek-ai specifier its BUILT lib
 *      actually imports and asserts it lands in the dsh CLI's own copy — never a
 *      .pnpm store path. A second physical copy of dsh-typert-protocol means
 *      @Remote markers are written into a WeakMap the harness's registry cannot
 *      read.
 *   3. Asserts every non-@deepseek-ai runtime dependency resolves too, which is
 *      what an undeclared import or a pruned node_modules breaks.
 *   4. Imports each entry point, which is the failure a consumer actually hits.
 *   5. Reports which profile installs actually track this repo. A profile holding
 *      a frozen copy silently serves stale bytes after every rebuild — no error,
 *      which is why it needs reporting rather than discovering.
 *
 * Live checks (with --port):
 *   6. POSTs each host plugin's endpoint and requires a 200 with ok:true.
 *      A 404 means the ./typert export was not registered.
 *
 * Usage:
 *   node scripts/verify.mjs
 *   node scripts/verify.mjs --port=38111 --workspace=<id>
 *   node scripts/verify.mjs --port=38111        # picks a workspace id for you
 *
 * Exits non-zero on the first category that fails, so it works in CI.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readVersion, resolveDesktopDsh, resolveDsh } from './host-deps.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pluginRoot = join(repoRoot, 'plugins')

const arg = (n) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const port = arg('port')
let workspaceId = arg('workspace')

/** Windows paths arrive with either separator and inconsistent case. */
const norm = (p) => p.replace(/\\/g, '/').toLowerCase()

let failures = 0
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`) }
const ok = (msg) => console.log(`  ok    ${msg}`)

// --- 1. which harness are we verifying against? -----------------------------
console.log('=== harness ===')
const cli = resolveDsh(process.env.DSH_HOST_DEPS)
console.log(`  dsh CLI              ${cli ? cli.version ?? '(version unreadable)' : 'not found'}`)
if (cli) console.log(`  at                   ${cli.dshRoot}`)
const desktopRoot = resolveDesktopDsh()
const desktopVersion = desktopRoot ? readVersion(desktopRoot) : null
console.log(`  DSH Desktop bundle   ${desktopVersion ?? (process.platform === 'win32' ? 'not installed' : 'n/a on this platform')}`)
if (cli && desktopVersion && cli.version !== desktopVersion) {
  console.log('  note  the two surfaces run different dsh versions — verify both, and expect')
  console.log('        module identity to matter more than usual.')
}
if (!cli) {
  console.log('  FAIL  no dsh install found; nothing can be anchored against it')
  console.log('        install it (npm i -g @deepseek-ai/dsh) or set DSH_HOST_DEPS')
  process.exit(1)
}
const hostDeps = norm(cli.hostDeps)

// --- 2-4. per package -------------------------------------------------------
const packages = readdirSync(pluginRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

for (const name of packages) {
  const dir = join(pluginRoot, name)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  console.log(`\n=== ${manifest.name} ===`)

  const libDir = join(dir, 'lib')
  if (!existsSync(libDir)) { fail(`${name}: no lib/ — run \`pnpm run build\``); continue }

  // Entry points from the exports map, falling back to main.
  const entries = new Set()
  for (const v of Object.values(manifest.exports ?? {})) {
    const target = typeof v === 'string' ? v : (v?.default ?? null)
    if (typeof target === 'string' && target.endsWith('.js')) entries.add(target)
  }
  if (!entries.size && manifest.main) entries.add(manifest.main)

  const req = createRequire(join(libDir, 'index.js'))

  // 2. every @deepseek-ai specifier the built output imports must land in the
  //    CLI's own copy.
  const specs = new Set()
  for (const f of readdirSync(libDir).filter((f) => /\.(js|mjs)$/.test(f) && !f.includes('.test.'))) {
    const src = readFileSync(join(libDir, f), 'utf8')
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](@deepseek-ai\/[^"']+)["']/g)) specs.add(m[1])
  }
  if (!specs.size) ok('imports no @deepseek-ai packages (nothing to anchor)')
  for (const spec of [...specs].sort()) {
    let resolved
    try { resolved = req.resolve(spec) }
    catch (e) { fail(`${spec} does not resolve (${e.code}) — run \`node scripts/anchor.mjs\``); continue }
    if (norm(resolved).startsWith(hostDeps)) ok(`${spec} → dsh CLI copy`)
    else if (norm(resolved).includes('.pnpm')) fail(`${spec} → .pnpm store copy, NOT the dsh CLI: ${resolved}`)
    else fail(`${spec} → unexpected location: ${resolved}`)
  }

  // 3. declared runtime deps must resolve from this package.
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    try { req.resolve(dep); ok(`dependency ${dep} resolves`) }
    catch (e) { fail(`dependency ${dep} does not resolve (${e.code}) — run \`pnpm install\` at the repo root`) }
  }

  // 4. entry points. Host halves must import under Node. Client halves must NOT
  //    be imported — they are browser bundles wrapped in the host loader's
  //    `window.__ModuleLoader__.load({ id, factory })` convention, so importing
  //    one in Node fails with "window is not defined" by design. Check the
  //    wrapper is intact instead, which is what the loader actually requires.
  for (const entry of [...entries].sort()) {
    const abs = resolve(dir, entry)
    if (!existsSync(abs)) { fail(`entry ${entry} missing on disk`); continue }
    const src = readFileSync(abs, 'utf8')
    if (src.includes('__ModuleLoader__')) {
      const id = src.match(/id:\s*"([^"]+)"/)?.[1]
      if (!/window\.__ModuleLoader__\.load\(/.test(src)) fail(`${entry} is a client bundle but has no __ModuleLoader__.load wrapper`)
      else if (id !== manifest.name) fail(`${entry} declares loader id ${JSON.stringify(id)}, expected ${JSON.stringify(manifest.name)}`)
      else ok(`${entry} client bundle well-formed (id ${id}, ${src.length} bytes)`)
      continue
    }
    try { await import(pathToFileURL(abs).href); ok(`imports ${entry}`) }
    catch (e) { fail(`${entry} throws on import: ${e.code ?? ''} ${String(e.message).split('\n')[0]}`) }
  }
}

// --- 5. do edits here actually reach the profiles? --------------------------
//
// A profile serves whatever its node_modules entry points at. Junctioned at this
// repo, a rebuild self-deploys and a browser refresh picks it up. Materialised as
// a real directory, the profile is FROZEN at install time and silently keeps
// serving stale bytes — no error anywhere, which is the whole problem. DSH
// Desktop's profile-repair install turns junctions back into copies, so this
// drifts on its own.
//
// Reported, never fatal: a profile that installed from npm is *meant* to hold a
// copy. It is only a defect if you expect your edits to show up there.
console.log('\n=== profile deployment ===')
const profileRoots = [
  join(homedir(), '.dsh', 'profiles'),
  join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'dsh-desktop', 'harness', 'profiles'),
]
const repoPackages = new Map()
for (const name of packages) {
  try {
    const m = JSON.parse(readFileSync(join(pluginRoot, name, 'package.json'), 'utf8'))
    repoPackages.set(m.name, join(pluginRoot, name))
  } catch { /* skip */ }
}

let live = 0, frozen = 0, foreign = 0
for (const root of profileRoots) {
  if (!existsSync(root)) continue
  for (const profile of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const scope = join(root, profile.name, 'node_modules', '@dennisrongo')
    if (!existsSync(scope)) continue
    for (const entry of readdirSync(scope)) {
      const installed = join(scope, entry)
      let real
      try { real = realpathSync(installed) } catch { continue }
      const pkgName = `@dennisrongo/${entry}`
      const expected = repoPackages.get(pkgName)
      if (!expected) { foreign++; continue }   // not one of ours; leave it alone
      if (norm(real) === norm(expected)) { live++; continue }
      frozen++
      console.log(`  note  ${profile.name}/${entry} is a frozen copy — edits here will NOT reach it`)
      console.log(`        run scripts/dev-link.ps1 to junction it at this repo`)
    }
  }
}
console.log(`  ${live} profile install(s) track this repo, ${frozen} frozen${foreign ? `, ${foreign} not from this repo` : ''}`)

// --- 6. live wire probes ----------------------------------------------------
const PROBES = [
  { pkg: '@dennisrongo/dsh-todo', method: 'dshTodo/list' },
  { pkg: '@dennisrongo/dsh-git', method: 'dshGit/status' },
]

if (port) {
  console.log(`\n=== wire probes against 127.0.0.1:${port} ===`)
  if (!workspaceId) {
    // Any registered workspace will do; the probe only needs a real id.
    try {
      const reg = JSON.parse(readFileSync(join(homedir(), '.dsh', 'storages', 'workspace.json'), 'utf8'))
      workspaceId = Object.keys(reg.tables?.workspaces ?? {})[0]
      if (workspaceId) console.log(`  using workspace ${workspaceId}`)
    } catch { /* fall through */ }
  }
  if (!workspaceId) {
    fail('no workspace id — pass --workspace=<id>')
  } else {
    for (const { pkg, method } of PROBES) {
      const body = {
        type: 'client-request', rpcId: 'verify', method,
        payload: { args: { request: { workspaceId } } },
      }
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        })
        const text = await r.text()
        if (r.status === 404) fail(`${method} → 404: the ./typert export is not registered (restart the profile)`)
        else if (r.status !== 200) fail(`${method} → HTTP ${r.status}`)
        else if (!/"ok":\s*true/.test(text)) fail(`${method} → 200 but not ok:true: ${text.slice(0, 120)}`)
        else ok(`${method} → 200 ok:true`)
      } catch (e) { fail(`${method} unreachable: ${e.message}`) }
      // the browser half is served from disk per request
      try {
        const r = await fetch(`http://127.0.0.1:${port}/plugins/${pkg}/client.js`)
        const len = (await r.text()).length
        if (r.status === 200 && len > 0) ok(`${pkg}/client.js → 200 (${len} bytes)`)
        else fail(`${pkg}/client.js → HTTP ${r.status} (${len} bytes)`)
      } catch (e) { fail(`${pkg}/client.js unreachable: ${e.message}`) }
    }
  }
} else {
  console.log('\n=== wire probes skipped ===')
  console.log('  pass --port=<port> of a running profile to check the /api surface too:')
  console.log('    dsh --profile web --port 38111 --no-open')
  console.log('    node scripts/verify.mjs --port=38111')
}

console.log('')
if (failures) { console.log(`${failures} check(s) FAILED`); process.exit(1) }
console.log('all checks passed')
