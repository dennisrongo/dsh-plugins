/**
 * Smoke tests for dsh-superpowers.
 *
 * This package had NO tests, which matters more here than the line count
 * suggests: every failure mode is SILENT by design. A missing clone, a bad
 * root, and `enabled: false` all register nothing and let dsh boot happily, so a
 * regression does not crash anything — the bootstrap section just quietly stops
 * reaching the model and nobody notices until behaviour drifts.
 *
 * Runs offline against a temp clone; no harness, no network.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Config, VENDOR_ROOT, apply, inject, name } from '../lib/index.js'

let passed = 0
/** Run one named check. Supports async checks so the provider can be driven. */
async function test(label, fn) {
  await fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

/**
 * Drive apply() with a stub context, capturing sections and warnings.
 * @param config - plugin config.
 * @param env - value for SUPERPOWERS_ROOT, or undefined to unset it.
 * @returns the captured section, warnings, and any throw.
 */
function run(config, env, options = {}) {
  const prev = process.env.SUPERPOWERS_ROOT
  if (env === undefined) delete process.env.SUPERPOWERS_ROOT
  else process.env.SUPERPOWERS_ROOT = env

  const warns = []
  const originalWarn = console.warn
  console.warn = (...args) => warns.push(args.join(' '))

  const sections = []
  let provider = null
  let threw = null
  // `skills` is an OPTIONAL service read through ctx.get. Absent by default so
  // the existing checks keep exercising a profile without it; `withSkills`
  // opts in. A real cordis context THROWS on an undeclared read rather than
  // returning undefined, so the absent case models that instead of being a
  // plain-object stub that cannot fail.
  const get = (n) => {
    if (n !== 'skills') return undefined
    if (options.withSkills !== true) throw new Error(`cannot get property "${n}" without inject`)
    return { registerProvider: (factory) => { provider = factory({}) } }
  }
  try {
    apply(
      {
        effect: (fn) => fn(),
        systemPrompt: { section: (s) => sections.push(s) },
        get,
        logger: { warn: (...args) => warns.push(args.join(' ')) },
      },
      new Config(config),
    )
  } catch (error) {
    threw = error
  } finally {
    console.warn = originalWarn
    if (prev === undefined) delete process.env.SUPERPOWERS_ROOT
    else process.env.SUPERPOWERS_ROOT = prev
  }
  // Two independent sections now come out of apply(), so they are addressed by
  // name rather than by position — the clone bootstrap and the hand-written
  // "offer choices as choices" nudge. `count` stays the bootstrap's count so
  // the checks below keep meaning exactly what they meant.
  const named = (n) => sections.find((s) => s.name === n) ?? null
  return {
    section: named('superpowers:using-superpowers'),
    ask: named('superpowers:ask-with-options'),
    count: sections.filter((s) => s.name === 'superpowers:using-superpowers').length,
    all: sections,
    provider,
    warns,
    threw,
  }
}

/** Resolve a provider's list() to a plain candidate array. */
async function candidatesOf(provider) {
  const list = await provider.list({})
  return Array.isArray(list) ? list : list.candidates
}

/** Build a throwaway catalog of <name>/SKILL.md bundles under a root. */
function makeCatalog(skills) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sp-cat-'))
  for (const [skillName, frontmatter, body] of skills) {
    mkdirSync(join(dir, 'skills', skillName), { recursive: true })
    writeFileSync(
      join(dir, 'skills', skillName, 'SKILL.md'),
      `---\n${frontmatter}\n---\n\n${body}\n`,
      'utf8',
    )
  }
  return dir
}

/** Build a throwaway clone whose marker body is identifiable by length. */
function makeClone(body) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sp-'))
  mkdirSync(join(dir, 'skills', 'using-superpowers'), { recursive: true })
  writeFileSync(
    join(dir, 'skills', 'using-superpowers', 'SKILL.md'),
    `---\nname: using-superpowers\ndescription: test fixture\n---\n\n${body}\n`,
    'utf8',
  )
  return dir
}

