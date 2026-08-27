#!/usr/bin/env node
/**
 * Link the skills from an obra/superpowers clone into the dsh agents skills
 * directory, so `git pull` in that clone updates them in place.
 *
 * Why link rather than copy: dsh's skill filesystem provider scans
 * <agentsHome>/skills, classifying each entry with readdir(withFileTypes) and
 * following links via stat(). Copies work but go stale silently — a pull
 * updates the clone and nothing else. A link makes the pull the whole update.
 *
 * Cross-platform on purpose: Windows gets junctions (no administrator rights
 * needed, unlike directory symlinks), macOS and Linux get directory symlinks.
 * Node's symlink type argument is honoured on Windows and ignored elsewhere.
 *
 * Usage:
 *   node scripts/link-superpowers-skills.mjs [options]
 *
 *   --root=<path>        superpowers clone root (default: SUPERPOWERS_ROOT, then a probe)
 *   --skills-dir=<path>  target skills dir (default: DSH_AGENTS_HOME/skills, then ~/.agents/skills)
 *   --dry-run            report what would change, touch nothing
 *   --restore            put the backed-up real directories back, removing the links
 *   --quiet              only print the summary
 *
 * Safe to re-run: already-correct links are left alone, and a later `git pull`
 * that adds a new upstream skill is picked up by running this again.
 */
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync,
  renameSync, rmSync, symlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Windows junctions need no elevation; every other platform gets a dir symlink. */
const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir'

/** Path inside a clone that proves it really is one. */
const MARKER = join('skills', 'using-superpowers', 'SKILL.md')

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const dryRun = flag('dry-run')
const restore = flag('restore')
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

/**
 * Where dsh looks for skills. Mirrors dsh-skill-filesystem, which resolves
 * `config.agentsHome ?? DSH_AGENTS_HOME ?? ~/.agents` and scans its skills/.
 */
function resolveSkillsDir() {
  const explicit = value('skills-dir')
  if (explicit) return resolve(explicit)
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')
  return join(agentsHome, 'skills')
}

/** True when the path is any kind of link (junction included). */
function isLink(p) {
  try { return lstatSync(p).isSymbolicLink() } catch { return false }
}

function linkTarget(p) {
  try { return resolve(readlinkSync(p)) } catch { return null }
}

const root = resolveRoot()
const skillsDir = resolveSkillsDir()

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

const sourceSkills = join(root, 'skills')
const backupDir = join(skillsDir, '..', 'skills-backup-superpowers')

log(`clone       ${root}`)
log(`skills dir  ${skillsDir}`)
log(`link type   ${LINK_TYPE} (${process.platform})`)
log('')

if (!existsSync(skillsDir)) {
  if (dryRun) log(`would create ${skillsDir}`)
  else mkdirSync(skillsDir, { recursive: true })
}

const names = readdirSync(sourceSkills, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

let linked = 0, already = 0, restored = 0, backedUp = 0, failed = 0

if (restore) {
  for (const n of names) {
    const dst = join(skillsDir, n)
    const saved = join(backupDir, n)
    if (!existsSync(saved)) continue
    if (isLink(dst)) {
      if (dryRun) { log(`  would restore ${n}`); restored++; continue }
      rmSync(dst, { recursive: false, force: true })
      renameSync(saved, dst)
      log(`  RESTORED ${n}`); restored++
    }
  }
  log('')
  console.log(`restored=${restored}${dryRun ? ' (dry run)' : ''}`)
  process.exit(0)
}

for (const n of names) {
  const src = join(sourceSkills, n)
  const dst = join(skillsDir, n)

  if (isLink(dst)) {
    if (linkTarget(dst) === resolve(src)) { already++; continue }
    if (dryRun) { log(`  would relink ${n} (points elsewhere)`); linked++; continue }
    rmSync(dst, { recursive: false, force: true })
    symlinkSync(src, dst, LINK_TYPE)
    log(`  RELINKED ${n}`); linked++
    continue
  }

  if (existsSync(dst)) {
    // A real directory: preserve it before replacing, so this is reversible.
    if (dryRun) { log(`  would back up + link ${n}`); linked++; backedUp++; continue }
    mkdirSync(backupDir, { recursive: true })
    const saved = join(backupDir, n)
    if (existsSync(saved)) rmSync(saved, { recursive: true, force: true })
    renameSync(dst, saved)
    backedUp++
    try {
      symlinkSync(src, dst, LINK_TYPE)
      log(`  LINKED   ${n} (original saved)`); linked++
    } catch (error) {
      renameSync(saved, dst)  // roll this one back
      console.error(`  FAILED   ${n}: ${error.message} (original restored)`); failed++
    }
    continue
  }

  if (dryRun) { log(`  would link ${n} (new)`); linked++; continue }
  try {
    symlinkSync(src, dst, LINK_TYPE)
    log(`  LINKED   ${n} (new)`); linked++
  } catch (error) {
    console.error(`  FAILED   ${n}: ${error.message}`); failed++
  }
}

log('')
console.log(
  `linked=${linked} already=${already} backed-up=${backedUp} failed=${failed}` +
  `${dryRun ? ' (dry run — nothing changed)' : ''}`
)
if (backedUp > 0 && !dryRun) console.log(`originals saved in ${backupDir} (--restore puts them back)`)
if (failed > 0) {
  console.error('')
  console.error('Some links failed. On Windows, junctions need no elevation but the target must')
  console.error('be on a local volume; on macOS/Linux check write permission on the skills dir.')
  process.exit(1)
}
