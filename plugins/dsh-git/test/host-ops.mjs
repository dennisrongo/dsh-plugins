/**
 * Exercise the git engine's real behaviour against a throwaway repository:
 * init, stage, unstage, discard, commit, and the status transitions between
 * them. This covers the host paths the UI test cannot reach without touching a
 * real project.
 *
 * The LLM path is deliberately NOT covered here — it needs credentials and a
 * live model; it is verified separately against the running server.
 */
// Must come first: it scrubs inherited GIT_DIR/GIT_INDEX_FILE before any git runs.
import './git-env.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assertSafeSha,
  collectChangeDiff,
  parseCommitFiles,
  readStatus,
  runGit,
  repoRoot,
  untrackedPatch,
} from '../src/git.ts'

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

  await test('assertSafeSha accepts hex and rejects git revision syntax', async () => {
    assert.equal(assertSafeSha('a1b2c3d'), 'a1b2c3d')
    assert.equal(assertSafeSha('A1B2C3D4'), 'A1B2C3D4')
    for (const bad of [
      // Anything git would read as a FLAG rather than an object name.
      '--output=/tmp/pwned',
      '-n',
      // Revision syntax addressing commits the UI never offered.
      'HEAD',
      'HEAD~3',
      'main..dev',
      ':/secret',
      'refs/heads/main',
      // Too short to be an object name, and the non-string cases.
      'abc',
      '',
      undefined,
      null,
      42,
    ]) {
      assert.throws(
        () => assertSafeSha(bad),
        /invalid commit sha/,
        `should reject ${String(bad)}`,
      )
    }
  })

  await test('parseCommitFiles reads a real commit, including a rename', async () => {
    // Land a commit that adds, modifies, deletes and renames in one go, so the
    // parser meets every branch it has against git's actual output.
    writeFileSync(join(dir, 'kept.txt'), 'kept\n')
    writeFileSync(join(dir, 'doomed.txt'), 'doomed\n')
    writeFileSync(join(dir, 'oldname.txt'), 'x'.repeat(200) + '\n')
    await runGit(dir, ['add', '-A'])
    await runGit(dir, ['commit', '-m', 'chore: set up rename fixture'])

    writeFileSync(join(dir, 'kept.txt'), 'kept\nmore\n')
    writeFileSync(join(dir, 'added.txt'), 'added\n')
    rmSync(join(dir, 'doomed.txt'))
    await runGit(dir, ['mv', 'oldname.txt', 'newname.txt'])
    await runGit(dir, ['add', '-A'])
    await runGit(dir, ['commit', '-m', 'feat: exercise every status letter'])

    const run = await runGit(dir, [
      'show',
      '--name-status',
      '-z',
      '--no-color',
      '--first-parent',
      '--format=',
      'HEAD',
    ])
    assert.equal(run.code, 0)
    const files = parseCommitFiles(run.stdout)
    const by = (p) => files.find((f) => f.path === p)

    assert.equal(by('added.txt').status, 'A')
    assert.equal(by('kept.txt').status, 'M')
    assert.equal(by('doomed.txt').status, 'D')

    const renamed = by('newname.txt')
    assert.ok(renamed, 'the rename DESTINATION is the path, not the source')
    assert.equal(renamed.status, 'R')
    assert.equal(renamed.origPath, 'oldname.txt')
    // The source must not also appear as its own entry: a rename emits two path
    // fields, and consuming only one would misread the destination as the next
    // record's status token.
    assert.equal(by('oldname.txt'), undefined)
    assert.equal(files.length, 4, 'exactly four paths, with no phantom entry')
  })

  await test('parseCommitFiles survives truncated and empty output', async () => {
    assert.deepEqual(parseCommitFiles(''), [])
    // A status letter with no path behind it must not produce a pathless entry.
    assert.deepEqual(parseCommitFiles('M\0'), [])
    assert.deepEqual(parseCommitFiles('R100\0only-source.txt\0'), [])
  })

  await test('a merge commit still lists its files', async () => {
    // Without --first-parent, `git show` prints NO file list for a merge, so the
    // history pane would expand a real merge into a convincing "no files".
    await runGit(dir, ['checkout', '-b', 'side'])
    writeFileSync(join(dir, 'side.txt'), 'side\n')
    await runGit(dir, ['add', '-A'])
    await runGit(dir, ['commit', '-m', 'feat: side branch work'])

    const back = await runGit(dir, ['checkout', 'trunk'])
    assert.equal(back.code, 0)
    writeFileSync(join(dir, 'trunk.txt'), 'trunk\n')
    await runGit(dir, ['add', '-A'])
    await runGit(dir, ['commit', '-m', 'feat: trunk work'])

    const merge = await runGit(dir, ['merge', '--no-ff', '-m', 'merge: side into trunk', 'side'])
    assert.equal(merge.code, 0, merge.stderr)

    const run = await runGit(dir, [
      'show',
      '--name-status',
      '-z',
      '--no-color',
      '--first-parent',
      '--format=',
      'HEAD',
    ])
    const files = parseCommitFiles(run.stdout)
    assert.ok(
      files.some((f) => f.path === 'side.txt'),
      'the merge brings side.txt in, and --first-parent must show it',
    )
  })
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// --- the diff handed to the commit-message model ----------------------------
//
// The scope rule is the whole feature: staged content alone when the index has
// any, every uncommitted change when it does not. Both halves are easy to get
// subtly wrong in ways no type catches — a bare `git diff` silently drops the
// index, and untracked files are invisible to every revision git can name.

