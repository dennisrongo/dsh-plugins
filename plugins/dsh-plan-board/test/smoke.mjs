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
const { PlanStore, parse, serialize, isSafeId, firstHeading, slugify, stamp, PlanService, MAX_PLANS, extractFencedPlans, PLAN_FENCE } = lib

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

// -- implicit capture: the plan fence ---------------------------------------

test('the fence tag the prompt asks for is the one the parser looks for', () => {
  assert.equal(PLAN_FENCE, 'plan')
})

test('a fenced plan is extracted from surrounding prose', () => {
  const message = [
    'Here is how I would approach it.',
    '',
    '```plan',
    '# Add retry to the client',
    '',
    '- back off exponentially',
    '- cap at five attempts',
    '```',
    '',
    'Want me to go ahead?',
  ].join('\n')
  const found = extractFencedPlans(message)
  assert.equal(found.length, 1)
  assert.ok(found[0].startsWith('# Add retry to the client'))
  assert.ok(found[0].includes('cap at five attempts'))
  assert.ok(!found[0].includes('Want me to go ahead?'), 'the follow-up question stays outside')
})

test('plan-shaped PROSE is never captured', () => {
  // The whole reason for a marker: a heuristic would misfire on exactly this.
  const message = ['# My plan for the refactor', '', 'Goal: make it faster.', '', '1. Measure'].join('\n')
  assert.deepEqual(extractFencedPlans(message), [])
})

test('other fenced languages are left alone', () => {
  assert.deepEqual(extractFencedPlans('```ts\nconst x = 1\n```'), [])
  assert.deepEqual(extractFencedPlans('```planner\nnot a plan\n```'), [])
})

test('several fences in one message each become a plan', () => {
  const message = ['```plan', '# First', 'a', '```', 'between', '```plan', '# Second', 'b', '```'].join('\n')
  assert.deepEqual(extractFencedPlans(message).map((p) => p.split('\n')[0]), ['# First', '# Second'])
})

test('an unterminated fence is not captured', () => {
  assert.deepEqual(extractFencedPlans('```plan\n# Half a plan\nno closing fence'), [])
})

// -- code blocks INSIDE a plan ----------------------------------------------
// The bug this pins shipped and bit: a plan is a design document, so it
// routinely contains code blocks, and the original one-regex extractor ended
// the plan at the first ``` inside it. Two plans captured from a real session
// were cut at "## The prompt", losing the prompt template and everything after
// it, and the panel rendered the truncation faithfully — the data was already
// gone by then, so nothing downstream could have noticed.

const TICK = '`'.repeat(3)
const QUAD = '`'.repeat(4)

test('a FOUR-backtick plan survives code blocks, bare or tagged', () => {
  const bare = [QUAD + 'plan', '# T', 'before', TICK, 'x', TICK, 'after', QUAD].join('\n')
  assert.deepEqual(extractFencedPlans(bare), ['# T\nbefore\n' + TICK + '\nx\n' + TICK + '\nafter'])
  const tagged = [QUAD + 'plan', '# T', TICK + 'ts', 'const x = 1', TICK, 'tail', QUAD].join('\n')
  assert.match(extractFencedPlans(tagged)[0], /const x = 1[\s\S]*tail$/)
})

test('a three-backtick plan still survives a TAGGED inner block', () => {
  // The info string makes it unambiguously a nested opener, so the plan can be
  // recovered even when the model forgets the longer fence.
  const message = [TICK + 'plan', '# T', 'before', TICK + 'markdown', '# {title}', TICK, 'after', TICK].join('\n')
  assert.match(extractFencedPlans(message)[0], /before[\s\S]*\{title\}[\s\S]*after$/)
})

test('a BARE inner fence of equal length still ends the plan, as CommonMark says', () => {
  // Nothing in the text distinguishes "nested block opens" from "plan ends",
  // and guessing would be worse than the documented limit. This is exactly why
  // the prompt section asks for four backticks; the assertion exists so the
  // limit is a decision on record rather than a surprise.
  const message = [TICK + 'plan', '# T', 'before', TICK, 'x', TICK, 'after', TICK].join('\n')
  assert.deepEqual(extractFencedPlans(message), ['# T\nbefore'])
})

test('the prompt section asks for four backticks', () => {
  // The parser cannot rescue the ambiguous case, so the instruction is the
  // other half of the fix and must not drift away from it.
  // The example line is built by concatenation (`'    ' + QUAD + PLAN_FENCE`),
  // so assert on the pieces that actually survive into the bundle rather than
  // on a literal the bundler never emits.
  const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(host.includes(QUAD), 'the example fence must be four backticks')
  assert.ok(/Four backticks, not three/.test(host), 'the reason must be stated to the model')
  assert.ok(
    !/'\s*```' \+ PLAN_FENCE/.test(host),
    'a three-backtick example would undo the parser fix',
  )
})

// -- proposed plans ---------------------------------------------------------

test('a proposed plan is stored as proposed, not pending', () => {
  inWorkspace((dir, store) => {
    const record = store.create(dir, '# From the chat\n\nbody', 's1', Date.UTC(2026, 7, 29), 'proposed')
    assert.equal(record.status, 'proposed')
    assert.equal(store.get(dir, record.id).status, 'proposed')
  })
})

