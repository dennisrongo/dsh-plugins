/**
 * Smoke test: the pure logic and the wire contract, with no dsh runtime.
 *
 * Two things are checked that a typecheck cannot:
 *   1. The porcelain parser against REAL `git status -z` output from a
 *      throwaway repo, including the space-in-filename and rename cases that
 *      are exactly where a naive parser breaks.
 *   2. Every Remote codec is `strict`. A non-strict codec makes the browser's
 *      $mount throw, and the tab would silently never appear.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseStatus, parseBranchHeader, assertSafePath } from '../src/git.ts'
import { GIT_REMOTE } from '../src/remote.ts'
import {
  countChanges,
  badgeFor,
  canCommit,
  branchSummary,
  baseName,
  dirName,
  GitStore,
} from '../lib/client.test.mjs'

let passed = 0
/**
 * Run one named check.
 *
 * AWAITS the body: a synchronous helper silently reports an async test as
 * passing the moment it returns a promise, so a rejected assertion inside one
 * would surface only as an unhandled rejection — after the run already claimed
 * success.
 */
async function test(name, fn) {
  await fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

// --- 1. Remote contract -----------------------------------------------------

await test('every remote codec is strict', () => {
  assert.equal(GIT_REMOTE.package, '@dennisrongo/dsh-git')
  assert.equal(GIT_REMOTE.descriptors.length, 10)
  for (const d of GIT_REMOTE.descriptors) {
    assert.equal(d.namespace, 'dshGit', `${d.method} namespace`)
    assert.equal(d.result.mode, 'strict', `${d.method} result codec`)
    for (const p of d.parameters) {
      assert.equal(p.codec.mode, 'strict', `${d.method} param codec`)
      // The host resolves the endpoint by PARAMETER NAME; a mismatch here is a
      // silent "missing wire field" at call time.
      assert.equal(p.wire, 'request', `${d.method} wire field`)
    }
  }
})

await test('remote covers every host method', () => {
  const methods = GIT_REMOTE.descriptors.map((d) => d.method).sort()
  assert.deepEqual(methods, [
    'changeToken', 'commit', 'commitDiff', 'commitFiles', 'diff', 'init', 'stage', 'status',
    'suggestMessage', 'sync',
  ])
})

// --- 1b. A failed commit expansion must be DISTINGUISHABLE from an empty one -

// This is the bug that made a 404 invisible: a stale host half (one booted
// before commitFiles existed) 404s the call, and collapsing that into the same
// empty list a real no-file commit returns renders as nothing happening at all.
// The two states must stay separable so the pane can say which one it is.

/** A store whose remote always fails the way an unregistered endpoint does. */
function storeWithFailingRemote(message) {
  return new GitStore(
    {
      commitFiles: async () => ({ ok: false, error: { code: 'HTTP_404', message } }),
    },
    'ws-test',
  )
}

await test('a FAILED commitFiles reports the error instead of an empty list', async () => {
  const store = storeWithFailingRemote('HTTP 404')
  const result = await store.commitFiles('a1b2c3d')
  assert.equal(result.ok, false, 'a failed call must not look successful')
  assert.match(result.error, /404/, 'the reason reaches the caller')
})

await test('a rejected commitFiles is reported, not swallowed', async () => {
  const store = new GitStore(
    {
      commitFiles: async () => {
        throw new Error('network down')
      },
    },
    'ws-test',
  )
  const result = await store.commitFiles('a1b2c3d')
  assert.equal(result.ok, false)
  assert.match(result.error, /network down/)
})

await test('a genuinely EMPTY commit is a success, not an error', async () => {
  const store = new GitStore(
    { commitFiles: async () => ({ ok: true, value: { files: [] } }) },
    'ws-test',
  )
  const result = await store.commitFiles('a1b2c3d')
  assert.equal(result.ok, true, 'no files is an ordinary outcome')
  assert.deepEqual(result.files, [])
})

await test('a successful commitFiles carries its files through', async () => {
  const files = [{ path: 'a.ts', status: 'M' }]
  const store = new GitStore(
    { commitFiles: async () => ({ ok: true, value: { files } }) },
    'ws-test',
  )
  const result = await store.commitFiles('a1b2c3d')
  assert.equal(result.ok, true)
  assert.deepEqual(result.files, files)
})

// --- 2. Porcelain parsing against real git ----------------------------------

const dir = mkdtempSync(join(tmpdir(), 'dsh-git-smoke-'))
try {
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  git('init', '-b', 'main')
  git('config', 'user.email', 'smoke@example.com')
  git('config', 'user.name', 'Smoke Test')

  writeFileSync(join(dir, 'kept.txt'), 'one\n')
  writeFileSync(join(dir, 'renamed-from.txt'), 'move me\n')
  git('add', '-A')
  git('commit', '-m', 'initial')

  // The three cases that break naive parsers: a space in the name, a rename,
  // and an untracked file in a subdirectory.
  writeFileSync(join(dir, 'kept.txt'), 'one\ntwo\n')
  writeFileSync(join(dir, 'with space.txt'), 'spaced\n')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub', 'new.txt'), 'nested\n')
  git('mv', 'renamed-from.txt', 'renamed-to.txt')
  git('add', 'with space.txt')

  const raw = git('status', '--porcelain=v1', '-b', '-z', '--untracked-files=all')
  const firstNul = raw.indexOf('\0')
  const header = raw.slice(0, firstNul)
  const files = parseStatus(raw.slice(firstNul + 1))
  const byPath = new Map(files.map((f) => [f.path, f]))

  test('parses a branch header', () => {
    const info = parseBranchHeader(header.slice(3))
    assert.equal(info.branch, 'main')
    assert.equal(info.upstream, undefined)
  })

  test('parses a filename containing a space', () => {
    const f = byPath.get('with space.txt')
    assert.ok(f, 'with space.txt should be present')
    assert.equal(f.staged, true)
    assert.equal(f.index, 'A')
  })

  test('parses a rename and keeps its original path', () => {
    const f = byPath.get('renamed-to.txt')
    assert.ok(f, 'renamed-to.txt should be present')
    assert.equal(f.index, 'R')
    assert.equal(f.origPath, 'renamed-from.txt')
    // The original path must be CONSUMED, not left to parse as its own entry.
    assert.equal(byPath.has('renamed-from.txt'), false)
  })

  test('parses an untracked nested file', () => {
    const f = byPath.get('sub/new.txt')
    assert.ok(f, 'sub/new.txt should be present')
    assert.equal(f.untracked, true)
    assert.equal(f.staged, false)
  })

  test('parses an unstaged modification', () => {
    const f = byPath.get('kept.txt')
    assert.ok(f, 'kept.txt should be present')
    assert.equal(f.worktree, 'M')
    assert.equal(f.staged, false)
  })

  test('counts sections without double-counting', () => {
    const counts = countChanges(files)
    assert.equal(counts.total, files.length)
    assert.equal(counts.conflicted, 0)
    assert.ok(counts.staged >= 2, 'rename + added file are staged')
    assert.ok(counts.unstaged >= 2, 'modified + untracked are unstaged')
  })
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// --- 3. View logic ----------------------------------------------------------

await test('badgeFor reads the column its section shows', () => {
  const f = { path: 'a', index: 'A', worktree: 'M', staged: true, conflicted: false, untracked: false }
  assert.equal(badgeFor(f, 'staged'), 'A')
  assert.equal(badgeFor(f, 'unstaged'), 'M')
  assert.equal(badgeFor({ ...f, untracked: true }, 'unstaged'), 'U')
})

await test('canCommit blocks on conflicts and empty messages', () => {
  const clean = { repo: true, root: '/r', unborn: false, hasRemote: false, files: [], recent: [] }
  const changed = {
    ...clean,
    files: [{ path: 'a', index: 'M', worktree: ' ', staged: true, conflicted: false, untracked: false }],
  }
  const conflicted = {
    ...clean,
    files: [{ path: 'a', index: 'U', worktree: 'U', staged: false, conflicted: true, untracked: false }],
  }
  assert.equal(canCommit(changed, 'feat: x'), true)
  assert.equal(canCommit(changed, '   '), false, 'blank message blocks')
  assert.equal(canCommit(clean, 'feat: x'), false, 'nothing to commit blocks')
  assert.equal(canCommit(conflicted, 'feat: x'), false, 'conflicts block')
  assert.equal(canCommit({ repo: false, root: '/r' }, 'feat: x'), false)
})

await test('branchSummary reports divergence', () => {
  const base = { repo: true, root: '/r', branch: 'main', unborn: false, hasRemote: true, files: [], recent: [] }
  assert.equal(branchSummary(base), 'main')
  assert.equal(
    branchSummary({ ...base, upstream: { name: 'origin/main', ahead: 2, behind: 1 } }),
    'main ↑2 ↓1',
  )
  assert.equal(branchSummary({ ...base, unborn: true }), 'main · no commits yet')
})

await test('path splitting handles root and nested files', () => {
  assert.equal(baseName('a/b/c.ts'), 'c.ts')
  assert.equal(dirName('a/b/c.ts'), 'a/b/')
  assert.equal(baseName('top.ts'), 'top.ts')
  assert.equal(dirName('top.ts'), '')
})

await test('assertSafePath refuses escapes and absolute paths', () => {
  assert.equal(assertSafePath('src/a.ts'), 'src/a.ts')
  assert.throws(() => assertSafePath('../etc/passwd'), /escape/)
  assert.throws(() => assertSafePath('/etc/passwd'), /absolute/)
  assert.throws(() => assertSafePath('C:/Windows/system32'), /absolute/)
  assert.throws(() => assertSafePath(''), /non-empty/)
})

console.log(`\n${passed} checks passed`)