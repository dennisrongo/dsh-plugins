#!/usr/bin/env node
/**
 * Anchor every package's `@deepseek-ai/*` at the dsh install's own copies.
 *
 * These plugins declare the harness packages as peers and deliberately do not
 * install their own. A package is loaded through its REAL path — junctioned into
 * a profile, or checked out in CI — so Node resolves its dependencies from HERE,
 * not from the profile's hoisted tree. Without these links the harness dies at
 * boot with ERR_MODULE_NOT_FOUND, `pnpm test` cannot import cordis, and
 * tsconfig's `paths` (which point at ./node_modules/@deepseek-ai/...) resolve to
 * nothing.
 *
 * Keeping one physical copy also keeps module identity intact: Typert's @Remote
 * marker table is a module-level WeakMap in dsh-typert-protocol, so a second
 * copy means markers the harness's registry cannot read.
 *
 * Cross-platform: junctions on Windows (no elevation needed), directory symlinks
 * elsewhere. This is the portable half of scripts/dev-link.ps1 — that script
 * additionally junctions packages INTO profiles, which is Windows-only.
 *
 * Usage:
 *   node scripts/anchor.mjs
 *   node scripts/anchor.mjs --host=/path/to/dsh/node_modules/@deepseek-ai
 *   node scripts/anchor.mjs --dry-run
 *
 * Host lookup order: --host, then DSH_HOST_DEPS, then `npm root -g`, then the
 * platform default. Exits non-zero if the host cannot be found or a link fails.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDsh } from './host-deps.mjs'

const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir'
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pluginRoot = join(repoRoot, 'plugins')

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(`--${n}`)
const value = (n) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const dryRun = flag('dry-run')

const resolved = resolveDsh(value('host') ?? process.env.DSH_HOST_DEPS)
const hostDeps = resolved?.hostDeps ?? null
if (!hostDeps) {
  console.error('Could not locate the dsh install\'s @deepseek-ai copies.')
  console.error('  Install the harness:  npm i -g @deepseek-ai/dsh')
  console.error('  Or pass --host=<dsh>/node_modules/@deepseek-ai (or set DSH_HOST_DEPS).')
  process.exit(1)
}
console.log(`host deps  ${hostDeps}`)
console.log(`link type  ${LINK_TYPE} (${process.platform})`)
console.log('')

/** Strip // line comments so tsconfig.json parses as JSON. */
const readJsonc = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, ''))

/**
 * Every @deepseek-ai package this plugin needs: what it declares at runtime,
 * plus whatever its tsconfig maps for typechecking. Derived, so it cannot drift.
 */
function neededFor(dir) {
  const needed = new Set()
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (name.startsWith('@deepseek-ai/')) needed.add(name.split('/')[1])
    }
  }
  const tsconfig = join(dir, 'tsconfig.json')
  if (existsSync(tsconfig)) {
    try {
      for (const key of Object.keys(readJsonc(tsconfig).compilerOptions?.paths ?? {})) {
        if (key.startsWith('@deepseek-ai/')) needed.add(key.split('/')[1])
      }
    } catch { console.log(`  warn  could not parse ${tsconfig}; its paths are not anchored`) }
  }
  return needed
}

const isLink = (p) => { try { return lstatSync(p).isSymbolicLink() } catch { return false } }

let linked = 0, already = 0, missing = 0, failed = 0

for (const name of readdirSync(pluginRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
  const dir = join(pluginRoot, name)
  if (!existsSync(join(dir, 'package.json'))) continue

  const needed = [...neededFor(dir)].sort()
  if (!needed.length) { console.log(`  --    ${name} needs no anchoring`); continue }

  for (const short of needed) {
    const target = join(hostDeps, short)
    if (!existsSync(target)) {
      console.log(`  MISS  ${name} → @deepseek-ai/${short} is not in the dsh install`)
      missing++; continue
    }
    const dst = join(dir, 'node_modules', '@deepseek-ai', short)
    if (isLink(dst)) {
      let current = null
      try { current = resolve(readlinkSync(dst)) } catch { /* unreadable link */ }
      if (current === resolve(target)) { already++; continue }
      if (dryRun) { console.log(`  would relink ${name} → @deepseek-ai/${short}`); linked++; continue }
      rmSync(dst, { recursive: false, force: true })
    } else if (existsSync(dst)) {
      // A real directory: a stale copy from another package manager. Replacing
      // it is the point — a second physical copy is the identity hazard.
      if (dryRun) { console.log(`  would replace real dir ${name} → @deepseek-ai/${short}`); linked++; continue }
      rmSync(dst, { recursive: true, force: true })
    } else if (dryRun) { console.log(`  would link ${name} → @deepseek-ai/${short}`); linked++; continue }

    try {
      mkdirSync(dirname(dst), { recursive: true })
      symlinkSync(target, dst, LINK_TYPE)
      console.log(`  LINK  ${name} → @deepseek-ai/${short}`)
      linked++
    } catch (e) { console.error(`  FAIL  ${name} → @deepseek-ai/${short}: ${e.message}`); failed++ }
  }
}

console.log('')
console.log(`linked=${linked} already=${already} missing=${missing} failed=${failed}${dryRun ? ' (dry run)' : ''}`)
if (missing) console.log('A MISS means the installed dsh does not ship that package — check its version.')
if (failed) process.exit(1)
