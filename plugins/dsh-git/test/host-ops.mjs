/**
 * Exercise the git engine's real behaviour against a throwaway repository:
 * init, stage, unstage, discard, commit, and the status transitions between
 * them. This covers the host paths the UI test cannot reach without touching a
 * real project.
 *
 * The LLM path is deliberately NOT covered here — it needs credentials and a
 * live model; it is verified separately against the running server.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readStatus, runGit, repoRoot } from '../src/git.ts'

let passed = 0
/** Run one named async check. */
async function test(name, fn) {
  await fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-git-ops-'))
try {
  await test('a fresh directory is not a repository', async () => {
    const status = await readStatus(dir)
    assert.equal(status.repo, false)
    assert.equal(await repoRoot(dir), undefined)
  })

  await test('init creates a repo on the requested branch', async () => {
    const run = await runGit(dir, ['init', '-b', 'trunk'])
    assert.equal(run.code, 0)
    execFileSync('git', ['config', 'user.email', 'ops@example.com'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Ops Test'], { cwd: dir })
    const status = await readStatus(dir)
    assert.equal(status.repo, true)
    assert.equal(status.branch, 'trunk')
    assert.equal(status.unborn, true, 'no commits yet')
    assert.equal(status.hasRemote, false)
  })

  writeFileSync(join(dir, 'a.txt'), 'alpha\n')
  writeFileSync(join(dir, 'b.txt'), 'beta\n')

  await test('new files show as untracked', async () => {
    const status = await readStatus(dir)
    assert.equal(status.files.length, 2)
    assert.ok(status.files.every((f) => f.untracked && !f.staged))
  })

  await test('staging one path moves only that path', async () => {
    await runGit(dir, ['add', '--', 'a.txt'])
    const status = await readStatus(dir)
    const a = status.files.find((f) => f.path === 'a.txt')
    const b = status.files.find((f) => f.path === 'b.txt')
    assert.equal(a.staged, true)
    assert.equal(a.index, 'A')
    assert.equal(b.staged, false)
    assert.equal(b.untracked, true)
  })

  await test('unstaging on an unborn branch uses rm --cached', async () => {
    // `restore --staged` has no HEAD to restore from before the first commit;
    // this is the exact case the service special-cases.
    const restore = await runGit(dir, ['restore', '--staged', '--', 'a.txt'])
    assert.notEqual(restore.code, 0, 'restore --staged should fail pre-first-commit')
    const rm = await runGit(dir, ['rm', '--cached', '-r', '--', 'a.txt'])
    assert.equal(rm.code, 0)
    const status = await readStatus(dir)
    assert.equal(status.files.find((f) => f.path === 'a.txt').untracked, true)
  })

  await test('commit records the tree and clears the working set', async () => {
    await runGit(dir, ['add', '-A'])
    const commit = await runGit(dir, ['commit', '-m', 'chore: seed the repo'])
    assert.equal(commit.code, 0)
    const status = await readStatus(dir)
    assert.equal(status.files.length, 0, 'tree is clean after commit')
    assert.equal(status.unborn, false)
    assert.ok(status.head && status.head.length > 0, 'HEAD now resolves')
    assert.equal(status.recent[0].subject, 'chore: seed the repo')
  })

  await test('a modification appears unstaged, then staged', async () => {
    writeFileSync(join(dir, 'a.txt'), 'alpha\nmore\n')
    let status = await readStatus(dir)
    let a = status.files.find((f) => f.path === 'a.txt')
    assert.equal(a.worktree, 'M')
    assert.equal(a.staged, false)

    await runGit(dir, ['add', '--', 'a.txt'])
    status = await readStatus(dir)
    a = status.files.find((f) => f.path === 'a.txt')
    assert.equal(a.index, 'M')
    assert.equal(a.staged, true)
  })

  await test('unstaging after a commit restores from HEAD', async () => {
    const run = await runGit(dir, ['restore', '--staged', '--', 'a.txt'])
    assert.equal(run.code, 0)
    const status = await readStatus(dir)
    const a = status.files.find((f) => f.path === 'a.txt')
    assert.equal(a.staged, false)
    assert.equal(a.worktree, 'M', 'the edit itself survives unstaging')
  })

  await test('discard restores tracked files and deletes untracked ones', async () => {
    writeFileSync(join(dir, 'untracked.txt'), 'temp\n')
    await runGit(dir, ['checkout', '--', '.'])
    await runGit(dir, ['clean', '-fd', '--', '.'])
    const status = await readStatus(dir)
    assert.equal(status.files.length, 0, 'nothing left after discard')
  })

  await test('the diff of a staged change is readable', async () => {
    writeFileSync(join(dir, 'b.txt'), 'beta\nchanged\n')
    await runGit(dir, ['add', '--', 'b.txt'])
    const staged = await runGit(dir, ['diff', '--no-color', '--cached', '--', 'b.txt'])
    assert.match(staged.stdout, /\+changed/)
    const worktree = await runGit(dir, ['diff', '--no-color', '--', 'b.txt'])
    assert.equal(worktree.stdout.trim(), '', 'nothing left unstaged')
  })

  await test('push without a remote fails as data, not a crash', async () => {
    const run = await runGit(dir, ['push'])
    assert.notEqual(run.code, 0)
    assert.ok(run.stderr.length > 0, 'git explains itself on stderr')
  })
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${passed} host checks passed`)
