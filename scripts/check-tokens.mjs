#!/usr/bin/env node
/**
 * Every `var(--dsw-*)` a plugin references must be a token the harness defines.
 *
 * A misspelt token name fails SILENTLY and looks like working code: CSS falls
 * back to the second argument, so `var(--dsw-alias-state-warning-primary,
 * #f59e0b)` renders a perfectly reasonable amber forever and simply never
 * follows the theme. Nothing errors, nothing looks broken, and the element is
 * quietly immune to every palette the user picks.
 *
 * That is not hypothetical: this check was written after finding TEN such
 * references across three plugins — `state-warning-primary` (the real one is
 * `state-warn-primary`), `state-info-primary` (`state-business-primary`),
 * `border-focus` (no such token), `label-on-accent`
 * (`label-primary-foreground`), `bg-l1` (`bg-layer-1`), and `font-mono` /
 * `font-family-mono` (`--ds-font-family-code`). The two mono ones meant git
 * diffs and mission-control's tool output never followed the code font at all.
 *
 * The authority is the harness's own stylesheet, read from the installed dsh —
 * the same source `scripts/anchor.mjs` resolves. With no harness installed the
 * check SKIPS rather than fails, so a clean CI checkout is not blocked by a
 * missing dev-preview dependency.
 *
 * Usage:
 *   node scripts/check-tokens.mjs
 *   node scripts/check-tokens.mjs --list    # print what each plugin references
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDsh } from './host-deps.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pluginRoot = join(repoRoot, 'plugins')
const listOnly = process.argv.includes('--list')

const resolved = resolveDsh(process.env.DSH_HOST_DEPS)
const hostDeps = resolved?.hostDeps ?? null
if (hostDeps === null) {
  console.log('check-tokens: no dsh install found — skipping (install @deepseek-ai/dsh to enable)')
  process.exit(0)
}

// ui-theme owns every base token: the static ramp, the alias layer, the
// composed typography set, and the shiki syntax colours.
const themeBundle = join(hostDeps, 'dsh-client-ui-theme', 'lib', 'client.js')
if (!existsSync(themeBundle)) {
  console.log('check-tokens: dsh-client-ui-theme not found — skipping')
  process.exit(0)
}

/** Every custom property the harness DEFINES. */
const defined = new Set(
  [...readFileSync(themeBundle, 'utf8').matchAll(/(--(?:dsw|ds|shiki)-[a-z0-9-]+)\s*:/g)].map(
    (match) => match[1],
  ),
)

/** Names a plugin may legitimately define for itself. */
const ownPrefixes = ['--dshth-', '--mc-', '--td-', '--g-', '--dshwx-', '--dshpb-']

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
    // No src/ — nothing to check.
  }
  return out
}

const findings = []
const summary = []

for (const plugin of readdirSync(pluginRoot)) {
  const used = new Map()
  for (const file of sourcesOf(join(pluginRoot, plugin))) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const match of line.matchAll(/var\((--[a-z0-9-]+)/g)) {
          const token = match[1]
          // Prose in doc comments writes wildcards like `var(--dsw-static-*)`.
          // A real custom property never ends in a hyphen, so this drops the
          // narration without needing a comment parser.
          if (token.endsWith('-')) continue
          if (ownPrefixes.some((prefix) => token.startsWith(prefix))) continue
          if (!used.has(token)) used.set(token, `${relative(repoRoot, file).replace(/\\/g, '/')}:${index + 1}`)
        }
      })
  }
  if (used.size === 0) continue
  const bogus = [...used].filter(([token]) => !defined.has(token))
  summary.push(`${plugin.padEnd(24)} ${used.size} referenced, ${bogus.length} undefined`)
  for (const [token, where] of bogus) findings.push({ plugin, token, where })
}

for (const line of summary) console.log(line)
if (listOnly) process.exit(0)

if (findings.length > 0) {
  console.error(`\n${findings.length} reference(s) to tokens the harness does not define:\n`)
  for (const finding of findings) console.error(`  ${finding.where}  ${finding.token}`)
  console.error(
    '\nA misspelt token never errors — it silently uses its fallback forever and stops' +
      '\nfollowing the theme. Point it at a real token, or define your own with a plugin' +
      '\nprefix if it genuinely has no shell equivalent.',
  )
  process.exit(1)
}

console.log(`\nok — every referenced --dsw/--ds token is defined by the harness (${defined.size} known)`)
