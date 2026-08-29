/**
 * The WIRE contract: every request the client sends and every reply the host
 * returns, pushed through the real zod codecs in `src/remote.ts`.
 *
 * This is the gap the service-level suites cannot see. They call `GitService`
 * methods DIRECTLY, so a descriptor that refuses a valid request — or silently
 * drops a field — passes all 82 of them and fails only in a browser.
 *
 * Both codecs are `mode: 'strict'`, and zod objects STRIP unknown keys rather
 * than rejecting them. That is the dangerous direction:
 *
 *   * a REQUEST field the schema does not declare never reaches the host, so
 *     the feature silently does nothing (`worktree.startPoint` would have
 *     behaved exactly this way had remote.ts not been updated with it);
 *   * a RESULT field the schema does not declare never reaches the browser, so
 *     the tab renders a stale shape forever (`status.merging` and
 *     `status.stashCount` are both new, and both invisible if omitted).
 *
 * Neither throws. Neither logs. So every check here asserts a LOSSLESS round
 * trip — parse and deep-equal the input — rather than merely that parsing
 * succeeded. `assert.doesNotThrow` would pass in both failure modes above.
 */
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { GitService } from '../lib/index.js'
import { GIT_REMOTE } from '../src/remote.ts'
import { makeService, makeEmptyService, cleanup, makeRunner, WS } from './service-harness.mjs'

const { test, state } = makeRunner()

/** Index the descriptors by method, so a rename here fails loudly. */
const BY_METHOD = new Map(GIT_REMOTE.descriptors.map((d) => [d.method, d]))

/**
 * Push a request through its descriptor codec and assert nothing was lost.
 * @returns the decoded request, which is what the host would actually receive.
 */
function encodeRequest(method, request) {
  const d = BY_METHOD.get(method)
  assert.ok(d, 'no descriptor for ' + method)
  const param = d.parameters[0]
  assert.equal(param.wire, 'request', method + ': wire name must match the host parameter')
  const parsed = param.codec.schema.parse(request)
  assert.deepEqual(
    parsed,
    request,
    method + ': the request codec DROPPED a field -- the host would never see it',
  )
  return parsed
}

/** Push a reply through its result codec and assert nothing was lost. */
function decodeResult(method, result) {
  const d = BY_METHOD.get(method)
  const parsed = d.result.schema.parse(result)
  assert.deepEqual(
    parsed,
    result,
    method + ': the result codec DROPPED a field -- the browser would never see it',
  )
  return parsed
}

/** Call the service exactly as the gateway would, both ways through the wire. */
async function roundTrip(svc, method, request) {
  const onWire = encodeRequest(method, request)
  const reply = await svc[method](onWire)
  return decodeResult(method, reply)
}

