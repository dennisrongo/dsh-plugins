/**
 * Smoke tests for dsh-skills.
 *
 * This package had NO tests, and that matters more than its ~300 lines suggest
 * because EVERY failure mode here is silent in a different way:
 *
 *   * The harness's `validateCandidate` THROWS on a malformed candidate, and a
 *     throwing provider is caught and skipped with a warning — so one wrong
 *     field degrades to an empty skill catalog, never a boot failure.
 *   * `enabled: false`, an unresolvable root, and a catalog directory that
 *     cannot be read all register nothing and let dsh boot happily.
 *   * The root `test` script runs `pnpm -r --if-present run test`, so a package
 *     with no test script contributes silently to a green run. That is exactly
 *     how this file came to be missing.
 *
 * So the checks below are mostly about what must NOT happen quietly. They run
 * offline against a temp catalog: no harness, no network, no real skills library.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Config, SkillsLibraryProvider, apply, inject, name } from '../lib/index.js'

let passed = 0
/**
 * Run one named check, sync or async.
 * @param {string} label - the behaviour being pinned.
 * @param {() => void | Promise<void>} fn - the assertions.
 */
async function test(label, fn) {
  await fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

/**
 * The provider identity every candidate must echo.
 *
 * Hardcoded rather than imported: the registry compares a candidate's
 * `provider` against the provider's own `name`, and importing the constant
 * would make a rename agree with itself. Pinning the literal is what catches a
 * rename that silently orphans every candidate.
 */
const PROVIDER = 'dennisrongo-skills'

/**
 * Build a throwaway library root containing a `skills/` catalog.
 * @param {Record<string, string>} bundles - directory name -> SKILL.md contents.
 * @returns the library root (the parent of `skills/`).
 */
function makeLibrary(bundles) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skills-'))
  const catalog = join(root, 'skills')
  mkdirSync(catalog, { recursive: true })
  for (const [dir, body] of Object.entries(bundles)) {
    mkdirSync(join(catalog, dir), { recursive: true })
    writeFileSync(join(catalog, dir, 'SKILL.md'), body, 'utf8')
  }
  return root
}

/** A well-formed SKILL.md. */
function skillFile(frontmatter, body) {
  return `---\n${frontmatter}\n---\n\n${body}\n`
}

/**
 * Drive apply() with a stub context, capturing what it registered and warned.
 *
 * `skills.registerProvider` takes a FACTORY, so the captured value is the
 * constructed provider — which is what the registry would go on to call.
 * @param config - plugin config.
 * @param env - value for DSH_SKILLS_ROOT, or undefined to unset it.
 */
function run(config, env) {
  const prev = process.env.DSH_SKILLS_ROOT
  if (env === undefined) delete process.env.DSH_SKILLS_ROOT
  else process.env.DSH_SKILLS_ROOT = env

  const warns = []
  const providers = []
  let usedEffect = false
  let threw = null
  try {
    apply(
      {
        logger: { warn: (m) => warns.push(String(m)) },
        effect: (fn) => {
          usedEffect = true
          return fn()
        },
        skills: {
          registerProvider: (factory) => {
            providers.push(factory({}))
          },
        },
      },
      new Config(config),
    )
  } catch (error) {
    threw = error
  } finally {
    if (prev === undefined) delete process.env.DSH_SKILLS_ROOT
    else process.env.DSH_SKILLS_ROOT = prev
  }
  return { providers, provider: providers[0] ?? null, warns, threw, usedEffect }
}

const NOWHERE = mkdtempSync(join(tmpdir(), 'dsh-skills-empty-'))

const libA = makeLibrary({
  'alpha-skill': skillFile('name: alpha-skill\ndescription: does alpha things', 'BODY-ALPHA'),
  'beta-skill': skillFile(
    'name: beta-skill\ndescription: does beta things\nwhenToUse: when beta',
    'BODY-BETA',
  ),
})

const libB = makeLibrary({
  'gamma-skill': skillFile('name: gamma-skill\ndescription: does gamma things', 'BODY-GAMMA'),
})

const cleanup = [NOWHERE, libA, libB]

