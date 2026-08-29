/**
 * stage, commit, init and sync: the HOST SERVICE driven end to end.
 *
 * These are the OLDEST endpoints in the package and the only ones still tested
 * exclusively from below. `host-ops.mjs` has checks named "init creates a repo"
 * and "discard restores tracked files", but it imports `src/git.ts` and drives
 * `runGit` itself — so it proves git behaves, not that these endpoints drive git
 * correctly. That is the identical gap that hid `git checkout -- <branch>` in
 * `branch switch`, where branch switching never worked with every suite green.
 *
 * Risk order, highest first: `discard` DELETES user work and defaults to the
 * whole tree; `commit` writes history; `init` on an existing repo would
 * re-initialize it (which really happened in this repo once, setting core.bare
 * and clobbering the user identity); `sync` talks to a remote and can reject or
 * overwrite. Everything below is arranged that way, not alphabetically.
 *
 * sync is tested against a real LOCAL BARE REPOSITORY. Git treats one as a
 * genuine remote — upstream tracking, fetch, and the --ff-only refusal all
 * behave exactly as they do over a network — so the one endpoint family that
 * can lose work to a bad push is covered without needing one.
 */
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { GitService } from '../lib/index.js'
import { makeService, makeEmptyService, addRemote, cloneOf, cleanup, makeRunner, WS, head } from './service-harness.mjs'

const { test, state } = makeRunner()
const read = (box, name) => readFileSync(join(box.repo, name), 'utf8').trim()
const write = (box, name, body) => writeFileSync(join(box.repo, name), body)

