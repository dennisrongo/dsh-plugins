/**
 * Smoke test for dsh-memory, run against the BUILT `lib/`.
 *
 * Two things are worth pinning here, and both need real files.
 *
 * The **append** is a text edit to a file the user probably wrote by hand and
 * probably has in version control, so what matters is what it does NOT do:
 * move anything, glue a heading onto prose, or start a second memories list.
 *
 * The **inspector** is only useful if it agrees with the loader, so it is
 * exercised through the real `@deepseek-ai/dsh-agent-instructions` discovery
 * against a fixture tree — including the budget case, where the interesting
 * assertion is that a discovered file is reported as NOT loaded.
 */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const lib = await import('../lib/index.js')
const {
  MemoryService,
  appendFact,
  inspect,
  readInstruction,
  targetFor,
  findProjectRoot,
  formatFact,
  parseScope,
  validateFact,
  MEMORY_HEADING,
  MEMORY_SCOPES,
  MAX_FACT_CHARS,
  DEFAULT_MAX_BYTES,
} = lib

let passed = 0
/**
 * Assert and count.
 * @param {string} what - the behaviour being pinned.
 * @param {() => void | Promise<void>} body - the assertions.
 */
async function test(what, body) {
  await body()
  passed += 1
  console.log(`  ok  ${what}`)
}

/**
 * Run a body against a fresh temp project with a `.git` marker.
 * @param {(root: string) => void | Promise<void>} body - the test body.
 */