// An empty directory stands in for a machine with no clone: HOME is not
// redirectable from inside the process, so point the config at nothing instead.
const NOWHERE = mkdtempSync(join(tmpdir(), 'dsh-sp-empty-'))
const cloneA = makeClone('BODY-A mandate text')
const cloneB = makeClone('BODY-B a noticeably longer mandate body for precedence checks')

// A catalog that is ALSO a valid clone: it carries the using-superpowers
// marker, so it can stand in for a real checkout in precedence checks while
// serving predictable skills to the provider.
const catalog = makeCatalog([
  ['beta-skill', 'name: beta-skill\ndescription: second', 'BETA BODY'],
  ['alpha-skill', 'name: alpha-skill\ndescription: first', 'ALPHA BODY'],
  ['using-superpowers', 'name: using-superpowers\ndescription: marker', 'MARKER BODY'],
])

// One good bundle beside three broken ones. `bad-yaml` reproduces the real
// upstream defect: an inline description containing ": ", which YAML reads as
// a nested mapping and refuses.
const mixed = makeCatalog([
  ['good-skill', 'name: good-skill\ndescription: fine', 'GOOD'],
  ['bad-yaml', 'name: bad-yaml\ndescription: a lens council: parallel agents', 'BAD'],
  ['no-description', 'name: no-description', 'NO DESC'],
  ['Bad_Name', 'name: Bad_Name\ndescription: not kebab-case', 'BAD NAME'],
])

// Directory names whose CREATION order is not their sorted order, and whose
// frontmatter `name` sorts differently again. readdir order is
// filesystem-dependent and frequently already alphabetical, so a fixture that
// happens to arrive sorted cannot fail when names.sort() is deleted — verified
// by sabotage: that exact mutation ESCAPED until this fixture existed.
const unsorted = makeCatalog([
  ['zulu', 'name: zulu\ndescription: created first', 'Z'],
  ['mike', 'name: mike\ndescription: created second', 'M'],
  ['alfa', 'name: alfa\ndescription: created third', 'A'],
])

// Dot- and underscore-prefixed directories must stay out of the catalog.
const hidden = makeCatalog([
  ['real-skill', 'name: real-skill\ndescription: visible', 'REAL'],
  ['_scratch', 'name: scratch\ndescription: hidden by underscore', 'NOPE'],
  ['.hidden', 'name: hidden\ndescription: hidden by dot', 'NOPE'],
])

