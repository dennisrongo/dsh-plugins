/**
 * CLI coverage, driven in-process through the BUILT lib/cli.js.
 *
 * Every command is exercised against a real SQLite database in a temp
 * workspace, because the CLI's whole risk surface is the durable layer it
 * shares with the host service.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
assert.ok(existsSync(join(root, 'lib/cli.js')), 'lib/cli.js missing — run pnpm build')
assert.ok(existsSync(join(root, 'lib/bin.js')), 'lib/bin.js missing — run pnpm build')

const cli = await import(pathToFileURL(join(root, 'lib/cli.js')).href)

// The executable must carry exactly ONE shebang: esbuild adds it via banner, so
// a second one in the source makes the output a syntax error at load time.
{
  const { readFileSync } = await import('node:fs')
  const bin = readFileSync(join(root, 'lib/bin.js'), 'utf8')
  const shebangs = bin.split('\n').filter((l) => l.startsWith('#!')).length
  assert.equal(shebangs, 1, 'lib/bin.js must have exactly one shebang')
  assert.ok(bin.startsWith('#!/usr/bin/env node'), 'the shebang must be the first line')
}

// --- argument parsing -------------------------------------------------------
{
  const p = cli.parseArgs(['add', 'Fix', 'the', 'thing', '--priority', 'p0', '--json'])
  assert.equal(p.command, 'add')
  assert.deepEqual(p.positional, ['Fix', 'the', 'thing'])
  assert.equal(p.options.priority, 'p0')
  assert.equal(p.options.json, true, 'a bare flag parses as true')

  assert.equal(cli.parseArgs(['x', '--key=value']).options.key, 'value', '--key=value form')
  // A flag whose value looks like another flag must not swallow it.
  const q = cli.parseArgs(['x', '--release', '--json'])
  assert.equal(q.options.release, true, 'a flag followed by a flag takes no value')
  assert.equal(q.options.json, true, 'the following flag survives')
  assert.equal(cli.parseArgs([]).command, 'help', 'no args is help')
}

// --- filtering --------------------------------------------------------------
{
  const items = [
    { id: 'a', title: 'a', status: 'todo', priority: 'p0', release: 'v1', createdAt: 1 },
    { id: 'b', title: 'b', status: 'done', priority: 'p2', createdAt: 2 },
    { id: 'c', title: 'c', status: 'blocked', priority: 'p2', sprint: 'S1', createdAt: 3 },
    { id: 'd', title: 'd', status: 'done', priority: 'p2', createdAt: 4, archivedAt: 9 },
  ]
  const ids = (f) => cli.filterList(items, f).map((i) => i.id)
  // Archived tasks are hidden by default: the archive is history, and an agent
  // asking for "the work" must not be handed finished rows.
  assert.deepEqual(ids({}), ['a', 'b', 'c'], 'archived excluded by default')
  assert.deepEqual(ids({ archived: true }), ['d'], '--archived shows only the archive')
  assert.deepEqual(ids({ open: true }), ['a', 'c'], '--open excludes finished work')
  assert.deepEqual(ids({ status: 'blocked' }), ['c'])
  assert.deepEqual(ids({ priority: 'p0' }), ['a'])
  assert.deepEqual(ids({ release: 'v1' }), ['a'])
  assert.deepEqual(ids({ sprint: 'S1' }), ['c'])
  assert.deepEqual(ids({ status: 'done', open: true }), [], 'filters combine (AND)')
}

// --- id prefix resolution ---------------------------------------------------
{
  const items = [
    { id: 'tabc123', title: 'a', status: 'todo', priority: 'p2', createdAt: 1 },
    { id: 'tabc999', title: 'b', status: 'todo', priority: 'p2', createdAt: 2 },
    { id: 'tzzz111', title: 'c', status: 'todo', priority: 'p2', createdAt: 3 },
  ]
  assert.equal(cli.findItem(items, 'tabc123').id, 'tabc123', 'exact id wins')
  assert.equal(cli.findItem(items, 'tzz').id, 'tzzz111', 'an unambiguous prefix resolves')
  // Ids are time-ordered, so short prefixes collide often — guessing would edit
  // the wrong task, so ambiguity must be an error.
  assert.throws(() => cli.findItem(items, 'tabc'), /matches 2 tasks/, 'ambiguous prefix is refused')
  assert.throws(() => cli.findItem(items, 'nope'), /no task matching/, 'unknown id is refused')
  try {
    cli.findItem(items, 'nope')
  } catch (e) {
    assert.equal(e.code, cli.EXIT.notFound, 'a missing task exits notFound, not usage')
  }
}

// --- end to end against a real database -------------------------------------
{
  const ws = mkdtempSync(join(tmpdir(), 'todo-cli-'))
  let clock = 1000
  const now = () => (clock += 1000)
  const rand = () => 0.5
  const go = (argv) => cli.run(cli.parseArgs(argv), ws, now, rand)

  // add
  const added = go(['add', 'Ship', 'login', '--priority', 'p0', '--release', '1.5', '--due', '2026-03-14'])
  const id = added.json.item.id
  assert.equal(added.json.item.title, 'Ship login', 'positionals join into the title')
  assert.equal(added.json.item.priority, 'p0')
  assert.equal(added.json.item.release, '1.5')
  assert.equal(added.json.item.dueDate, '2026-03-14')
  assert.equal(added.json.item.status, 'todo', 'a new task defaults to todo')
  assert.ok(existsSync(join(ws, '.dsh', 'todo.db')), 'the database is created on first write')

  // Labels stay numeric so they sort without mixing alpha and numeric, but the
  // two fields differ: a RELEASE carries a patch segment (0.5.1), a SPRINT is a
  // single decimal. Invalid values are REFUSED, never dropped.
  for (const bad of ['v1.5', 'Sprint 24', 'beta', '1.2.3.4', '1.']) {
    assert.throws(
      () => go(['add', 'Bad release', '--release', bad]),
      /--release must be a version number/,
      `add refuses --release "${bad}"`,
    )
    assert.throws(
      () => go(['update', id, '--release', bad]),
      /--release must be a version number/,
      `update refuses --release "${bad}"`,
    )
  }
  // A sprint is NOT a version: the patch form is refused there.
  for (const bad of ['v1.5', 'Sprint 24', 'beta', '0.5.1']) {
    assert.throws(
      () => go(['add', 'Bad sprint', '--sprint', bad]),
      /--sprint must be a decimal number/,
      `add refuses --sprint "${bad}"`,
    )
    assert.throws(
      () => go(['update', id, '--sprint', bad]),
      /--sprint must be a decimal number/,
      `update refuses --sprint "${bad}"`,
    )
  }
  assert.equal(go(['show', id]).json.release, '1.5', 'a refused update leaves the field untouched')

  // The revision must advance on every write, or the running UI would never
  // learn its cached list is stale.
  assert.equal(added.json.revision, 1, 'first write is revision 1')
  const second = go(['add', 'Second'])
  assert.equal(second.json.revision, 2, 'revision advances per write')

  // A release carries a patch segment; every numeric shape up to three parts is
  // accepted and stored verbatim.
  for (const good of ['0.5.1', '1', '24', '1.5']) {
    assert.equal(go(['update', id, '--release', good]).json.item.release, good,
      `update accepts --release "${good}"`)
  }

  // list
  assert.equal(go(['list']).json.count, 2)
  assert.equal(go(['list', '--priority', 'p0']).json.count, 1, 'filters reach the list command')

  // update, including clearing a field with an empty string
  const upd = go(['update', id, '--status', 'in-progress', '--sprint', '24'])
  assert.equal(upd.json.item.status, 'in-progress')
  assert.equal(upd.json.item.sprint, '24')
  assert.equal(upd.json.item.completedAt, undefined, 'in-progress must not stamp completion')
  const cleared = go(['update', id, '--release', ''])
  assert.ok(!('release' in cleared.json.item), 'an empty value CLEARS the field')

  // done / reopen keep completedAt honest
  const done = go(['done', id])
  assert.equal(done.json.item.status, 'done')
  assert.ok(typeof done.json.item.completedAt === 'number', 'done stamps completedAt')
  const reopened = go(['reopen', id])
  assert.equal(reopened.json.item.status, 'todo')
  assert.ok(!('completedAt' in reopened.json.item), 'reopen clears the completion stamp')

  // archive: one task, then the bulk form
  go(['done', id])
  assert.equal(go(['archive']).json.archived, 1, 'bulk archive takes every completed task')
  assert.equal(go(['list']).json.count, 1, 'archived tasks leave the default list')
  assert.equal(go(['list', '--archived']).json.count, 1)
  assert.equal(go(['archive']).json.archived, 0, 'archiving twice is a no-op')

  // show
  assert.equal(go(['show', id]).json.id, id)
  assert.match(go(['show', id]).text, /Ship login/)

  // rm
  const before = go(['list', '--archived']).json.count
  go(['rm', id])
  assert.equal(go(['list', '--archived']).json.count, before - 1, 'rm deletes outright')

  // Validation must REJECT, not silently drop: an agent that asked for a due
  // date would otherwise never learn the value was discarded.
  assert.throws(() => go(['add', 'x', '--due', '2026-02-31']), /calendar date/,
    'an impossible date is refused rather than rolled forward')
  assert.throws(() => go(['add', 'x', '--due', 'tomorrow']), /calendar date/)
  assert.throws(() => go(['add', 'x', '--status', 'wat']), /must be one of/)
  assert.throws(() => go(['add', 'x', '--priority', 'p9']), /must be one of/)
  assert.throws(() => go(['add']), /needs a title/)
  assert.throws(() => go(['update', id]), /at least one field/)
  assert.throws(() => go(['bogus']), /unknown command/)

  // --- agent-facing feedback ------------------------------------------------
  // An agent parses --json, so BOTH paths must state plainly whether the write
  // happened: a bare payload with no verdict makes failure look like success.
  {
    const captured = []
    const errors = []
    const log = console.log
    const err = console.error
    console.log = (line) => captured.push(String(line))
    console.error = (line) => errors.push(String(line))
    let okCode, badCode, badText
    try {
      okCode = cli.main(['add', 'Feedback ok', '--release', '0.5.1', '--json', '--workspace', ws], ws)
      badCode = cli.main(['add', 'Feedback bad', '--release', 'v1.5', '--json', '--workspace', ws], ws)
      badText = cli.main(['add', 'Feedback bad', '--sprint', '0.5.1', '--workspace', ws], ws)
    } finally {
      console.log = log
      console.error = err
    }

    const success = JSON.parse(captured[0])
    assert.equal(okCode, cli.EXIT.ok, 'a good write exits 0')
    assert.equal(success.ok, true, 'a successful command SAYS it succeeded')
    assert.equal(success.item.release, '0.5.1', 'the stored task comes back for confirmation')

    const failure = JSON.parse(captured[1])
    assert.equal(badCode, cli.EXIT.usage, 'refused data exits non-zero')
    assert.equal(failure.ok, false, 'a refused command SAYS it failed')
    assert.equal(failure.code, cli.EXIT.usage)
    assert.equal(failure.field, 'release', 'the agent is told WHICH field was refused')
    assert.match(failure.expected, /0\.5\.1/, 'and what shape that field accepts')
    assert.equal(failure.got, 'v1.5', 'and what it sent')
    assert.match(failure.error, /--release/)

    // Without --json the human path must still explain itself on stderr.
    assert.equal(badText, cli.EXIT.usage)
    assert.ok(errors.some((l) => /--sprint must be/.test(l)), 'the text path names the field too')
  }

  rmSync(ws, { recursive: true, force: true })
}

// --- the CLI shares ONE storage implementation with the host ----------------
// A second copy of the v1 -> v2 migration is the duplication that could corrupt
// a real database, so the CLI must upgrade a v1 file exactly as the host does.
{
  const ws = mkdtempSync(join(tmpdir(), 'todo-cli-v1-'))
  mkdirSync(join(ws, '.dsh'), { recursive: true })
  const legacy = new DatabaseSync(join(ws, '.dsh', 'todo.db'))
  legacy.exec(
    'CREATE TABLE todo (id TEXT PRIMARY KEY, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,' +
      ' created_at INTEGER NOT NULL, completed_at INTEGER, archived_at INTEGER, position INTEGER NOT NULL);' +
      ' CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
  )
  legacy.prepare('INSERT INTO todo VALUES (?,?,?,?,?,?,?)').run('v1a', 'legacy open', 0, 100, null, null, 0)
  legacy.prepare('INSERT INTO todo VALUES (?,?,?,?,?,?,?)').run('v1b', 'legacy done', 1, 101, 102, null, 1)
  legacy.close()

  const listed = cli.run(cli.parseArgs(['list']), ws).json
  assert.equal(listed.count, 2, 'the CLI reads a v1 database after migrating it')
  assert.equal(listed.items[0].title, 'legacy open', 'v1 text becomes title')
  assert.equal(listed.items[1].status, 'done', 'v1 done=1 becomes status done')
  assert.equal(listed.items[0].priority, 'p2', 'migrated rows get the default priority')

  rmSync(ws, { recursive: true, force: true })
}

// --- concurrent access with a live host handle ------------------------------
// SQLite is a multi-process database; this asserts the CLI can write while the
// harness holds its long-lived handle, which is the premise of the whole design.
{
  const ws = mkdtempSync(join(tmpdir(), 'todo-cli-cc-'))
  cli.run(cli.parseArgs(['add', 'first']), ws)

  // Stand in for the running harness: a handle held open for the duration.
  const host = new DatabaseSync(join(ws, '.dsh', 'todo.db'))
  const rows = () => host.prepare('SELECT COUNT(*) c FROM todo').get().c
  assert.equal(rows(), 1)

  const added = cli.run(cli.parseArgs(['add', 'second']), ws)
  assert.equal(added.json.revision, 2, 'the CLI writes while the host holds a handle')
  assert.equal(rows(), 2, 'the host sees the CLI write immediately, same file')

  // And the revision it stamped is what a stale reader would conflict against.
  const rev = Number(host.prepare("SELECT value FROM meta WHERE key='revision'").get().value)
  assert.equal(rev, 2, 'the revision token is visible to the host')

  host.close()
  rmSync(ws, { recursive: true, force: true })
}

console.log('cli OK')