const ai = mkdtempSync(join(tmpdir(), 'dsh-git-ai-'))
try {
  await runGit(ai, ['init', '-b', 'trunk'])
  execFileSync('git', ['config', 'user.email', 'ai@example.com'], { cwd: ai })
  execFileSync('git', ['config', 'user.name', 'AI Test'], { cwd: ai })

  await test('an unborn branch with only new files still gets a diff', async () => {
    writeFileSync(join(ai, 'first.txt'), 'hello\n')
    const got = await collectChangeDiff(ai)
    assert.equal(got.scope, 'all', 'nothing staged means the whole tree')
    // `git diff HEAD` cannot run here at all, and a bare `git diff` shows an
    // untracked file nothing — so this is entirely the synthesized patch.
    assert.match(got.text, /first\.txt/)
    assert.match(got.text, /\+hello/)
  })

  await test('a clean tree yields nothing to describe', async () => {
    await runGit(ai, ['add', '-A'])
    await runGit(ai, ['commit', '-m', 'chore: seed'])
    const got = await collectChangeDiff(ai)
    assert.equal(got.text, '', 'the caller decides how to report "no changes"')
    assert.equal(got.truncated, false)
  })

  await test('with nothing staged, the diff covers modified AND untracked files', async () => {
    writeFileSync(join(ai, 'first.txt'), 'hello\nworld\n')
    writeFileSync(join(ai, 'brand-new.txt'), 'fresh content\n')
    const got = await collectChangeDiff(ai)
    assert.equal(got.scope, 'all')
    assert.match(got.text, /\+world/, 'the tracked modification is in')
    assert.match(got.text, /brand-new\.txt/, 'the untracked file is in')
    assert.match(got.text, /\+fresh content/, 'with its contents, not just its name')
  })

  await test('with something staged, the diff covers ONLY the index', async () => {
    await runGit(ai, ['add', '--', 'first.txt'])
    const got = await collectChangeDiff(ai)
    assert.equal(got.scope, 'staged', 'a non-empty index picks the scope')
    assert.match(got.text, /\+world/, 'the staged change is described')
    assert.doesNotMatch(
      got.text,
      /brand-new\.txt/,
      'the untracked file is NOT part of what this commit would record',
    )
  })

  await test('an explicit scope overrides the default, and sees past the index', async () => {
    const all = await collectChangeDiff(ai, { staged: false })
    assert.equal(all.scope, 'all')
    // `git diff` alone would show nothing for first.txt now that it is staged;
    // only `git diff HEAD` keeps it visible.
    assert.match(all.text, /\+world/, 'staged work stays visible in the all scope')
    assert.match(all.text, /brand-new\.txt/, 'and so does the untracked file')

    // Forcing the staged scope over an empty index describes nothing, rather
    // than quietly widening to the working tree — that silent widening is the
    // bug the scope rule exists to prevent.
    await runGit(ai, ['restore', '--staged', '--', 'first.txt'])
    const staged = await collectChangeDiff(ai, { staged: true })
    assert.equal(staged.scope, 'staged')
    assert.equal(staged.text, '')
  })

  await test('the byte budget truncates rather than failing the call', async () => {
    const got = await collectChangeDiff(ai, { maxBytes: 200 })
    assert.equal(got.truncated, true)
    assert.match(got.text, /\[diff truncated\]/)
    assert.ok(got.text.length < 300, `capped, got ${got.text.length} bytes`)
  })

  await test('untrackedPatch reports a real patch despite a non-zero exit', async () => {
    // --no-index exits 1 whenever the sides differ, which is always the case
    // here; reading the exit code instead of stdout would drop every new file.
    const patch = await untrackedPatch(ai, 'brand-new.txt')
    assert.match(patch, /\+fresh content/)
  })
} finally {
  rmSync(ai, { recursive: true, force: true })
}

console.log(`\n${passed} host checks passed`)