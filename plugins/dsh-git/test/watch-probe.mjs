/**
 * Watcher probe: proves the change token actually advances on an EXTERNAL edit,
 * and that it stays put when nothing happens.
 *
 * This is the regression test for the tab's live-update claim. The failure it
 * guards against is silent in the worst way: a watcher that never fires leaves
 * the tab looking exactly like the old manual-refresh build, and every other
 * test in this package still passes.
 *
 * It exercises the real RepoWatcher against a real repository on disk — no
 * mocks, because the whole question is whether the OS delivers the events.
 */
// Must come first: it scrubs inherited GIT_DIR/GIT_INDEX_FILE before any git runs.
import './git-env.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RepoWatcher } from '../src/watch.ts'

/** Give the OS and the debounce window time to deliver a change. */
const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms))

const dir = mkdtempSync(join(tmpdir(), 'dsh-git-watch-'))
const watcher = new RepoWatcher()
let passed = 0

/** Run one named async check. */
async function test(name, fn) {
  await fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

try {
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  git('init', '-b', 'main')
  git('config', 'user.email', 'watch@example.com')
  git('config', 'user.name', 'Watch Probe')
  writeFileSync(join(dir, 'seed.txt'), 'seed\n')
  git('add', '-A')
  git('commit', '-m', 'seed')

  await test('first read establishes a non-zero baseline', async () => {
    const first = watcher.token(dir)
    assert.ok(first > 0, `expected a positive token, got ${first}`)
  })

  await test('an idle repository does not advance the token', async () => {
    const before = watcher.token(dir)
    await settle()
    assert.equal(watcher.token(dir), before, 'token moved with no filesystem activity')
  })

  await test('a NEW untracked file advances the token', async () => {
    const before = watcher.token(dir)
    writeFileSync(join(dir, 'added.txt'), 'hello\n')
    await settle()
    assert.ok(
      watcher.token(dir) > before,
      'creating a file did not advance the token — the worktree watch is dead',
    )
  })

  await test('MODIFYING a tracked file advances the token', async () => {
    const before = watcher.token(dir)
    writeFileSync(join(dir, 'seed.txt'), 'seed changed\n')
    await settle()
    assert.ok(watcher.token(dir) > before, 'editing a file did not advance the token')
  })

  await test('STAGING advances the token via the .git watch', async () => {
    const before = watcher.token(dir)
    git('add', '-A')
    await settle()
    assert.ok(
      watcher.token(dir) > before,
      'staging did not advance the token — the .git watch is dead, so staging,\n' +
        'commits and branch switches would never reach the tab',
    )
  })

  await test('COMMITTING advances the token', async () => {
    const before = watcher.token(dir)
    git('commit', '-m', 'second')
    await settle()
    assert.ok(watcher.token(dir) > before, 'commit did not advance the token')
  })

  await test('a burst of writes collapses into few advances', async () => {
    const before = watcher.token(dir)
    // 40 writes in a tight loop stands in for a build or a bulk agent edit.
    for (let i = 0; i < 40; i += 1) writeFileSync(join(dir, `burst-${i}.txt`), `${i}\n`)
    await settle(800)
    const delta = watcher.token(dir) - before
    assert.ok(delta > 0, 'a burst of 40 writes went entirely unnoticed')
    // The debounce is the reason polling stays cheap: without it each write
    // would bump the token and the client would re-read status 40 times.
    assert.ok(delta < 10, `debounce failed to collapse the burst: ${delta} advances`)
  })

  await test('a BRANCH SWITCH advances the token', async () => {
    git('branch', 'feature')
    await settle()
    const before = watcher.token(dir)
    git('checkout', 'feature')
    await settle()
    assert.ok(
      watcher.token(dir) > before,
      'checkout did not advance the token — .git/HEAD and refs/ writes are being\n' +
        'filtered out, so the tab would show the old branch',
    )
    git('checkout', 'main')
    await settle()
  })

  // --- The self-trigger regression -----------------------------------------
  //
  // This is the one that a denylist filter gets wrong, and it is invisible in
  // every other test: READING a repository touches .git/objects, and the tab's
  // own status read is such a read. If `objects` counts as significant, status
  // bumps the token, which triggers another status, forever — runaway polling on
  // a repository nobody is touching. Measured before the fix: +1 with no change.
  await test('the tab\u2019s OWN status reads do not advance the token', async () => {
    const { readStatus } = await import('../src/git.ts')
    await settle()
    const before = watcher.token(dir)
    for (let i = 0; i < 5; i += 1) await readStatus(dir)
    // Sample only after a full quiet period. A debounced watcher coalesces the
    // whole burst into ONE late advance, so checking immediately reads the token
    // before it lands and the assertion passes for the wrong reason.
    await settle(900)
    assert.equal(
      watcher.token(dir),
      before,
      'SELF-TRIGGER LOOP: reading status advanced the token, so the tab wakes\n' +
        'itself forever on an idle repository',
    )
  })

  await test('the .git filter REJECTS the entries that reading a repo touches', async () => {
    // Behavioural checks for this are timing-sensitive and quietly stop proving
    // anything as the repo's state drifts, so pin the predicate directly. These
    // are the exact names a plain `git status`/`git diff` writes.
    const { isSignificantGitEntry } = await import('../src/watch.ts')
    // The `.lock` entries are belt-and-braces: the allowlist already rejects
    // them, so these assertions pin the OUTCOME, not the suffix guard (which no
    // test can currently distinguish). `objects` is the load-bearing one.
    for (const noise of ['objects', 'index.lock', 'HEAD.lock', 'packed-refs.lock', 'refs.lock', 'COMMIT_EDITMSG', 'logs']) {
      assert.equal(
        isSignificantGitEntry(noise),
        false,
        `'${noise}' counts as significant — reading a repo touches it, so the tab\n` +
          'would trigger itself: status -> event -> token bump -> status, forever',
      )
    }
    // 'worktrees' is the one a worktree add/remove writes, and nothing else
    // touches it — without it the Repo pane's worktree list silently never
    // refreshes, which looks like the feature working until you add one.
    for (const real of ['index', 'HEAD', 'refs', 'packed-refs', 'MERGE_HEAD', 'worktrees']) {
      assert.equal(isSignificantGitEntry(real), true, `'${real}' must advance the token`)
    }
  })

  await test('reading a DIFF does not advance the token', async () => {
    await settle()
    const before = watcher.token(dir)
    for (let i = 0; i < 5; i += 1) git('diff', 'HEAD')
    await settle(900)
    assert.equal(watcher.token(dir), before, 'git diff advanced the token')
  })

  await test('churn inside node_modules is ignored', async () => {
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    await settle()
    const before = watcher.token(dir)
    // An install or a watch-mode build writes thousands of these. None of them
    // change `git status`, but each one costs a wakeup and re-arms the debounce.
    for (let i = 0; i < 50; i += 1) {
      writeFileSync(join(dir, 'node_modules', 'pkg', `f-${i}.js`), `// ${i}\n`)
    }
    await settle(700)
    assert.equal(
      watcher.token(dir),
      before,
      'node_modules churn advanced the token — a dependency install would spam',
    )
  })

  await test('a CONTINUOUS trickle still advances within the cap', async () => {
    await settle()
    const before = watcher.token(dir)
    // Emit an event every 60ms for 1.5s: each one re-arms the 120ms debounce, so
    // a pure re-arming debounce would never fire and the tab would stay stale for
    // as long as the build runs. MAX_DEBOUNCE_MS is what breaks the starvation.
    const stop = Date.now() + 1500
    let n = 0
    while (Date.now() < stop) {
      writeFileSync(join(dir, `trickle-${n}.txt`), `${n}\n`)
      n += 1
      await new Promise((r) => setTimeout(r, 60))
    }
    assert.ok(
      watcher.token(dir) > before,
      'a continuous trickle starved the debounce: the token never advanced while\n' +
        'writes kept arriving, so the list stays stale for the whole build',
    )
  })

  await test('DOTFILES like .gitignore are not swallowed by the .git filter', async () => {
    // `path.startsWith('.git')` is a prefix test, not a path-segment test, so it
    // silently eats .gitignore, .gitattributes, and everything under .github/ —
    // exactly the files a source-control tab most needs to notice.
    for (const name of ['.gitignore', '.gitattributes']) {
      const before = watcher.token(dir)
      writeFileSync(join(dir, name), `# ${Date.now()}\n`)
      await settle()
      assert.ok(watcher.token(dir) > before, `${name} was swallowed by the .git filter`)
    }
    const before = watcher.token(dir)
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\n')
    await settle()
    assert.ok(watcher.token(dir) > before, '.github/ was swallowed by the .git filter')
  })

  await test('tokens never repeat after a watcher is torn down', async () => {
    // A client holding the old baseline would read a reused token as "no change"
    // and go blind until the counter climbed past it. Plugin reloads make this a
    // routine path, not an edge case.
    const fresh = mkdtempSync(join(tmpdir(), 'dsh-git-mono-'))
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: fresh, stdio: 'ignore' })
      const first = new RepoWatcher()
      const a = first.token(fresh)
      first.close()
      const second = new RepoWatcher()
      const b = second.token(fresh)
      second.close()
      assert.notEqual(b, a, `token restarted at ${b} after teardown, so a client baselined there goes blind`)
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
  })

  await test('a non-repository directory is never watched', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'dsh-git-plain-'))
    try {
      // The host maps this to token 0 before ever reaching the watcher; assert
      // the service-level contract holds so the client stops polling.
      const { repoRoot } = await import('../src/git.ts')
      assert.equal(await repoRoot(plain), undefined)
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  console.log(`\n${passed} watch checks passed`)
} finally {
  watcher.close()
  rmSync(dir, { recursive: true, force: true })
}