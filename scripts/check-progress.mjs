#!/usr/bin/env node
/**
 * Every plugin's loading state follows ONE rule, ported from `dsh-git`.
 *
 * dsh-git does not have a single loading style — it has a rule that picks a
 * treatment by surface size, and that is what the other plugins copy:
 *
 *   large content pane  -> a skeleton shaped like the real content
 *   list row / small pane -> a dim caption row
 *   inside a button     -> a spinner beside the retained label
 *
 * Each plugin ships its own inline CSS behind its own class prefix, so nothing
 * structurally stops the copies drifting apart — the same problem
 * `check-type-scale.mjs` and `check-tokens.mjs` exist to solve, applied to the
 * three invariants that make a skeleton correct rather than merely present:
 *
 *   1. SHIMMER TIMING is shared, so two skeletons on screen together do not
 *      beat against each other at different rates.
 *   2. THE SWEEP ANIMATES background-position over an oversized gradient, never
 *      `transform`, `width`, `height`, `opacity` or `margin`. Those are layout
 *      or compositing properties: a skeleton that animates one can nudge the
 *      content around it while it waits, which is the exact lurch the skeleton
 *      exists to prevent.
 *   3. REDUCED MOTION flattens every bar to a static tone. The skeleton still
 *      says "loading" by being there; the sweep is the part that is optional.
 *
 * Plus the accessibility contract: a skeleton is a live region announced ONCE,
 * not a pile of decorative bars narrated individually.
 *
 * WHY NOT A SHARED PACKAGE: these are independently published plugins, and an
 * undeclared runtime import resolves locally by accident and dies on a fresh
 * install — see AGENTS.md, where that has already happened twice. Copying the
 * pattern and checking it here costs no dependency and no resolution risk.
 *
 * Usage:
 *   node scripts/check-progress.mjs
 *   node scripts/check-progress.mjs --list    # print what each plugin declares
 *
 * Exits non-zero listing file:line for anything off the rule.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The shimmer every skeleton shares, taken from dsh-git's DiffSkeleton. */
const SHIMMER_DURATION = '1.4s'
const SHIMMER_EASING = 'ease-in-out'

/**
 * Properties a shimmer must never animate.
 *
 * `transform` and `opacity` do not reflow, but they DO make the bar move or
 * fade relative to the text it stands in for, which is the visual lurch this
 * rule exists to prevent; the rest reflow outright.
 */
const FORBIDDEN_ANIMATED = ['transform', 'width', 'height', 'opacity', 'margin', 'padding', 'top', 'left']

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pluginRoot = join(repoRoot, 'plugins')
const listOnly = process.argv.includes('--list')

/** Every source file that can carry inline CSS or the components that use it. */
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
    // A plugin with no src/ (a CLI or host-only package) has no UI to check.
  }
  return out
}

const findings = []
const summary = new Map()

/** Record one violation against a source location. */
function fail(file, index, message) {
  findings.push({
    where: `${relative(repoRoot, file).replace(/\\/g, '/')}:${index + 1}`,
    message,
  })
}