try {
  await test('every descriptor is strict, and named for a real host method', () => {
    // A src-json fallback works on the HOST and makes the CLIENT's $mount throw,
    // so the tab silently never registers. Cheap to assert, invisible to catch.
    const svc = makeService('wire-shape-').svc
    for (const d of GIT_REMOTE.descriptors) {
      assert.equal(d.result.mode, 'strict', d.method + ' result must be strict')
      assert.equal(d.parameters[0].codec.mode, 'strict', d.method + ' request must be strict')
      assert.equal(d.parameters[0].source, 'json', d.method)
      assert.equal(typeof svc[d.method], 'function', d.method + ' has no host method')
      assert.equal(d.service, 'dshGit')
    }
    assert.equal(GIT_REMOTE.descriptors.length, 16)
  })

  await test('status survives the wire with merge, stash and worktree state', async () => {
    // The richest reply this plugin produces, and the one whose newest fields
    // (merging / mergeHead / stashCount) would vanish silently if undeclared.
    const box = makeService('wire-status-')
    // A stash.
    writeFileSync(join(box.repo, 'a.txt'), 'stashed\n')
    await svcCall(box, 'stash', { ...WS, action: 'push', message: 'wired' })
    // A worktree.
    await svcCall(box, 'worktree', { ...WS, action: 'add', path: '../wired-wt', newBranch: 'wired' })
    // A real conflict, so merging/mergeHead are populated.
    box.g('checkout', '-b', 'ours')
    writeFileSync(join(box.repo, 'a.txt'), 'ours\n')
    box.g('add', '-A'); box.g('commit', '-m', 'ours')
    box.g('checkout', 'main')
    box.g('checkout', '-b', 'theirs')
    writeFileSync(join(box.repo, 'a.txt'), 'theirs\n')
    box.g('add', '-A'); box.g('commit', '-m', 'theirs')
    await svcCall(box, 'merge', { ...WS, action: 'merge', from: 'ours' })

    const out = await roundTrip(box.svc, 'status', { workspaceId: 'w1' })
    assert.equal(out.status.repo, true)
    assert.equal(out.status.merging, true, 'merging survived the wire')
    assert.ok(out.status.mergeHead, 'mergeHead survived the wire')
    assert.equal(out.status.stashCount, 1, 'stashCount survived the wire')
    assert.ok(out.status.files.some((f) => f.conflicted), 'conflicted flag survived')
    assert.ok(out.status.recent.length > 0, 'recent commits survived')
  })

  await test('a NON-repository status round-trips as data', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'wire-plain-'))
    const ctx = new Context()
    ctx.provide('workspaceRegistry'); ctx.provide('llm'); ctx.provide('agentDefaultModel')
    ctx.workspaceRegistry = { list: () => [{ id: 'w1', path: plain }] }
    const svc = new GitService(ctx)
    try {
      const out = await roundTrip(svc, 'status', { workspaceId: 'w1' })
      assert.equal(out.status.repo, false, 'the repo:false union member survives')
      const token = await roundTrip(svc, 'changeToken', { workspaceId: 'w1' })
      assert.equal(token.token, 0, 'token 0 is the stop-polling signal')
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  await test('an UNBORN status round-trips (no HEAD, no upstream)', async () => {
    const box = makeEmptyService('wire-unborn-')
    writeFileSync(join(box.repo, 'new.txt'), 'x\n')
    const out = await roundTrip(box.svc, 'status', { workspaceId: 'w1' })
    assert.equal(out.status.unborn, true)
    assert.equal(out.status.upstream, undefined, 'absent, not null')
    assert.ok(out.status.files.some((f) => f.untracked))
  })

  await test('diff round-trips for tracked, staged and UNTRACKED files', async () => {
    const box = makeService('wire-diff-')
    writeFileSync(join(box.repo, 'a.txt'), 'changed\n')
    writeFileSync(join(box.repo, 'fresh.txt'), 'brand new\n')
    const tracked = await roundTrip(box.svc, 'diff', { workspaceId: 'w1', path: 'a.txt' })
    assert.match(tracked.patch, /changed/)
    assert.equal(tracked.binary, false)
    // The synthesized /dev/null patch: a new file must not render blank.
    const untracked = await roundTrip(box.svc, 'diff', { workspaceId: 'w1', path: 'fresh.txt' })
    assert.match(untracked.patch, /brand new/)
    await svcCall(box, 'stage', { ...WS, action: 'stage', paths: ['a.txt'] })
    const staged = await roundTrip(box.svc, 'diff', { workspaceId: 'w1', path: 'a.txt', staged: true })
    assert.match(staged.patch, /changed/)
    // A whole-tree diff carries no path at all.
    await roundTrip(box.svc, 'diff', { workspaceId: 'w1' })
  })

  await test('commitFiles and commitDiff round-trip, including a RENAME', async () => {
    const box = makeService('wire-commit-')
    box.g('mv', 'a.txt', 'renamed.txt')
    writeFileSync(join(box.repo, 'renamed.txt'), 'moved and edited\n')
    box.g('add', '-A'); box.g('commit', '-m', 'rename it')
    const sha = box.g('rev-parse', 'HEAD').trim()
    const files = await roundTrip(box.svc, 'commitFiles', { workspaceId: 'w1', sha })
    assert.ok(files.files.length >= 1)
    // CHARACTERIZATION. The discriminated outcome AGENTS.md describes is the
    // CLIENT's (CommitFilesOutcome), and it separates a thrown or 404'd bridge
    // from a reply. The HOST sends a bare list: { files: [] } both for a sha
    // git refused and for a directory that is not a repository, so "this commit
    // changed nothing" and "we could not read it" are identical on the wire.
    assert.equal(files.ok, undefined, 'the host sends a bare list, not an outcome')
    // origPath is optional on the wire and only renames carry it.
    const patch = await roundTrip(box.svc, 'commitDiff', { workspaceId: 'w1', sha })
    assert.ok(patch.patch.length > 0)
    await roundTrip(box.svc, 'commitDiff', { workspaceId: 'w1', sha, path: 'renamed.txt' })

    // A well-formed sha that resolves to nothing: hex, so the wire lets it
    // through, and the host then flattens it to an empty list.
    const ghost = await roundTrip(box.svc, 'commitFiles', {
      workspaceId: 'w1',
      sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    })
    assert.deepEqual(ghost.files, [], 'indistinguishable from an empty commit')
  })

  await test('refs round-trips branches, stashes and worktrees together', async () => {
    const box = makeService('wire-refs-')
    box.g('branch', 'other')
    writeFileSync(join(box.repo, 'a.txt'), 'wip\n')
    await svcCall(box, 'stash', { ...WS, action: 'push', message: 'for refs' })
    await svcCall(box, 'worktree', { ...WS, action: 'add', path: '../refs-wt', newBranch: 'refs-wt' })
    const out = await roundTrip(box.svc, 'refs', { workspaceId: 'w1' })
    assert.equal(out.ok, true)
    assert.ok(out.branches.length >= 2)
    assert.equal(out.stashes.length, 1)
    assert.equal(out.worktrees.length, 2)
    assert.ok(out.worktrees.some((w) => w.main), 'the main flag survived')
    assert.ok(out.worktrees.some((w) => w.current), 'the current flag survived')
  })

  await test('every MUTATING request shape the client sends is accepted whole', async () => {
    // Each of these is a field the tab actually sets. A codec that dropped one
    // would leave the feature dead with no error anywhere -- which is precisely
    // what would have happened to worktree.startPoint had remote.ts not moved
    // with types.ts and index.ts.
    encodeRequest('stage', { workspaceId: 'w1', action: 'discard', paths: ['a.txt', 'b/c.txt'] })
    encodeRequest('commit', { workspaceId: 'w1', message: 'subject\n\nbody', all: true })
    encodeRequest('init', { workspaceId: 'w1', branch: 'trunk' })
    encodeRequest('sync', { workspaceId: 'w1', action: 'publish' })
    encodeRequest('branch', { workspaceId: 'w1', action: 'createSwitch', name: 'feat/x', startPoint: 'main', force: true })
    encodeRequest('merge', { workspaceId: 'w1', action: 'merge', from: 'topic', noFF: true })
    encodeRequest('stash', { workspaceId: 'w1', action: 'drop', index: 2, message: 'm', includeUntracked: true })
    encodeRequest('worktree', {
      workspaceId: 'w1', action: 'add', path: '../proj-x',
      branch: 'existing', newBranch: 'fresh', startPoint: 'main', force: true, register: true,
    })
    // 'staged' is the request field; 'scope' is on the REPLY. Sending 'scope'",
    // is dropped, correctly -- it was never part of this contract.",
    encodeRequest('suggestMessage', { workspaceId: 'w1', staged: true })
    assert.throws(
      () => encodeRequest('suggestMessage', { workspaceId: 'w1', scope: 'staged' }),
      'a field that is not in the contract must not pass silently',
    )
    // The reply DOES carry scope, and it must survive: the log strip names
    // which set of changes the message describes.
    decodeResult('suggestMessage', { message: 'feat: x', scope: 'staged' })
    decodeResult('suggestMessage', { message: 'feat: x' })
    decodeResult('suggestBranch', { name: 'fix/login-retry' })
    encodeRequest('suggestBranch', { workspaceId: 'w1', hint: 'fix login retry' })
    encodeRequest('changeToken', { workspaceId: 'w1' })
    encodeRequest('refs', { workspaceId: 'w1' })
  })

  await test('the wire REFUSES what the host would also refuse', async () => {
    // Boundary validation is meant to fail before a round trip is spent. These
    // are the same values assertSafeRef and assertSafeSha reject host-side.
    for (const name of ['--exec=calc', 'main..dev', 'a b', 'HEAD~1', '-f']) {
      assert.throws(
        () => encodeRequest('branch', { workspaceId: 'w1', action: 'switch', name }),
        JSON.stringify(name) + ' must be refused at the wire',
      )
    }
    for (const sha of ['HEAD', 'main..dev', '--output=x', 'zzzz']) {
      assert.throws(
        () => encodeRequest('commitFiles', { workspaceId: 'w1', sha }),
        JSON.stringify(sha) + ' must be refused at the wire',
      )
    }
    for (const index of [-1, 1.5, '0']) {
      assert.throws(
        () => encodeRequest('stash', { workspaceId: 'w1', action: 'drop', index }),
        String(index) + ' must be refused at the wire',
      )
    }
    assert.throws(() => encodeRequest('stage', { workspaceId: 'w1', action: 'nuke' }))
    assert.throws(() => encodeRequest('commit', { workspaceId: 'w1' }), 'message is required')
  })

  await test('a FAILED command still round-trips, error text and all', async () => {
    const box = makeService('wire-fail-')
    const out = await roundTrip(box.svc, 'branch', { workspaceId: 'w1', action: 'switch', name: 'ghost' })
    assert.equal(out.ok, false, 'the honest ok flag crosses the wire')
    assert.ok(out.output.length > 0, 'and so does git reason')
    assert.equal(out.status.repo, true, 'with the refreshed status attached')
  })
} finally {
  cleanup()
}

/** Call the service without wire assertions, for fixture setup only. */
async function svcCall(box, method, request) {
  return box.svc[method](request)
}

console.log('\n' + state.passed + ' wire-contract checks passed')
