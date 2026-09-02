#!/usr/bin/env node
/**
 * Sabotage harness for dsh-superpowers.
 *
 * A check that has never failed is decoration. This applies one targeted
 * mutation to lib/index.js at a time, runs the smoke suite, and asserts the
 * suite goes RED — then restores the file.
 *
 * It also verifies the mutation actually LANDED before believing a red or a
 * green, because the easiest way to fake this exercise is a regex that quietly
 * matched nothing. That trap is recorded in the root AGENTS.md.
 *
 *   node test/sabotage.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TARGET = join(HERE, '..', 'lib', 'index.js')
const SUITE = join(HERE, 'smoke.mjs')

/** [label, find, replace] — each must break at least one check. */
const SABOTAGES = [
  ['provider name no longer echoed by candidates',
    'provider: PROVIDER,\n    rank: RANK,', 'provider: "wrong-name",\n    rank: RANK,'],
  ['resourceBase points at the FILE, not the directory',
    'resourceBase: { kind: "directory", path: skill.directory },',
    'resourceBase: { kind: "directory", path: skill.path },'],
  ['unreadable catalog returns a complete-and-empty list',
    'return { candidates: [], complete: false };', 'return [];'],
  ['catalog order is no longer sorted',
    'names.sort();', ''],
  ['hidden _ and . directories are served',
    'if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;', ''],
  ['frontmatter is served raw in the skill body',
    'content: parsed.body.trim()\n    };\n  }\n}', 'content: raw\n    };\n  }\n}'],
  ['a malformed bundle throws instead of being skipped',
    'logger?.warn(`[dsh-superpowers] ${path} ignored: invalid YAML frontmatter: ${error.message}`);\n    return null;',
    'throw error;'],
  ['a missing description is accepted',
    'if (description === undefined) {', 'if (false) {'],
  ['a non-kebab-case name is accepted',
    'if (!SKILL_NAME.test(skillName)) {', 'if (false) {'],
  ['skillProvider:false is ignored',
    'if (config.skillProvider !== false) {', 'if (true) {'],
  ['enabled:false no longer silences the plugin',
    'if (config.enabled === false) return;', ''],
  ['registration bypasses ctx.effect',
    'ctx.effect(\n        () => skills.registerProvider(() => new SuperpowersSkillProvider(root, ctx.logger)),\n        "superpowers.registerProvider()"\n      );',
    'skills.registerProvider(() => new SuperpowersSkillProvider(root, ctx.logger));'],
  ['an absent skills service throws instead of degrading',
    'try {\n      skills = ctx.get("skills");\n    } catch {', 'try {\n      skills = ctx.get("skills");\n    } if (false) {'],
  ['the vendored snapshot is unreachable',
    'if (existsSync(join(VENDOR_ROOT, MARKER))) return VENDOR_ROOT;', ''],
  ['the vendored snapshot OUTRANKS a real clone',
    'function resolveRoot(configured) {\n  if (typeof configured === "string" && configured.length > 0) return configured;',
    'function resolveRoot(configured) {\n  if (existsSync(join(VENDOR_ROOT, MARKER))) return VENDOR_ROOT;\n  if (typeof configured === "string" && configured.length > 0) return configured;'],
  ['skills is declared in inject, gating the whole plugin',
    'const inject = ["systemPrompt"];', 'const inject = ["systemPrompt", "skills"];'],
]

const original = readFileSync(TARGET, 'utf8')
let caught = 0
const escaped = []

try {
  for (const [label, find, replace] of SABOTAGES) {
    if (!original.includes(find)) {
      console.log(`  SKIP  ${label}\n        (anchor not found — mutation would be a no-op)`)
      escaped.push(`${label} [anchor missing]`)
      continue
    }
    const mutated = original.replace(find, replace)
    if (mutated === original) {
      console.log(`  SKIP  ${label}\n        (mutation did not change the file)`)
      escaped.push(`${label} [no-op]`)
      continue
    }
    writeFileSync(TARGET, mutated, 'utf8')

    let red = false
    try {
      execFileSync(process.execPath, [SUITE], { stdio: 'pipe', encoding: 'utf8' })
    } catch {
      red = true // non-zero exit: the suite caught it
    }

    if (red) { console.log(`  ok    caught: ${label}`); caught += 1 }
    else { console.log(`  FAIL  ESCAPED: ${label}`); escaped.push(label) }
  }
} finally {
  writeFileSync(TARGET, original, 'utf8')
}

console.log(`\n${caught}/${SABOTAGES.length} sabotages caught`)
if (escaped.length > 0) {
  console.error('\nUNCAUGHT — these checks do not actually test what they claim:')
  for (const e of escaped) console.error(`  - ${e}`)
  process.exit(1)
}