for (const plugin of readdirSync(pluginRoot)) {
  const files = sourcesOf(join(pluginRoot, plugin))
  if (files.length === 0) continue

  const sources = files.map((file) => ({ file, text: readFileSync(file, 'utf8') }))
  const all = sources.map((s) => s.text).join('\n')

  // A skeleton is identified by its own class naming, which every plugin
  // follows behind its own prefix: `<prefix>-skel*`.
  const hasSkeleton = /\.[a-z]+-skel[a-z-]*\s*[,{]/.test(all)
  const captionRows = (all.match(/\.[a-z]+-loadingrow\s*[,{]/g) ?? []).length
  if (!hasSkeleton && captionRows === 0) continue

  summary.set(plugin, {
    skeleton: hasSkeleton,
    captions: captionRows,
  })

  for (const { file, text } of sources) {
    const lines = text.split('\n')

    lines.forEach((line, index) => {
      // --- invariant 1: one shared shimmer timing -------------------------
      // Matched on the shorthand `animation:` that names a *-shimmer keyframe,
      // which is how every plugin declares it.
      const shimmer = /animation:\s*([a-z-]*shimmer)\s+([^;]+);/.exec(line)
      if (shimmer !== null) {
        const rest = shimmer[2]
        if (!rest.includes(SHIMMER_DURATION)) {
          fail(file, index, `shimmer must run at ${SHIMMER_DURATION}, got: ${rest.trim()}`)
        }
        if (!rest.includes(SHIMMER_EASING)) {
          fail(file, index, `shimmer must ease ${SHIMMER_EASING}, got: ${rest.trim()}`)
        }
        if (!rest.includes('infinite')) {
          fail(file, index, `shimmer must be infinite, got: ${rest.trim()}`)
        }
      }
    })

    // --- invariant 2: the sweep may only move background-position ----------
    // Read the BODY of every *-shimmer keyframes block rather than the file at
    // large: a plugin is free to animate transforms elsewhere, and only the
    // skeleton's own sweep is constrained.
    for (const block of text.matchAll(/@keyframes\s+([a-z-]*shimmer)\s*\{([\s\S]*?)\n\}/g)) {
      const body = block[2]
      const at = text.slice(0, block.index).split('\n').length - 1
      if (!body.includes('background-position')) {
        fail(file, at, `@keyframes ${block[1]} must animate background-position`)
      }
      for (const prop of FORBIDDEN_ANIMATED) {
        // Match a real declaration, not a word inside another property name.
        if (new RegExp(`(^|[;{\\s])${prop}\\s*:`).test(body)) {
          fail(
            file,
            at,
            `@keyframes ${block[1]} animates ${prop} — the sweep must not move layout; ` +
              'animate background-position over an oversized gradient instead',
          )
        }
      }
    }

    // --- invariant 3: reduced motion flattens the bars --------------------
    for (const block of text.matchAll(/@keyframes\s+([a-z-]*shimmer)\b/g)) {
      const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g
      let flattened = false
      for (const media of text.matchAll(reduced)) {
        if (/animation:\s*none/.test(media[1]) && /-skel/.test(media[1])) flattened = true
      }
      if (!flattened) {
        const at = text.slice(0, block.index).split('\n').length - 1
        fail(
          file,
          at,
          `${block[1]} has no prefers-reduced-motion counterpart — a skeleton must ` +
            'hold its bars at a flat tone rather than sweeping',
        )
      }
    }

    // --- the caption rung -------------------------------------------------
    // The dim caption row is the small-surface treatment, and its whole job is
    // to look the same everywhere: 12px on a 20px line, in the tertiary tone.
    for (const block of text.matchAll(/\.[a-z]+-loadingrow\s*\{([^}]*)\}/g)) {
      const body = block[1]
      const at = text.slice(0, block.index).split('\n').length - 1
      if (!/font-size:\s*12px/.test(body)) {
        fail(file, at, 'a caption loading row must be 12px')
      }
      if (!/line-height:\s*20px/.test(body)) {
        fail(file, at, 'a caption loading row must sit on a 20px line')
      }
      if (!/color:\s*var\(--[a-z0-9-]*(tertiary|caption)/.test(body)) {
        fail(file, at, 'a caption loading row must use the tertiary/caption tone')
      }
    }

    // --- the accessibility contract ---------------------------------------
    // A skeleton is announced once as a live region; its bars are decorative.
    // Checked on the COMPONENT, which is the only place the roles appear.
    for (const block of text.matchAll(/className="[a-z]+-skel"([\s\S]{0,220})/g)) {
      const head = block[1]
      const at = text.slice(0, block.index).split('\n').length - 1
      if (!head.includes('role="status"')) {
        fail(file, at, 'a skeleton root must carry role="status"')
      }
      if (!head.includes('aria-busy')) {
        fail(file, at, 'a skeleton root must carry aria-busy')
      }
    }
  }

  // Every skeleton's decorative rows must be hidden from assistive tech, or a
  // screen reader narrates a dozen empty bars instead of one status line.
  if (hasSkeleton) {
    for (const { file, text } of sources) {
      for (const block of text.matchAll(/className=\{?["'`][a-z]+-skel-(row|line)/g)) {
        const at = text.slice(0, block.index).split('\n').length - 1
        const window = text.slice(block.index, block.index + 260)
        if (!window.includes('aria-hidden')) {
          fail(file, at, 'a decorative skeleton row must be aria-hidden')
        }
      }
    }
  }
}

for (const [plugin, info] of [...summary].sort()) {
  const parts = []
  if (info.skeleton) parts.push('skeleton')
  if (info.captions > 0) parts.push(`${info.captions} caption row(s)`)
  console.log(`${plugin.padEnd(24)} ${parts.join(', ')}`)
}

if (summary.size === 0) {
  console.error('\nno loading states found at all — this check would pass vacuously')
  process.exit(1)
}

if (listOnly) process.exit(0)

if (findings.length > 0) {
  console.error(`\n${findings.length} loading state(s) off the shared rule:\n`)
  for (const finding of findings) console.error(`  ${finding.where}  ${finding.message}`)
  console.error(
    '\nThe rule comes from dsh-git: a skeleton for a large pane, a dim caption row' +
      '\nfor a small one, a spinner inside a button. The sweep animates' +
      '\nbackground-position only, shares one timing, and flattens under' +
      '\nprefers-reduced-motion.',
  )
  process.exit(1)
}

console.log(`\nok — every loading state follows the shared rule (${summary.size} plugin(s))`)