try {
  // ── identity ──────────────────────────────────────────────────────────────

  await test('plugin identity is stable', () => {
    assert.equal(name, 'skills')
    // A changed inject array is how this plugin stops mounting at all.
    assert.deepEqual(inject, ['skills'])
  })

  // ── the provider contract the registry validates ──────────────────────────
  // validateCandidate throws on a malformed candidate and the registry then
  // skips the WHOLE provider with only a warning, so each field below is a
  // silent-empty-catalog bug if it drifts.

  await test('every candidate satisfies the registry contract', async () => {
    const { provider } = run({ skillsRoot: libA }, undefined)
    const candidates = await provider.list()
    assert.equal(candidates.length, 2, 'expected both skill bundles')

    for (const c of candidates) {
      assert.match(c.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `name "${c.name}" is not kebab-case`)
      assert.equal(typeof c.description, 'string')
      assert.ok(c.description.length > 0, 'description must be non-empty')
      assert.equal(typeof c.invocation, 'object')
      assert.equal(typeof c.invocation.modelInvocable, 'boolean')
      assert.equal(typeof c.invocation.userInvocable, 'boolean')
      assert.equal(typeof c.source, 'string')
      assert.ok(Number.isFinite(c.rank), 'rank must be a finite number')
      // The one field whose whole job is to equal the provider's own name.
      assert.equal(c.provider, PROVIDER, 'candidate.provider must echo the provider name')
      assert.equal(c.resourceBase.kind, 'directory')
      assert.equal(typeof c.resourceBase.path, 'string')
    }
  })

  await test('candidate.provider matches the provider instance name', async () => {
    // Pinned as a relationship, not two constants: the registry compares these
    // two values, so they must agree even if the identity is renamed.
    const { provider } = run({ skillsRoot: libA }, undefined)
    const candidates = await provider.list()
    for (const c of candidates) {
      assert.equal(c.provider, provider.name, 'a candidate orphaned from its provider is skipped')
    }
  })

  await test('resourceBase points at the skill DIRECTORY, not the SKILL.md file', async () => {
    // references/ and scripts/ resolve against resourceBase. Pointing it at the
    // file would make every relative resource in every skill silently missing.
    const { provider } = run({ skillsRoot: libA }, undefined)
    const [first] = await provider.list()
    assert.ok(!first.resourceBase.path.endsWith('SKILL.md'), 'resourceBase must be the directory')
    assert.match(first.resourceBase.path, /alpha-skill$/)
  })

  await test('whenToUse is carried when present and ABSENT when not', async () => {
    const { provider } = run({ skillsRoot: libA }, undefined)
    const candidates = await provider.list()
    const alpha = candidates.find((c) => c.name === 'alpha-skill')
    const beta = candidates.find((c) => c.name === 'beta-skill')
    assert.equal(beta.whenToUse, 'when beta')
    // An absent optional field must be an ABSENT KEY, not '' or undefined-valued.
    assert.ok(!('whenToUse' in alpha), 'omitted whenToUse must not appear as a key')
  })

  await test('candidates are returned in a stable sorted order', async () => {
    // readdir order is filesystem-dependent; an unsorted catalog makes rank
    // ties resolve differently per machine.
    const { provider } = run({ skillsRoot: libA }, undefined)
    const names = (await provider.list()).map((c) => c.name)
    assert.deepEqual(names, [...names].sort(), 'catalog order must be deterministic')
  })

  // ── get() ─────────────────────────────────────────────────────────────────

  await test('get() returns the body with frontmatter stripped', async () => {
    const { provider } = run({ skillsRoot: libA }, undefined)
    const [first] = await provider.list()
    const loaded = await provider.get(first)
    assert.match(loaded.content, /BODY-ALPHA/)
    assert.ok(!loaded.content.includes('---'), 'frontmatter leaked into the body')
    assert.ok(!/description:/.test(loaded.content), 'metadata leaked into the body')
    assert.equal(loaded.provider, PROVIDER)
  })

  await test('get() re-reads from disk so a clone edit lands without a restart', async () => {
    // The documented reason get() does not serve list()'s cached body.
    const root = makeLibrary({
      'edit-me': skillFile('name: edit-me\ndescription: original', 'ORIGINAL-BODY'),
    })
    cleanup.push(root)
    const { provider } = run({ skillsRoot: root }, undefined)
    const [candidate] = await provider.list()
    writeFileSync(
      join(root, 'skills', 'edit-me', 'SKILL.md'),
      skillFile('name: edit-me\ndescription: original', 'EDITED-BODY'),
      'utf8',
    )
    const loaded = await provider.get(candidate)
    assert.match(loaded.content, /EDITED-BODY/, 'get() served a stale cached body')
  })

  await test('get() yields undefined for a file that disappeared', async () => {
    const { provider } = run({ skillsRoot: libA }, undefined)
    const [candidate] = await provider.list()
    const missing = {
      ...candidate,
      locator: { path: join(NOWHERE, 'gone', 'SKILL.md'), directory: join(NOWHERE, 'gone') },
    }
    assert.equal(await provider.get(missing), undefined, 'a vanished file must not throw')
  })

  // ── malformed bundles are skipped, never fatal ─────────────────────────────
  // A throwing provider is skipped wholesale, so ONE bad bundle must not be
  // able to take the other skills down with it.

  await test('a bundle with no description is dropped, and the rest survive', async () => {
    const root = makeLibrary({
      'no-desc': skillFile('name: no-desc', 'BODY'),
      'good-skill': skillFile('name: good-skill\ndescription: fine', 'BODY'),
    })
    cleanup.push(root)
    // The provider logger is the ctx logger, so a skipped bundle must SAY so:
    // a dropped skill with no diagnostic is the silent failure this guards.
    const { provider, warns } = run({ skillsRoot: root }, undefined)
    const names = (await provider.list()).map((c) => c.name)
    assert.deepEqual(names, ['good-skill'], 'a descriptionless bundle must be dropped')
    assert.ok(
      warns.some((w) => /no-desc/.test(w) && /description/.test(w)),
      'dropping a bundle must warn naming the file and the reason',
    )
  })

  await test('a bundle whose name is not kebab-case is dropped', async () => {
    const root = makeLibrary({
      'Bad_Name': skillFile('name: Bad_Name\ndescription: invalid identity', 'BODY'),
      'good-skill': skillFile('name: good-skill\ndescription: fine', 'BODY'),
    })
    cleanup.push(root)
    const { provider } = run({ skillsRoot: root }, undefined)
    const names = (await provider.list()).map((c) => c.name)
    assert.deepEqual(names, ['good-skill'], 'an invalid name would make the registry throw')
  })

  await test('invalid YAML frontmatter is survived, not thrown', async () => {
    // The documented upstream defect: a description containing ": " parses as a
    // nested mapping and throws. The harness's own parser fails identically, so
    // this must degrade to a skipped skill rather than an empty catalog.
    const root = makeLibrary({
      'bad-yaml': '---\nname: bad-yaml\ndescription: a lens council: parallel agents\n---\n\nBODY\n',
      'good-skill': skillFile('name: good-skill\ndescription: fine', 'BODY'),
    })
    cleanup.push(root)
    const { provider } = run({ skillsRoot: root }, undefined)
    const candidates = await provider.list()
    const names = candidates.map((c) => c.name)
    assert.ok(names.includes('good-skill'), 'one bad bundle must not sink the catalog')
    assert.ok(!names.includes('bad-yaml'), 'unparseable frontmatter must be skipped')
  })

  await test('a directory with no SKILL.md is not a skill and not an error', async () => {
    const root = makeLibrary({ 'good-skill': skillFile('name: good-skill\ndescription: fine', 'B') })
    cleanup.push(root)
    mkdirSync(join(root, 'skills', 'not-a-skill'), { recursive: true })
    const { provider } = run({ skillsRoot: root }, undefined)
    const names = (await provider.list()).map((c) => c.name)
    assert.deepEqual(names, ['good-skill'])
  })

  await test('underscore- and dot-prefixed directories are ignored', async () => {
    const root = makeLibrary({
      '_template': skillFile('name: template\ndescription: scaffold', 'BODY'),
      '.hidden': skillFile('name: hidden\ndescription: hidden', 'BODY'),
      'good-skill': skillFile('name: good-skill\ndescription: fine', 'BODY'),
    })
    cleanup.push(root)
    const { provider } = run({ skillsRoot: root }, undefined)
    const names = (await provider.list()).map((c) => c.name)
    assert.deepEqual(names, ['good-skill'], 'scaffolding directories must stay out of the catalog')
  })

  // ── an unreadable catalog reports INCOMPLETE, never empty ──────────────────

  await test('an unreadable catalog returns complete:false rather than an empty list', async () => {
    // The registry CACHES complete results. Reporting a transient read failure
    // as a complete empty catalog would pin emptiness until invalidation.
    const provider = new SkillsLibraryProvider(join(NOWHERE, 'does-not-exist'), {
      warn: () => {},
    })
    const result = await provider.list()
    assert.ok(!Array.isArray(result), 'an unreadable catalog must not look like a complete list')
    assert.equal(result.complete, false, 'emptiness must be reported as an incomplete observation')
    assert.deepEqual(result.candidates, [])
  })

  // ── apply(): registration and the silent-failure guards ───────────────────

  await test('registration goes through ctx.effect', () => {
    // Registering outside the effect leaks the provider across a plugin reload.
    const r = run({ skillsRoot: libA }, undefined)
    assert.equal(r.threw, null)
    assert.ok(r.usedEffect, 'registerProvider() must be wrapped in ctx.effect')
    assert.equal(r.providers.length, 1, 'exactly one provider')
  })

  await test('enabled:false registers nothing, silently', () => {
    const r = run({ skillsRoot: libA, enabled: false }, undefined)
    assert.equal(r.providers.length, 0)
    assert.equal(r.threw, null)
    assert.equal(r.warns.length, 0, 'a deliberate opt-out must not warn')
  })

  await test('an explicit bad root is trusted, and fails as INCOMPLETE at list time', async () => {
    // An explicit skillsRoot is honoured verbatim — resolution does not verify
    // it, deliberately, so a typo'd path reaches the provider. That is only
    // safe because list() then reports `complete: false` instead of an empty
    // catalog: the registry caches complete results, so the wrong answer here
    // would pin emptiness for the whole process.
    const r = run({ skillsRoot: join(NOWHERE, 'not-a-library') }, undefined)
    assert.equal(r.threw, null, 'a missing library must never take dsh down')
    assert.equal(r.providers.length, 1, 'an explicit root is taken at its word')
    const result = await r.provider.list()
    assert.equal(result.complete, false, 'a bad root must not report a complete empty catalog')
    assert.deepEqual(result.candidates, [])
  })

  await test('empty config + no env resolves the bundled library, silently', () => {
    // The intended path: @dennisrongo/skills is this plugin's own dependency,
    // so an unconfigured profile still gets a catalog and says nothing.
    const r = run({ skillsRoot: '' }, undefined)
    assert.equal(r.threw, null, 'resolution must never throw')
    assert.equal(r.providers.length, 1, 'the bundled dependency must resolve')
    assert.equal(r.warns.length, 0, 'a successful resolution must not warn')
  })

  await test('the unresolved-library warning names every knob', () => {
    // This is asserted against the WARNING TEXT rather than by driving apply()
    // into the unresolved branch, because that branch is unreachable wherever
    // the library IS installed — which is every developer machine and CI, since
    // it is a hard dependency of this package. dsh-superpowers' AGENTS.md
    // records the same trap: a resolution test that does not force the miss
    // silently exercises the found path and proves nothing.
    //
    // A resolvable library is confirmed by the check above, so what remains
    // worth pinning is that the diagnostic still names all three knobs. An
    // unresolved library is a configuration gap, and a warning that does not
    // say which knob to set leaves a silently empty catalog with no way out.
    const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
    const warnCall = source.slice(source.indexOf('no skills library found'))
    assert.ok(warnCall.length > 0, 'the unresolved-library warning must exist')
    const body = warnCall.slice(0, 500)
    assert.match(body, /skillsRoot/, 'the warning must name the config knob')
    assert.match(body, /DSH_SKILLS_ROOT/, 'the warning must name the env knob')
    assert.match(body, /@dennisrongo\/skills|PACKAGE/, 'the warning must name the package')
  })

  await test('DSH_SKILLS_ROOT is honoured when config is empty', async () => {
    const r = run({ skillsRoot: '' }, libB)
    assert.equal(r.providers.length, 1)
    const names = (await r.provider.list()).map((c) => c.name)
    assert.deepEqual(names, ['gamma-skill'], 'the environment root was not used')
  })

  await test('config BEATS the environment variable', async () => {
    const r = run({ skillsRoot: libA }, libB)
    const names = (await r.provider.list()).map((c) => c.name)
    assert.ok(names.includes('alpha-skill'), 'env overrode an explicit config')
    assert.ok(!names.includes('gamma-skill'))
  })

  await test('Config defaults are the documented ones', () => {
    const c = new Config({})
    assert.equal(c.skillsRoot, '', 'empty means "resolve it", never cwd')
    assert.equal(c.enabled, true)
  })

  console.log(`\n${passed} skills checks passed`)
} finally {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true })
}
