/**
 * Smoke test for dsh-plan-board, run against the BUILT `lib/`.
 *
 * The store is exercised against real files in a temp directory, because the
 * behaviour worth pinning is all filesystem behaviour: the round trip through
 * JSON frontmatter, that a damaged metadata line does not cost the plan body,
 * that ids off the wire cannot escape the plans directory, and that pruning
 * never touches a plan nobody has answered yet.
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const lib = await import('../lib/index.js')
// The SHIPPED manifest — what the loader registers and the browser mounts.
const { TYPERT } = await import('../lib/typert.host.js')
const { PlanStore, parse, serialize, isSafeId, firstHeading, slugify, stamp, PlanService, MAX_PLANS } = lib

let passed = 0
/**
 * Assert and count.
 * @param {string} what - the behaviour being pinned.
 * @param {() => void} body - the assertions.
 */
function test(what, body) {
  body()
  passed += 1
  console.log(`  ok  ${what}`)
}

/**
 * Run a body against a fresh temp workspace.
 * @param {(dir: string, store: object) => void} body - the test body.
 */
function inWorkspace(body) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plans-'))
  try {
    body(dir, new PlanStore())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const PLAN = `# Add a hook lifecycle

Some **prose** with \`code\`.

- one
- two

\`\`\`ts
const x = 1
\`\`\`
`

// ── shape ──────────────────────────────────────────────────────────────────

test('exports the documented surface', () => {
  assert.equal(typeof PlanService, 'function')
  assert.equal(PlanService.name, 'PlanService')
  // Both are required: `tools` for the exit_plan_mode wrapper, and
  // `workspaceRegistry` because every endpoint is addressed by workspace id.
  assert.deepEqual(PlanService.inject, ['tools', 'workspaceRegistry'])
  assert.equal(typeof PlanStore, 'function')
})

// ── the wire contract ──────────────────────────────────────────────────────

/**
 * Method names the client's `RemoteNamespaceService` already owns.
 *
 * `assertMethodAvailable` refuses any descriptor whose method collides with a
 * field or a prototype member of that class, and the refusal happens inside
 * `$mount` — which is a THROW, not a warning. It takes down the whole mount, so
 * the namespace never appears, the `inject(['remote.dshPlans', ...])` fiber
 * never runs, and every seat this plugin registers silently fails to exist.
 * `remove` shipped once and cost exactly that: no Plans tab, no window, one
 * console line.
 */
const RESERVED_METHODS = new Set([
  'ctx', 'empty', 'invokeRemote', 'methods', 'name', 'namespace',
  'constructor', 'has', 'install', 'installDirect', 'installScoped', 'remove',
])

test('no descriptor collides with the client namespace service', () => {
  for (const d of TYPERT.invocations) {
    assert.equal(
      RESERVED_METHODS.has(d.method),
      false,
      `method "${d.method}" is reserved by RemoteNamespaceService — $mount would throw and every seat would vanish`,
    )
  }
})

test('the manifest and the wire agree on every method', () => {
  const wire = TYPERT.invocations.map((d) => d.method).sort()
  const manifest = TYPERT.model.services[0].members.map((m) => m.name).sort()
  assert.deepEqual(manifest, wire, 'the ./typert manifest drifted from the mounted descriptors')
})

// ── helpers ────────────────────────────────────────────────────────────────

test('firstHeading finds the plan title at any level', () => {
  assert.equal(firstHeading('# Title\nbody'), 'Title')
  assert.equal(firstHeading('intro\n### Deep\n'), 'Deep')
  assert.equal(firstHeading('no headings here'), undefined)
})

test('slugify refuses anything that could be a path', () => {
  assert.equal(slugify('Add a hook lifecycle'), 'add-a-hook-lifecycle')
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd')
  assert.equal(slugify('C:\\Windows\\System32'), 'c-windows-system32')
  assert.equal(slugify('???'), 'plan', 'a title with nothing usable still yields a filename')
  assert.ok(slugify('x'.repeat(200)).length <= 48)
})

test('stamp sorts lexicographically in time order', () => {
  const early = stamp(Date.UTC(2026, 0, 1))
  const late = stamp(Date.UTC(2026, 7, 29))
  assert.ok(early < late, 'a directory listing is already chronological')
  assert.match(early, /^\d{8}T\d{9}$/)
})

test('isSafeId is a real boundary, not a formality', () => {
  assert.equal(isSafeId('20260829T121500123-add-a-hook'), true)
  for (const bad of ['../secrets', 'a/b', 'a\\b', '', 'x'.repeat(200), '..', 'a..b', null, 42]) {
    assert.equal(isSafeId(bad), false, `${JSON.stringify(bad)} must be refused`)
  }
})

// ── serialization ──────────────────────────────────────────────────────────

test('a record survives a serialize/parse round trip', () => {
  const record = {
    id: 'abc',
    title: 'Add a hook lifecycle',
    sessionId: 's1',
    createdAt: 1756000000000,
    status: 'rejected',
    decidedAt: 1756000009999,
    feedback: 'line one\nline "two"\nand a \\ backslash',
    bytes: 0,
    body: PLAN,
  }
  const back = parse('abc', serialize(record))
  assert.equal(back.title, record.title)
  assert.equal(back.status, 'rejected')
  assert.equal(back.decidedAt, record.decidedAt)
  assert.equal(back.feedback, record.feedback, 'multiline quoted feedback survives')
  assert.equal(back.body, PLAN)
})

test('a damaged frontmatter line costs that field, not the plan', () => {
  const text = ['---', 'id: "abc"', 'title: not-json-at-all', 'createdAt: 5', '---', '', PLAN].join('\n')
  const back = parse('abc', text)
  assert.equal(back.id, 'abc')
  assert.equal(back.createdAt, 5, 'the readable lines still parse')
  assert.equal(back.title, 'Add a hook lifecycle', 'the title falls back to the body heading')
  assert.equal(back.body, PLAN, 'the plan itself is never lost')
})

test('a file with no frontmatter is still a plan', () => {
  const back = parse('hand-written', PLAN)
  assert.equal(back.body, PLAN)
  assert.equal(back.title, 'Add a hook lifecycle')
  assert.equal(back.status, 'pending')
})

// ── the store, on disk ─────────────────────────────────────────────────────

test('create writes one markdown file under .dsh/plans', () => {
  inWorkspace((dir, store) => {
    const record = store.create(dir, PLAN, 'sess-1', Date.UTC(2026, 7, 29, 12, 15))
    assert.ok(record)
    assert.equal(record.status, 'pending')
    assert.equal(record.title, 'Add a hook lifecycle')
    assert.match(record.id, /^20260829T121500000-add-a-hook-lifecycle$/)

    const files = readdirSync(join(dir, '.dsh', 'plans'))
    assert.deepEqual(files, [`${record.id}.md`])
    const text = readFileSync(join(dir, '.dsh', 'plans', files[0]), 'utf8')
    assert.ok(text.startsWith('---\n'), 'frontmatter is written first')
    assert.ok(text.includes('# Add a hook lifecycle'), 'the markdown is readable in the file')
  })
})

test('create refuses an empty or oversized plan', () => {
  inWorkspace((dir, store) => {
    assert.equal(store.create(dir, '', 's'), undefined)
    assert.equal(store.create(dir, '   \n  ', 's'), undefined)
    assert.equal(store.create(dir, 'x'.repeat(600 * 1024), 's'), undefined)
    assert.equal(store.list(dir).length, 0, 'nothing was written')
  })
})

test('settle records the outcome and the feedback', () => {
  inWorkspace((dir, store) => {
    const record = store.create(dir, PLAN, 's1')
    const settled = store.settle(dir, record.id, 'rejected', 'The user chose to keep planning; their feedback: too broad')
    assert.equal(settled.status, 'rejected')
    assert.match(settled.feedback, /too broad/)
    assert.ok(settled.decidedAt > 0)
    assert.equal(store.get(dir, record.id).status, 'rejected', 'the change is on disk, not just in memory')
  })
})

test('settling a plan the user deleted does not resurrect it', () => {
  inWorkspace((dir, store) => {
    const record = store.create(dir, PLAN, 's1')
    assert.equal(store.remove(dir, record.id), true)
    assert.equal(store.settle(dir, record.id, 'approved'), undefined)
    assert.equal(store.list(dir).length, 0)
  })
})

test('the change token moves on every write and only forward', () => {
  inWorkspace((dir, store) => {
    assert.equal(store.token(dir), 0)
    const record = store.create(dir, PLAN, 's1')
    const afterCreate = store.token(dir)
    assert.ok(afterCreate > 0)
    // Reads must never move it, or the UI re-fetches forever.
    store.list(dir)
    store.get(dir, record.id)
    assert.equal(store.token(dir), afterCreate)
    store.settle(dir, record.id, 'approved')
    assert.ok(store.token(dir) > afterCreate)
  })
})

test('list is newest-first and carries no bodies', () => {
  inWorkspace((dir, store) => {
    store.create(dir, '# Older\n', 's1', Date.UTC(2026, 0, 1))
    store.create(dir, '# Newer\n', 's1', Date.UTC(2026, 7, 1))
    const plans = store.list(dir)
    assert.deepEqual(
      plans.map((p) => p.title),
      ['Newer', 'Older'],
    )
    assert.equal(plans[0].body, undefined, 'a 200-plan list must not ship 200 markdown bodies')
    assert.ok(plans[0].bytes > 0, 'the size is still reported')
  })
})

test('get refuses a traversal id instead of reading outside the directory', () => {
  inWorkspace((dir, store) => {
    store.create(dir, PLAN, 's1')
    writeFileSync(join(dir, 'secret.md'), 'top secret')
    assert.equal(store.get(dir, '../secret'), undefined)
    assert.equal(store.get(dir, '..\\secret'), undefined)
    assert.equal(store.remove(dir, '../secret'), false)
    assert.equal(readFileSync(join(dir, 'secret.md'), 'utf8'), 'top secret', 'the file is untouched')
  })
})

test('a foreign file in the plans directory is ignored, not crashed on', () => {
  inWorkspace((dir, store) => {
    mkdirSync(join(dir, '.dsh', 'plans'), { recursive: true })
    writeFileSync(join(dir, '.dsh', 'plans', 'notes.txt'), 'not a plan')
    writeFileSync(join(dir, '.dsh', 'plans', 'broken.md'), '---\nnope\n')
    const plans = store.list(dir)
    assert.equal(plans.length, 1, 'only the .md file is considered')
    assert.equal(plans[0].id, 'broken')
  })
})

test('pruning drops old settled plans but never a pending one', () => {
  inWorkspace((dir, store) => {
    // One pending plan, far in the past, so age alone would condemn it.
    const pending = store.create(dir, '# Pending\n', 's1', Date.UTC(2020, 0, 1))
    for (let i = 0; i < MAX_PLANS + 5; i += 1) {
      const record = store.create(dir, `# Settled ${i}\n`, 's1', Date.UTC(2026, 0, 1) + i * 1000)
      store.settle(dir, record.id, 'approved')
    }
    const plans = store.list(dir)
    assert.ok(plans.length <= MAX_PLANS + 1, `kept ${plans.length}`)
    assert.ok(
      plans.some((p) => p.id === pending.id),
      'a plan nobody has answered is live work and is never pruned',
    )
  })
})

test('writes are atomic — no .tmp file survives', () => {
  inWorkspace((dir, store) => {
    const record = store.create(dir, PLAN, 's1')
    store.settle(dir, record.id, 'approved')
    const files = readdirSync(join(dir, '.dsh', 'plans'))
    assert.deepEqual(files, [`${record.id}.md`], 'the temp file is renamed, never left behind')
  })
})

console.log(`\n${passed} checks passed`)
