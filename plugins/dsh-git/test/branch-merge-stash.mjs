/**
 * Branch, merge and stash: the HOST SERVICE driven end to end.
 *
 * The companion to `worktree-integration.mjs`, and it exists for the same
 * reason — that suite found `git checkout -- <branch>` (a PATHSPEC, not a
 * branch) sitting in `branch switch` with every other test green, because
 * nothing ran the code that turns a request into a git command.
 *
 * `switch` overlaps slightly with the worktree suite on purpose: there it pins
 * the `ok` contract three client behaviours depend on, here it pins branch
 * semantics. Both would have to be deleted to lose the coverage.
 */
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeService, makeEmptyService, cleanup, makeRunner, WS, head, branches } from './service-harness.mjs'

const { test, state } = makeRunner()

/** Commit a file, so a branch has something of its own. */
function commit(box, name, body, message) {
  writeFileSync(join(box.repo, name), body)
  box.g('add', '-A')
  box.g('commit', '-m', message)
}

try {
  // === branch ==============================================================

  await test('create makes a branch and does NOT move HEAD', async () => {
    const box = makeService('svc-br-create-')
    const r = await box.svc.branch({ ...WS, action: 'create', name: 'feature' })
    assert.equal(r.ok, true, r.output)
    assert.deepEqual(branches(box.g), ['feature', 'main'])
    assert.equal(head(box.g), 'main', 'create alone must not check it out')
  })

  await test('create honours a startPoint', async () => {
    const box = makeService('svc-br-createsp-')
    box.g('checkout', '-b', 'side')
    commit(box, 'side.txt', 'side\n', 'only on side')
    const r = await box.svc.branch({ ...WS, action: 'create', name: 'off-main', startPoint: 'main' })
    assert.equal(r.ok, true, r.output)
    const log = box.g('log', '--oneline', 'off-main')
    assert.doesNotMatch(log, /only on side/, 'forked from main, not HEAD')
  })

  await test('createSwitch creates AND moves HEAD', async () => {
    const box = makeService('svc-br-cs-')
    const r = await box.svc.branch({ ...WS, action: 'createSwitch', name: 'feat/new-thing' })
    assert.equal(r.ok, true, r.output)
    assert.equal(head(box.g), 'feat/new-thing')
    assert.equal(r.status.branch, 'feat/new-thing', 'and the reply agrees')
  })

  await test('createSwitch honours a startPoint', async () => {
    const box = makeService('svc-br-cssp-')
    box.g('checkout', '-b', 'side')
    commit(box, 'side.txt', 'side\n', 'only on side')
    const r = await box.svc.branch({ ...WS, action: 'createSwitch', name: 'fresh', startPoint: 'main' })
    assert.equal(r.ok, true, r.output)
    assert.equal(head(box.g), 'fresh')
    assert.ok(!existsSync(join(box.repo, 'side.txt')), 'working tree is main, not side')
  })

  await test('switch moves HEAD to an existing branch', async () => {
    const box = makeService('svc-br-switch-')
    box.g('branch', 'topic')
    const r = await box.svc.branch({ ...WS, action: 'switch', name: 'topic' })
    assert.equal(r.ok, true, r.output)
    assert.equal(head(box.g), 'topic')
  })

  await test('switching to a branch that does not exist fails as data', async () => {
    const box = makeService('svc-br-noswitch-')
    const r = await box.svc.branch({ ...WS, action: 'switch', name: 'ghost' })
    assert.equal(r.ok, false)
    assert.equal(head(box.g), 'main', 'HEAD stayed put')
  })

  await test('create refuses a name that already exists', async () => {
    const box = makeService('svc-br-dup-')
    box.g('branch', 'taken')
    const r = await box.svc.branch({ ...WS, action: 'create', name: 'taken' })
    assert.equal(r.ok, false)
    assert.match(r.output, /already exists/i)
  })

  await test('delete removes a merged branch', async () => {
    const box = makeService('svc-br-del-')
    box.g('branch', 'doomed')
    const r = await box.svc.branch({ ...WS, action: 'delete', name: 'doomed' })
    assert.equal(r.ok, true, r.output)
    assert.deepEqual(branches(box.g), ['main'])
  })

  await test('delete REFUSES an unmerged branch until forced', async () => {
    // -d protects unmerged work; -D is the override the client only sends after
    // confirming. If the refusal ever stopped happening, the confirm would be
    // guarding nothing.
    const box = makeService('svc-br-delunmerged-')
    box.g('checkout', '-b', 'unmerged')
    commit(box, 'u.txt', 'work\n', 'unmerged work')
    box.g('checkout', 'main')
    const refused = await box.svc.branch({ ...WS, action: 'delete', name: 'unmerged' })
    assert.equal(refused.ok, false, 'unmerged work must not vanish on a plain delete')
    assert.match(refused.output, /not fully merged/i)
    assert.ok(branches(box.g).includes('unmerged'))
    const forced = await box.svc.branch({ ...WS, action: 'delete', name: 'unmerged', force: true })
    assert.equal(forced.ok, true, forced.output)
    assert.deepEqual(branches(box.g), ['main'])
  })

  await test('delete refuses the branch that is checked out', async () => {
    const box = makeService('svc-br-delcur-')
    const r = await box.svc.branch({ ...WS, action: 'delete', name: 'main' })
    assert.equal(r.ok, false)
    assert.match(r.output, /checked out|cannot delete/i)
  })

  await test('rename renames the CURRENT branch and HEAD follows', async () => {
    const box = makeService('svc-br-rename-')
    const r = await box.svc.branch({ ...WS, action: 'rename', name: 'renamed' })
    assert.equal(r.ok, true, r.output)
    assert.equal(head(box.g), 'renamed')
    assert.deepEqual(branches(box.g), ['renamed'])
    assert.equal(r.status.branch, 'renamed')
  })

  await test('rename onto an existing name is refused', async () => {
    const box = makeService('svc-br-renamedup-')
    box.g('branch', 'occupied')
    const r = await box.svc.branch({ ...WS, action: 'rename', name: 'occupied' })
    assert.equal(r.ok, false)
    assert.match(r.output, /already exists/i)
    assert.equal(head(box.g), 'main', 'and nothing moved')
  })

  await test('hostile branch names are refused at the boundary', async () => {
    const box = makeService('svc-br-hostile-')
    for (const bad of ['--exec=calc', 'main..dev', 'a b', 'HEAD~1', '-f', 'x.lock']) {
      for (const action of ['create', 'switch', 'delete', 'rename']) {
        await assert.rejects(
          () => box.svc.branch({ ...WS, action, name: bad }),
          /dsh-git/,
          action + ' ' + JSON.stringify(bad) + ' must be refused',
        )
      }
    }
    assert.deepEqual(branches(box.g), ['main'], 'nothing was created')
  })

  await test('an unknown action is reported, never silently ignored', async () => {
    // withRepo catches the throw and returns it as data, which is the right
    // shape here: the tab renders the reason instead of the bridge breaking.
    const box = makeService('svc-br-badaction-')
    const r = await box.svc.branch({ ...WS, action: 'obliterate', name: 'x' })
    assert.equal(r.ok, false)
    assert.match(r.output, /unknown branch action/)
    assert.deepEqual(branches(box.g), ['main'], 'and nothing happened')
  })

  // === merge ===============================================================

  await test('a fast-forward merge concludes itself', async () => {
    const box = makeService('svc-mg-ff-')
    box.g('checkout', '-b', 'ahead')
    commit(box, 'f.txt', 'ff\n', 'feat: ff')
    box.g('checkout', 'main')
    const r = await box.svc.merge({ ...WS, action: 'merge', from: 'ahead' })
    assert.equal(r.ok, true, r.output)
    assert.equal(r.status.merging, false, 'nothing left in progress')
    assert.ok(existsSync(join(box.repo, 'f.txt')))
  })

  await test('noFF forces a merge commit even when a fast-forward was possible', async () => {
    const box = makeService('svc-mg-noff-')
    box.g('checkout', '-b', 'ahead')
    commit(box, 'f.txt', 'ff\n', 'feat: ff')
    box.g('checkout', 'main')
    const r = await box.svc.merge({ ...WS, action: 'merge', from: 'ahead', noFF: true })
    assert.equal(r.ok, true, r.output)
    const parents = box.g('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(/\s+/)
    assert.equal(parents.length, 3, 'a merge commit has two parents')
  })

  await test('a CONFLICTING merge reports failure and leaves the repo merging', async () => {
    const box = makeService('svc-mg-conflict-')
    box.g('checkout', '-b', 'ours')
    commit(box, 'a.txt', 'from ours\n', 'ours')
    box.g('checkout', 'main')
    box.g('checkout', '-b', 'theirs')
    commit(box, 'a.txt', 'from theirs\n', 'theirs')
    const r = await box.svc.merge({ ...WS, action: 'merge', from: 'ours' })
    assert.equal(r.ok, false, 'a conflict means the merge did not complete')
    assert.equal(r.status.merging, true, 'and the repo is mid-merge')
    assert.match(r.status.mergeHead, /ours/, 'the banner can name what is being merged')
    const conflicted = r.status.files.filter((f) => f.conflicted)
    assert.equal(conflicted.length, 1)
    assert.equal(conflicted[0].path, 'a.txt')
  })

  await test('continue is refused while conflicts are unresolved', async () => {
    const box = makeService('svc-mg-earlycont-')
    box.g('checkout', '-b', 'ours')
    commit(box, 'a.txt', 'ours\n', 'ours')
    box.g('checkout', 'main')
    box.g('checkout', '-b', 'theirs')
    commit(box, 'a.txt', 'theirs\n', 'theirs')
    await box.svc.merge({ ...WS, action: 'merge', from: 'ours' })
    const r = await box.svc.merge({ ...WS, action: 'continue' })
    assert.equal(r.ok, false, 'cannot conclude with conflicts outstanding')
    assert.equal(r.status.merging, true, 'still merging')
  })

  await test('resolve then continue completes the merge', async () => {
    const box = makeService('svc-mg-resolve-')
    box.g('checkout', '-b', 'ours')
    commit(box, 'a.txt', 'ours\n', 'ours')
    box.g('checkout', 'main')
    box.g('checkout', '-b', 'theirs')
    commit(box, 'a.txt', 'theirs\n', 'theirs')
    await box.svc.merge({ ...WS, action: 'merge', from: 'ours' })
    // Resolve exactly as the tab does: edit, then stage through the service.
    writeFileSync(join(box.repo, 'a.txt'), 'resolved by hand\n')
    await box.svc.stage({ ...WS, action: 'stage', paths: ['a.txt'] })
    const mid = await box.svc.status(WS)
    assert.equal(mid.status.merging, true, 'resolved but NOT concluded')
    assert.equal(mid.status.files.filter((f) => f.conflicted).length, 0)
    const r = await box.svc.merge({ ...WS, action: 'continue' })
    assert.equal(r.ok, true, r.output)
    assert.equal(r.status.merging, false, 'the merge is over')
    assert.equal(readFileSync(join(box.repo, 'a.txt'), 'utf8').trim(), 'resolved by hand')
  })

  await test('abort restores the pre-merge state', async () => {
    const box = makeService('svc-mg-abort-')
    box.g('checkout', '-b', 'ours')
    commit(box, 'a.txt', 'ours\n', 'ours')
    box.g('checkout', 'main')
    box.g('checkout', '-b', 'theirs')
    commit(box, 'a.txt', 'theirs\n', 'theirs')
    await box.svc.merge({ ...WS, action: 'merge', from: 'ours' })
    const r = await box.svc.merge({ ...WS, action: 'abort' })
    assert.equal(r.ok, true, r.output)
    assert.equal(r.status.merging, false)
    assert.equal(r.status.mergeHead, undefined)
    assert.equal(readFileSync(join(box.repo, 'a.txt'), 'utf8').trim(), 'theirs')
    assert.equal(r.status.files.length, 0, 'tree is clean again')
  })

  await test('abort with no merge in progress fails as data', async () => {
    const box = makeService('svc-mg-noabort-')
    const r = await box.svc.merge({ ...WS, action: 'abort' })
    assert.equal(r.ok, false)
    assert.match(r.output, /no merge|MERGE_HEAD/i)
  })

  await test('merging an unknown branch is refused', async () => {
    const box = makeService('svc-mg-ghost-')
    const r = await box.svc.merge({ ...WS, action: 'merge', from: 'ghost' })
    assert.equal(r.ok, false)
    assert.equal(r.status.merging, false, 'and left nothing half-done')
  })

  await test('merge requires a branch to merge FROM', async () => {
    const box = makeService('svc-mg-nofrom-')
    await assert.rejects(() => box.svc.merge({ ...WS, action: 'merge' }), /dsh-git/)
    await assert.rejects(
      () => box.svc.merge({ ...WS, action: 'merge', from: '--exec=calc' }),
      /dsh-git/,
    )
  })

  // === stash ===============================================================

  await test('push stashes tracked changes and leaves the tree clean', async () => {
    const box = makeService('svc-st-push-')
    writeFileSync(join(box.repo, 'a.txt'), 'work in progress\n')
    const r = await box.svc.stash({ ...WS, action: 'push', message: 'wip one' })
    assert.equal(r.ok, true, r.output)
    assert.equal(r.status.stashCount, 1)
    assert.equal(r.status.files.length, 0, 'tree is clean')
    assert.equal(readFileSync(join(box.repo, 'a.txt'), 'utf8').trim(), 'seed')
    const refs = await box.svc.refs(WS)
    assert.match(refs.stashes[0].message, /wip one/)
  })

  await test('includeUntracked carries brand-new files along', async () => {
    // Without -u a new file is left behind, which is exactly the work someone
    // stashing expects to be safe.
    const box = makeService('svc-st-untracked-')
    writeFileSync(join(box.repo, 'fresh.txt'), 'brand new\n')
    const r = await box.svc.stash({ ...WS, action: 'push', includeUntracked: true })
    assert.equal(r.ok, true, r.output)
    assert.ok(!existsSync(join(box.repo, 'fresh.txt')), 'it was taken')
    await box.svc.stash({ ...WS, action: 'pop' })
    assert.ok(existsSync(join(box.repo, 'fresh.txt')), 'and it comes back')
  })

  await test('pop restores the work and shrinks the stack', async () => {
    const box = makeService('svc-st-pop-')
    writeFileSync(join(box.repo, 'a.txt'), 'stashed edit\n')
    await box.svc.stash({ ...WS, action: 'push' })
    const r = await box.svc.stash({ ...WS, action: 'pop' })
    assert.equal(r.ok, true, r.output)
    assert.equal(r.status.stashCount, 0)
    assert.equal(readFileSync(join(box.repo, 'a.txt'), 'utf8').trim(), 'stashed edit')
  })

  await test('apply restores the work but KEEPS the entry', async () => {
    const box = makeService('svc-st-apply-')
    writeFileSync(join(box.repo, 'a.txt'), 'kept\n')
    await box.svc.stash({ ...WS, action: 'push' })
    const r = await box.svc.stash({ ...WS, action: 'apply' })
    assert.equal(r.ok, true, r.output)
    assert.equal(r.status.stashCount, 1, 'apply is not pop')
    assert.equal(readFileSync(join(box.repo, 'a.txt'), 'utf8').trim(), 'kept')
  })

  await test('an index is a CURSOR: dropping one renumbers the rest', async () => {
    // This is why the client re-reads refs after every mutation instead of
    // reusing an index it captured earlier.
    const box = makeService('svc-st-cursor-')
    for (const tag of ['first', 'second', 'third']) {
      writeFileSync(join(box.repo, 'a.txt'), tag + '\n')
      await box.svc.stash({ ...WS, action: 'push', message: tag })
    }
    let refs = await box.svc.refs(WS)
    // Newest first: third=0, second=1, first=2.
    assert.match(refs.stashes[0].message, /third/)
    assert.match(refs.stashes[2].message, /first/)
    const r = await box.svc.stash({ ...WS, action: 'drop', index: 1 })
    assert.equal(r.ok, true, r.output)
    refs = await box.svc.refs(WS)
    assert.equal(refs.stashes.length, 2)
    assert.match(refs.stashes[0].message, /third/, 'newest is untouched')
    assert.match(refs.stashes[1].message, /first/, 'and second is the one that went')
    assert.equal(refs.stashes[1].index, 1, 'first SHIFTED from 2 to 1')
  })

  await test('clear empties the whole stack', async () => {
    const box = makeService('svc-st-clear-')
    for (const tag of ['one', 'two']) {
      writeFileSync(join(box.repo, 'a.txt'), tag + '\n')
      await box.svc.stash({ ...WS, action: 'push', message: tag })
    }
    const r = await box.svc.stash({ ...WS, action: 'clear' })
    assert.equal(r.ok, true, r.output)
    assert.equal(r.status.stashCount, 0)
    assert.equal((await box.svc.refs(WS)).stashes.length, 0)
  })

  await test('pop on an empty stack fails as data', async () => {
    const box = makeService('svc-st-empty-')
    const r = await box.svc.stash({ ...WS, action: 'pop' })
    assert.equal(r.ok, false)
    assert.match(r.output, /No stash entries/i)
  })

  await test('a CONFLICTING pop reports failure and leaves the conflict visible', async () => {
    const box = makeService('svc-st-popconflict-')
    writeFileSync(join(box.repo, 'a.txt'), 'stashed version\n')
    await box.svc.stash({ ...WS, action: 'push' })
    commit(box, 'a.txt', 'committed something else\n', 'diverge')
    const r = await box.svc.stash({ ...WS, action: 'pop' })
    assert.equal(r.ok, false, 'a conflicting pop did not complete')
    assert.ok(r.status.files.some((f) => f.conflicted), 'the conflict is in the file list')
  })

  await test('an invalid stash index is refused at the boundary', async () => {
    const box = makeService('svc-st-badindex-')
    for (const bad of [-1, 1.5, Number.NaN, '0']) {
      await assert.rejects(
        () => box.svc.stash({ ...WS, action: 'drop', index: bad }),
        /dsh-git/,
        String(bad) + ' must be refused',
      )
    }
  })

  await test('push with nothing to stash is a no-op, not a failure', async () => {
    const box = makeService('svc-st-nothing-')
    const r = await box.svc.stash({ ...WS, action: 'push' })
    assert.equal(r.ok, true, 'git exits zero and says so: ' + r.output)
    assert.equal(r.status.stashCount, 0)
  })

  // === the unborn branch ====================================================

  await test('a repo with no commits answers instead of crashing', async () => {
    // Every one of these has no HEAD to work from. They must report, not throw.
    const box = makeEmptyService('svc-unborn-')
    const st = await box.svc.status(WS)
    assert.equal(st.status.unborn, true)
    const create = await box.svc.branch({ ...WS, action: 'create', name: 'early' })
    assert.equal(create.ok, false, 'nothing to branch from yet')
    const stash = await box.svc.stash({ ...WS, action: 'push' })
    assert.equal(stash.ok, false)
    const merge = await box.svc.merge({ ...WS, action: 'merge', from: 'main' })
    assert.equal(merge.ok, false)
    const refs = await box.svc.refs(WS)
    assert.equal(refs.ok, true, 'refs still answers')
    assert.deepEqual(refs.branches, [], 'with no branches yet')
  })
} finally {
  cleanup()
}

console.log('\n' + state.passed + ' branch/merge/stash integration checks passed')
