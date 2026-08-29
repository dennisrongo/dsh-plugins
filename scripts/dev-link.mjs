#!/usr/bin/env node
// dev-link.mjs — cross-platform postinstall entry for dev-link.
//
// `pnpm install` materialises file:/npm plugin deps as frozen copies and wipes
// the profile links and @deepseek-ai anchors with them. This hook re-runs the
// platform's dev-link right where that damage happens, so the rule
// "re-run after ANY pnpm install" is enforced mechanically instead of by
// memory. See AGENTS.md.
//
//   win32         -> scripts/dev-link.ps1 (junctions)
//   darwin/linux  -> scripts/dev-link.sh  (symlinks)
//
// Deliberately NON-FATAL: CI installs without a dsh CLI present (the publish
// workflow anchors in a later step), and dev machines may lack one profile or
// another. A failed link pass is a warning, never a broken install — verify.mjs
// is the gate that catches a genuinely unwired workspace.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)),
  process.platform === 'win32' ? 'dev-link.ps1' : 'dev-link.sh')

if (!existsSync(script)) {
  console.warn(`dev-link: ${script} not found — skipping (non-fatal)`)
  process.exit(0)
}

// Machine-local targets: .dev-link.json (gitignored) at the repo root, e.g.
//   { "profiles": "web,mission-control", "desktopProfiles": "web" }
// Absent file = the underlying script's own defaults. Keeps per-machine
// profile names out of the shared manifest.
const extraArgs = []
try {
  const cfgPath = path.join(repoRootArg(), '.dev-link.json')
  if (existsSync(cfgPath)) {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    if (cfg.profiles) extraArgs.push('--profiles', String(cfg.profiles))
    if (cfg.desktopProfiles) extraArgs.push('--desktop-profiles', String(cfg.desktopProfiles))
    if (cfg.plugins) extraArgs.push('--plugins', String(cfg.plugins))
  }
} catch (err) {
  console.warn(`dev-link: ignoring unreadable .dev-link.json (${err.message})`)
}

function repoRootArg() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

const runner = process.platform === 'win32'
  ? { cmd: 'powershell', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'] }
  : { cmd: 'bash', args: [] }

const res = spawnSync(runner.cmd, [...runner.args, script, ...process.argv.slice(2)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
  timeout: 120_000,
})

if (res.status === 0) {
  // Print only what changed, so a postinstall stays quiet when healthy.
  const lines = `${res.stdout ?? ''}`.split('\n').filter(l => /^(LINK|ALREADY|SKIP|Done\.)/.test(l))
  console.log(lines.join('\n'))
} else {
  console.warn(`dev-link: exited ${res.status ?? 'timeout'} — non-fatal, run it manually if links are stale\n${res.stderr ?? ''}`)
}
process.exit(0)
