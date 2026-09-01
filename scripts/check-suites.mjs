#!/usr/bin/env node
/**
 * Every package under `plugins/` must declare a `test` script that runs at
 * least one real test file.
 *
 * WHY THIS EXISTS: the root `test` script is
 * `pnpm -r --if-present run test`, and `--if-present` is silent. A package with
 * no `test` script is not reported, not counted, and not skipped out loud — it
 * simply contributes nothing to a run that still prints green. `dsh-skills`
 * lived that way through eleven releases with zero tests, and nothing in the
 * repo could have told you: `pnpm test` passed the whole time.
 *
 * That is the same failure shape the sibling checkers exist for. A misspelt
 * `var(--dsw-*)` renders a plausible colour forever (`check-tokens.mjs`); a
 * plugin that registers no slots proves nothing by passing
 * (`check-context.mjs`). In each case the wrong state is INDISTINGUISHABLE from
 * the right one at a glance, so it gets a structural check rather than a
 * convention.
 *
 * Deliberately NOT a coverage threshold. Coverage measures execution, not
 * assertion, and a line executed by a tautological test is worse than an
 * uncovered one because it looks protected. This checks only the thing that
 * cannot be faked into existence: a suite that runs at all.
 *
 * Usage:
 *   node scripts/check-suites.mjs
 *   node scripts/check-suites.mjs --list    # print what each plugin declares
 *
 * Exits non-zero naming every package that cannot fail.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pluginRoot = join(repoRoot, 'plugins')
const listOnly = process.argv.includes('--list')

/**
 * Test files a `test` script may reference.
 *
 * `.mjs` and `.test.mjs` are both in use across this repo, and `dsh-git` runs
 * several of its suites through `node --experimental-strip-types` on `.mjs`
 * sources, so the extension alone does not distinguish them.
 */
const TEST_FILE = /\.(m?js|test\.mjs)$/

/**
 * Read a package manifest, or null when the directory is not a package.
 * @param dir - absolute path to a candidate package directory.
 */
function manifestOf(dir) {
  const path = join(dir, 'package.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { __unparseable: error.message }
  }
}

/**
 * Every file under a package's `test/` directory.
 *
 * A package may legitimately keep suites elsewhere, which is why a missing
 * `test/` is not itself a failure — the `test` script is the contract, and this
 * is only used to explain a failure and to catch a script that names a file
 * which does not exist.
 */
function testFilesOf(dir) {
  const testDir = join(dir, 'test')
  try {
    if (!statSync(testDir).isDirectory()) return []
  } catch {
    return []
  }
  return readdirSync(testDir).filter((f) => TEST_FILE.test(f))
}

/**
 * Extract the file paths a `test` script actually runs.
 *
 * Shell-parsing is deliberately shallow: the goal is to catch a script that
 * names a file which is not there, not to emulate a shell. Anything that looks
 * like a path to a JS file counts.
 * @param script - the raw `test` script.
 */
function referencedFiles(script) {
  return [...script.matchAll(/(?:^|[\s&|])((?:\.\/)?(?:test|build|scripts)\/[\w.\-/]+\.m?js)/g)].map(
    (m) => m[1].replace(/^\.\//, ''),
  )
}

const failures = []
const rows = []

const entries = readdirSync(pluginRoot)
  .map((name) => join(pluginRoot, name))
  .filter((dir) => statSync(dir).isDirectory())

for (const dir of entries) {
  const rel = relative(repoRoot, dir).split('\\').join('/')
  const manifest = manifestOf(dir)

  if (manifest === null) {
    // Not a package at all — nothing to enforce.
    rows.push({ rel, name: '(no package.json)', script: '', note: 'skipped' })
    continue
  }
  if (manifest.__unparseable !== undefined) {
    failures.push(`${rel}/package.json: cannot be parsed — ${manifest.__unparseable}`)
    continue
  }

  const name = manifest.name ?? '(unnamed)'
  const script = manifest.scripts?.test
  const present = testFilesOf(dir)

  if (typeof script !== 'string' || script.trim() === '') {
    // The whole point of this checker. `--if-present` makes this state green.
    const hint =
      present.length > 0
        ? `test/ already holds ${present.length} file(s) (${present.slice(0, 3).join(', ')}) that never run`
        : 'and no test/ directory — this package has no suite at all'
    failures.push(
      `${rel}: ${name} declares no "test" script, so \`pnpm -r --if-present run test\` skips it silently; ${hint}`,
    )
    rows.push({ rel, name, script: '(none)', note: 'FAIL' })
    continue
  }

  // A script that names a file which does not exist fails loudly at run time,
  // but only for whoever runs that one package. Catch it here instead.
  const missing = referencedFiles(script).filter((f) => !existsSync(join(dir, f)))
  if (missing.length > 0) {
    failures.push(`${rel}: ${name} "test" script references missing file(s): ${missing.join(', ')}`)
    rows.push({ rel, name, script, note: 'FAIL' })
    continue
  }

  rows.push({ rel, name, script, note: 'ok' })
}

if (listOnly) {
  for (const row of rows) {
    console.log(`${row.note.padEnd(7)} ${row.name}`)
    if (row.script !== '') console.log(`        ${row.script}`)
  }
  process.exit(0)
}

if (failures.length > 0) {
  console.error('check-suites: every plugin must declare a test script that runs.\n')
  for (const failure of failures) console.error(`  ${failure}`)
  console.error(
    '\nA package with no test script is invisible to `pnpm test`: --if-present skips it\n' +
      'and the run still reports success. Add a "test" script, even a single smoke file.',
  )
  process.exit(1)
}

const counted = rows.filter((r) => r.note === 'ok').length
// A checker that examined nothing must not report a pass — the same rule
// check-context.mjs applies to a plugin registering zero slots.
if (counted === 0) {
  console.error('check-suites: examined no packages — the plugins/ layout must have changed.')
  process.exit(1)
}
console.log(`ok — ${counted} plugin(s) declare a test script, and every named file exists`)
