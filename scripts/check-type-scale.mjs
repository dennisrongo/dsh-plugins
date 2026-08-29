#!/usr/bin/env node
/**
 * Every plugin's UI text sits on ONE type scale.
 *
 * Each plugin ships its own inline CSS, so nothing structurally stops them
 * drifting apart — and they did. `dsh-mission-control` accumulated sizes from
 * 9px to 15px including half-pixel steps (10.5, 11.5, 12.5), which next to
 * dsh's own 11–16px chrome read as a different application rather than a
 * denser panel. `dsh-todo` already guarded its own sizes; this is that idea
 * applied to the whole repo, in one place, so a new plugin inherits it.
 *
 * THE SCALE IS DSH'S, NOT OURS. These are the sizes the harness's typography
 * tokens define (`--dsw-font-xxxs-11` … `--dsw-font-xl-24`), so a plugin on
 * this ladder matches the shell it renders inside.
 *
 * Why literal px and not the tokens themselves: the harness sets font-size
 * literally in 305 places and through `font: var(--dsw-font-*)` in only 44, so
 * the tokens are not what dsh's own UI actually follows. Matching the VALUES
 * is what buys visual consistency; binding to the tokens would only track a
 * scale dsh mostly ignores, and would blind `dsh-todo`'s own size probe, which
 * greps for literals.
 *
 * Usage:
 *   node scripts/check-type-scale.mjs
 *   node scripts/check-type-scale.mjs --list    # print every size in use
 *
 * Exits non-zero listing file:line for anything off the ladder.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** dsh's typography ladder, in px. */
const SCALE = [11, 12, 13, 14, 16, 20, 24]

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pluginRoot = join(repoRoot, 'plugins')
const listOnly = process.argv.includes('--list')

/** Every source file that can carry inline CSS. */
function sourcesOf(dir) {
  const out = []
  const walk = (at) => {
    for (const entry of readdirSync(at)) {
      if (entry === 'node_modules') continue
      const full = join(at, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(tsx?|css)$/.test(entry)) out.push(full)
    }
  }
  const src = join(dir, 'src')
  try {
    if (statSync(src).isDirectory()) walk(src)
  } catch {
    // A plugin with no src/ (nothing to check) is fine.
  }
  return out
}

const findings = []
const seen = new Map()

for (const plugin of readdirSync(pluginRoot)) {
  const files = sourcesOf(join(pluginRoot, plugin))

  // A size can hide one level down: `--mc-ctl-font: 11.5px` consumed as
  // `font-size: var(--mc-ctl-font)`. Checking only the literal at the
  // `font-size:` declaration missed four of those, so collect every custom
  // property that holds a bare px value and resolve through them.
  const vars = new Map()
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/(--[a-z0-9-]+):\s*([0-9.]+)px\s*;/g)) {
      if (!vars.has(match[1])) vars.set(match[1], new Set())
      vars.get(match[1]).add(Number(match[2]))
    }
  }

  const record = (file, index, line, size) => {
    if (!seen.has(plugin)) seen.set(plugin, new Set())
    seen.get(plugin).add(size)
    if (SCALE.includes(size)) return
    findings.push({
      where: `${relative(repoRoot, file).replace(/\\/g, '/')}:${index + 1}`,
      size: `${size}px`,
      text: line.trim().slice(0, 80),
    })
  }

  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const match of line.matchAll(/font-size:\s*([^;}\n]+)/g)) {
          const value = match[1].trim()

          const literal = /^([0-9.]+)px$/.exec(value)
          if (literal !== null) {
            record(file, index, line, Number(literal[1]))
            continue
          }

          const indirect = /^var\((--[a-z0-9-]+)\)$/.exec(value)
          if (indirect !== null) {
            // Unknown or non-px custom properties (inherited, or set in JS) are
            // not something this check can judge; only resolve what it can see.
            for (const size of vars.get(indirect[1]) ?? []) record(file, index, line, size)
            continue
          }

          // Arithmetic on a scale step lands between rungs by construction —
          // `11px - 1px` is 10px. State the step instead.
          if (value.startsWith('calc(')) {
            findings.push({
              where: `${relative(repoRoot, file).replace(/\\/g, '/')}:${index + 1}`,
              size: 'calc()',
              text: line.trim().slice(0, 80),
            })
          }
        }
      })
  }
}

for (const [plugin, sizes] of [...seen].sort()) {
  console.log(`${plugin.padEnd(24)} ${[...sizes].sort((a, b) => a - b).join(', ')}`)
}

if (listOnly) process.exit(0)

if (findings.length > 0) {
  console.error(`\n${findings.length} declaration(s) off the ${SCALE.join('/')} scale:\n`)
  for (const finding of findings) console.error(`  ${finding.where}  ${finding.size}  ${finding.text}`)
  console.error(
    '\nRound to the nearest step, and state derived steps as their own custom property' +
      '\nrather than calc()-ing off another one. Line-height is not checked — that stays' +
      '\nlayout-tuned, and is the lever for density.',
  )
  process.exit(1)
}

console.log(`\nok — every plugin font-size is on the ${SCALE.join('/')} scale`)