async function inProject(body) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-mem-'))
  try {
    // `.git` is the loader's default project-root marker.
    mkdirSync(join(root, '.git'), { recursive: true })
    await body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// ── shape ──────────────────────────────────────────────────────────────────

await test('exports the documented surface', () => {
  assert.equal(typeof MemoryService, 'function')
  assert.equal(MemoryService.name, 'MemoryService')
  // Only the registry is required. `commands` is picked up through a child
  // fiber so a deployment without one still gets the endpoints.
  assert.deepEqual(MemoryService.inject, ['workspaceRegistry'])
  assert.equal(DEFAULT_MAX_BYTES, 65536, "must match the code preset's agent-instructions maxBytes")
  assert.deepEqual([...MEMORY_SCOPES], ['project', 'local', 'user'])
})

// ── parsing ────────────────────────────────────────────────────────────────

await test('parseScope reads a leading flag and keeps the rest verbatim', () => {
  assert.deepEqual(parseScope('the build needs pnpm 11'), { scope: 'project', rest: 'the build needs pnpm 11' })
  assert.deepEqual(parseScope('--user  I prefer tabs'), { scope: 'user', rest: 'I prefer tabs' })
  assert.deepEqual(parseScope('--local secret path'), { scope: 'local', rest: 'secret path' })
  // A flag-looking word that is not a scope stays part of the fact.
  assert.deepEqual(parseScope('--verbose is not a scope'), {
    scope: 'project',
    rest: '--verbose is not a scope',
  })
})

await test('validateFact refuses what should not become a line', () => {
  assert.equal(validateFact('a real fact').ok, true)
  assert.equal(validateFact('').ok, false)
  assert.equal(validateFact('   \n ').ok, false)
  assert.equal(validateFact(42).ok, false)
  assert.equal(validateFact('x'.repeat(MAX_FACT_CHARS + 1)).ok, false)
})

await test('formatFact collapses a multi-line fact onto one list item', () => {
  assert.equal(formatFact('  line one\n  line two  '), '- line one line two')
})

// ── write targets ──────────────────────────────────────────────────────────

await test('findProjectRoot walks up to the .git marker', async () => {
  await inProject((root) => {
    const nested = join(root, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    assert.equal(findProjectRoot(nested), root)
  })
})

await test('each scope resolves to its own file', async () => {
  await inProject((root) => {
    const nested = join(root, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    assert.equal(targetFor('project', nested), join(root, 'AGENTS.md'))
    assert.equal(targetFor('local', nested), join(root, 'AGENTS.local.md'))
    // user goes to $DSH_HOME, not the project.
    assert.ok(!targetFor('user', nested).startsWith(root))
    assert.ok(targetFor('user', nested).endsWith('AGENTS.md'))
  })
})

// ── appending ──────────────────────────────────────────────────────────────

await test('a missing file is created with the heading', async () => {
  await inProject((root) => {
    const path = join(root, 'AGENTS.md')
    appendFact(path, 'pnpm 11 ignores package.json pnpm blocks')
    assert.equal(
      readFileSync(path, 'utf8'),
      `${MEMORY_HEADING}\n\n- pnpm 11 ignores package.json pnpm blocks\n`,
    )
  })
})

await test('an existing file without the heading keeps everything above it', async () => {
  await inProject((root) => {
    const path = join(root, 'AGENTS.md')
    writeFileSync(path, '# Project\n\nSome hand-written guidance.\n')
    appendFact(path, 'first fact')
    const text = readFileSync(path, 'utf8')
    assert.ok(text.startsWith('# Project\n\nSome hand-written guidance.\n'), 'nothing was moved')
    assert.ok(text.includes(`${MEMORY_HEADING}\n\n- first fact`))
    assert.ok(!text.includes('guidance.\n## Memories'), 'the heading is not glued to the prose')
  })
})

await test('a second fact joins the existing list instead of starting a new one', async () => {
  await inProject((root) => {
    const path = join(root, 'AGENTS.md')
    appendFact(path, 'first')
    appendFact(path, 'second')
    appendFact(path, 'third')
    const text = readFileSync(path, 'utf8')
    assert.equal(text.match(new RegExp(MEMORY_HEADING, 'g')).length, 1, 'exactly one memories heading')
    const items = text.split('\n').filter((line) => line.startsWith('- '))
    assert.deepEqual(items, ['- first', '- second', '- third'], 'in order, with no gaps between them')
  })
})

await test('a fact lands inside the memories section, not after a later heading', async () => {
  await inProject((root) => {
    const path = join(root, 'AGENTS.md')
    writeFileSync(path, `# Project\n\n${MEMORY_HEADING}\n\n- existing\n\n## Conventions\n\nUse tabs.\n`)
    appendFact(path, 'new fact')
    const lines = readFileSync(path, 'utf8').split('\n')
    const memAt = lines.indexOf(MEMORY_HEADING)
    const convAt = lines.indexOf('## Conventions')
    const factAt = lines.indexOf('- new fact')
    assert.ok(memAt < factAt && factAt < convAt, 'the fact is inside its own section')
    assert.equal(lines[lines.indexOf('- existing') + 1], '- new fact', 'appended to the end of the list')
    assert.ok(readFileSync(path, 'utf8').includes('## Conventions\n\nUse tabs.\n'), 'later sections intact')
  })
})

// ── the inspector, through the loader's own discovery ──────────────────────

await test('inspect reports the real hierarchy in precedence order', async () => {
  await inProject(async (root) => {
    const nested = join(root, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, 'AGENTS.md'), '# Root rules\n')
    writeFileSync(join(nested, 'AGENTS.md'), '# App rules\n')

    const report = await inspect(nested, DEFAULT_MAX_BYTES)
    const paths = report.files.map((file) => file.displayPath)
    assert.ok(paths.length >= 2, `expected the two project files, got ${JSON.stringify(paths)}`)
    // Broadest first: the root file precedes the nested one.
    const rootAt = paths.findIndex((p) => p === 'AGENTS.md')
    const nestedAt = paths.findIndex((p) => p.includes('app'))
    assert.ok(rootAt !== -1 && nestedAt !== -1 && rootAt < nestedAt, `order was ${JSON.stringify(paths)}`)
    assert.ok(report.files.every((file) => file.included), 'nothing is dropped at the full budget')
    assert.ok(report.discoveredBytes > 0)
    assert.equal(report.maxBytes, DEFAULT_MAX_BYTES)
  })
})

await test('CLAUDE.md is discovered alongside AGENTS.md', async () => {
  await inProject(async (root) => {
    writeFileSync(join(root, 'CLAUDE.md'), '# Claude rules\n')
    const report = await inspect(root, DEFAULT_MAX_BYTES)
    assert.ok(
      report.files.some((file) => file.displayPath.endsWith('CLAUDE.md')),
      'the loader treats CLAUDE.md as an instruction candidate',
    )
  })
})

await test('a file the budget drops is reported as discovered but not loaded', async () => {
  await inProject(async (root) => {
    const nested = join(root, 'deep')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, 'AGENTS.md'), `# Root\n\n${'root filler. '.repeat(400)}\n`)
    writeFileSync(join(nested, 'AGENTS.md'), `# Deep\n\n${'deep filler. '.repeat(400)}\n`)

    // A budget far below the combined size forces the loader to drop the
    // broader file and cut the more specific one — precedence keeps the file
    // nearest the cwd.
    const report = await inspect(nested, 512)
    assert.equal(report.maxBytes, 512)
    assert.equal(report.files.length, 2, 'both files are still DISCOVERED')

    const rootRow = report.files.find((file) => file.displayPath === 'AGENTS.md')
    const deepRow = report.files.find((file) => file.displayPath !== 'AGENTS.md')
    assert.equal(rootRow.included, false, 'the broader file is dropped for budget')
    assert.equal(rootRow.bytes > 0, true, 'and is still reported with its real size')
    assert.equal(deepRow.included, true, 'the most specific file survives')
    assert.ok(
      deepRow.truncatedTo > 0 && deepRow.truncatedTo < deepRow.bytes,
      `the surviving file is reported as cut short (${deepRow.truncatedTo} of ${deepRow.bytes})`,
    )
  })
})

await test('read only serves a file the loader discovered', async () => {
  await inProject(async (root) => {
    writeFileSync(join(root, 'AGENTS.md'), '# Root rules\n')
    writeFileSync(join(root, 'secrets.env'), 'TOKEN=hunter2')

    assert.equal(await readInstruction(root, join(root, 'AGENTS.md')), '# Root rules\n')
    // The boundary that stops this being a read-any-file endpoint.
    assert.equal(await readInstruction(root, join(root, 'secrets.env')), undefined)
    assert.equal(await readInstruction(root, join(root, '..', 'anything.md')), undefined)
    assert.equal(await readInstruction(root, ''), undefined)
    assert.equal(await readInstruction(root, 42), undefined)
  })
})

console.log(`\n${passed} checks passed`)
