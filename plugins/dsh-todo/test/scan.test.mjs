/**
 * Workspace scanner: what reaches the model, and what must not.
 *
 * Builds a real temp workspace rather than mocking fs — the caps and the
 * ignore rules are the whole point, and a mock would only prove the code
 * agrees with the mock.
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
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

/**
 * Report a test as skipped WITHOUT counting it green.
 *
 * Used only where the environment, not the code, decides whether the case can
 * run at all — creating a symlink can require a privilege this machine may not
 * grant. A silent pass would be worse than no test.
 *
 * @param {string} name @param {string} why
 */
function skip(name, why) {
  console.log('  SKIP ' + name + ' — ' + why)
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

// --- Cap disclosure -------------------------------------------------------
//
// Five caps can drop evidence, and only ONE of them (the digest byte ceiling)
// was covered before. The four below each dropped evidence while the digest
// asserted nothing was lost — the exact failure the spec's "truncation must be
// MARKED, never silent" rule exists to prevent. Each test therefore asserts
// BOTH halves: that the cap bound, and that the digest DISCLOSED it. Asserting
// only the cap is what let this ship.

test('the comment cap is disclosed in the section header and the flag', () => {
  const out = withWorkspace((root) => {
    // Comfortably over MAX_COMMENTS (80) with one comment per file, so the cap
    // binds on comments alone and not on any other section.
    for (let i = 0; i < 200; i += 1) {
      writeFileSync(join(root, `c${i}.ts`), `// TODO: item number ${i}\n`)
    }
  })
  const header = out.digest.split('\n').find((l) => l.startsWith('### Unresolved comments'))
  assert.ok(header !== undefined, 'the comments section must be present')
  // The TRUE total, not merely the kept count: a reader must be able to see how
  // much is missing, which "showing 80" alone does not say.
  assert.ok(/200 found/.test(header), `header did not report the true total: ${header}`)
  assert.ok(/showing 80/.test(header), `header did not report the kept count: ${header}`)
  assert.equal(out.truncated, true, 'a capped section must set the truncated flag')
})

test('the untested-module cap is disclosed in the section header and the flag', () => {
  const out = withWorkspace((root) => {
    mkdirSync(join(root, 'src'), { recursive: true })
    // Over MAX_UNTESTED (40). Distinct stems, none matching the index/main/
    // types/constants exclusion, and no test files anywhere.
    for (let i = 0; i < 120; i += 1) {
      writeFileSync(join(root, 'src', `mod${i}.ts`), 'export const x = 1\n')
    }
  })
  const header = out.digest.split('\n').find((l) => l.startsWith('### Untested modules'))
  assert.ok(header !== undefined, 'the untested section must be present')
  assert.ok(/120 found/.test(header), `header did not report the true total: ${header}`)
  assert.ok(/showing 40/.test(header), `header did not report the kept count: ${header}`)
  assert.equal(out.truncated, true, 'a capped section must set the truncated flag')
})

test('exceeding the walk depth is marked in the digest TEXT, not just the flag', () => {
  const out = withWorkspace((root) => {
    // MAX_DEPTH is 8; go well past it so the depth guard, not the file count,
    // is what trips.
    let dir = root
    for (let i = 0; i < 12; i += 1) {
      dir = join(dir, `d${i}`)
      mkdirSync(dir)
    }
    writeFileSync(join(dir, 'deep.ts'), '// TODO: too deep to see\n')
    writeFileSync(join(root, 'shallow.ts'), '// TODO: visible\n')
  })
  assert.equal(out.truncated, true, 'exceeding MAX_DEPTH must set the flag')
  // The flag alone is invisible to a model reading the digest. The text must
  // say so itself; relying on a later caller to read the flag is what made this
  // silent in the first place.
  assert.ok(
    /truncat/i.test(out.digest),
    'depth truncation must be marked in the digest text, not only in the flag',
  )
})

test('exceeding the walked-file cap is marked in the digest TEXT, not just the flag', () => {
  const out = withWorkspace((root) => {
    // MAX_FILES_WALKED is 4000. Spread across directories so no single readdir
    // is pathological, and stay under MAX_DEPTH so DEPTH is not what trips.
    for (let d = 0; d < 42; d += 1) {
      const dir = join(root, `p${d}`)
      mkdirSync(dir)
      for (let i = 0; i < 100; i += 1) writeFileSync(join(dir, `f${i}.ts`), 'export const x = 1\n')
    }
  })
  assert.equal(out.truncated, true, 'exceeding MAX_FILES_WALKED must set the flag')
  assert.ok(
    /truncat/i.test(out.digest),
    'walk truncation must be marked in the digest text, not only in the flag',
  )
})

// --- Bounded work ---------------------------------------------------------

test('an implausibly large source file is skipped rather than read whole', () => {
  const out = withWorkspace((root) => {
    // Over MAX_READ_BYTES. A checked-in bundle or dataset under a source
    // extension must not become a whole-file allocation on a button click.
    const filler = 'x'.repeat(1024)
    writeFileSync(join(root, 'huge.js'), '// TODO: HUGE-FILE-LEAK\n' + filler.repeat(2200))
    writeFileSync(join(root, 'small.ts'), '// TODO: still scanned\n')
  })
  assert.ok(!out.digest.includes('HUGE-FILE-LEAK'), 'an oversized file must not be read')
  assert.ok(out.digest.includes('still scanned'), 'ordinary files must still be scanned')
})

// --- Ignore list ----------------------------------------------------------

test('common vendored and generated roots are never walked', () => {
  const dirs = ['third_party', 'vendored', 'Pods', 'bower_components', 'generated']
  const out = withWorkspace((root) => {
    for (const dir of dirs) {
      mkdirSync(join(root, dir), { recursive: true })
      writeFileSync(join(root, dir, 'v.js'), `// TODO: LEAK-FROM-${dir}\n`)
    }
    writeFileSync(join(root, 'own.ts'), '// TODO: my own work\n')
  })
  for (const dir of dirs) {
    assert.ok(!out.digest.includes(`LEAK-FROM-${dir}`), `${dir} reached the digest`)
  }
  assert.ok(out.digest.includes('my own work'), 'first-party files must still be scanned')
})

// --- Symlink immunity -----------------------------------------------------

test('a symlink pointing at its own ancestor does not loop the walk', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshtd-scan-'))
  try {
    const inner = join(root, 'a', 'b')
    mkdirSync(inner, { recursive: true })
    writeFileSync(join(root, 'a', 'real.ts'), '// TODO: reached\n')
    try {
      // 'junction' works on Windows without elevation; it is ignored elsewhere.
      symlinkSync(root, join(inner, 'loop'), 'junction')
    } catch (error) {
      skip('a symlink pointing at its own ancestor does not loop the walk',
        'cannot create a symlink here: ' + error.code)
      return
    }
    // The assertion is TERMINATION. buildDigest returning at all is the result;
    // a regression here hangs or blows the stack rather than failing an assert.
    const out = buildDigest(root)
    assert.ok(out.digest.includes('reached'), 'the real file must still be found')
    assert.ok(
      !/loop[/\\]a[/\\]b[/\\]loop/.test(out.digest),
      'the walk must not descend through the link repeatedly',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

process.exitCode = failures === 0 ? 0 : 1
console.log(failures === 0 ? 'scan: all passed' : `scan: ${failures} failed`)
