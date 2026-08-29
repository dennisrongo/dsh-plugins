/**
 * Worktree integration: the HOST SERVICE driven end to end against real
 * repositories.
 *
 * This is the layer nothing else covered. `branch-ops.mjs` exercises `git.ts`
 * BELOW the endpoint and builds its argv by hand; `smoke.mjs` exercises the
 * client store ABOVE it against a stub remote. Neither runs the code that turns
 * a request into a git command -- so `git checkout -- <branch>` (a PATHSPEC,
 * not a branch) sat in `branch` for its whole life with every test green, and
 * every command reported `ok: true` even when git had failed.
 *
 * The service is constructed against a plain cordis Context with a stub
 * workspaceRegistry, which is enough: nothing here needs the LLM or the
 * gateway. It imports the BUILT lib/index.js, both because this repo tests
 * built output and because --experimental-strip-types cannot parse the @Remote
 * decorators.
 */
import './git-env.mjs'
import assert from 'node:assert/strict'
import { writeFileSync, existsSync, rmSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { GitService } from '../lib/index.js'
// One rig, shared with branch-merge-stash.mjs: two copies of the setup drift,
// and the drift shows up as a test that passes for the wrong reason.
import { makeService, cleanup, makeRunner, WS, head } from './service-harness.mjs'

const { test, state } = makeRunner()
const fresh = makeService

try {
  // --- the bug this suite exists to catch ---------------------------------

  await test('SWITCH actually switches the branch', async () => {
    // `git checkout -- <name>` reads the name as a PATHSPEC and switches
    // nothing, reporting "pathspec ... did not match any file(s)". That shipped,
    // and every existing test stayed green because none called the service --
    // they ran runGit(dir, ['checkout', 'feature']) themselves.
    const { svc, g } = fresh('wt-int-switch-')
    g('branch', 'topic')
    assert.equal(head(g), 'main')
    const r = await svc.branch({ ...WS, action: 'switch', name: 'topic' })
    assert.equal(r.ok, true, 'switch should succeed: ' + r.output)
    assert.equal(head(g), 'topic', 'HEAD must actually move')
    assert.equal(r.status.branch, 'topic', 'and the returned status must agree')
  })

  await test('a REFUSED switch reports ok:false, which the stash offer depends on', async () => {
    // The client shows 'Stash changes and switch' only when ok is false. With
    // every command reporting ok:true that button could never appear.
    const { svc, g, repo } = fresh('wt-int-dirty-')
    g('checkout', '-b', 'topic')
    writeFileSync(join(repo, 'a.txt'), 'topic version\n')
    g('add', '-A'); g('commit', '-m', 'topic edit')
    g('checkout', 'main')
    writeFileSync(join(repo, 'a.txt'), 'uncommitted\n')
    const r = await svc.branch({ ...WS, action: 'switch', name: 'topic' })
    assert.equal(r.ok, false, 'a refused switch is a FAILURE')
    assert.match(r.output, /local changes|would be overwritten/i, 'and carries git reason')
    assert.equal(head(g), 'main', 'HEAD stayed put')
  })

  await test('stashSwitch stashes, switches, and leaves the tree clean', async () => {
    const { svc, g, repo } = fresh('wt-int-stashsw-')
    g('branch', 'topic')
    writeFileSync(join(repo, 'a.txt'), 'work in progress\n')
    writeFileSync(join(repo, 'brand-new.txt'), 'untracked\n')
    const r = await svc.branch({ ...WS, action: 'stashSwitch', name: 'topic' })
    assert.equal(r.ok, true, r.output)
    assert.equal(head(g), 'topic', 'it switched')
    assert.equal(g('status', '--porcelain').trim(), '', 'and the tree is clean')
    assert.match(g('stash', 'list'), /switching to topic/)
    assert.equal(r.status.stashCount, 1, 'status reports the stash')
  })

  // --- worktree lifecycle --------------------------------------------------

  await test('add creates the worktree BESIDE the repo, on a new branch', async () => {
    const { svc, parent, repo } = fresh('wt-int-add-')
    const r = await svc.worktree({ ...WS, action: 'add', path: '../proj-alpha', newBranch: 'alpha' })
    assert.equal(r.ok, true, r.output)
    const target = join(parent, 'proj-alpha')
    assert.ok(existsSync(target), 'directory exists at ' + target)
    assert.ok(existsSync(join(target, 'a.txt')), 'and it is a real checkout')
    assert.ok(!existsSync(join(repo, 'proj-alpha')), 'NOT nested inside the repo')
  })

  await test('refs lists it, flagging main and current correctly', async () => {
    const { svc } = fresh('wt-int-refs-')
    await svc.worktree({ ...WS, action: 'add', path: '../proj-beta', newBranch: 'beta' })
    const refs = await svc.refs(WS)
    assert.equal(refs.ok, true)
    assert.equal(refs.worktrees.length, 2)
    const main = refs.worktrees.find((w) => w.main)
    const added = refs.worktrees.find((w) => !w.main)
    assert.equal(main.current, true, 'the workspace we act on is current')
    assert.equal(added.current, false)
    assert.equal(added.branch, 'beta')
    assert.ok(basename(added.path).endsWith('proj-beta'))
  })

  await test('add forks from the CURRENT branch by default', async () => {
    const { svc, g, repo, parent } = fresh('wt-int-fork-head-')
    g('checkout', '-b', 'side')
    writeFileSync(join(repo, 'side.txt'), 'side\n')
    g('add', '-A'); g('commit', '-m', 'only on side')
    await svc.worktree({ ...WS, action: 'add', path: '../proj-w', newBranch: 'from-head' })
    assert.ok(existsSync(join(parent, 'proj-w', 'side.txt')), 'inherited side')
  })

  await test('add forks from an explicit startPoint instead', async () => {
    const { svc, g, repo, parent } = fresh('wt-int-fork-sp-')
    g('checkout', '-b', 'side')
    writeFileSync(join(repo, 'side.txt'), 'side\n')
    g('add', '-A'); g('commit', '-m', 'only on side')
    const r = await svc.worktree({ ...WS, action: 'add', path: '../proj-x', newBranch: 'from-main', startPoint: 'main' })
    assert.equal(r.ok, true, r.output)
    assert.ok(!existsSync(join(parent, 'proj-x', 'side.txt')), 'did NOT inherit side')
    assert.ok(existsSync(join(parent, 'proj-x', 'a.txt')), 'but has main content')
  })

  await test('remove deletes it and drops it from refs', async () => {
    const { svc, parent } = fresh('wt-int-remove-')
    await svc.worktree({ ...WS, action: 'add', path: '../proj-gone', newBranch: 'gone' })
    const target = join(parent, 'proj-gone')
    assert.ok(existsSync(target))
    const r = await svc.worktree({ ...WS, action: 'remove', path: '../proj-gone' })
    assert.equal(r.ok, true, r.output)
    assert.ok(!existsSync(target), 'directory is gone')
    assert.equal((await svc.refs(WS)).worktrees.length, 1)
  })

  await test('prune clears an entry whose directory was deleted behind git', async () => {
    const { svc, parent } = fresh('wt-int-prune-')
    await svc.worktree({ ...WS, action: 'add', path: '../proj-stale', newBranch: 'stale' })
    rmSync(join(parent, 'proj-stale'), { recursive: true, force: true })
    const before = await svc.refs(WS)
    assert.equal(before.worktrees.length, 2, 'git still lists the stale entry')
    assert.equal(before.worktrees.find((w) => !w.main).prunable, true, 'flagged prunable')
    const r = await svc.worktree({ ...WS, action: 'prune' })
    assert.equal(r.ok, true, r.output)
    assert.equal((await svc.refs(WS)).worktrees.length, 1, 'and prune removed it')
  })

  // --- failures must be DATA, never crashes -------------------------------

  await test('a FAILED add reports ok:false', async () => {
    // The client opens a workspace at the target when ok is true. Reporting a
    // failed add as success sends it to a directory git never created.
    const { svc, parent } = fresh('wt-int-failadd-')
    const occupied = join(parent, 'occupied')
    mkdirSync(occupied); writeFileSync(join(occupied, 'x.txt'), 'in the way')
    const r = await svc.worktree({ ...WS, action: 'add', path: occupied, newBranch: 'nope' })
    assert.equal(r.ok, false, 'git refuses a non-empty target')
    assert.ok(r.output.length > 0, 'and says why')
  })

  await test('a FAILED remove reports ok:false, and force is the override', async () => {
    // The client unregisters the workspace when ok is true. Reporting a failed
    // remove as success unregisters a worktree that still exists.
    const { svc, parent } = fresh('wt-int-failrm-')
    await svc.worktree({ ...WS, action: 'add', path: '../proj-dirty', newBranch: 'dirty' })
    writeFileSync(join(parent, 'proj-dirty', 'a.txt'), 'uncommitted\n')
    const r = await svc.worktree({ ...WS, action: 'remove', path: '../proj-dirty' })
    assert.equal(r.ok, false, 'git refuses to remove a dirty worktree')
    assert.ok(existsSync(join(parent, 'proj-dirty')), 'and it is still there')
    const forced = await svc.worktree({ ...WS, action: 'remove', path: '../proj-dirty', force: true })
    assert.equal(forced.ok, true, 'force is the deliberate override')
    assert.ok(!existsSync(join(parent, 'proj-dirty')))
  })

  await test('removing the MAIN worktree fails as data, not a crash', async () => {
    const { svc, repo } = fresh('wt-int-main-')
    const r = await svc.worktree({ ...WS, action: 'remove', path: repo })
    assert.equal(r.ok, false)
    assert.match(r.output, /main working tree/i)
    assert.ok(existsSync(repo), 'and the repo survives')
  })

  await test('a worktree on an already-checked-out branch is refused', async () => {
    const { svc } = fresh('wt-int-dup-')
    const r = await svc.worktree({ ...WS, action: 'add', path: '../proj-dup', branch: 'main' })
    assert.equal(r.ok, false)
    assert.match(r.output, /already used by worktree/i)
  })

  await test('an INSIDE-repo path is refused with an actionable message', async () => {
    const { svc, repo } = fresh('wt-int-inside-')
    const r = await svc.worktree({ ...WS, action: 'add', path: 'nested', newBranch: 'n' })
    assert.equal(r.ok, false)
    assert.match(r.output, /cannot live inside the repository/)
    assert.match(r.output, /\.\.\/nested/, 'names the form to use instead')
    assert.ok(!existsSync(join(repo, 'nested')), 'and nothing was created')
  })

  await test('hostile refs and paths are refused at the boundary', async () => {
    const { svc } = fresh('wt-int-hostile-')
    for (const bad of ['--exec=calc', 'main..dev', 'a b']) {
      await assert.rejects(
        () => svc.worktree({ ...WS, action: 'add', path: '../x', newBranch: bad }),
        /dsh-git/,
        JSON.stringify(bad) + ' must be refused',
      )
    }
    const dash = await svc.worktree({ ...WS, action: 'add', path: '--force' })
    assert.equal(dash.ok, false, 'a path that is really a flag')
    const empty = await svc.worktree({ ...WS, action: 'add', path: '' })
    assert.equal(empty.ok, false, 'an empty path')
  })

  await test('an unknown workspace is refused before any git runs', async () => {
    const { svc } = fresh('wt-int-ws-')
    await assert.rejects(
      () => svc.worktree({ workspaceId: 'nope', action: 'prune' }),
      /unknown workspace/,
    )
  })

  // --- workspace registration ----------------------------------------------

  await test('register asks the registry for the RESOLVED absolute path', async () => {
    const { svc, parent, registered } = fresh('wt-int-reg-')
    const r = await svc.worktree({ ...WS, action: 'add', path: '../proj-reg', newBranch: 'reg', register: true })
    assert.equal(r.ok, true, r.output)
    assert.equal(registered.length, 1, 'exactly one registration')
    // The relative path the user typed must NOT reach the registry.
    assert.equal(basename(registered[0].path), 'proj-reg')
    assert.ok(registered[0].path.includes(basename(parent)), 'absolute, under the parent')
    assert.match(r.output, /Registered/)
  })

  await test('a FAILED add never registers anything', async () => {
    const { svc, parent, registered } = fresh('wt-int-noreg-')
    const occupied = join(parent, 'busy')
    mkdirSync(occupied); writeFileSync(join(occupied, 'x'), 'x')
    const r = await svc.worktree({ ...WS, action: 'add', path: occupied, newBranch: 'x', register: true })
    assert.equal(r.ok, false)
    assert.equal(registered.length, 0, 'no workspace for a directory git never made')
  })

  await test('a registry failure is reported WITHOUT failing the git operation', async () => {
    const { svc, parent } = fresh('wt-int-regfail-')
    svc.ctx.workspaceRegistry.create = async () => { throw new Error('registry offline') }
    const r = await svc.worktree({ ...WS, action: 'add', path: '../proj-rf', newBranch: 'rf', register: true })
    assert.equal(r.ok, true, 'the worktree exists, so the command succeeded')
    assert.ok(existsSync(join(parent, 'proj-rf')))
    assert.match(r.output, /could not register it/i)
    assert.match(r.output, /registry offline/)
  })

  // --- concurrency ----------------------------------------------------------

  await test('concurrent adds are serialised, not interleaved', async () => {
    // withRepo queues per repository root because git fails a second writer on
    // index.lock rather than waiting for it.
    const { svc, parent } = fresh('wt-int-conc-')
    const results = await Promise.all([
      svc.worktree({ ...WS, action: 'add', path: '../c-one', newBranch: 'c-one' }),
      svc.worktree({ ...WS, action: 'add', path: '../c-two', newBranch: 'c-two' }),
      svc.worktree({ ...WS, action: 'add', path: '../c-three', newBranch: 'c-three' }),
    ])
    for (const r of results) assert.equal(r.ok, true, r.output)
    for (const n of ['c-one', 'c-two', 'c-three']) {
      assert.ok(existsSync(join(parent, n)), n + ' exists')
    }
    assert.equal((await svc.refs(WS)).worktrees.length, 4, 'main plus three')
  })

  // --- not a repository -----------------------------------------------------

  await test('a workspace that is not a repository answers as data', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'wt-int-plain-'))
    const ctx = new Context()
    ctx.provide('workspaceRegistry'); ctx.provide('llm'); ctx.provide('agentDefaultModel')
    ctx.workspaceRegistry = { list: () => [{ id: 'w1', path: plain }] }
    const svc = new GitService(ctx)
    try {
      const r = await svc.worktree({ ...WS, action: 'prune' })
      assert.equal(r.ok, false)
      assert.match(r.output, /Not a git repository/)
      const refs = await svc.refs(WS)
      assert.equal(refs.ok, false, 'refs says so too, rather than empty lists')
      assert.match(refs.error, /Not a git repository/)
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
} finally {
  cleanup()
}

console.log('\n' + state.passed + ' worktree integration checks passed')