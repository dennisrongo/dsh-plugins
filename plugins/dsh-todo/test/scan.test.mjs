/**
 * Workspace scanner: what reaches the model, and what must not.
 *
 * Builds a real temp workspace rather than mocking fs — the caps and the
 * ignore rules are the whole point, and a mock would only prove the code
 * agrees with the mock.
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDigest, DIGEST_BYTE_CAP } from '../lib/scan.js'

let failures = 0
/** @param {string} name @param {() => void} fn */
function test(name, fn) {
  try {
    fn()
    console.log('  ok  ' + name)
  } catch (error) {
    failures += 1
    console.error('  FAIL ' + name + '\n    ' + error.message)
  }
}

/** @param {(root: string) => void} setup */
function withWorkspace(setup) {
  const root = mkdtempSync(join(tmpdir(), 'dshtd-scan-'))
  try {
    setup(root)
    return buildDigest(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a TODO comment reaches the digest with its file and line', () => {
  const out = withWorkspace((root) => {
    writeFileSync(join(root, 'a.ts'), 'const x = 1\n// TODO: wire up retries\n')
  })
  assert.ok(out.digest.includes('wire up retries'))
  assert.ok(out.digest.includes('a.ts:2'))
})

test('FIXME and HACK are found too', () => {
  const out = withWorkspace((root) => {
    writeFileSync(join(root, 'b.ts'), '// FIXME: leaks\n// HACK: works by luck\n')
  })
  assert.ok(out.digest.includes('leaks'))
  assert.ok(out.digest.includes('works by luck'))
})

test('the README is included', () => {
  const out = withWorkspace((root) => {
    writeFileSync(join(root, 'README.md'), '# Project\nPromises a CSV export.\n')
  })
  assert.ok(out.digest.includes('Promises a CSV export'))
})

test('node_modules is never walked', () => {
  const out = withWorkspace((root) => {
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'pkg', 'i.js'), '// TODO: SHOULD-NOT-APPEAR\n')
  })
  assert.ok(!out.digest.includes('SHOULD-NOT-APPEAR'))
})

test('.git and build output are never walked', () => {
  const out = withWorkspace((root) => {
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, '.git', 'c.js'), '// TODO: GIT-LEAK\n')
    mkdirSync(join(root, 'lib'), { recursive: true })
    writeFileSync(join(root, 'lib', 'd.js'), '// TODO: BUILD-LEAK\n')
  })
  assert.ok(!out.digest.includes('GIT-LEAK'))
  assert.ok(!out.digest.includes('BUILD-LEAK'))
})

test('a source file with no test is reported as an untested module', () => {
  const out = withWorkspace((root) => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'lonely.ts'), 'export const x = 1\n')
  })
  assert.ok(/lonely/.test(out.digest))
})

test('a source file WITH a test is not reported as untested', () => {
  const out = withWorkspace((root) => {
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'test'), { recursive: true })
    writeFileSync(join(root, 'src', 'covered.ts'), 'export const x = 1\n')
    writeFileSync(join(root, 'test', 'covered.test.mjs'), 'covered\n')
  })
  const section = out.digest.slice(out.digest.indexOf('Untested'))
  assert.ok(!section.includes('covered.ts'))
})

test('the digest respects its byte cap and says so', () => {
  const out = withWorkspace((root) => {
    // Long NAMES, not merely many files. Every section is independently capped
    // (300 tree entries, 80 comments, each comment body clipped to 160 chars),
    // so file COUNT alone asymptotes around 17KB and can never reach the 24KB
    // ceiling — verified by measurement: 400 and 3000 short-named files both
    // yield an untruncated digest. Per-entry length is the only lever that
    // reaches the cap, so the padding lives in the filename.
    for (let i = 0; i < 400; i += 1) {
      const name = `f${i}`.padEnd(90, 'n')
      writeFileSync(join(root, `${name}.ts`), `// TODO: item number ${i} padded ${'x'.repeat(200)}\n`)
    }
  })
  assert.ok(out.digest.length <= DIGEST_BYTE_CAP, `digest was ${out.digest.length}`)
  assert.equal(out.truncated, true)
  assert.ok(/truncat/i.test(out.digest), 'truncation must be marked, not silent')
})

test('a small workspace is not marked truncated', () => {
  const out = withWorkspace((root) => {
    writeFileSync(join(root, 'a.ts'), '// TODO: one thing\n')
  })
  assert.equal(out.truncated, false)
})

test('a missing directory yields an empty digest rather than throwing', () => {
  const out = buildDigest(join(tmpdir(), 'dshtd-does-not-exist-' + Date.now()))
  assert.equal(typeof out.digest, 'string')
  assert.equal(out.truncated, false)
})

test('a binary file does not corrupt the digest', () => {
  const out = withWorkspace((root) => {
    writeFileSync(join(root, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
    // A .png is filtered out by extension and never opened, so it alone cannot
    // exercise the NUL guard — deleting that guard leaves this test green.
    // Binary content under a SOURCE extension is what actually reaches
    // readText (a compiled artefact, a fixture, an accidental commit), and is
    // the case the guard exists for.
    writeFileSync(join(root, 'bin.js'), Buffer.from([0x2f, 0x2f, 0x20, 0x54, 0x4f, 0x44, 0x4f, 0x3a, 0x20, 0x00, 0x01, 0x0a]))
    writeFileSync(join(root, 'a.ts'), '// TODO: still found\n')
  })
  assert.ok(out.digest.includes('still found'))
  assert.ok(!out.digest.includes('\u0000'))
})

process.exitCode = failures === 0 ? 0 : 1
console.log(failures === 0 ? 'scan: all passed' : `scan: ${failures} failed`)
