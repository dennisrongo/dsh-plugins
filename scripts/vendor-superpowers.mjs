#!/usr/bin/env node
/**
 * Re-vendor the Superpowers skill catalog into plugins/dsh-superpowers/vendor.
 *
 * The plugin's prompt half reads YOUR clone and vendors nothing. Its catalog
 * half needs bodies that exist on a machine with no clone, and there is no npm
 * package to depend on: `@obra/superpowers` is unpublished, and bare
 * `superpowers` on npm belongs to someone else. So the catalog ships inside the
 * plugin, and this script is how that snapshot is refreshed.
 *
 * Usage:
 *   node scripts/vendor-superpowers.mjs [options]
 *
 *   --root=<path>  clone to vendor from (default: SUPERPOWERS_ROOT, then a probe)
 *   --dry-run      report what would change, touch nothing
 *   --allow-dirty  vendor from a clone with uncommitted changes (records it)
 *   --quiet        only print the summary
 *
 * Refuses a dirty working tree by default. Vendoring uncommitted edits would
 * ship them as if they were upstream and make PROVENANCE false — the file's
 * only job is to answer "what version is this", so a wrong answer is worse
 * than no file.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const VENDOR = resolve(HERE, '..', 'plugins', 'dsh-superpowers', 'vendor')

/** Path inside a clone that proves it really is one. */
const MARKER = join('skills', 'using-superpowers', 'SKILL.md')

const args = process.argv.slice(2)
const flag = (n) => args.includes(`--${n}`)
const value = (n) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}

const dryRun = flag('dry-run')
const allowDirty = flag('allow-dirty')
const quiet = flag('quiet')
const log = (...m) => { if (!quiet) console.log(...m) }

/** Candidate clone locations, all relative to the home directory. */
function candidateRoots() {
  const home = homedir()
  return [
    join(home, 'superpowers'),
    join(home, 'src', 'superpowers'),
    join(home, 'code', 'superpowers'),
    join(home, 'dev', 'superpowers'),
    join(home, 'git', 'superpowers'),
    join(home, 'repos', 'superpowers'),
    join(home, 'Projects', 'superpowers'),
    join(home, 'Documents', 'superpowers'),
    join(home, 'Documents', 'GitHub', 'superpowers'),
    join(home, 'Documents', 'Experimental Projects', 'superpowers'),
  ]
}

function resolveRoot() {
  const explicit = value('root') ?? process.env.SUPERPOWERS_ROOT
  if (explicit) return resolve(explicit)
  return candidateRoots().find((c) => existsSync(join(c, MARKER))) ?? null
}

/** Run git in the clone, returning trimmed stdout, or null when git fails. */
function git(root, ...gitArgs) {
  try {
    return execFileSync('git', ['-C', root, ...gitArgs], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/** Total files and bytes under a directory. */
function measure(dir) {
  let files = 0, bytes = 0
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.isFile()) { files += 1; bytes += statSync(p).size }
    }
  }
  walk(dir)
  return { files, bytes }
}

const root = resolveRoot()
if (root === null) {
  console.error('No superpowers clone found.')
  console.error('  Pass --root=<path>, or set SUPERPOWERS_ROOT, pointing at the repo root')
  console.error(`  containing ${MARKER}.`)
  console.error('  Clone it with: git clone https://github.com/obra/superpowers')
  process.exit(1)
}
if (!existsSync(join(root, MARKER))) {
  console.error(`Not a superpowers clone (no ${MARKER}): ${root}`)
  process.exit(1)
}

const commit = git(root, 'rev-parse', 'HEAD')
const date = git(root, 'show', '-s', '--format=%cI', 'HEAD')
const status = git(root, 'status', '--porcelain')
const dirty = status !== null && status.length > 0

