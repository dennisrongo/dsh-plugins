/**
 * Locate the installed dsh and its own `@deepseek-ai/*` copies.
 *
 * Shared by anchor.mjs and verify.mjs. It lives in one place because the two
 * scripts disagreeing about where dsh is means one of them is silently wrong —
 * which is exactly what happened: verify.mjs hardcoded the Windows
 * %APPDATA%\npm path and reported "no dsh CLI install found" on Linux CI while
 * anchor.mjs, two steps earlier, had linked against it fine.
 *
 * @module scripts/host-deps
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Candidate locations for a global dsh install's dependency directory, best
 * first. `npm root -g` is asked first because it is correct by construction;
 * the platform defaults only matter when npm is off PATH.
 * @returns absolute candidate paths.
 */
function candidates() {
  const out = []
  try {
    const npmRoot = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (npmRoot) out.push(join(npmRoot, '@deepseek-ai', 'dsh'))
  } catch { /* npm not available; fall through */ }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    out.push(join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh'))
  } else {
    out.push('/usr/local/lib/node_modules/@deepseek-ai/dsh')
    out.push(join(homedir(), '.npm-global', 'lib', 'node_modules', '@deepseek-ai', 'dsh'))
  }
  return out
}

/**
 * Resolve the dsh package root.
 * @param explicit - a caller-supplied dependency dir (`--host`/DSH_HOST_DEPS);
 *   its parent is treated as the dsh root.
 * @returns `{ dshRoot, hostDeps, version }`, or null when nothing is found.
 */
export function resolveDsh(explicit) {
  if (explicit) {
    const hostDeps = resolve(explicit)
    // explicit points at <dsh>/node_modules/@deepseek-ai
    const dshRoot = resolve(hostDeps, '..', '..')
    return { dshRoot, hostDeps, version: readVersion(dshRoot) }
  }
  for (const dshRoot of candidates()) {
    const hostDeps = join(dshRoot, 'node_modules', '@deepseek-ai')
    if (existsSync(hostDeps)) return { dshRoot, hostDeps, version: readVersion(dshRoot) }
  }
  return null
}

/** @returns the version in a package.json, or null. */
export function readVersion(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version }
  catch { return null }
}

/**
 * DSH Desktop bundles its own harness copy under its app directory. Windows
 * only for now; the desktop's macOS layout has not been verified here.
 * @returns the bundled dsh root, or null.
 */
export function resolveDesktopDsh() {
  if (process.platform !== 'win32') return null
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  const dir = join(localAppData, 'Programs', 'DSH Desktop', 'resources', 'app',
    'node_modules', '@deepseek-ai', 'dsh')
  return existsSync(dir) ? dir : null
}
