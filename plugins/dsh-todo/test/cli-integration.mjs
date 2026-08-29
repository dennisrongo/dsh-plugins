/**
 * INTEGRATION: drive the real `dsh-todo` binary as a subprocess, the way an
 * agent does.
 *
 * Every other test in this package imports `lib/cli.js` and calls `run()` or
 * `main()` in-process, which never exercises what an actual caller depends on:
 * the shebang'd `lib/bin.js`, `process.exitCode`, the stdout/stderr split, and
 * argv as a real shell delivers it. Those are the seams a refactor breaks
 * silently, because the in-process tests keep passing.
 *
 * The scenario is one realistic agent workflow — plan a release, inspect it,
 * recover from a refusal, finish the work — asserting only on what an agent can
 * actually see: the JSON payload and the exit code.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(root, 'lib/bin.js')
assert.ok(existsSync(BIN), 'lib/bin.js missing — run pnpm build')

const ws = mkdtempSync(join(tmpdir(), 'todo-e2e-'))

/**
 * Run the binary exactly as a caller would.
 *
 * `--workspace` is appended rather than relying on cwd, because that is the
 * form an agent working outside the project uses, and the one that has to keep
 * working when cwd is somewhere else entirely.
 */
function cli(...args) {
  const r = spawnSync(process.execPath, [BIN, ...args, '--workspace', ws], {
    encoding: 'utf8',
    // A real caller inherits no TTY; make sure nothing waits for one.
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (r.error) throw r.error
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

/** Run with --json and parse, the way an agent consumes the CLI. */
function json(...args) {
  const r = cli(...args, '--json')
  try {
    return { ...r, json: JSON.parse(r.stdout) }
  } catch {
    assert.fail('--json did not produce parseable stdout for [' + args.join(' ') + ']: ' + JSON.stringify(r.stdout))
  }
}

let checks = 0
const ok = (name, cond) => { checks += 1; assert.ok(cond, name) }

try {
  // --- 1. an empty workspace answers, it does not fail ---------------------
  {
    const r = json('list')
    ok('an unseen workspace lists cleanly', r.code === 0 && r.json.ok === true)
    assert.equal(r.json.count, 0, 'a fresh workspace has no tasks')
  }

  // --- 2. plan a release ---------------------------------------------------
  const ids = {}
  {
    const a = json('add', 'Fix token refresh', '--priority', 'p0', '--release', '0.5.1', '--due', '2026-03-14')
    assert.equal(a.code, 0)
    assert.equal(a.json.ok, true, 'a successful write says so')
    assert.equal(a.json.item.release, '0.5.1', 'the patch release survives the shell')
    assert.equal(a.json.item.dueDate, '2026-03-14')
    ids.fix = a.json.item.id

    const b = json('add', 'Write the migration guide', '--sprint', '24', '--release', '1.5')
    assert.equal(b.json.item.sprint, '24')
    assert.equal(b.json.item.release, '1.5')
    ids.guide = b.json.item.id

    const c = json('add', 'Cut the release', '--status', 'backlog')
    ids.cut = c.json.item.id
    // The revision is what a live tab reconciles against; it must advance
    // across separate PROCESSES, which is the whole point of doing this here.
    assert.ok(c.json.revision > a.json.revision, 'the revision advances across processes')
  }

  // --- 3. inspect, the way an agent decides what to do next ----------------
  {
    assert.equal(json('list', '--open').json.count, 3, 'all three are unfinished')
    assert.deepEqual(json('list', '--priority', 'p0').json.items.map((i) => i.id), [ids.fix],
      'filters reach the binary')
    assert.deepEqual(json('list', '--release', '0.5.1').json.items.map((i) => i.id), [ids.fix])
    // An id prefix is what an agent actually holds after reading a list. Ids are
    // time-ordered, so tasks created together SHARE a long prefix: a short one is
    // ambiguous and must be refused rather than resolved to whichever matched
    // first, and a longer one resolves.
    const ambiguous = json('show', ids.fix.slice(0, 4))
    assert.equal(ambiguous.code, 2, 'an ambiguous prefix is a usage error, not a guess')
    assert.match(ambiguous.json.error, /matches \d+ tasks/)
    assert.equal(json('show', ids.fix).json.id, ids.fix, 'the full id resolves')
  }

  // --- 4. a refusal an agent can recover from ------------------------------
  {
    const bad = json('update', ids.guide, '--release', 'v2.0')
    assert.equal(bad.code, 2, 'refused data exits usage')
    assert.equal(bad.json.ok, false, 'and says it failed')
    assert.equal(bad.json.field, 'release', 'naming the field')
    assert.equal(bad.json.got, 'v2.0', 'and what it was given')
    ok('the refusal states what the field accepts', /version number/.test(bad.json.expected))

    // Nothing may have been written: a partial write is the worst case here,
    // because the agent has already been told the command failed.
    assert.equal(json('show', ids.guide).json.release, '1.5',
      'a refused update leaves the stored value alone')

    // The agent corrects itself from the payload alone and retries.
    const fixed = json('update', ids.guide, '--release', '2.0')
    assert.equal(fixed.code, 0)
    assert.equal(fixed.json.ok, true)
    assert.equal(fixed.json.item.release, '2.0', 'the corrected value lands')

    // The sprint rule is narrower, and the message must say so rather than
    // repeating the release wording.
    const badSprint = json('update', ids.guide, '--sprint', '0.5.1')
    assert.equal(badSprint.json.field, 'sprint')
    ok('a sprint refusal names the decimal rule', /decimal number/.test(badSprint.json.expected))
  }

  // --- 5. clearing a field through a real shell ----------------------------
  {
    // `--release=` is the form that survives EVERY shell: PowerShell strips a
    // separate empty argument before node sees it, so `--release ""` arrives as
    // a bare flag and clears nothing.
    const cleared = json('update', ids.guide, '--release=')
    assert.equal(cleared.json.ok, true)
    assert.ok(!('release' in cleared.json.item), '--release= clears the field')
  }

  // --- 6. finish the work --------------------------------------------------
  {
    const done = json('done', ids.fix)
    assert.equal(done.json.ok, true)
    assert.equal(done.json.item.status, 'done')
    assert.ok(typeof done.json.item.completedAt === 'number', 'completion is stamped')

    assert.equal(json('archive').json.archived, 1, 'the bulk archive files the finished task')
    assert.equal(json('list').json.count, 2, 'archived work leaves the active list')
    assert.equal(json('list', '--archived').json.count, 1, 'and is still reachable')

    const removed = json('rm', ids.cut)
    assert.equal(removed.json.ok, true)
    assert.equal(json('list').json.count, 1, 'rm deletes outright')
  }

  // --- 7. failures an agent must be able to tell apart ----------------------
  {
    const missing = json('show', 'nosuchid')
    assert.equal(missing.code, 3, 'not-found has its own exit code')
    assert.equal(missing.json.ok, false)

    const usage = json('bogus-command')
    assert.equal(usage.code, 2, 'a bad command is a usage error, not not-found')
    assert.equal(usage.json.ok, false)
  }

  // --- 8. stdout stays machine-readable ------------------------------------
  {
    // node:sqlite prints an experimental warning; if it ever reached stdout the
    // JSON contract would break for every caller that pipes into jq.
    const r = cli('list', '--json')
    assert.doesNotThrow(() => JSON.parse(r.stdout), 'stdout is pure JSON')
    ok('the sqlite warning goes to stderr, not stdout', !/ExperimentalWarning/.test(r.stdout))

    // Without --json the human path must not emit JSON.
    const human = cli('list')
    ok('the text path stays text', !human.stdout.trimStart().startsWith('{'))

    // An error without --json belongs on stderr, so a piped stdout stays clean.
    const err = cli('show', 'nosuchid')
    assert.equal(err.code, 3)
    ok('a human error goes to stderr', /no task matching/.test(err.stderr) && err.stdout.trim() === '')
  }

  // --- 9. help works with no workspace at all -------------------------------
  {
    const r = spawnSync(process.execPath, [BIN, 'help'], { encoding: 'utf8' })
    assert.equal(r.status, 0, 'help exits 0')
    ok('help documents the release shape', /--release/.test(r.stdout) && /0\.5\.1/.test(r.stdout))
    ok('help documents the json flag', /--json/.test(r.stdout))
  }

  console.log('cli-integration OK (' + checks + ' explicit checks + assertions)')
} finally {
  rmSync(ws, { recursive: true, force: true })
}