if (dirty && !allowDirty) {
  console.error(`Clone has uncommitted changes: ${root}`)
  console.error('  Vendoring now would ship local edits as though they were upstream,')
  console.error('  and PROVENANCE would record a commit the files do not match.')
  console.error('  Commit or stash them, or pass --allow-dirty to record the state honestly.')
  process.exit(1)
}

const sourceSkills = join(root, 'skills')
const sourceLicence = join(root, 'LICENSE')
if (!existsSync(sourceLicence)) {
  console.error(`No LICENSE in ${root} — refusing to vendor without the licence text.`)
  process.exit(1)
}

const skillNames = readdirSync(sourceSkills, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

log(`clone   ${root}`)
log(`commit  ${commit ?? 'unknown'}${dirty ? ' (DIRTY)' : ''}`)
log(`vendor  ${VENDOR}`)
log(`skills  ${skillNames.length}`)
log('')

if (dryRun) {
  for (const n of skillNames) log(`  would vendor ${n}`)
  log('')
  console.log(`skills=${skillNames.length} (dry run — nothing changed)`)
  process.exit(0)
}

// Replace wholesale: an incremental copy would leave skills deleted upstream
// sitting in the snapshot forever, which is exactly the drift this guards.
rmSync(VENDOR, { recursive: true, force: true })
mkdirSync(VENDOR, { recursive: true })
cpSync(sourceSkills, join(VENDOR, 'skills'), { recursive: true })
cpSync(sourceLicence, join(VENDOR, 'LICENSE'))

const { files, bytes } = measure(join(VENDOR, 'skills'))

writeFileSync(join(VENDOR, 'PROVENANCE'), `Vendored snapshot of the Superpowers skill catalog.

    source   https://github.com/obra/superpowers
    commit   ${commit ?? 'unknown'}${dirty ? '  (WORKING TREE WAS DIRTY - includes local edits)' : ''}
    date     ${date ?? 'unknown'}
    skills   ${skillNames.length}
    files    ${files} under skills/ (plus LICENSE and this file)
    bytes    ${bytes} under skills/, as copied from the clone
    licence  MIT, Copyright (c) 2025 Jesse Vincent (see ./LICENSE)

LINE ENDINGS

This repo pins \`* text=auto eol=lf\`, so files that arrived from the clone with
CRLF are stored and checked out as LF. The CONTENT matches the commit above; the
line endings may not, and the byte count above is the pre-normalisation figure.
That is harmless here — these are markdown and helper scripts read by the
plugin, not bytes served verbatim to a browser the way lib/client.js is.

WHY THIS EXISTS

The plugin's system-prompt half is an adapter over YOUR clone and vendors
nothing. This snapshot serves the other half: the skill catalog, on a machine
that has no clone.

There is no npm package to depend on. \`@obra/superpowers\` does not exist, and
the bare \`superpowers\` name on npm (0.0.2) is an unrelated package — the same
scope trap documented twice in this repo's AGENTS.md files. So the bodies ship
here, inside the plugin, or fresh installs get a silently empty catalog.

RESOLUTION ORDER

This snapshot is tried LAST:

    superpowersRoot config -> SUPERPOWERS_ROOT env -> homedir probe -> vendor/

That is deliberately the mirror image of dsh-skills, which tries its bundled
dependency BEFORE its probe. There the dependency is the intended path; here a
real clone is, and this is the fallback that makes a fresh install work. A live
clone always wins, so \`git pull\` keeps behaving the way it always has.

REFRESHING

    node scripts/vendor-superpowers.mjs                 # from the repo root
    node scripts/vendor-superpowers.mjs --dry-run
    node scripts/vendor-superpowers.mjs --root=<path>

The script refuses a dirty working tree: vendoring uncommitted edits would ship
them as though they were upstream, and the provenance above would be a lie.
Rewrite this file only through that script.
`, 'utf8')

log('')
console.log(`vendored skills=${skillNames.length} files=${files} bytes=${bytes} commit=${(commit ?? 'unknown').slice(0, 7)}`)
