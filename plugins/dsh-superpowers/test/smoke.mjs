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
import { Config, apply, inject, name } from '../lib/index.js'

let passed = 0
/** Run one named check. */
function test(label, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

/**
 * Drive apply() with a stub context, capturing sections and warnings.
 * @param config - plugin config.
 * @param env - value for SUPERPOWERS_ROOT, or undefined to unset it.
 * @returns the captured section, warnings, and any throw.
 */
function run(config, env) {
  const prev = process.env.SUPERPOWERS_ROOT
  if (env === undefined) delete process.env.SUPERPOWERS_ROOT
  else process.env.SUPERPOWERS_ROOT = env

  const warns = []
  const originalWarn = console.warn
  console.warn = (...args) => warns.push(args.join(' '))

  const sections = []
  let threw = null
  try {
    apply(
      { effect: (fn) => fn(), systemPrompt: { section: (s) => sections.push(s) } },
      new Config(config),
    )
  } catch (error) {
    threw = error
  } finally {
    console.warn = originalWarn
    if (prev === undefined) delete process.env.SUPERPOWERS_ROOT
    else process.env.SUPERPOWERS_ROOT = prev
  }
  return { section: sections[0] ?? null, count: sections.length, warns, threw }
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

try {
  test('plugin identity is stable', () => {
    assert.equal(name, 'superpowers')
    assert.deepEqual(inject, ['systemPrompt'])
  })

  test('registers a section from a real clone', () => {
    const r = run({ superpowersRoot: cloneA }, undefined)
    assert.equal(r.threw, null)
    assert.equal(r.count, 1, 'expected exactly one section')
    assert.equal(r.section.name, 'superpowers:using-superpowers')
    assert.match(r.section.text, /BODY-A/)
  })

  test('strips YAML frontmatter', () => {
    const r = run({ superpowersRoot: cloneA }, undefined)
    assert.ok(!r.section.text.startsWith('---'), 'frontmatter leaked into the prompt')
    assert.ok(!/description: test fixture/.test(r.section.text), 'metadata leaked')
  })

  test('default order sits before persona', () => {
    const r = run({ superpowersRoot: cloneA }, undefined)
    // persona is 0 and harness identity is -100; the bootstrap must land
    // between them or it stops being a mandatory-first instruction.
    assert.equal(r.section.order, -50)
    assert.ok(r.section.order < 0 && r.section.order > -100)
  })

  test('order is configurable', () => {
    const r = run({ superpowersRoot: cloneA, order: -77 }, undefined)
    assert.equal(r.section.order, -77)
  })

  test('enabled:false registers nothing and does not warn', () => {
    const r = run({ superpowersRoot: cloneA, enabled: false }, undefined)
    assert.equal(r.count, 0)
    assert.equal(r.threw, null)
    assert.equal(r.warns.length, 0, 'a deliberate opt-out must be silent')
  })

  test('a BAD root warns and registers nothing, never throws', () => {
    const r = run({ superpowersRoot: join(NOWHERE, 'not-here') }, undefined)
    assert.equal(r.threw, null, 'a missing clone must never take dsh down')
    assert.equal(r.count, 0)
    assert.ok(r.warns.length > 0, 'a silent miss is the whole failure mode')
    assert.match(r.warns[0], /dsh-superpowers/)
  })

  test('a directory without the marker is refused', () => {
    const r = run({ superpowersRoot: NOWHERE }, undefined)
    assert.equal(r.count, 0, 'a non-clone directory must not register')
    assert.ok(r.warns.length > 0)
  })

  test('SUPERPOWERS_ROOT is honoured when config is empty', () => {
    const r = run({}, cloneA)
    assert.equal(r.count, 1)
    assert.match(r.section.text, /BODY-A/)
  })

  test('config BEATS the environment variable', () => {
    const r = run({ superpowersRoot: cloneA }, cloneB)
    assert.match(r.section.text, /BODY-A/, 'env overrode an explicit config')
  })

  test('an empty config string falls through to the environment', () => {
    // '' is the schema default and must mean "resolve it", not "use cwd".
    const r = run({ superpowersRoot: '' }, cloneB)
    assert.match(r.section.text, /BODY-B/)
  })

  test('the section is registered through ctx.effect', () => {
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

  console.log(`\n${passed} superpowers checks passed`)
} finally {
  for (const dir of [NOWHERE, cloneA, cloneB]) {
    rmSync(dir, { recursive: true, force: true })
  }
}