test('the same plan body is never stored twice', () => {
  inWorkspace((dir, store) => {
    const body = '# Restated plan\n\nsame every time'
    assert.ok(store.create(dir, body, 's1', Date.UTC(2026, 7, 29), 'proposed'))
    assert.equal(store.create(dir, body, 's1', Date.UTC(2026, 7, 30), 'proposed'), undefined)
    assert.equal(store.list(dir).length, 1)
  })
})

test('a proposed plan survives the round trip through the file', () => {
  const back = parse('x', serialize({
    id: 'x', title: 'T', sessionId: 's', createdAt: 1, status: 'proposed', bytes: 0, body: '# T\n',
  }))
  assert.equal(back.status, 'proposed')
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

// ── the browser bundle ─────────────────────────────────────────────────────
// The client half cannot be imported under Node (it is a browser bundle
// wrapped in window.__ModuleLoader__.load), so the facts worth pinning are
// asserted against its text — the same discipline dsh-weather's smoke test
// uses. Every one of these is a bug that already shipped once.

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('the dock never answers a review by taking the question provider', () => {
  // ctx.userQuestions documents ONE active provider per context and the shipped
  // question UI holds it; registering a second would hijack every question in
  // the harness. The dock answers the dispatched carrier instead.
  assert.ok(!client.includes('registerProvider'), 'the dock must never register a userQuestions provider')
  assert.ok(client.includes('plan-review'), 'the dock must narrow on the plan-review intent')
  assert.ok(client.includes('not-pending'), 'a receipt rejected as already-answered must be reported, not swallowed')
})

test('the dock does not anchor to the scrolled conversation view', () => {
  // [data-slot="conversation.view"]'s first child is the Chat view root INSIDE
  // the scrollport, so its top goes negative as soon as the chat scrolls. The
  // dock measured it, rejected the negative, and silently fell back to the
  // column top — restoring the very geometry the anchor was added to remove.
  assert.ok(
    !client.includes('conversation.view"]'),
    'the dock must not measure the conversation view: its child is the scrolled content root',
  )
  assert.ok(client.includes('data-slot="conversation"'), 'the dock still measures the conversation column')
})

test('the dock clears the desktop drag strip and outranks the weather bar', () => {
  // A drag region is resolved by the compositor BEFORE hit-testing, so it
  // swallows clicks whatever z-index the covered element carries — the header
  // has to be inset out of the strip instead.
  assert.ok(client.includes('dsh-desktop-windows-titlebar-layout'), 'the header must clear the desktop drag strip')
  assert.ok(client.includes('--dshpb-titlebar-h'), 'drag-strip clearance variable missing')
  assert.ok(client.includes('app-region: no-drag'), 'the header must opt out of the drag region')
  // Above dsh-weather (2147482900), below dsh-mission-control (2147483000).
  const z = /z-index: (\d+)/.exec(client)
  assert.ok(z !== null, 'the dock declares no z-index')
  const value = Number(z[1])
  assert.ok(value > 2147482900, `the dock must outrank dsh-weather's bar, got ${value}`)
  assert.ok(value < 2147483000, `the dock must stay under mission control's rail, got ${value}`)
})

test('the dock publishes its strip claim so floating chrome can dodge it', () => {
  assert.ok(client.includes('data-dsh-overlay-claim'), 'the dock must mark the strip it holds')
})

test('the dock converts between viewport and author pixels', () => {
  // dsh-theme's UI scale is `#root { zoom: var(--dshth-ui-scale, 1) }`, so the
  // shell renders in two coordinate spaces: getBoundingClientRect() reports
  // TRUE viewport px while an inline length is an AUTHOR px the zoom scales
  // again. Measuring in one and writing in the other is exactly self-consistent
  // at 100% — which is why it shipped — and wrong by the zoom factor at every
  // other step. Measured at the 90% step before the fix: a panel told
  // `height: 1680px` rendered 1512 and stopped 168px short of the window, and
  // one told `right: 377px` sat 22px underneath mission control's rail.
  assert.ok(client.includes('currentCSSZoom'), 'the dock must resolve the effective CSS zoom')
  assert.ok(client.includes('offsetWidth'), 'the zoom fallback must derive from author-px offsetWidth')
})

test('the dock re-measures when the UI scale changes', () => {
  // No ResizeObserver reports a zoom change: measured across 1.0 -> 0.8 -> 1.0
  // in the shell, a content-box observer fired zero times and so did a
  // device-pixel-content-box one, because a CSS zoom rewrites the rendered
  // result without resizing any observed box. dsh-theme sets the scale as an
  // inline custom property on <body>, so the style attribute is the trigger.
  assert.ok(
    /attributeFilter:\s*\[\s*["']style["']\s*,\s*["']class["']\s*\]/.test(client),
    "the dock must watch <body>'s style attribute for UI-scale changes",
  )
})

test('nothing transforms the dock away from where it was measured', () => {
  // Observed in the shell: the entrance animation never got a start time
  // (getAnimations() → startTime: null, currentTime: 0) and pinned the panel at
  // its FROM keyframe forever, computed transform matrix(1,0,0,1,12,0). A dock
  // measured flush to the column edge at 863 painted at 875, 12px into the gap
  // it keeps from mission control's rail. The panel's position is measured
  // against a boundary, so no animation may offset it afterwards.
  assert.ok(!client.includes('dshpb-slide'), 'the dock must not animate its own transform')
  assert.ok(
    !/\.dshpb-dock\s*\{[^}]*\btransform:/.test(client),
    'the dock must not carry a static transform either',
  )
})

console.log(`\n${passed} checks passed`)