try {
  await test('plugin identity is stable', () => {
    assert.equal(name, 'superpowers')
    assert.deepEqual(inject, ['systemPrompt'])
  })

  await test('registers a section from a real clone', () => {
    const r = run({ superpowersRoot: cloneA }, undefined)
    assert.equal(r.threw, null)
    assert.equal(r.count, 1, 'expected exactly one section')
    assert.equal(r.section.name, 'superpowers:using-superpowers')
    assert.match(r.section.text, /BODY-A/)
  })

  await test('strips YAML frontmatter', () => {
    const r = run({ superpowersRoot: cloneA }, undefined)
    assert.ok(!r.section.text.startsWith('---'), 'frontmatter leaked into the prompt')
    assert.ok(!/description: test fixture/.test(r.section.text), 'metadata leaked')
  })

  await test('default order sits before persona', () => {
    const r = run({ superpowersRoot: cloneA }, undefined)
    // persona is 0 and harness identity is -100; the bootstrap must land
    // between them or it stops being a mandatory-first instruction.
    assert.equal(r.section.order, -50)
    assert.ok(r.section.order < 0 && r.section.order > -100)
  })

  await test('order is configurable', () => {
    const r = run({ superpowersRoot: cloneA, order: -77 }, undefined)
    assert.equal(r.section.order, -77)
  })

  await test('enabled:false registers nothing and does not warn', () => {
    const r = run({ superpowersRoot: cloneA, enabled: false }, undefined)
    assert.equal(r.count, 0)
    assert.equal(r.all.length, 0, 'the master switch must silence every section')
    assert.equal(r.threw, null)
    assert.equal(r.warns.length, 0, 'a deliberate opt-out must be silent')
  })

  await test('a BAD root warns and registers nothing, never throws', () => {
    const r = run({ superpowersRoot: join(NOWHERE, 'not-here') }, undefined)
    assert.equal(r.threw, null, 'a missing clone must never take dsh down')
    assert.equal(r.count, 0)
    assert.ok(r.warns.length > 0, 'a silent miss is the whole failure mode')
    assert.match(r.warns[0], /dsh-superpowers/)
  })

  await test('a directory without the marker is refused', () => {
    const r = run({ superpowersRoot: NOWHERE }, undefined)
    assert.equal(r.count, 0, 'a non-clone directory must not register')
    assert.ok(r.warns.length > 0)
  })

  // ── the "offer choices as choices" section ───────────────────────────────
  // Hand-written here, not read from the clone, so it must survive every state
  // that legitimately kills the bootstrap. A machine that has never cloned
  // superpowers is an ordinary machine, and the nudge disappearing there would
  // be a bug nobody would think to look for.

  await test('the ask-with-options section registers alongside the bootstrap', () => {
    const r = run({ superpowersRoot: cloneA }, undefined)
    assert.ok(r.ask !== null, 'expected the ask-with-options section')
    assert.equal(r.all.length, 2, 'both sections, no more')
    assert.ok(r.ask.order < 0, 'must land before the persona at 0')
    assert.ok(r.ask.order > -100, 'must land after harness identity at -100')
  })

  await test('it survives a missing clone', () => {
    const r = run({ superpowersRoot: join(NOWHERE, 'not-here') }, undefined)
    assert.equal(r.count, 0, 'the bootstrap is correctly absent')
    assert.ok(r.ask !== null, 'the nudge must not depend on the clone')
  })

  await test('it survives a directory with no marker', () => {
    const r = run({ superpowersRoot: NOWHERE }, undefined)
    assert.equal(r.count, 0)
    assert.ok(r.ask !== null, 'the nudge must not depend on the clone')
  })

  await test('askWithOptions:false opts out of just that section', () => {
    const r = run({ superpowersRoot: cloneA, askWithOptions: false }, undefined)
    assert.equal(r.ask, null)
    assert.equal(r.count, 1, 'the bootstrap must be unaffected')
  })

  await test('its order is configurable', () => {
    const r = run({ superpowersRoot: cloneA, askWithOptionsOrder: -33 }, undefined)
    assert.equal(r.ask.order, -33)
  })

  await test('it names the real tool and stands down in plan mode', () => {
    const r = run({ superpowersRoot: cloneA }, undefined)
    // The tool is `ask_user_question` — a wrong name is a section that reads
    // fine and can never be acted on.
    assert.match(r.ask.text, /ask_user_question/, 'must name the actual tool')
    assert.match(r.ask.text, /multi_select/, 'checkboxes are the point of the nudge')
    // dsh's plan-mode section declares that its rules override later guidance
    // and forbids asking "should I proceed?" through prose OR the tool. A nudge
    // that did not stand down there would tell the model to break a live rule.
    assert.match(r.ask.text, /plan mode/, 'must defer to plan mode explicitly')
    assert.match(r.ask.text, /exit_plan_mode/, 'must point at the plan-mode route')
  })

  await test('SUPERPOWERS_ROOT is honoured when config is empty', () => {
    const r = run({}, cloneA)
    assert.equal(r.count, 1)
    assert.match(r.section.text, /BODY-A/)
  })

  await test('config BEATS the environment variable', () => {
    const r = run({ superpowersRoot: cloneA }, cloneB)
    assert.match(r.section.text, /BODY-A/, 'env overrode an explicit config')
  })

  await test('an empty config string falls through to the environment', () => {
    // '' is the schema default and must mean "resolve it", not "use cwd".
    const r = run({ superpowersRoot: '' }, cloneB)
    assert.match(r.section.text, /BODY-B/)
  })

  await test('the section is registered through ctx.effect', () => {
    // Registration must be an effect so it is torn down with the fiber; calling
    // section() directly would leak it across a plugin reload.
    let usedEffect = false
    const prev = process.env.SUPERPOWERS_ROOT
    delete process.env.SUPERPOWERS_ROOT
    apply(
      {
        effect: (fn) => {
          usedEffect = true
          return fn()
        },
        systemPrompt: { section: () => {} },
      },
      new Config({ superpowersRoot: cloneA }),
    )
    if (prev !== undefined) process.env.SUPERPOWERS_ROOT = prev
    assert.ok(usedEffect, 'section() was not registered inside ctx.effect')
  })

  // ── the skill provider half ──────────────────────────────────────────────
  // The catalog is the half that was silently missing on a fresh machine: a
  // link script cannot INSTALL one, because it presumes <agentsHome>/skills
  // exists and nothing in the harness creates it. A missing root surfaces as
  // an empty LIST rather than an error, so every failure here is invisible.

  await test('serves the resolved root as a skill provider', async () => {
    const r = run({ superpowersRoot: catalog }, undefined, { withSkills: true })
    assert.equal(r.threw, null)
    assert.ok(r.provider !== null, 'expected a registered provider')
    const c = await candidatesOf(r.provider)
    assert.deepEqual(c.map((x) => x.name), ['alpha-skill', 'beta-skill', 'using-superpowers'], 'sorted, both served')
  })

  await test('every candidate echoes the provider name', async () => {
    // validateCandidate THROWS when provider !== the provider's own name, and
    // a throwing provider is skipped WHOLESALE — one wrong field costs the
    // entire catalog, not one skill.
    const r = run({ superpowersRoot: catalog }, undefined, { withSkills: true })
    const c = await candidatesOf(r.provider)
    for (const cand of c) assert.equal(cand.provider, r.provider.name)
  })

  await test('resourceBase is the DIRECTORY, never the SKILL.md', async () => {
    // These skills ship .sh/.js/.ts/.cjs helpers beside the markdown, so
    // pointing at the file silently breaks every reference to them.
    const r = run({ superpowersRoot: catalog }, undefined, { withSkills: true })
    const c = await candidatesOf(r.provider)
    for (const cand of c) {
      assert.equal(cand.resourceBase.kind, 'directory')
      assert.ok(!cand.resourceBase.path.endsWith('SKILL.md'), 'resourceBase points at the file')
    }
  })

  await test('candidates carry the full registry contract', async () => {
    const r = run({ superpowersRoot: catalog }, undefined, { withSkills: true })
    const [cand] = await candidatesOf(r.provider)
    assert.match(cand.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'name must be kebab-case')
    assert.ok(typeof cand.description === 'string' && cand.description.length > 0)
    assert.equal(typeof cand.invocation.modelInvocable, 'boolean')
    assert.equal(typeof cand.invocation.userInvocable, 'boolean')
    assert.ok(Number.isFinite(cand.rank), 'rank must be a finite number')
    assert.ok(cand.locator !== undefined, 'get() is handed the locator back')
  })

  await test('get() returns a stripped body, re-read from disk', async () => {
    const r = run({ superpowersRoot: catalog }, undefined, { withSkills: true })
    const [cand] = await candidatesOf(r.provider)
    const full = await r.provider.get(cand, {})
    assert.match(full.content, /ALPHA BODY/)
    assert.ok(!full.content.startsWith('---'), 'frontmatter leaked into the skill body')
    assert.ok(!/description: first/.test(full.content), 'metadata leaked')
    assert.equal(full.resourceBase.kind, 'directory')
  })

  await test('one malformed bundle does not sink the others', async () => {
    // The real upstream defect recorded in dsh-skills was a description
    // containing ": ", which YAML reads as a nested mapping. A bad bundle must
    // be dropped, never allowed to throw the whole catalog away.
    const r = run({ superpowersRoot: mixed }, undefined, { withSkills: true })
    const c = await candidatesOf(r.provider)
    assert.deepEqual(c.map((x) => x.name), ['good-skill'], 'only the valid bundle survives')
    assert.ok(r.provider !== null, 'a malformed bundle must not unregister the provider')
  })

  await test('an unreadable catalog reports INCOMPLETE, not empty', async () => {
    // The registry caches complete results, so returning [] for a transient
    // read error would pin emptiness until invalidation.
    const r = run({ superpowersRoot: catalog }, undefined, { withSkills: true })
    r.provider.catalog = join(NOWHERE, 'definitely-not-here')
    const list = await r.provider.list({})
    assert.ok(!Array.isArray(list), 'an unreadable catalog must not return a plain array')
    assert.equal(list.complete, false, 'must report an incomplete observation')
    assert.deepEqual(list.candidates, [])
  })

  await test('_ and . prefixed directories stay out', async () => {
    const r = run({ superpowersRoot: hidden }, undefined, { withSkills: true })
    const c = await candidatesOf(r.provider)
    assert.deepEqual(c.map((x) => x.name), ['real-skill'])
  })

  await test('the catalog is sorted, not left in readdir order', async () => {
    // The disorder is INJECTED, not hoped for. NTFS returns readdir entries
    // already sorted, so no filesystem fixture can make this fail on Windows —
    // verified by sabotage, where deleting names.sort() escaped a fixture-based
    // version of this check. ext4 and APFS make no ordering guarantee, so the
    // sort is genuinely load-bearing and must be pinned somewhere.
    const r = run({ superpowersRoot: unsorted }, undefined, { withSkills: true })
    r.provider.readdir = async () => ([
      { name: 'zulu', isDirectory: () => true, isSymbolicLink: () => false },
      { name: 'mike', isDirectory: () => true, isSymbolicLink: () => false },
      { name: 'alfa', isDirectory: () => true, isSymbolicLink: () => false },
    ])
    const c = await candidatesOf(r.provider)
    assert.deepEqual(c.map((x) => x.name), ['alfa', 'mike', 'zulu'])
  })

  await test('the provider is registered through ctx.effect', () => {
    // Bypassing the effect leaks the provider across a plugin reload.
    let inEffect = false
    let registeredInsideEffect = false
    const prev = process.env.SUPERPOWERS_ROOT
    delete process.env.SUPERPOWERS_ROOT
    apply(
      {
        effect: (fn) => { inEffect = true; try { return fn() } finally { inEffect = false } },
        systemPrompt: { section: () => {} },
        get: (n) => n === 'skills'
          ? { registerProvider: () => { registeredInsideEffect = inEffect } }
          : undefined,
        logger: { warn: () => {} },
      },
      new Config({ superpowersRoot: catalog }),
    )
    if (prev !== undefined) process.env.SUPERPOWERS_ROOT = prev
    assert.ok(registeredInsideEffect, 'registerProvider() was not called inside ctx.effect')
  })

  await test('skillProvider:false opts out of just the catalog', () => {
    // The opt-out exists because link-superpowers-skills.mjs already junctions
    // these into <agentsHome>/skills; without it such a machine lists every
    // skill twice.
    const r = run({ superpowersRoot: catalog, skillProvider: false }, undefined, { withSkills: true })
    assert.equal(r.provider, null)
    assert.equal(r.count, 1, 'the bootstrap must be unaffected')
    assert.ok(r.ask !== null, 'the nudge must be unaffected')
  })

  await test('enabled:false silences the provider too', () => {
    const r = run({ superpowersRoot: catalog, enabled: false }, undefined, { withSkills: true })
    assert.equal(r.provider, null)
    assert.equal(r.all.length, 0)
  })

  await test('an ABSENT skills service is survived, not thrown on', () => {
    // A cordis context is a Proxy: an undeclared read THROWS rather than
    // yielding undefined, which is why the stub throws here instead of being a
    // plain object that cannot fail.
    const r = run({ superpowersRoot: catalog }, undefined, { withSkills: false })
    assert.equal(r.threw, null, 'a missing skills service must never take dsh down')
    assert.equal(r.provider, null)
    assert.equal(r.count, 1, 'the bootstrap section must still register')
    assert.ok(r.ask !== null, 'the nudge must still register')
  })

  await test('inject stays minimal so any profile still activates', () => {
    // systemPrompt is provided by dsh-base, so the plugin activates anywhere.
    // Declaring `skills` would park the WHOLE plugin in "waiting" on a profile
    // that lacks the service, taking the prompt half down with it.
    assert.deepEqual(inject, ['systemPrompt'])
    assert.ok(!inject.includes('skills'), 'skills must stay an optional read')
  })

  // ── the vendored snapshot ────────────────────────────────────────────────
  // The floor that makes a fresh install work. It must be reachable, and it
  // must LOSE to a real clone.

  await test('RESOLUTION falls back to the vendored snapshot', async () => {
    // This must exercise resolveRoot()'s fallback, NOT merely prove the vendor
    // directory has files in it. Passing superpowersRoot: VENDOR_ROOT does the
    // latter and looks identical — verified by sabotage: deleting the fallback
    // branch entirely left that version of this check GREEN.
    //
    // So: no config, no env, and HOME/USERPROFILE redirected at an empty
    // directory so the homedir()-relative probe cannot find a real clone. The
    // package's own AGENTS.md records that testing without that override
    // silently exercises the found path and proves nothing.
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
    process.env.HOME = NOWHERE
    process.env.USERPROFILE = NOWHERE
    try {
      const r = run({}, undefined, { withSkills: true })
      assert.equal(r.threw, null)
      assert.equal(r.warns.length, 0, 'the snapshot means a fresh machine has no reason to warn')
      assert.ok(r.provider !== null, 'expected the vendored catalog to be served')
      const c = await candidatesOf(r.provider)
      assert.ok(c.length >= 14, `expected the full vendored catalog, got ${c.length}`)
      assert.ok(c.some((x) => x.name === 'brainstorming'), 'brainstorming missing')
      assert.ok(c.some((x) => x.name === 'using-superpowers'), 'using-superpowers missing')
      // And the bootstrap half must be satisfied by the same snapshot.
      assert.equal(r.count, 1, 'the snapshot must carry a readable marker file')
      assert.ok(r.section.text.length > 500, 'suspiciously short bootstrap body')
      assert.ok(!r.section.text.startsWith('---'), 'frontmatter leaked')
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })

  await test('a real clone BEATS the vendored snapshot', async () => {
    // The snapshot is a floor, not a ceiling: `git pull` must keep working.
    const r = run({ superpowersRoot: catalog }, undefined, { withSkills: true })
    const c = await candidatesOf(r.provider)
    assert.deepEqual(c.map((x) => x.name), ['alpha-skill', 'beta-skill', 'using-superpowers'], 'snapshot shadowed the clone')
  })

  await test('SUPERPOWERS_ROOT also beats the vendored snapshot', async () => {
    const r = run({}, catalog, { withSkills: true })
    const c = await candidatesOf(r.provider)
    assert.deepEqual(c.map((x) => x.name), ['alpha-skill', 'beta-skill', 'using-superpowers'])
  })

  console.log(`\n${passed} superpowers checks passed`)
} finally {
  for (const dir of [NOWHERE, cloneA, cloneB, catalog, mixed, hidden]) {
    rmSync(dir, { recursive: true, force: true })
  }
}