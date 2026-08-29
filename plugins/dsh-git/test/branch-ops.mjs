/**
 * Branch, merge, stash and worktree operations against a real repository.
 *
 * Split from host-ops.mjs because these build several repositories and a real
 * merge conflict, and mixing that into the staging tests made both harder to
 * read. The LLM path is not covered here for the same reason it is not there:
 * it needs credentials and a live model.
 */
// Must come first: it scrubs inherited GIT_DIR/GIT_INDEX_FILE before any git runs.
import './git-env.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, isAbsolute, basename } from 'node:path'

import {
  assertSafeRef,
  assertSafeStashIndex,
  resolveWorktreePath,
  parseBranches,
  parseStashes,
  parseWorktrees,
  readRefs,
  readStatus,
  readMergeState,
  readStashCount,
  repoPaths,
  runGit,
} from '../src/git.ts'
// Shared with the browser: one implementation, so the preview the user reads
// and the directory git receives cannot disagree.
import { resolveWorktreeTarget } from '../src/types.ts'

let passed = 0
/** Run one named async check. */
async function test(name, fn) {
  await fn()
  passed += 1
  console.log('  ok  ' + name)
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-git-branch-'))
const worktrees = []

try {
  // --- validators ----------------------------------------------------------

  await test('assertSafeRef accepts ordinary branch names', () => {
    for (const ok of ['main', 'feature/x', 'origin/feature/x', 'release-1.2', 'a_b']) {
      assert.equal(assertSafeRef(ok), ok, ok + ' should be accepted')
    }
  })

  await test('assertSafeRef refuses flags and revision syntax', () => {
    // Each of these reaches git as something other than a branch name.
    const bad = [
      '--exec=rm -rf /',   // read as a FLAG, not a name
      '-f',
      'main..dev',         // a revision RANGE
      'main...dev',
      'HEAD~1',            // ancestry
      'main^',
      'refs/heads/x:y',    // addresses another ref
      'main@{yesterday}',  // reflog syntax
      'has space',
      'star*',
      'quest?',
      'brack[et',
      'back\\slash',
      '.hidden',
      'trailing.lock',
      'trailing/',
      'double//slash',
      '',
      '   ',
    ]
    for (const value of bad) {
      assert.throws(() => assertSafeRef(value), /dsh-git/, JSON.stringify(value) + ' must be refused')
    }
    assert.throws(() => assertSafeRef(null), /dsh-git/)
    assert.throws(() => assertSafeRef(42), /dsh-git/)
  })

  await test('assertSafeStashIndex takes only non-negative integers', () => {
    assert.equal(assertSafeStashIndex(0), 0)
    assert.equal(assertSafeStashIndex(3), 3)
    for (const bad of [-1, 1.5, NaN, '0', null, undefined, Infinity]) {
      assert.throws(() => assertSafeStashIndex(bad), /dsh-git/, String(bad) + ' must be refused')
    }
  })

  await test('resolveWorktreePath resolves ".." like a terminal AT the repo root', () => {
    // The bug this replaced: resolution hung off the repo's PARENT, so the ".."
    // was applied twice and "../feature" landed TWO levels up. It shipped with a
    // form placeholder of "../feature-worktree", so the default demonstrated the
    // bug every time the form was opened.
    const root = 'C:/proj/repo'
    assert.equal(resolveWorktreePath(root, '../feature'), 'C:/proj/feature', 'beside the repo')
    assert.equal(resolveWorktreePath(root, '../../feature'), 'C:/feature', 'two up when asked')
    assert.equal(
      resolveWorktreePath(root, 'C:/elsewhere/wt'),
      'C:/elsewhere/wt',
      'an absolute path is left alone',
    )
  })

  await test('resolveWorktreePath REFUSES a target inside the repository', () => {
    // Git allows it, but the worktree then shows up as untracked content in the
    // very tab the user is looking at -- easy to do by accident, annoying to undo.
    const root = 'C:/proj/repo'
    for (const bad of ['feature', 'sub/dir', './feature', 'C:/proj/repo/inner', '.']) {
      assert.throws(
        () => resolveWorktreePath(root, bad),
        /cannot live inside the repository/,
        JSON.stringify(bad) + ' must be refused',
      )
    }
    // A refusal that does not say what to do instead is only half an answer.
    assert.throws(() => resolveWorktreePath(root, 'feature'), /\.\.\/feature/)
  })

  await test('the repo root itself is inside the repo, and a case difference does not hide it', () => {
    // Windows paths differ in case constantly; a containment check that missed
    // on a drive letter would wave through the exact nesting it exists to catch.
    assert.equal(resolveWorktreeTarget('C:/proj/repo', 'C:/PROJ/Repo/x').inside, true)
    assert.equal(resolveWorktreeTarget('C:/proj/repo', 'C:/proj/repo').inside, true)
    // A sibling whose name merely STARTS with the root must not count as inside.
    assert.equal(resolveWorktreeTarget('C:/proj/repo', 'C:/proj/repo-two').inside, false)
  })

  await test('resolveWorktreePath refuses a leading dash', () => {
    // git would read this as an option rather than a directory.
    assert.throws(() => resolveWorktreePath('/r', '--force'), /dsh-git/)
    assert.throws(() => resolveWorktreePath('/r', ''), /dsh-git/)
  })

  // --- a real repository ----------------------------------------------------

  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'ops@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Ops Test'], { cwd: dir })
  writeFileSync(join(dir, 'shared.txt'), 'base\n')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-m', 'chore: base'], { cwd: dir })

  await test('repoPaths returns three ABSOLUTE directories from one call', async () => {
    const paths = await repoPaths(dir)
    assert.ok(paths !== undefined)
    // rev-parse prints these relative to cwd; unresolved they read as nothing
    // and the merge probe would report a clean repo mid-merge.
    assert.ok(isAbsolute(paths.gitDir), 'gitDir absolute, got ' + paths.gitDir)
    assert.ok(isAbsolute(paths.commonDir), 'commonDir absolute, got ' + paths.commonDir)
    assert.ok(existsSync(paths.gitDir), 'gitDir exists on disk')
  })

  await test('a clean repo reports no merge and no stashes', async () => {
    const status = await readStatus(dir)
    assert.equal(status.repo, true)
    assert.equal(status.merging, false)
    assert.equal(status.stashCount, 0)
  })

  // --- branches -------------------------------------------------------------

  await test('readRefs lists branches with the current one marked', async () => {
    await runGit(dir, ['branch', 'feature'])
    const refs = await readRefs(dir)
    const names = refs.branches.map((b) => b.name).sort()
    assert.deepEqual(names, ['feature', 'main'])
    const current = refs.branches.filter((b) => b.current)
    assert.equal(current.length, 1, 'exactly one current branch')
    assert.equal(current[0].name, 'main')
    assert.equal(refs.branches.every((b) => b.remote === false), true, 'no remotes configured')
  })

  await test('a branch subject comes through for menu context', async () => {
    const refs = await readRefs(dir)
    const main = refs.branches.find((b) => b.name === 'main')
    assert.equal(main.subject, 'chore: base')
  })

  await test('switching branches moves HEAD', async () => {
    const run = await runGit(dir, ['checkout', 'feature'])
    assert.equal(run.code, 0)
    const status = await readStatus(dir)
    assert.equal(status.branch, 'feature')
    await runGit(dir, ['checkout', 'main'])
  })

  await test('git REFUSES to switch away from clobbering local changes', async () => {
    // The premise of the stash-and-switch flow: git says no first, and the tab
    // only then offers to stash. If this ever stopped failing, the second-click
    // affordance would be dead UI.
    writeFileSync(join(dir, 'shared.txt'), 'edited on main\n')
    await runGit(dir, ['checkout', 'feature'])   // seed divergence
    await runGit(dir, ['checkout', 'main'])
    writeFileSync(join(dir, 'shared.txt'), 'dirty\n')
    await runGit(dir, ['stash', 'push', '-m', 'probe'])
    await runGit(dir, ['checkout', 'feature'])
    writeFileSync(join(dir, 'shared.txt'), 'feature edit\n')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'feat: feature edit'], { cwd: dir })
    await runGit(dir, ['checkout', 'main'])
    writeFileSync(join(dir, 'shared.txt'), 'uncommitted on main\n')
    const refused = await runGit(dir, ['checkout', 'feature'])
    assert.notEqual(refused.code, 0, 'checkout must refuse a clobbering switch')
    assert.match((refused.stderr + refused.stdout), /local changes|overwritten/i)
    await runGit(dir, ['checkout', '--', 'shared.txt'])
  })

  // --- stash ----------------------------------------------------------------

  await test('stashCount reflects the reflog without spawning git', async () => {
    const paths = await repoPaths(dir)
    const viaFile = await readStashCount(paths.commonDir)
    const viaGit = (await runGit(dir, ['stash', 'list'])).stdout
      .split('\n').filter((l) => l.trim().length > 0).length
    assert.equal(viaFile, viaGit, 'the file count IS git stash list')
    assert.ok(viaFile >= 1, 'the probe stash from the switch test is there')
  })

  await test('readRefs lists stashes with usable indices', async () => {
    writeFileSync(join(dir, 'shared.txt'), 'second stash\n')
    await runGit(dir, ['stash', 'push', '-m', 'second'])
    const refs = await readRefs(dir)
    assert.ok(refs.stashes.length >= 2)
    // Newest first, and the index is the address git accepts.
    assert.equal(refs.stashes[0].index, 0)
    assert.match(refs.stashes[0].message, /second/)
    assert.equal(refs.stashes[0].branch, 'main')
    const show = await runGit(dir, ['stash', 'show', 'stash@{' + refs.stashes[0].index + '}'])
    assert.equal(show.code, 0, 'the reported index is a real address')
  })

  await test('popping a stash restores the work and shifts indices', async () => {
    const before = await readRefs(dir)
    const count = before.stashes.length
    const pop = await runGit(dir, ['stash', 'pop'])
    assert.equal(pop.code, 0, pop.stderr)
    const after = await readRefs(dir)
    assert.equal(after.stashes.length, count - 1, 'the stack shrank')
    const status = await readStatus(dir)
    assert.equal(status.stashCount, count - 1, 'status agrees with the list')
    await runGit(dir, ['checkout', '--', '.'])
  })

  // --- merge ----------------------------------------------------------------

  await test('a fast-forward merge leaves no merge in progress', async () => {
    await runGit(dir, ['checkout', '-b', 'ff-base'])
    await runGit(dir, ['checkout', '-b', 'ff-topic'])
    writeFileSync(join(dir, 'ff.txt'), 'ff\n')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'feat: ff'], { cwd: dir })
    await runGit(dir, ['checkout', 'ff-base'])
    const merge = await runGit(dir, ['merge', '--no-edit', 'ff-topic'])
    assert.equal(merge.code, 0)
    const status = await readStatus(dir)
    assert.equal(status.merging, false, 'a clean merge concludes itself')
  })

  await test('a CONFLICTING merge reports merging:true and names the branch', async () => {
    await runGit(dir, ['checkout', 'main'])
    await runGit(dir, ['checkout', '-b', 'conflict-a'])
    writeFileSync(join(dir, 'shared.txt'), 'from A\n')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'feat: A'], { cwd: dir })
    await runGit(dir, ['checkout', 'main'])
    await runGit(dir, ['checkout', '-b', 'conflict-b'])
    writeFileSync(join(dir, 'shared.txt'), 'from B\n')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'feat: B'], { cwd: dir })

    const merge = await runGit(dir, ['merge', '--no-edit', 'conflict-a'])
    assert.notEqual(merge.code, 0, 'the merge must actually conflict')

    const status = await readStatus(dir)
    assert.equal(status.merging, true, 'MERGE_HEAD is the signal, and it is read')
    assert.match(status.mergeHead, /conflict-a/, 'names what is being merged')
    const conflicted = status.files.filter((f) => f.conflicted)
    assert.equal(conflicted.length, 1, 'the conflict surfaces in the file list')
    assert.equal(conflicted[0].path, 'shared.txt')
  })

  await test('merging stays TRUE after every conflict is resolved', async () => {
    // The reason merging is its own field rather than inferred from conflicts:
    // once resolved there are no conflicted files left, and the merge is still
    // unconcluded. Inferring it would hide the Abort button exactly when the
    // user still needs to finish or back out.
    writeFileSync(join(dir, 'shared.txt'), 'resolved\n')
    await runGit(dir, ['add', '--', 'shared.txt'])
    const status = await readStatus(dir)
    assert.equal(status.files.filter((f) => f.conflicted).length, 0, 'nothing conflicted now')
    assert.equal(status.merging, true, 'but the merge is NOT over')
    assert.ok(status.files.some((f) => f.staged), 'the resolution is staged and committable')
  })

  await test('aborting a merge clears the state entirely', async () => {
    const abort = await runGit(dir, ['merge', '--abort'])
    assert.equal(abort.code, 0, abort.stderr)
    const status = await readStatus(dir)
    assert.equal(status.merging, false)
    assert.equal(status.mergeHead, undefined)
    assert.equal(status.files.filter((f) => f.conflicted).length, 0)
  })

  // --- worktrees ------------------------------------------------------------

  await test('worktree add is listed, and the current one is marked', async () => {
    await runGit(dir, ['checkout', 'main'])
    const wt = join(tmpdir(), 'dsh-git-wt-' + Date.now())
    worktrees.push(wt)
    const add = await runGit(dir, ['worktree', 'add', '-b', 'wt-branch', wt])
    assert.equal(add.code, 0, add.stderr)

    const refs = await readRefs(dir)
    assert.equal(refs.worktrees.length, 2, 'main plus the new one')
    const main = refs.worktrees.find((w) => w.main)
    assert.ok(main, 'git lists the main worktree first')
    assert.equal(main.current, true, 'we are sitting in the main worktree')
    const added = refs.worktrees.find((w) => !w.main)
    assert.equal(added.branch, 'wt-branch')
    assert.equal(added.current, false)
    assert.ok(added.head && added.head.length === 7, 'short head sha')
  })

  await test('a linked worktree resolves DIFFERENT git and common dirs', async () => {
    // This is what makes reading MERGE_HEAD and refs/stash from the right place
    // non-obvious: per-worktree state lives in the gitDir, the stash in the
    // common dir, and in a linked worktree those are not the same directory.
    const paths = await repoPaths(worktrees[0])
    assert.ok(paths !== undefined)
    assert.notEqual(paths.gitDir, paths.commonDir, 'they diverge in a linked worktree')
    assert.ok(isAbsolute(paths.gitDir) && isAbsolute(paths.commonDir))
    // The stash is shared, so the count read from the linked worktree matches.
    const here = await readStashCount(paths.commonDir)
    const there = await readStashCount((await repoPaths(dir)).commonDir)
    assert.equal(here, there, 'stash is shared across worktrees')
  })

  await test('worktree remove drops it from the list', async () => {
    const wt = worktrees[0]
    const removed = await runGit(dir, ['worktree', 'remove', wt])
    assert.equal(removed.code, 0, removed.stderr)
    const refs = await readRefs(dir)
    assert.equal(refs.worktrees.length, 1)
    assert.equal(refs.worktrees[0].main, true)
  })

  // --- parsers, against shapes a live repo will not easily produce -----------

  await test('parseWorktrees keeps a path containing spaces intact', () => {
    const raw = [
      'worktree /home/me/my project',
      'HEAD 1234567890abcdef',
      'branch refs/heads/main',
      '',
      'worktree /home/me/other',
      'HEAD abcdef1234567890',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n')
    const got = parseWorktrees(raw)
    assert.equal(got.length, 2)
    assert.equal(got[0].path, '/home/me/my project', 'the space survives')
    assert.equal(got[0].branch, 'main')
    assert.equal(got[0].main, true)
    assert.equal(got[1].branch, undefined, 'a detached worktree has no branch')
    assert.equal(got[1].prunable, true)
    assert.equal(got[1].main, false)
  })

  await test('parseBranches keeps ahead/behind undefined without an upstream', () => {
    const S = String.fromCharCode(31)
    const raw = [
      ['main', '*', 'origin/main', '[ahead 2, behind 1]', 'subject one'].join(S),
      ['local-only', ' ', '', '', 'subject two'].join(S),
      ['remotes/origin/HEAD', ' ', '', '', ''].join(S) + ' -> origin/main',
    ].join('\n')
    const got = parseBranches(raw)
    const main = got.find((b) => b.name === 'main')
    assert.equal(main.current, true)
    assert.equal(main.ahead, 2)
    assert.equal(main.behind, 1)
    const local = got.find((b) => b.name === 'local-only')
    // Not zero: 'in sync' and 'no upstream' are different facts.
    assert.equal(local.ahead, undefined)
    assert.equal(local.behind, undefined)
    assert.equal(local.upstream, undefined)
    assert.ok(!got.some((b) => b.name.includes('->')), 'the remote HEAD symref is skipped')
  })

  await test('parseStashes reads the index from the selector git printed', () => {
    const S = String.fromCharCode(31)
    const raw = [
      ['stash@{0}', 'WIP on main: 1a2b3c4 latest', '1700000000'].join(S),
      ['stash@{1}', 'On feature/x: hand written', '1600000000'].join(S),
    ].join('\n')
    const got = parseStashes(raw)
    assert.equal(got.length, 2)
    assert.equal(got[0].index, 0)
    assert.equal(got[0].branch, 'main')
    assert.equal(got[1].index, 1)
    assert.equal(got[1].branch, 'feature/x')
    assert.equal(got[0].date, 1700000000000)
  })
} finally {
  for (const wt of worktrees) rmSync(wt, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
}

console.log('\n' + passed + ' branch/merge/stash/worktree checks passed')
