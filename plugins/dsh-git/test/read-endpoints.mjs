/**
 * The READ endpoints, driven through the host service against real
 * repositories: status, diff, commitFiles, commitDiff and changeToken.
 *
 * `wire-contract.mjs` proves their SHAPES survive the codecs. This proves the
 * CONTENT is right — that status classifies a partially staged file into both
 * sections, that a staged diff and an unstaged diff of the same file differ,
 * that a rename carries its original path, and that the polling endpoint
 * actually moves when the repository does.
 *
 * Reads were the last thing still covered only at the `git.ts` layer, which is
 * the same gap that hid `git checkout -- <branch>` in `branch switch` for its
 * entire life.
 */
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { GitService } from '../lib/index.js'
import { makeService, makeEmptyService, addRemote, cloneOf, cleanup, makeRunner, WS } from './service-harness.mjs'

const { test, state } = makeRunner()
const write = (box, name, body) => writeFileSync(join(box.repo, name), body)
const fileOf = (status, path, staged) =>
  status.files.find((f) => f.path === path && f.staged === staged)

try {
  await test('status keeps BOTH codes for a partially staged file', async () => {
    // One row per path, carrying the index code AND the worktree code. The tab
    // derives its two sections by filtering that single row twice --
    //   staged:   !conflicted && staged
    //   unstaged: !conflicted && (worktree !== ' ' || untracked)
    // -- so a partially staged file appears in both. Collapsing the two codes
    // into one boolean here would silently empty one of those sections.
    const box = makeService('read-partial-')
    write(box, 'a.txt', 'STAGED version\n')
    box.g('add', 'a.txt')
    write(box, 'a.txt', 'later unstaged edit\n')
    const { status } = await box.svc.status(WS)
    const rows = status.files.filter((f) => f.path === 'a.txt')
    assert.equal(rows.length, 1, 'one row, not one per section')
    const row = rows[0]
    assert.equal(row.index, 'M', 'the index has a change')
    assert.equal(row.worktree, 'M', 'and so does the working tree')
    assert.equal(row.staged, true)
    // Reproduce the tab's own filters against this row.
    assert.ok(!row.conflicted && row.staged, 'selected by the staged filter')
    assert.ok(!row.conflicted && (row.worktree !== ' ' || row.untracked), 'and the unstaged one')
  })

  await test('status reports a rename with its ORIGINAL path', async () => {
    const box = makeService('read-rename-')
    box.g('mv', 'a.txt', 'moved.txt')
    const { status } = await box.svc.status(WS)
    const row = status.files.find((f) => f.path === 'moved.txt')
    assert.ok(row, 'listed under the NEW path')
    assert.equal(row.index, 'R', 'flagged as a rename')
    assert.equal(row.origPath, 'a.txt', 'and carries where it came from')
    assert.ok(!status.files.some((f) => f.path === 'a.txt'), 'not a phantom second row')
  })

  await test('status flags conflicts and untracked files distinctly', async () => {
    const box = makeService('read-flags-')
    box.g('checkout', '-b', 'ours')
    write(box, 'a.txt', 'ours\n'); box.g('add', '-A'); box.g('commit', '-m', 'ours')
    box.g('checkout', 'main'); box.g('checkout', '-b', 'theirs')
    write(box, 'a.txt', 'theirs\n'); box.g('add', '-A'); box.g('commit', '-m', 'theirs')
    await box.svc.merge({ ...WS, action: 'merge', from: 'ours' })
    write(box, 'brand-new.txt', 'x\n')
    const { status } = await box.svc.status(WS)
    const conflicted = status.files.filter((f) => f.conflicted)
    assert.equal(conflicted.length, 1)
    assert.equal(conflicted[0].path, 'a.txt')
    assert.equal(conflicted[0].untracked, false, 'a conflict is not untracked')
    const fresh = status.files.find((f) => f.path === 'brand-new.txt')
    assert.equal(fresh.untracked, true)
    assert.equal(fresh.conflicted, false)
  })

  await test('status counts ahead and behind against a real upstream', async () => {
    const box = makeService('read-upstream-')
    const bare = addRemote(box)
    await box.svc.sync({ ...WS, action: 'publish' })
    const other = cloneOf(box, bare, 'other')
    writeFileSync(join(other.dir, 'theirs.txt'), 'x\n')
    other.g('add', '-A'); other.g('commit', '-m', 't1'); other.g('push')
    write(box, 'mine.txt', 'y\n')
    await box.svc.stage({ ...WS, action: 'stage' })
    await box.svc.commit({ ...WS, message: 'm1' })
    await box.svc.sync({ ...WS, action: 'fetch' })
    const { status } = await box.svc.status(WS)
    assert.equal(status.upstream.name, 'origin/main')
    assert.equal(status.upstream.ahead, 1, 'one unpushed commit')
    assert.equal(status.upstream.behind, 1, 'one unpulled commit')
    assert.equal(status.hasRemote, true)
  })

  await test('status recent[] carries a usable commit list', async () => {
    const box = makeService('read-recent-')
    for (let i = 1; i <= 3; i += 1) {
      write(box, 'a.txt', 'v' + i + '\n')
      box.g('add', '-A'); box.g('commit', '-m', 'change ' + i)
    }
    const { status } = await box.svc.status(WS)
    assert.equal(status.recent[0].subject, 'change 3', 'newest first')
    assert.match(status.recent[0].sha, /^[0-9a-f]{7,40}$/, 'a usable sha')
    assert.ok(status.recent[0].author.length > 0)
    assert.ok(status.recent[0].date > 0, 'an epoch, not a formatted string')
    assert.ok(status.recent.length <= 15, 'the window is capped')
  })

  await test('diff of the SAME file differs staged vs unstaged', async () => {
    // The selector is the whole point of the two sections. If it were ignored,
    // both rows would render the same patch and nobody would notice quickly.
    const box = makeService('read-diffsel-')
    write(box, 'a.txt', 'STAGED CONTENT\n')
    box.g('add', 'a.txt')
    write(box, 'a.txt', 'WORKTREE CONTENT\n')
    const staged = await box.svc.diff({ ...WS, path: 'a.txt', staged: true })
    const worktree = await box.svc.diff({ ...WS, path: 'a.txt' })
    assert.match(staged.patch, /STAGED CONTENT/)
    assert.doesNotMatch(staged.patch, /WORKTREE CONTENT/, 'index only')
    assert.match(worktree.patch, /WORKTREE CONTENT/)
    assert.notEqual(staged.patch, worktree.patch)
  })

  await test('diff synthesizes a patch for an UNTRACKED file', async () => {
    // It is in no tree and no index, so git alone shows nothing and the pane
    // would render blank for every newly created file.
    const box = makeService('read-diffnew-')
    write(box, 'fresh.txt', 'line one\nline two\n')
    const out = await box.svc.diff({ ...WS, path: 'fresh.txt' })
    assert.match(out.patch, /line one/)
    assert.match(out.patch, /line two/)
    assert.match(out.patch, /dev\/null/, 'against /dev/null')
    assert.equal(out.binary, false)
  })

  await test('diff reports a BINARY file instead of dumping bytes', async () => {
    const box = makeService('read-binary-')
    writeFileSync(join(box.repo, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255, 0, 7, 0]))
    box.g('add', '-A'); box.g('commit', '-m', 'add binary')
    writeFileSync(join(box.repo, 'blob.bin'), Buffer.from([0, 9, 9, 0, 1, 0, 2, 0]))
    const out = await box.svc.diff({ ...WS, path: 'blob.bin' })
    assert.equal(out.binary, true, 'flagged, so the pane can say so')
  })

  await test('diff refuses an escaping path', async () => {
    const box = makeService('read-diffpath-')
    for (const path of ['../outside.txt', '/etc/passwd', 'a/../../b']) {
      await assert.rejects(() => box.svc.diff({ ...WS, path }), /dsh-git/)
    }
  })

  await test('commitFiles reads a MERGE commit, which needs --first-parent', async () => {
    // Without the flag git prints no file list for a merge at all, so the row
    // expands into a convincing but false "no files in this commit".
    const box = makeService('read-merge-')
    box.g('checkout', '-b', 'side')
    write(box, 'side.txt', 'side\n'); box.g('add', '-A'); box.g('commit', '-m', 'side work')
    box.g('checkout', 'main')
    write(box, 'main.txt', 'main\n'); box.g('add', '-A'); box.g('commit', '-m', 'main work')
    box.g('merge', '--no-edit', '--no-ff', 'side')
    const sha = box.g('rev-parse', 'HEAD').trim()
    const out = await box.svc.commitFiles({ ...WS, sha })
    assert.ok(out.files.length > 0, 'a merge commit still lists files')
    assert.ok(out.files.some((f) => f.path === 'side.txt'))
  })

  await test('commitDiff scoped to one path excludes the others', async () => {
    const box = makeService('read-cdiff-')
    write(box, 'one.txt', 'first file\n')
    write(box, 'two.txt', 'second file\n')
    box.g('add', '-A'); box.g('commit', '-m', 'two files')
    const sha = box.g('rev-parse', 'HEAD').trim()
    const whole = await box.svc.commitDiff({ ...WS, sha })
    assert.match(whole.patch, /first file/)
    assert.match(whole.patch, /second file/)
    const scoped = await box.svc.commitDiff({ ...WS, sha, path: 'one.txt' })
    assert.match(scoped.patch, /first file/)
    assert.doesNotMatch(scoped.patch, /second file/, 'scoped to the clicked path')
  })

  await test('a hostile sha never reaches git, for either commit endpoint', async () => {
    const box = makeService('read-sha-')
    for (const sha of ['HEAD', 'main..dev', '--output=/tmp/x', ':/secret', 'refs/heads/main']) {
      await assert.rejects(() => box.svc.commitFiles({ ...WS, sha }), /dsh-git/, sha)
      await assert.rejects(() => box.svc.commitDiff({ ...WS, sha }), /dsh-git/, sha)
    }
  })

  await test('changeToken is 0 outside a repository, and non-zero inside', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'read-token-plain-'))
    const ctx = new Context()
    ctx.provide('workspaceRegistry'); ctx.provide('llm'); ctx.provide('agentDefaultModel')
    ctx.workspaceRegistry = { list: () => [{ id: 'w1', path: plain }] }
    const svc = new GitService(ctx)
    try {
      const out = await svc.changeToken(WS)
      assert.equal(out.token, 0, 'the client stops polling on 0')
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
    const box = makeService('read-token-')
    const first = await box.svc.changeToken(WS)
    assert.notEqual(first.token, 0, 'a real repo yields a real token')
    // Never restarted at 1: a client holding the very common baseline of 1
    // would read a reused value as "no change" and go blind.
    assert.ok(first.token >= 1)
    const again = await box.svc.changeToken(WS)
    assert.equal(again.token, first.token, 'idle repo does not advance it')
  })
} finally {
  cleanup()
}

console.log('\n' + state.passed + ' read-endpoint checks passed')
// The watcher holds OS handles, so an explicit exit keeps the runner honest
// rather than hanging after the last check.
process.exit(0)