try {
  // === stage: the destructive one ==========================================

  await test('discard with NO paths reverts the whole tree, tracked and untracked', async () => {
    // The default target is '.', so this is the single most destructive request
    // the endpoint accepts. It has to do exactly what it says and no more.
    const box = makeService('svc-sc-discardall-')
    write(box, 'a.txt', 'modified\n')
    write(box, 'brand-new.txt', 'untracked\n')
    const r = await box.svc.stage({ ...WS, action: 'discard' })
    assert.equal(r.ok, true, r.output)
    assert.equal(read(box, 'a.txt'), 'seed', 'tracked file restored')
    assert.ok(!existsSync(join(box.repo, 'brand-new.txt')), 'untracked file removed')
    assert.equal(r.status.files.length, 0, 'and the tree is clean')
  })

  await test('discard of ONE path leaves every other change alone', async () => {
    // The blast radius is the whole point. If targeting ever silently widened to
    // '.', this is the test that would notice before a user did.
    const box = makeService('svc-sc-discardone-')
    write(box, 'a.txt', 'edit one\n')
    write(box, 'keep.txt', 'keep me\n')
    box.g('add', 'keep.txt')
    box.g('commit', '-m', 'add keep')
    write(box, 'keep.txt', 'edited and MUST SURVIVE\n')
    const r = await box.svc.stage({ ...WS, action: 'discard', paths: ['a.txt'] })
    assert.equal(r.ok, true, r.output)
    assert.equal(read(box, 'a.txt'), 'seed', 'target reverted')
    assert.equal(read(box, 'keep.txt'), 'edited and MUST SURVIVE', 'bystander untouched')
  })

  await test('discard removes an untracked file it was pointed at', async () => {
    // checkout errors on a path git has never tracked; clean is what actually
    // removes it, which is why discard runs both and in that order.
    const box = makeService('svc-sc-discardnew-')
    write(box, 'only-new.txt', 'never tracked\n')
    const r = await box.svc.stage({ ...WS, action: 'discard', paths: ['only-new.txt'] })
    assert.ok(!existsSync(join(box.repo, 'only-new.txt')), 'the file is gone')
    assert.equal(r.status.files.length, 0)
  })

  await test('discard drops the UNSTAGED edit and PRESERVES staged work', async () => {
    // `checkout -- <path>` restores from the INDEX, not from HEAD, and that is
    // deliberate rather than a gap. A partially staged file appears in both
    // sections, and the tab offers Discard on the unstaged row only
    // (section === 'unstaged' ? ... : undefined) -- so discarding there must
    // throw away the newer edit and leave the staged one intact.
    //
    // "Fixing" this to restore from HEAD would silently destroy staged work the
    // user deliberately kept. This test exists to make that regression loud.
    const box = makeService('svc-sc-partialdiscard-')
    write(box, 'a.txt', 'STAGED version\n')
    box.g('add', 'a.txt')
    write(box, 'a.txt', 'later unstaged scribble\n')
    const r = await box.svc.stage({ ...WS, action: 'discard', paths: ['a.txt'] })
    assert.equal(r.ok, true, r.output)
    assert.equal(read(box, 'a.txt'), 'STAGED version', 'staged work survived')
    const staged = r.status.files.filter((f) => f.staged)
    assert.equal(staged.length, 1, 'and is still staged, ready to commit')
    assert.equal(r.status.files.filter((f) => !f.staged).length, 0, 'scribble gone')
  })

  await test('stage with no paths stages everything; with a path, only that path', async () => {
    const box = makeService('svc-sc-stage-')
    write(box, 'one.txt', '1\n')
    write(box, 'two.txt', '2\n')
    const one = await box.svc.stage({ ...WS, action: 'stage', paths: ['one.txt'] })
    assert.equal(one.ok, true, one.output)
    const staged = one.status.files.filter((f) => f.staged).map((f) => f.path)
    assert.deepEqual(staged, ['one.txt'], 'only the named path')
    const all = await box.svc.stage({ ...WS, action: 'stage' })
    assert.equal(all.status.files.filter((f) => f.staged).length, 2, 'then everything')
  })

  await test('unstage returns the index to HEAD without touching the file', async () => {
    const box = makeService('svc-sc-unstage-')
    write(box, 'a.txt', 'my edit\n')
    await box.svc.stage({ ...WS, action: 'stage', paths: ['a.txt'] })
    const r = await box.svc.stage({ ...WS, action: 'unstage', paths: ['a.txt'] })
    assert.equal(r.ok, true, r.output)
    assert.equal(r.status.files.filter((f) => f.staged).length, 0, 'index reset')
    assert.equal(read(box, 'a.txt'), 'my edit', 'but the EDIT survives')
  })

  await test('unstage on an UNBORN branch uses rm --cached and keeps the file', async () => {
    // There is no HEAD to restore from before the first commit, so `restore
    // --staged` fails outright; rm --cached is the only way back.
    const box = makeEmptyService('svc-sc-unborn-')
    write(box, 'first.txt', 'before any commit\n')
    await box.svc.stage({ ...WS, action: 'stage' })
    const staged = (await box.svc.status(WS)).status.files.filter((f) => f.staged)
    assert.equal(staged.length, 1, 'staged on an unborn branch')
    const r = await box.svc.stage({ ...WS, action: 'unstage' })
    assert.equal(r.ok, true, r.output)
    assert.equal(r.status.files.filter((f) => f.staged).length, 0, 'unstaged')
    assert.ok(existsSync(join(box.repo, 'first.txt')), 'and the file still exists')
  })

  await test('an escaping path is refused for every stage action', async () => {
    // A path is handed to a git command that writes and DELETES, so anything
    // addressing outside the workspace must never reach it.
    const box = makeService('svc-sc-paths-')
    const outside = join(box.parent, 'bystander.txt')
    writeFileSync(outside, 'not part of the repo\n')
    const bad = ['../bystander.txt', '/etc/passwd', 'C:/Windows/system32', '..\\up.txt', 'a/../../b']
    for (const path of bad) {
      for (const action of ['stage', 'unstage', 'discard']) {
        await assert.rejects(
          () => box.svc.stage({ ...WS, action, paths: [path] }),
          /dsh-git/,
          action + ' ' + JSON.stringify(path) + ' must be refused',
        )
      }
    }
    assert.ok(existsSync(outside), 'the file outside the repo survived')
    assert.ok(existsSync(join(box.repo, 'a.txt')), 'and the repo is untouched')
  })

  await test('a path that LOOKS like a flag is inert, because of the -- separator', async () => {
    // assertSafePath does NOT refuse a leading dash, and does not need to: every
    // stage command puts `--` before the paths, so git reads the value as a
    // pathspec rather than an option. That separator is the protection, so pin
    // the behaviour rather than the validator -- dropping `--` from discard
    // would turn a crafted path into flags for `clean`.
    const box = makeService('svc-sc-dashpath-')
    write(box, 'keep-me.txt', 'must survive\n')
    box.g('add', '-A')
    box.g('commit', '-m', 'add keep-me')
    write(box, 'keep-me.txt', 'edited, must survive discard of a bogus path\n')

    // STAGE: '-A' is a REAL git flag meaning "stage everything", which makes the
    // difference observable rather than just another error message. With the
    // separator it is a pathspec that matches nothing; without it, every file
    // in the tree gets staged.
    write(box, 'untouched-one.txt', 'x\n')
    write(box, 'untouched-two.txt', 'y\n')
    const staged = await box.svc.stage({ ...WS, action: 'stage', paths: ['-A'] })
    assert.equal(
      staged.status.files.filter((f) => f.staged).length,
      0,
      'a path called -A must stage NOTHING, not sweep the tree',
    )

    // DISCARD: same idea against the pair that actually deletes.
    const r = await box.svc.stage({ ...WS, action: 'discard', paths: ['-rf'] })
    assert.equal(read(box, 'keep-me.txt'), 'edited, must survive discard of a bogus path')
    assert.ok(existsSync(join(box.repo, 'untouched-one.txt')), 'and nothing was cleaned')
    assert.ok(existsSync(join(box.repo, 'a.txt')))
  })

  await test('an unknown stage action is reported, never silently ignored', async () => {
    const box = makeService('svc-sc-badaction-')
    write(box, 'a.txt', 'edit\n')
    const r = await box.svc.stage({ ...WS, action: 'nuke' })
    assert.equal(r.ok, false)
    assert.match(r.output, /unknown stage action/)
    assert.equal(read(box, 'a.txt'), 'edit', 'and nothing happened')
  })

  // === commit: history ======================================================

  await test('an empty or whitespace message is refused BEFORE the repo is touched', async () => {
    const box = makeService('svc-sc-nomsg-')
    write(box, 'a.txt', 'edit\n')
    box.g('add', '-A')
    const before = box.g('rev-parse', 'HEAD').trim()
    for (const message of [undefined, '', '   ', '\n\t ']) {
      await assert.rejects(
        () => box.svc.commit({ ...WS, message }),
        /a commit message is required/,
        JSON.stringify(message) + ' must be refused',
      )
    }
    assert.equal(box.g('rev-parse', 'HEAD').trim(), before, 'HEAD did not move')
  })

  await test('a multi-line message with quotes survives VERBATIM', async () => {
    // The argv array is what keeps a generated message out of any shell. A
    // message mangled at the boundary would corrupt history silently.
    const box = makeService('svc-sc-msg-')
    write(box, 'a.txt', 'edit\n')
    await box.svc.stage({ ...WS, action: 'stage' })
    const message = 'feat: add "quoted" and $VAR and `tick`\n\nBody line with \'single\' quotes.\nAnd a trailing one.'
    const r = await box.svc.commit({ ...WS, message })
    assert.equal(r.ok, true, r.output)
    const stored = box.g('log', '-1', '--pretty=%B').replace(/\n+$/, '')
    assert.equal(stored, message, 'stored byte for byte')
  })

  await test('a commit with nothing staged is reported, not crashed', async () => {
    // The older endpoints keep the looser contract deliberately: "nothing to
    // commit" is information the tab renders, not a broken bridge.
    const box = makeService('svc-sc-nothing-')
    const before = box.g('rev-parse', 'HEAD').trim()
    const r = await box.svc.commit({ ...WS, message: 'nothing here' })
    assert.match(r.output, /nothing to commit/i, 'git said so')
    assert.equal(box.g('rev-parse', 'HEAD').trim(), before, 'and HEAD did not move')
  })

  await test('commit records ONLY the index, leaving unstaged work behind', async () => {
    // The Commit button's whole promise. If this ever widened, a commit would
    // silently include work the user chose not to stage.
    const box = makeService('svc-sc-partial-')
    write(box, 'staged.txt', 'in the commit\n')
    write(box, 'left.txt', 'NOT in the commit\n')
    await box.svc.stage({ ...WS, action: 'stage', paths: ['staged.txt'] })
    const r = await box.svc.commit({ ...WS, message: 'partial' })
    assert.equal(r.ok, true, r.output)
    const files = box.g('show', '--name-only', '--pretty=', 'HEAD').trim().split('\n')
    assert.deepEqual(files, ['staged.txt'])
    assert.ok(existsSync(join(box.repo, 'left.txt')), 'and the other file is still waiting')
  })

  await test('all:true sweeps tracked edits but NOT untracked files', async () => {
    // Kept for older clients. -a stages modifications to tracked files only,
    // which is a real distinction: a new file is silently not included.
    const box = makeService('svc-sc-all-')
    write(box, 'a.txt', 'tracked edit\n')
    write(box, 'newcomer.txt', 'untracked\n')
    const before = box.g('rev-parse', 'HEAD').trim()
    const r = await box.svc.commit({ ...WS, message: 'sweep', all: true })
    assert.equal(r.ok, true, r.output)
    // HEAD must MOVE. Asserting the file list alone was tautological: the seed
    // commit also touches a.txt, so dropping -a left HEAD on the seed and the
    // assertion still passed. A mutation sweep caught that, not review.
    assert.notEqual(box.g('rev-parse', 'HEAD').trim(), before, 'a commit was actually made')
    assert.equal(box.g('log', '-1', '--pretty=%s').trim(), 'sweep', 'and it is ours')
    const files = box.g('show', '--name-only', '--pretty=', 'HEAD').trim().split('\n')
    assert.deepEqual(files, ['a.txt'], 'tracked edit only')
    assert.ok(existsSync(join(box.repo, 'newcomer.txt')), 'new file left untracked')
  })

  await test('the FIRST commit on an unborn branch works', async () => {
    const box = makeEmptyService('svc-sc-first-')
    write(box, 'first.txt', 'hello\n')
    await box.svc.stage({ ...WS, action: 'stage' })
    const r = await box.svc.commit({ ...WS, message: 'first commit' })
    assert.equal(r.ok, true, r.output)
    assert.equal(r.status.unborn, false, 'the branch is born now')
    assert.equal(r.status.recent[0].subject, 'first commit')
  })

  // === init =================================================================

  await test('init on an EXISTING repo refuses and does not re-initialize', async () => {
    // Re-initializing a live repository is not hypothetical: it happened in this
    // very repo during development, setting core.bare=true and overwriting the
    // user identity, after which every git command failed.
    const box = makeService('svc-sc-reinit-')
    const headBefore = box.g('rev-parse', 'HEAD').trim()
    box.g('config', 'user.email', 'keep@me.test')
    const r = await box.svc.init({ ...WS, branch: 'somethingelse' })
    assert.equal(r.ok, false)
    assert.match(r.output, /Already a git repository/)
    assert.equal(box.g('rev-parse', 'HEAD').trim(), headBefore, 'history intact')
    assert.equal(head(box.g), 'main', 'branch not renamed')
    assert.equal(box.g('config', 'user.email').trim(), 'keep@me.test', 'identity intact')
    assert.equal(box.g('config', '--get', 'core.bare').trim(), 'false', 'still a work tree')
  })

  await test('init creates a repository on the requested branch', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'svc-sc-init-'))
    const ctx = new Context()
    ctx.provide('workspaceRegistry'); ctx.provide('llm'); ctx.provide('agentDefaultModel')
    ctx.workspaceRegistry = { list: () => [{ id: 'w1', path: plain }] }
    const svc = new GitService(ctx)
    try {
      const before = await svc.status(WS)
      assert.equal(before.status.repo, false, 'not a repo yet')
      const r = await svc.init({ ...WS, branch: 'trunk' })
      assert.equal(r.ok, true, r.output)
      assert.equal(r.status.repo, true)
      assert.equal(r.status.branch, 'trunk')
      assert.equal(r.status.unborn, true, 'born repo, unborn branch')
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  // === sync, against a real local remote ====================================

  await test('publish with no remote configured is refused', async () => {
    const box = makeService('svc-sc-noremote-')
    const r = await box.svc.sync({ ...WS, action: 'publish' })
    assert.equal(r.ok, false)
    assert.match(r.output, /no remote is configured/)
  })

  await test('push with no upstream fails as data, not a crash', async () => {
    const box = makeService('svc-sc-noupstream-')
    addRemote(box)
    const r = await box.svc.sync({ ...WS, action: 'push' })
    assert.equal(r.ok, true, 'the older endpoints report git text rather than failing')
    assert.match(r.output, /no upstream|has no upstream branch/i)
  })

  await test('publish sets upstream, and push then works', async () => {
    // publish exists as its own verb precisely because plain push cannot do a
    // first push: it needs -u and an explicit refspec.
    const box = makeService('svc-sc-publish-')
    const bare = addRemote(box)
    const r = await box.svc.sync({ ...WS, action: 'publish' })
    assert.equal(r.ok, true, r.output)
    // Check presence first: without -u there is no upstream at all, and reading
    // .name off undefined crashes the run instead of naming the failure.
    assert.ok(r.status.upstream, 'publish must RECORD an upstream (-u), not just push')
    assert.equal(r.status.upstream.name, 'origin/main', 'upstream recorded')
    write(box, 'a.txt', 'second\n')
    await box.svc.stage({ ...WS, action: 'stage' })
    await box.svc.commit({ ...WS, message: 'second' })
    const pushed = await box.svc.sync({ ...WS, action: 'push' })
    assert.equal(pushed.ok, true, pushed.output)
    assert.equal(pushed.status.upstream.ahead, 0, 'nothing left to push')
  })

  await test('fetch sees a sibling push, and pull fast-forwards onto it', async () => {
    const box = makeService('svc-sc-pull-')
    const bare = addRemote(box)
    await box.svc.sync({ ...WS, action: 'publish' })
    const other = cloneOf(box, bare, 'other')
    writeFileSync(join(other.dir, 'theirs.txt'), 'from elsewhere\n')
    other.g('add', '-A'); other.g('commit', '-m', 'theirs'); other.g('push')
    const fetched = await box.svc.sync({ ...WS, action: 'fetch' })
    assert.equal(fetched.ok, true, fetched.output)
    assert.equal(fetched.status.upstream.behind, 1, 'fetch alone only learns about it')
    assert.ok(!existsSync(join(box.repo, 'theirs.txt')), 'and changes nothing locally')
    const pulled = await box.svc.sync({ ...WS, action: 'pull' })
    assert.equal(pulled.ok, true, pulled.output)
    assert.equal(pulled.status.upstream.behind, 0)
    assert.ok(existsSync(join(box.repo, 'theirs.txt')), 'now it is here')
  })

  await test('pull REFUSES to invent a merge commit on a divergent branch', async () => {
    // --ff-only is the deliberate stance: the pull path has no conflict surface,
    // so it says so plainly rather than dropping the user into a merge.
    const box = makeService('svc-sc-diverge-')
    const bare = addRemote(box)
    await box.svc.sync({ ...WS, action: 'publish' })
    const other = cloneOf(box, bare, 'other')
    writeFileSync(join(other.dir, 'theirs.txt'), 'theirs\n')
    other.g('add', '-A'); other.g('commit', '-m', 'theirs'); other.g('push')
    // Now commit locally too, so the histories genuinely diverge.
    write(box, 'mine.txt', 'mine\n')
    await box.svc.stage({ ...WS, action: 'stage' })
    await box.svc.commit({ ...WS, message: 'mine' })
    const r = await box.svc.sync({ ...WS, action: 'pull' })
    assert.match(r.output, /divergent|not possible to fast-forward|Need to specify/i)
    assert.equal(r.status.merging, false, 'and left NO half-finished merge')
    assert.equal(read(box, 'mine.txt'), 'mine', 'local work untouched')
  })

  await test('sync pulls and then pushes in one action', async () => {
    // The action is 'sync', not 'both' -- anything else lands in the unknown
    // branch, which reports rather than acting.
    const box = makeService('svc-sc-sync-')
    addRemote(box)
    await box.svc.sync({ ...WS, action: 'publish' })
    write(box, 'mine.txt', 'mine\n')
    await box.svc.stage({ ...WS, action: 'stage' })
    await box.svc.commit({ ...WS, message: 'mine' })
    const r = await box.svc.sync({ ...WS, action: 'sync' })
    assert.equal(r.ok, true, r.output)
    assert.equal(r.status.upstream.ahead, 0, 'delivered')
    assert.equal(r.status.upstream.behind, 0)
  })

  await test('sync STOPS after a failed pull instead of stacking a second error', async () => {
    // Pushing on top of a refused pull is rejected too, and reporting both
    // buries the real cause under a symptom. Diverge the histories and assert
    // only ONE reason comes back.
    const box = makeService('svc-sc-syncstop-')
    const bare = addRemote(box)
    await box.svc.sync({ ...WS, action: 'publish' })
    const other = cloneOf(box, bare, 'other')
    writeFileSync(join(other.dir, 'theirs.txt'), 'theirs\n')
    other.g('add', '-A'); other.g('commit', '-m', 'theirs'); other.g('push')
    write(box, 'mine.txt', 'mine\n')
    await box.svc.stage({ ...WS, action: 'stage' })
    await box.svc.commit({ ...WS, message: 'mine' })
    const r = await box.svc.sync({ ...WS, action: 'sync' })
    assert.match(r.output, /divergent|not possible to fast-forward|Need to specify/i)
    assert.doesNotMatch(r.output, /rejected|non-fast-forward/i, 'no second, misleading error')
    assert.equal(r.status.upstream.ahead, 1, 'still unpushed, honestly reported')
    assert.equal(read(box, 'mine.txt'), 'mine', 'and local work is untouched')
  })

  await test('an unknown sync action is reported, never silently ignored', async () => {
    const box = makeService('svc-sc-syncbad-')
    const r = await box.svc.sync({ ...WS, action: 'both' })
    assert.equal(r.ok, false)
    assert.match(r.output, /unknown sync action/)
  })

  await test('sync on a non-repository answers as data', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'svc-sc-plain-'))
    const ctx = new Context()
    ctx.provide('workspaceRegistry'); ctx.provide('llm'); ctx.provide('agentDefaultModel')
    ctx.workspaceRegistry = { list: () => [{ id: 'w1', path: plain }] }
    const svc = new GitService(ctx)
    try {
      for (const action of ['fetch', 'pull', 'push', 'publish', 'sync']) {
        const r = await svc.sync({ ...WS, action })
        assert.equal(r.ok, false, action)
        assert.match(r.output, /Not a git repository/)
      }
      const c = await svc.commit({ ...WS, message: 'x' })
      assert.equal(c.ok, false)
      const s = await svc.stage({ ...WS, action: 'stage' })
      assert.equal(s.ok, false)
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
} finally {
  cleanup()
}

console.log('\n' + state.passed + ' stage/commit/init/sync integration checks passed')
