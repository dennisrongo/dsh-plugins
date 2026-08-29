/**
 * runGit must not inherit git's own repository-location variables.
 *
 * Git resolves which repository to operate on from the ENVIRONMENT before it
 * ever considers cwd, so an inherited GIT_DIR, GIT_INDEX_FILE or GIT_WORK_TREE
 * silently redirects every command to a different repository than the caller
 * asked for. This plugin's entire contract is 'run git in the workspace
 * directory resolved through workspaceRegistry' — that contract is void the
 * moment any of these leak in.
 *
 * This is not hypothetical. Git EXPORTS these to every hook it runs, so a
 * harness started from a pre-commit hook — or from `git rebase --exec`, or a CI
 * step nested inside a git operation — inherits them. It was found exactly that
 * way: this repo's own pre-commit hook made host-ops.mjs report 190 changed
 * files in a 2-file throwaway repository.
 *
 * The failure is silent and reads as data corruption rather than an error,
 * which is why it is pinned here rather than left to the other probes.
 */
// Must come first: it scrubs inherited GIT_DIR/GIT_INDEX_FILE before any git runs.
import './git-env.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'

import { readStatus, repoRoot } from '../src/git.ts'

let passed = 0
/** Run one named async check. */
async function test(name, fn) {
  await fn()
  passed += 1
  console.log('  ok  ' + name)
}

/** Build a throwaway repository with a committed identity. */
function makeRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  execFileSync('git', ['init', '-b', 'trunk'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'ops@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Ops Test'], { cwd: dir })
  return dir
}

const target = makeRepo('dsh-git-env-')
const outer = makeRepo('dsh-git-outer-')

try {
  // The OUTER repo gets a different number of files, so if its index or gitdir
  // leaks in, the count changes in a way the assertion can actually see.
  for (const name of ['outer-1.txt', 'outer-2.txt', 'outer-3.txt']) {
    writeFileSync(join(outer, name), 'outer\n')
  }
  execFileSync('git', ['add', '-A'], { cwd: outer })

  writeFileSync(join(target, 'a.txt'), 'alpha\n')
  writeFileSync(join(target, 'b.txt'), 'beta\n')

  const leaks = {
    GIT_DIR: join(outer, '.git'),
    GIT_INDEX_FILE: join(outer, '.git', 'index'),
    GIT_WORK_TREE: outer,
    GIT_COMMON_DIR: join(outer, '.git'),
    GIT_OBJECT_DIRECTORY: join(outer, '.git', 'objects'),
  }

  for (const [name, value] of Object.entries(leaks)) {
    await test('an inherited ' + name + ' does not redirect the repository', async () => {
      process.env[name] = value
      try {
        const root = await repoRoot(target)
        assert.ok(root !== undefined, name + ': still resolves a root')
        assert.equal(
          basename(root),
          basename(target),
          name + ': root is the requested repo, got ' + root,
        )

        const status = await readStatus(target)
        assert.equal(status.repo, true, name + ': reports a repository')
        assert.equal(
          status.files.length,
          2,
          name + ': sees the requested repo, not the outer one',
        )
        assert.ok(
          status.files.every((f) => f.path === 'a.txt' || f.path === 'b.txt'),
          name + ': no outer-repo path leaked in',
        )
      } finally {
        delete process.env[name]
      }
    })
  }

  // Transport and credential settings must SURVIVE. The fix is a denylist of
  // location variables, not a blanket scrub of GIT_*: wiping GIT_SSH_COMMAND or
  // GIT_ASKPASS would break push and pull for anyone who configures them that
  // way, trading a silent bug for a different silent bug.
  await test('non-location GIT_* settings are preserved', async () => {
    process.env.GIT_SSH_COMMAND = 'ssh -o Foo=bar'
    try {
      const { runGit } = await import('../src/git.ts')
      const run = await runGit(target, ['var', 'GIT_AUTHOR_IDENT'])
      assert.equal(run.code, 0, 'git still runs')
      assert.equal(
        process.env.GIT_SSH_COMMAND,
        'ssh -o Foo=bar',
        'the caller-visible environment is not mutated',
      )
    } finally {
      delete process.env.GIT_SSH_COMMAND
    }
  })
} finally {
  rmSync(target, { recursive: true, force: true })
  rmSync(outer, { recursive: true, force: true })
}

console.log('\n' + passed + ' environment-isolation checks passed')
