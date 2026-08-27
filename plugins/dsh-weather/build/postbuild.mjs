/**
 * Post-build deploy: sync the built plugin into the dsh profile that serves it.
 *
 * Why this exists: pnpm installed this package into the profile as a REAL
 * DIRECTORY of hardlinked files rather than a symlink/junction, so a rebuild
 * left the running GUI serving the bundle frozen at install time (and a profile
 * restart did not help — it re-reads the same stale files).
 *
 * Behavior:
 *   - target missing            -> skip quietly (fresh clone / CI)
 *   - target is a link/junction -> skip; the build already self-deployed
 *   - target is a real dir      -> copy the files listed in package.json "files"
 *
 * Never throws: a deploy problem must not fail `pnpm build`.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * CLI profiles to mirror into, as a comma-separated list in DSH_DEPLOY_PROFILES.
 *
 * Empty by default: the supported dev loop is scripts/dev-link.ps1, which
 * junctions the profile at this repo so a build self-deploys and no copy is
 * needed. This copier stays as a fallback for a profile that pnpm materialised
 * as a real directory and that you do not want to junction.
 */
const PROFILES = (process.env.DSH_DEPLOY_PROFILES ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const PKG = '@dennisrongo/dsh-weather'

/** Files/dirs to mirror — keep in sync with package.json "files" (+ package.json itself). */
const PAYLOAD = ['lib', 'README.md', 'package.json']

/** Recursively copy a file or directory, creating parents as needed. */
function copyInto(src, dst) {
  if (!existsSync(src)) return 0
  if (statSync(src).isDirectory()) {
    mkdirSync(dst, { recursive: true })
    let n = 0
    for (const entry of readdirSync(src)) n += copyInto(join(src, entry), join(dst, entry))
    return n
  }
  mkdirSync(dirname(dst), { recursive: true })
  copyFileSync(src, dst)
  return 1
}

let deployed = 0
for (const profile of PROFILES) {
  const target = join(homedir(), '.dsh', 'profiles', profile, 'node_modules', ...PKG.split('/'))
  if (!existsSync(target)) continue

  // A symlink/junction already points at this repo — the build self-deployed.
  if (lstatSync(target).isSymbolicLink()) {
    console.log('postbuild: %s is a link — no copy needed', profile)
    deployed++
    continue
  }

  if (relative(root, target) === '') continue // paranoia: never copy onto ourselves

  let count = 0
  for (const item of PAYLOAD) count += copyInto(join(root, item), join(target, item))
  console.log('postbuild: deployed %d file(s) to profile "%s"', count, profile)
  deployed++
}

if (deployed === 0) console.log('postbuild: no installed profile copy found — skipped')
