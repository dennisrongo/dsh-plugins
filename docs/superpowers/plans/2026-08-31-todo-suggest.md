# Todo Suggest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Suggest** button to the Todo tab that scans the workspace and proposes new tasks in a modal, where the user checks the ones to add.

**Architecture:** A scan is a **background harness session** that writes a JSON file the modal polls. The host builds a bounded evidence digest and reads the result back; the client creates a session, prompts it, never navigates to it, and archives it when done. No undocumented harness internals are used — see the spec's "Why not a direct model call".

**Tech Stack:** TypeScript, esbuild, React 18 (via shell externals), zod (strict Typert codecs), `node:sqlite`, Node 22+.

**Spec:** `docs/superpowers/specs/2026-08-31-todo-suggest-design.md`

## Global Constraints

Copied verbatim from the spec and the package's `AGENTS.md`. **Every task's requirements implicitly include this section.**

- **Node 22+** (`node:sqlite`). CLI stdout stays pure JSON under `--json`.
- **Host half: `minify: false`, `target: es2021`.** The gateway reads `@Remote` parameter names off `Function.prototype.toString()`; minifying silently changes the wire contract.
- **Every wire field must be named in `src/remote.ts`.** Strict codecs **strip fields they do not name**, and it fails silently.
- **A new host method needs `wire: 'request'` and exactly one parameter named `request`.**
- **Client CSS classes are namespaced `dshtd-`.** Custom properties use `--td-`.
- **Type scale: 11 / 12 / 13 / 14 / 16 / 20 / 24 px** repo-wide, but **this package allows only 12 / 14 / 16 / 20** (`test/icon-probe.mjs`). Literal px only — never `font: var(--dsw-font-*)`, never `calc()` on a font size.
- **Every `var(--dsw-*)` must name a real token.** A misspelt one never errors; it silently stops following the theme. `node scripts/check-tokens.mjs` enforces this.
- **Rows are 40px and the icon probe fails if they grow.**
- **Never gate a palette on `prefers-color-scheme`** for app colours. (The `<select>`/date-input `color-scheme` rule is the one deliberate exception already in the file.)
- **Modals portal to `document.body`** via `createPortal`; backdrop z-index **2147483100**, deliberately below Desktop's drag region (2147483644), clearing the 36px strip with top padding.
- **Loading is its own flag**, never inferred from an empty collection. Skeleton geometry copies real content; the sweep animates `background-position`; `prefers-reduced-motion` flattens it; root is `role="status"`, decorative bars `aria-hidden`.
- **Guarded service reads only.** `ctx.get(name)` first, bare read as fallback (`probeNamespaced`). A dotted name resolves **only** as `ctx['remote.foo']`. `ctx.remote?.foo` **throws** — never write it. A service that resolves may still throw on call: wrap a borrowed handle **once at the boundary**.
- **Build before test.** `pnpm test` runs `node build/build.mjs` first; both suites read built `lib/`.
- Commits use `feat:` / `fix:` / `docs:` / `chore:` prefixes. JSDoc on exported functions explaining *why*.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/scan.ts` | **Create.** Pure digest building: walk, filter, cap, format. Dependency-free apart from `node:fs`/`node:path` so it tests under plain Node. |
| `src/suggest.ts` | **Create.** Pure suggestion vocabulary: types, prompt composition, JSON parsing/validation. Dependency-free (imports `./types.ts` only), mirroring `src/launch.ts`. |
| `src/types.ts` | **Modify.** Add `Suggestion` and the suggestion-file constants. |
| `src/index.ts` | **Modify.** Two new `@Remote` methods: `scanDigest`, `readSuggestions`. |
| `src/remote.ts` | **Modify.** Strict zod descriptors for both new methods. |
| `src/client.tsx` | **Modify.** `SuggestDialog`, its skeleton, the header button, and the scan lifecycle. |
| `build/build.mjs` | **Modify.** Emit `lib/scan.js` and `lib/suggest.js` for the tests. |
| `test/scan.test.mjs` | **Create.** Digest caps, ignores, truncation marking. |
| `test/suggest.test.mjs` | **Create.** Prompt composition, JSON parsing, malformed-input handling. |
| `test/smoke.mjs` | **Modify.** Marker strings and the single-write-path assertion. |
| `test/context-probe.mjs` | **Modify.** Button hidden and non-throwing without `sessions`. |
| `plugins/dsh-todo/AGENTS.md` | **Modify.** Document the feature and its traps. |

Task order follows the dependency chain: pure logic first (testable with no harness), then the host wire, then the client. Tasks 1–3 are independently useful and reviewable; Task 4 is the first point the feature is visible.

---

### Task 1: Suggestion vocabulary and result parsing

**Files:**
- Create: `plugins/dsh-todo/src/suggest.ts`
- Modify: `plugins/dsh-todo/src/types.ts` (append; do not reorder existing exports)
- Modify: `plugins/dsh-todo/build/build.mjs:136` (add a build step after the `launch.ts` one)
- Test: `plugins/dsh-todo/test/suggest.test.mjs`

**Interfaces:**
- Consumes: `TodoItem`, `TodoPriority`, `DEFAULT_PRIORITY` from `./types.ts`.
- Produces:
  - `interface Suggestion { title: string; rationale: string; priority: TodoPriority; evidence?: string }`
  - `SUGGESTIONS_FILE = '.dsh/suggestions.json'` (constant, in `types.ts`)
  - `MAX_SUGGESTIONS = 12` (constant, in `types.ts`)
  - `composeScanPrompt(digest: string, excludeTitles: readonly string[]): string`
  - `parseSuggestions(raw: string): { ok: true; suggestions: Suggestion[] } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing test**

Create `plugins/dsh-todo/test/suggest.test.mjs`:

```javascript
/**
 * Suggestion vocabulary: prompt composition and result parsing.
 *
 * Reads the BUILT lib/suggest.js, matching how launch.js is tested — the
 * client bundle inlines the same source but minified, so asserting against
 * that would mean matching renamed identifiers.
 */
import { strict as assert } from 'node:assert'
import { composeScanPrompt, parseSuggestions } from '../lib/suggest.js'

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

test('the prompt carries the digest verbatim', () => {
  const prompt = composeScanPrompt('DIGEST-MARKER', [])
  assert.ok(prompt.includes('DIGEST-MARKER'))
})

test('existing titles are listed as exclusions', () => {
  const prompt = composeScanPrompt('d', ['Fix token refresh', 'Add dark mode'])
  assert.ok(prompt.includes('Fix token refresh'))
  assert.ok(prompt.includes('Add dark mode'))
})

test('an empty exclusion list does not emit an empty heading', () => {
  // An empty "Already planned:" section teaches the model the field is
  // meaningless, exactly as composePrompt() avoids an empty "Priority: —".
  const prompt = composeScanPrompt('d', [])
  assert.ok(!/already planned/i.test(prompt))
})

test('the prompt names the output path and demands JSON only', () => {
  const prompt = composeScanPrompt('d', [])
  assert.ok(prompt.includes('.dsh/suggestions.json'))
  assert.ok(/json/i.test(prompt))
})

test('a well-formed array parses', () => {
  const raw = JSON.stringify([
    { title: 'Add retry', rationale: 'Network calls are unguarded', priority: 'p1', evidence: 'src/a.ts:12' },
  ])
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions.length, 1)
  assert.equal(out.suggestions[0].evidence, 'src/a.ts:12')
})

test('an object wrapper with a suggestions key parses too', () => {
  // Models commonly wrap an array in an object however firmly they are told
  // not to. Accepting both is cheaper than a retry round-trip.
  const raw = JSON.stringify({ suggestions: [{ title: 'T', rationale: 'R', priority: 'p2' }] })
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions.length, 1)
})

test('a fenced code block is unwrapped', () => {
  const raw = '```json\n[{"title":"T","rationale":"R","priority":"p2"}]\n```'
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
})

test('malformed JSON reports an error rather than throwing', () => {
  const out = parseSuggestions('not json at all')
  assert.equal(out.ok, false)
  assert.ok(out.error.length > 0)
})

test('an unknown priority falls back to the default', () => {
  const raw = JSON.stringify([{ title: 'T', rationale: 'R', priority: 'urgent' }])
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions[0].priority, 'p2')
})

test('an entry with no title is dropped, not defaulted', () => {
  // A titleless suggestion has nothing to show in a row; inventing one would
  // put a blank task in the backlog.
  const raw = JSON.stringify([
    { rationale: 'R', priority: 'p2' },
    { title: 'Keeps', rationale: 'R', priority: 'p2' },
  ])
  const out = parseSuggestions(raw)
  assert.equal(out.suggestions.length, 1)
  assert.equal(out.suggestions[0].title, 'Keeps')
})

test('the list is capped', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ title: 't' + i, rationale: 'r', priority: 'p2' }))
  const out = parseSuggestions(JSON.stringify(many))
  assert.equal(out.suggestions.length, 12)
})

process.exitCode = failures === 0 ? 0 : 1
console.log(failures === 0 ? 'suggest: all passed' : `suggest: ${failures} failed`)
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd plugins/dsh-todo && node test/suggest.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `../lib/suggest.js`. That is the correct first failure — the module does not exist yet.

- [ ] **Step 3: Add the shared vocabulary to `src/types.ts`**

Append to `plugins/dsh-todo/src/types.ts`:

```typescript
/**
 * Where a scan session leaves its result, relative to the workspace root.
 *
 * A FILE rather than a return value because `session.prompt()` resolves when
 * the prompt is ACCEPTED, not when the work is done — there is no public
 * completion promise to await. A file is inspectable when a scan misbehaves
 * and survives the modal being closed mid-scan.
 */
export const SUGGESTIONS_FILE = '.dsh/suggestions.json'

/**
 * The most suggestions worth showing at once.
 *
 * A cap rather than a scroll: this is a list someone triages in one sitting,
 * and a model asked for "ideas" will happily produce fifty.
 */
export const MAX_SUGGESTIONS = 12

/** One proposed task, before anyone decides to keep it. */
export interface Suggestion {
  title: string
  /** One line on why this is worth doing — shown under the title. */
  rationale: string
  priority: TodoPriority
  /**
   * A `file:line` pointer backing the claim, when one exists. Absent is legal
   * — a missing feature has no line number — but this is what makes a
   * suggestion checkable rather than merely plausible.
   */
  evidence?: string
}
```

- [ ] **Step 4: Write `src/suggest.ts`**

Create `plugins/dsh-todo/src/suggest.ts`:

```typescript
/**
 * dsh-todo — the suggestion vocabulary.
 *
 * Deliberately dependency-free (it imports `./types.ts` and nothing else), so
 * `lib/suggest.js` can be imported by the test under plain Node with no React
 * and no harness packages on the import path. Same constraint as `launch.ts`,
 * for the same reason.
 */
import {
  DEFAULT_PRIORITY,
  MAX_SUGGESTIONS,
  PRIORITIES,
  SUGGESTIONS_FILE,
  type Suggestion,
  type TodoPriority,
} from './types.ts'

/**
 * Compose the brief a scan session works from.
 *
 * The exclusion list is titles ONLY. Descriptions would multiply the token
 * cost of every scan to restate work the model is being asked to avoid, and a
 * title is enough to recognise a duplicate.
 *
 * @param digest - the bounded workspace evidence from `buildDigest`.
 * @param excludeTitles - titles already in the backlog, plus anything already
 *   shown this session so Refresh returns genuinely new ideas.
 * @returns the prompt text for the scan session.
 */
export function composeScanPrompt(digest: string, excludeTitles: readonly string[]): string {
  const parts: string[] = [
    '# Propose work for this codebase',
    'You are reviewing a workspace to propose concrete next tasks. Base every ' +
      'suggestion on the evidence below — do not speculate about code you cannot see.',
    'Look for: unresolved TODO/FIXME/HACK comments, features the docs promise ' +
      'but the code does not implement, and modules with no tests.',
    '## Evidence',
    digest,
  ]

  // Only when there IS something to exclude. An empty "Already planned:"
  // heading teaches the model the field is meaningless — the same reasoning
  // that keeps composePrompt() from emitting "Priority: —".
  const exclusions = excludeTitles.map((t) => t.trim()).filter((t) => t.length > 0)
  if (exclusions.length > 0) {
    parts.push(
      '## Already planned — do NOT suggest these or close variants of them',
      exclusions.map((t) => `- ${t}`).join('\n'),
    )
  }

  parts.push(
    '## Output',
    `Write ONLY a JSON array to \`${SUGGESTIONS_FILE}\` (create the directory if needed).`,
    'Each element: {"title": string, "rationale": string, "priority": "p0"|"p1"|"p2"|"p3", "evidence": string}',
    '`evidence` is a `file:line` pointer where one exists; omit it otherwise.',
    `Produce at most ${MAX_SUGGESTIONS} suggestions. Write the file and stop — do not implement anything.`,
  )

  return parts.join('\n\n')
}

/** Narrow an arbitrary value to a known priority band, defaulting rather than failing. */
function toPriority(value: unknown): TodoPriority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value)
    ? (value as TodoPriority)
    : DEFAULT_PRIORITY
}

/**
 * Strip a markdown code fence, if the model wrapped its JSON in one.
 *
 * Told "write only JSON", models still fence it often enough that a retry
 * round-trip is the wrong price to pay for a five-line unwrap.
 */
function unfence(raw: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(raw)
  return fenced === null ? raw : fenced[1]
}

/**
 * Parse and validate what a scan session wrote.
 *
 * A model writing bad JSON is an EXPECTED case, not an exception: this returns
 * a result rather than throwing, so the modal can offer Refresh instead of
 * crashing the tab.
 *
 * @param raw - the file contents as written by the scan session.
 * @returns the validated suggestions, or a human-readable reason it failed.
 */
export function parseSuggestions(
  raw: string,
): { ok: true; suggestions: Suggestion[] } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(unfence(raw))
  } catch (cause) {
    return { ok: false, error: `the scan wrote invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}` }
  }

  // Accept both the bare array asked for and the {suggestions: [...]} wrapper
  // models commonly produce anyway.
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { suggestions?: unknown } | null)?.suggestions)
      ? ((parsed as { suggestions: unknown[] }).suggestions)
      : undefined
  if (list === undefined) {
    return { ok: false, error: 'the scan did not write a list of suggestions' }
  }

  const suggestions: Suggestion[] = []
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    // A titleless suggestion has nothing to show in a row, and inventing a
    // title would put a blank task in the backlog. Drop it.
    if (title.length === 0) continue
    const evidence = typeof row.evidence === 'string' ? row.evidence.trim() : ''
    suggestions.push({
      title,
      rationale: typeof row.rationale === 'string' ? row.rationale.trim() : '',
      priority: toPriority(row.priority),
      // Absent optional fields are ABSENT KEYS, never '', matching TodoItem.
      ...(evidence.length > 0 ? { evidence } : {}),
    })
    if (suggestions.length >= MAX_SUGGESTIONS) break
  }

  return { ok: true, suggestions }
}
```

- [ ] **Step 5: Add the build step**

In `plugins/dsh-todo/build/build.mjs`, immediately after the `src/launch.ts` build block (which ends at line 136), insert:

```javascript
// 1f) the suggestion helpers, on the same terms as launch.ts: bundled
// separately so the test can import the SHIPPED pure logic under plain Node.
// No externals — this module imports only ./types.ts.
await build({
  entryPoints: [join(root, 'src/suggest.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  minify: false,
  outfile: join(outdir, 'suggest.js'),
  logLevel: 'info',
})
```

- [ ] **Step 6: Build and run the test**

```bash
cd plugins/dsh-todo && node build/build.mjs && node test/suggest.test.mjs
```

Expected: `suggest: all passed`.

- [ ] **Step 7: Verify the tests can actually fail**

A test never seen red is decoration. Confirm each of these turns the suite red, then revert:

1. In `composeScanPrompt`, drop the `exclusions.length > 0` guard so the heading always emits → the empty-heading test fails.
2. In `parseSuggestions`, remove the `title.length === 0` check → the drop-titleless test fails.
3. Remove the `break` on `MAX_SUGGESTIONS` → the cap test fails.

Revert all three before committing.

- [ ] **Step 8: Register the test in `package.json`**

In `plugins/dsh-todo/package.json`, add `node test/suggest.test.mjs` to the `test` script, immediately after `node test/launch-lifecycle.mjs`.

- [ ] **Step 9: Commit**

```bash
git add plugins/dsh-todo/src/suggest.ts plugins/dsh-todo/src/types.ts \
        plugins/dsh-todo/build/build.mjs plugins/dsh-todo/test/suggest.test.mjs \
        plugins/dsh-todo/package.json
git commit -m "feat(todo): add suggestion vocabulary and result parsing"
```

---

### Task 2: The workspace scanner

**Files:**
- Create: `plugins/dsh-todo/src/scan.ts`
- Modify: `plugins/dsh-todo/build/build.mjs` (one more build step, after Task 1's)
- Test: `plugins/dsh-todo/test/scan.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks (`node:fs`, `node:path` only).
- Produces: `buildDigest(root: string): { digest: string; truncated: boolean }`

**Why bounded:** this spends tokens on a click. Every cap below is deliberate.

- [ ] **Step 1: Write the failing test**

Create `plugins/dsh-todo/test/scan.test.mjs`:

```javascript
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
    for (let i = 0; i < 400; i += 1) {
      writeFileSync(join(root, `f${i}.ts`), `// TODO: item number ${i} padded ${'x'.repeat(200)}\n`)
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
    writeFileSync(join(root, 'a.ts'), '// TODO: still found\n')
  })
  assert.ok(out.digest.includes('still found'))
  assert.ok(!out.digest.includes('\u0000'))
})

process.exitCode = failures === 0 ? 0 : 1
console.log(failures === 0 ? 'scan: all passed' : `scan: ${failures} failed`)
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd plugins/dsh-todo && node test/scan.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `../lib/scan.js`.

- [ ] **Step 3: Write `src/scan.ts`**

Create `plugins/dsh-todo/src/scan.ts`:

```typescript
/**
 * dsh-todo — building the evidence a scan reasons over.
 *
 * This module decides what a scan COSTS. Every source below is capped before
 * it is sent, because the button that triggers it spends tokens on one click
 * and a large repository would otherwise produce an unbounded prompt.
 *
 * It ships a DIGEST, never the repository: file contents appear only as
 * single-line comment matches and a leading slice of the README.
 *
 * Dependency-free apart from node builtins, so the test can import the built
 * module under plain Node with no harness packages on the import path.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Hard ceiling on the whole digest. Overflow truncates and says so. */
export const DIGEST_BYTE_CAP = 24_000

/** Directories never worth walking: vendored, generated, or version control. */
const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'lib', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.venv', 'venv', '__pycache__', 'target', 'vendor',
])

/** Extensions worth scanning for comments and counting as source. */
const SOURCE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs',
  '.java', '.rb', '.php', '.cs', '.swift', '.kt', '.scala', '.sh',
])

const MAX_FILES_WALKED = 4_000
const MAX_TREE_ENTRIES = 300
const MAX_COMMENTS = 80
const MAX_UNTESTED = 40
const MAX_COMMENT_LINE = 160
const README_BYTES = 4_000
const MAX_DEPTH = 8

interface Walked {
  /** Workspace-relative paths, forward-slashed. */
  files: string[]
  truncated: boolean
}

/** Normalise to forward slashes so the digest reads the same on every platform. */
function posix(path: string): string {
  return path.split(sep).join('/')
}

/**
 * Collect workspace-relative file paths, skipping vendored and generated trees.
 *
 * Depth- and count-capped: a deep monorepo must not turn one click into a
 * multi-second walk, and the caps are what keep the digest bounded before any
 * formatting happens.
 */
function walk(root: string): Walked {
  const files: string[] = []
  let truncated = false

  const visit = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES_WALKED) {
      truncated = true
      return
    }
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      // Unreadable directory: skip it. A permission error must not fail a scan.
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES_WALKED) {
        truncated = true
        return
      }
      // Skip dotfiles wholesale except the ones worth reading, plus every
      // ignored build/vendor directory.
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        visit(join(dir, entry.name), depth + 1)
      } else if (entry.isFile()) {
        files.push(posix(relative(root, join(dir, entry.name))))
      }
    }
  }

  try {
    if (!statSync(root).isDirectory()) return { files: [], truncated: false }
  } catch {
    // A workspace that does not exist yields an empty digest, not a throw.
    return { files: [], truncated: false }
  }
  visit(root, 0)
  return { files, truncated }
}

/** Read a file as text, yielding '' for anything unreadable or binary. */
function readText(path: string, limit = Number.MAX_SAFE_INTEGER): string {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return ''
  }
  // A NUL byte means this is not text; utf8-decoding a PNG produces garbage
  // that would waste digest budget and can carry control characters.
  if (raw.includes('\u0000')) return ''
  return raw.length > limit ? raw.slice(0, limit) : raw
}

const COMMENT_RE = /(?:^|\s)(?:\/\/|#|\/\*|\*)\s*(TODO|FIXME|HACK)\b[:\s]?(.*)$/

/** Unresolved-work comments, as `path:line  TAG rest`. */
function collectComments(root: string, files: readonly string[]): string[] {
  const out: string[] = []
  for (const rel of files) {
    if (out.length >= MAX_COMMENTS) break
    const dot = rel.lastIndexOf('.')
    if (dot < 0 || !SOURCE_EXT.has(rel.slice(dot))) continue
    const text = readText(join(root, rel))
    if (text === '') continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      if (out.length >= MAX_COMMENTS) break
      const match = COMMENT_RE.exec(lines[i])
      if (match === null) continue
      const body = match[2].trim().slice(0, MAX_COMMENT_LINE)
      out.push(`${rel}:${i + 1}  ${match[1]} ${body}`.trimEnd())
    }
  }
  return out
}

/** True when some file's name suggests it tests `base`. */
function hasTest(base: string, testNames: ReadonlySet<string>): boolean {
  return (
    testNames.has(`${base}.test`) ||
    testNames.has(`${base}.spec`) ||
    testNames.has(`test_${base}`) ||
    testNames.has(`${base}_test`) ||
    testNames.has(base)
  )
}

/**
 * Source modules with no apparent test.
 *
 * Name-based, deliberately: a real coverage run needs the project's own
 * toolchain, which a scan cannot assume exists. This is a HINT for the model
 * to weigh, which is why the digest labels it as such.
 */
function collectUntested(files: readonly string[]): string[] {
  const testNames = new Set<string>()
  for (const rel of files) {
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    const stem = name.replace(/\.[^.]+$/, '')
    if (/(^|[./_-])(test|spec)([./_-]|$)/i.test(rel)) {
      testNames.add(stem)
      testNames.add(stem.replace(/\.(test|spec)$/i, ''))
    }
  }

  const out: string[] = []
  for (const rel of files) {
    if (out.length >= MAX_UNTESTED) break
    const dot = rel.lastIndexOf('.')
    if (dot < 0 || !SOURCE_EXT.has(rel.slice(dot))) continue
    if (/(^|[./_-])(test|spec)([./_-]|$)/i.test(rel)) continue
    const stem = rel.slice(rel.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
    if (/^(index|main|types|constants)$/i.test(stem)) continue
    if (!hasTest(stem, testNames)) out.push(rel)
  }
  return out
}

/** Join sections, then enforce the byte ceiling with a visible marker. */
function assemble(sections: string[], walkTruncated: boolean): { digest: string; truncated: boolean } {
  const joined = sections.join('\n\n')
  if (joined.length <= DIGEST_BYTE_CAP) {
    return { digest: joined, truncated: walkTruncated }
  }
  // Truncation is MARKED, never silent: a model given a clipped digest must be
  // told, or it will reason confidently about a codebase it only half saw.
  const marker = '\n\n[digest truncated — the workspace is larger than one scan can carry]'
  return { digest: joined.slice(0, DIGEST_BYTE_CAP - marker.length) + marker, truncated: true }
}

/**
 * Build the bounded evidence a scan session reasons over.
 *
 * @param root - absolute path to the workspace directory.
 * @returns the digest text, and whether anything was left out.
 */
export function buildDigest(root: string): { digest: string; truncated: boolean } {
  const { files, truncated } = walk(root)
  const sections: string[] = []

  const tree = files.slice(0, MAX_TREE_ENTRIES)
  if (tree.length > 0) {
    sections.push(`### Files (${files.length} found, showing ${tree.length})\n${tree.join('\n')}`)
  }

  const readmeName = files.find((f) => /^readme(\.md|\.txt)?$/i.test(f))
  if (readmeName !== undefined) {
    const text = readText(join(root, readmeName), README_BYTES).trim()
    if (text !== '') sections.push(`### ${readmeName}\n${text}`)
  }

  const manifest = files.find((f) => f === 'package.json')
  if (manifest !== undefined) {
    const text = readText(join(root, manifest), 2_000).trim()
    if (text !== '') sections.push(`### package.json\n${text}`)
  }

  const comments = collectComments(root, files)
  if (comments.length > 0) {
    sections.push(`### Unresolved comments (TODO/FIXME/HACK)\n${comments.join('\n')}`)
  }

  const untested = collectUntested(files)
  if (untested.length > 0) {
    sections.push(
      '### Untested modules (name-based hint, not a coverage run)\n' + untested.join('\n'),
    )
  }

  return assemble(sections, truncated)
}
```

- [ ] **Step 4: Add the build step**

In `plugins/dsh-todo/build/build.mjs`, after the `suggest.ts` block added in Task 1:

```javascript
// 1g) the scanner, on the same terms: node platform (it uses node:fs) and no
// externals, so the test imports the shipped module directly.
await build({
  entryPoints: [join(root, 'src/scan.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  minify: false,
  outfile: join(outdir, 'scan.js'),
  logLevel: 'info',
})
```

- [ ] **Step 5: Build and run the test**

```bash
cd plugins/dsh-todo && node build/build.mjs && node test/scan.test.mjs
```

Expected: `scan: all passed`.

- [ ] **Step 6: Verify the tests can fail**

Confirm each turns the suite red, then revert:

1. Remove `'node_modules'` from `IGNORED_DIRS` → the vendored-leak test fails.
2. Raise `DIGEST_BYTE_CAP` to `10_000_000` → the cap test fails.
3. Delete the `raw.includes('\u0000')` guard → the binary test fails.

- [ ] **Step 7: Register the test**

Add `node test/scan.test.mjs` to the `test` script in `package.json`, after `suggest.test.mjs`.

- [ ] **Step 8: Commit**

```bash
git add plugins/dsh-todo/src/scan.ts plugins/dsh-todo/build/build.mjs \
        plugins/dsh-todo/test/scan.test.mjs plugins/dsh-todo/package.json
git commit -m "feat(todo): add bounded workspace scanner"
```

---

### Task 3: Host endpoints

**Files:**
- Modify: `plugins/dsh-todo/src/index.ts` (add two `@Remote` methods to `TodoService`)
- Modify: `plugins/dsh-todo/src/remote.ts` (two strict descriptors)
- Modify: `plugins/dsh-todo/src/types.ts` (request/result types)

**Interfaces:**
- Consumes: `buildDigest` (Task 2), `parseSuggestions` / `SUGGESTIONS_FILE` (Task 1), and the existing private `workspaceDir(workspaceId)` helper in `index.ts:218`.
- Produces two wire methods:
  - `scanDigest(request: { workspaceId: string }) => { digest: string; truncated: boolean }`
  - `readSuggestions(request: { workspaceId: string }) => { status: 'pending' | 'ready' | 'error'; suggestions?: Suggestion[]; error?: string }`

**The trap this task exists to avoid:** a strict codec **strips fields it does not name**, silently. Both schemas below must name every field, and `wire: 'request'` must match the parameter name exactly — the gateway reads parameter names off the function source, which is why the host half is built unminified.

- [ ] **Step 1: Add the wire types to `src/types.ts`**

Append:

```typescript
/** Request for both scan endpoints — one workspace, nothing else. */
export interface SuggestScanRequest {
  workspaceId: string
}

/** The bounded evidence a scan session reasons over. */
export interface ScanDigestResult {
  digest: string
  /** True when the workspace was larger than one digest can carry. */
  truncated: boolean
}

/**
 * Where a scan has got to.
 *
 * `pending` covers "no file yet" — the ordinary case while the session works.
 * `error` is a model that wrote unusable output, which is EXPECTED, not
 * exceptional, and must reach the UI as a message rather than a thrown fault.
 */
export interface ReadSuggestionsResult {
  status: 'pending' | 'ready' | 'error'
  suggestions?: Suggestion[]
  error?: string
}
```

- [ ] **Step 2: Add the two methods to `TodoService`**

In `plugins/dsh-todo/src/index.ts`, add these imports at the top with the existing ones:

```typescript
import { unlinkSync } from 'node:fs'
import { buildDigest } from './scan.ts'
import { parseSuggestions } from './suggest.ts'
```

and extend the existing `./types.ts` import with `SUGGESTIONS_FILE`, `type SuggestScanRequest`, `type ScanDigestResult`, `type ReadSuggestionsResult`.

Then add both methods to the class, after the existing `replace` method (`index.ts:280`):

```typescript
  /**
   * Build the bounded evidence a scan session reasons over.
   *
   * Read-only and side-effect free: it neither starts a scan nor touches the
   * todo database. The client sends the result on to a session it creates.
   *
   * @param request - the workspace to scan.
   * @returns the digest, and whether anything was left out.
   */
  @Remote
  async scanDigest(request: SuggestScanRequest): Promise<ScanDigestResult> {
    return buildDigest(this.workspaceDir(request.workspaceId))
  }

  /**
   * Read whatever a scan session has written so far.
   *
   * The file is DELETED once read successfully, so a later scan cannot show a
   * previous run's answers while it is still working — a stale list that looks
   * fresh is worse than an honest empty one.
   *
   * A model writing unusable JSON is an expected outcome, so this reports
   * `status: 'error'` rather than throwing: the modal turns that into a
   * Refresh, where a fault would take down the tab.
   *
   * @param request - the workspace whose scan result to read.
   * @returns pending when no file exists yet, otherwise the parsed result.
   */
  @Remote
  async readSuggestions(request: SuggestScanRequest): Promise<ReadSuggestionsResult> {
    const path = join(this.workspaceDir(request.workspaceId), ...SUGGESTIONS_FILE.split('/'))
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      // No file yet is the ordinary case while the session is still working.
      return { status: 'pending' }
    }

    const parsed = parseSuggestions(raw)
    // Consume the file either way: a malformed result left on disk would be
    // re-read on every poll and pin the modal to the same error forever.
    try {
      unlinkSync(path)
    } catch {
      // Nothing actionable — the result is already in hand.
    }

    if (!parsed.ok) return { status: 'error', error: parsed.error }
    return { status: 'ready', suggestions: parsed.suggestions }
  }
```

- [ ] **Step 3: Add the strict descriptors to `src/remote.ts`**

Add after `replaceResultSchema` (`remote.ts:71`):

```typescript
const scanRequestSchema = z.object({ workspaceId: z.string() })

const scanDigestResultSchema = z.object({
  digest: z.string(),
  truncated: z.boolean(),
})

/**
 * EVERY field must be named: a strict codec strips what it does not carry, and
 * it does so silently — a suggestion field missing here simply never arrives.
 */
const suggestionSchema = z.object({
  title: z.string(),
  rationale: z.string(),
  priority: z.enum(['p0', 'p1', 'p2', 'p3']),
  evidence: z.string().optional(),
})

const readSuggestionsResultSchema = z.object({
  status: z.enum(['pending', 'ready', 'error']),
  suggestions: z.array(suggestionSchema).optional(),
  error: z.string().optional(),
})
```

and extend the `descriptors` array (`remote.ts:115`) to:

```typescript
  descriptors: [
    descriptor('list', listRequestSchema, listResultSchema),
    descriptor('replace', replaceRequestSchema, replaceResultSchema),
    descriptor('scanDigest', scanRequestSchema, scanDigestResultSchema),
    descriptor('readSuggestions', scanRequestSchema, readSuggestionsResultSchema),
  ],
```

- [ ] **Step 4: Build and confirm the host half still loads**

```bash
cd plugins/dsh-todo && node build/build.mjs && node -e "import('./lib/index.js').then(() => console.log('host loads'))"
```

Expected: `host loads`. A decorator syntax error here means the `target: es2021` setting was disturbed.

- [ ] **Step 5: Confirm the parameter name survived the build**

This is the check that catches a silently broken wire contract:

```bash
cd plugins/dsh-todo && grep -n "async scanDigest(request)" lib/index.js && grep -n "async readSuggestions(request)" lib/index.js
```

Expected: both match. If the parameter reads `(e)` the host half was minified and the gateway will fail with "missing wire field" at call time.

- [ ] **Step 6: Run the full suite**

```bash
cd plugins/dsh-todo && pnpm test
```

Expected: every suite passes. Nothing here changes existing behaviour.

- [ ] **Step 7: Commit**

```bash
git add plugins/dsh-todo/src/index.ts plugins/dsh-todo/src/remote.ts plugins/dsh-todo/src/types.ts
git commit -m "feat(todo): add scanDigest and readSuggestions endpoints"
```

---

### Task 4: The Suggest dialog

**Files:**
- Modify: `plugins/dsh-todo/src/client.tsx`
- Test: `plugins/dsh-todo/test/smoke.mjs` (marker assertions)

**Interfaces:**
- Consumes: `scanDigest` / `readSuggestions` (Task 3) via `ctx.remote.dshTodo`; `composeScanPrompt` (Task 1); the existing `launchContext()` (`client.tsx:2972`), `TodoStore.update`, `PRIORITY_LABEL`, `Icon`/`ICON`, `describe()` (`client.tsx:795`), `activeItems()` (`client.tsx:124`), `isDone()` (`client.tsx:105`), `discardSession()` (from `./launch.ts`).
- **`makeItem(title, now, rand, fields)`** (`client.tsx:180`) — `fields` is the **fourth** parameter, carrying `status`/`priority`/`description`/`release`/`sprint`. Calling it as `makeItem(title, fields)` passes the object as `now`: no error, a garbage `id` and `createdAt`.
- Produces: `SuggestDialog` component and a `Suggest` header button in `TodoView`.

**Reused lifecycle:** `LaunchDialog` already creates a session without navigating (`client.tsx:2615`) and archives an unused one via `discardSession()`. This dialog uses the same shape with the navigation step permanently omitted.

**The `closeLaunch` lesson applies here.** `AGENTS.md` documents a shipped outage where a dialog's cleanup ran twice against a stale closure and archived a session that had just received its prompt. This dialog holds its session in a **ref that is blanked in the same step** it is read, so cleanup is idempotent.

- [ ] **Step 1: Add the CSS**

In the `VIEW_STYLES` template (`client.tsx:819`), append before the closing backtick. Note the sizes are on this package's stricter 12/14/16/20 ladder, and the skeleton geometry copies the real row's padding and line box:

```css
/* Suggestion rows. Geometry is copied by .dshtd-sug-skel below — change both
   together or the swap to real content will lurch. */
.dshtd-sug-row {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid transparent;
}
.dshtd-sug-row:hover { background: var(--td-hover); border-color: var(--td-border); }
.dshtd-sug-body { flex: 1 1 auto; min-width: 0; }
.dshtd-sug-title { font-size: 14px; line-height: 20px; color: var(--td-primary); }
.dshtd-sug-why {
  font-size: 12px; line-height: 18px; color: var(--td-caption);
  margin-top: 2px;
}
.dshtd-sug-eviden {
  font-size: 12px; line-height: 18px; color: var(--td-caption);
  font-family: var(--ds-font-family-code, monospace);
  margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshtd-sug-empty {
  font-size: 14px; line-height: 22px; color: var(--td-caption);
  padding: 24px 12px; text-align: center;
}
.dshtd-sug-status { font-size: 12px; line-height: 18px; color: var(--td-caption); }

/* Skeleton: same padding, same line boxes, same gaps as .dshtd-sug-row, so
   nothing moves when the real rows arrive. */
.dshtd-sug-skel { display: flex; gap: 10px; padding: 10px 12px; }
.dshtd-sug-skel > i {
  display: block; height: 16px; border-radius: 4px; flex: 0 0 16px;
  background: var(--td-hover);
}
.dshtd-sug-skel-body { flex: 1 1 auto; }
.dshtd-sug-skel-bar {
  display: block; height: 12px; border-radius: 4px; margin: 4px 0;
  background: linear-gradient(
    90deg, var(--td-hover) 0%, var(--td-border) 50%, var(--td-hover) 100%
  );
  background-size: 300% 100%;
  animation: dshtd-sug-sweep 1.4s ease-in-out infinite;
}
/* background-position, never transform/width/opacity: those reflow or move the
   bar relative to the text it stands in for, which is the lurch a skeleton
   exists to prevent. */
@keyframes dshtd-sug-sweep {
  0% { background-position: 180% 0; }
  100% { background-position: -80% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .dshtd-sug-skel-bar { animation: none; background: var(--td-border); }
}
```

- [ ] **Step 2: Write the skeleton component**

Add near `TodoSkeleton` (`client.tsx:2079`):

```tsx
/** Bar widths, varied so the skeleton reads as content rather than a grid. */
const SUG_SKELETON_WIDTHS = [72, 88, 61, 79, 68]

/**
 * Loading state for the suggestion list.
 *
 * A skeleton rather than a spinner because this is a large content pane — the
 * repo rule assigns a spinner only to a button and a caption row only to a
 * small surface. One `role="status"` announces the whole thing once; the bars
 * are decorative and hidden from assistive tech, or a screen reader narrates
 * five empty rows instead of one status line.
 */
function SuggestSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-live="polite">
      <span className="dshtd-sr">Scanning the workspace for suggestions…</span>
      {SUG_SKELETON_WIDTHS.map((w, i) => (
        <div className="dshtd-sug-skel" key={i} aria-hidden="true">
          <i />
          <div className="dshtd-sug-skel-body">
            <span className="dshtd-sug-skel-bar" style={{ width: w + '%' }} />
            <span className="dshtd-sug-skel-bar" style={{ width: w - 18 + '%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}
```

(`.dshtd-sr` is the existing visually-hidden class at `client.tsx:1215`.)

- [ ] **Step 3: Write `SuggestDialog`**

Add after `LaunchDialog` (`client.tsx:1663`). The scan lifecycle lives here:

```tsx
/** How long to wait for a scan session before offering a retry. */
const SCAN_TIMEOUT_MS = 180_000
/** How often to ask the host whether the result file has landed. */
const SCAN_POLL_MS = 1_500

/**
 * Scan the workspace and offer the results as checkable proposals.
 *
 * The scan is a background session: created, prompted, never navigated to, and
 * archived when it finishes or the dialog closes. That lifecycle is the same
 * one LaunchDialog uses, minus the `sessions.open()` call.
 *
 * `phase` is an EXPLICIT flag, never inferred from `suggestions.length === 0`.
 * Conflating "we have not looked" with "there is nothing" is what made
 * dsh-plan-board claim a workspace had no plans during every read.
 */
export function SuggestDialog({
  launch,
  store,
  items,
  onClose,
}: {
  launch: LaunchContext & { workspaceId: string }
  store: TodoStore
  items: TodoItem[]
  onClose: () => void
}): React.JSX.Element {
  const [phase, setPhase] = React.useState<'scanning' | 'ready' | 'error'>('scanning')
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([])
  const [checked, setChecked] = React.useState<Set<string>>(new Set())
  const [error, setError] = React.useState<string | null>(null)
  /** Titles already proposed this session, so Refresh returns new ideas. */
  const seenRef = React.useRef<string[]>([])
  /**
   * The scan session, held in a REF and blanked in the same step it is read.
   *
   * A render-closure copy is exactly as stale as the one that archived a
   * just-prompted session in the launch flow; blanking on read is what makes
   * cleanup idempotent when two paths both try to clean up.
   */
  const sessionRef = React.useRef<string | null>(null)
  const cancelledRef = React.useRef(false)

  /** Archive the scan session, exactly once, whoever asks. */
  const cleanup = React.useCallback((): void => {
    const id = sessionRef.current
    sessionRef.current = null
    if (id !== null) void discardSession(launch, id)
  }, [launch])

  const runScan = React.useCallback(async (): Promise<void> => {
    cleanup()
    cancelledRef.current = false
    setPhase('scanning')
    setError(null)

    try {
      const remote = (launch as unknown as { remoteTodo: TodoRemote }).remoteTodo
      const { digest } = await remote.scanDigest({ workspaceId: launch.workspaceId })

      // Titles only: descriptions would multiply the cost of every scan to
      // restate the very work the model is being told to avoid.
      const exclude = [
        ...activeItems(items).filter((i) => !isDone(i)).map((i) => i.title),
        ...seenRef.current,
      ]

      const sessionId = await launch.sessions.create({ workspaceId: launch.workspaceId })
      if (cancelledRef.current) {
        void discardSession(launch, sessionId)
        return
      }
      sessionRef.current = sessionId

      const binding = launch.sessions.binding(sessionId)
      if (binding === undefined) throw new Error('the scan session is not addressable yet')
      const sent = await binding.session.prompt(
        [{ type: 'text', text: composeScanPrompt(digest, exclude) }],
        'queue',
      )
      if (!sent.ok) throw new Error(sent.error?.message ?? 'the scan session refused the prompt')

      const deadline = Date.now() + SCAN_TIMEOUT_MS
      for (;;) {
        if (cancelledRef.current) return
        await new Promise((r) => setTimeout(r, SCAN_POLL_MS))
        if (cancelledRef.current) return
        const result = await remote.readSuggestions({ workspaceId: launch.workspaceId })
        if (result.status === 'ready') {
          const found = result.suggestions ?? []
          seenRef.current = [...seenRef.current, ...found.map((s) => s.title)]
          setSuggestions(found)
          setPhase('ready')
          cleanup()
          return
        }
        if (result.status === 'error') {
          setError(result.error ?? 'the scan produced unusable output')
          setPhase('error')
          cleanup()
          return
        }
        if (Date.now() > deadline) {
          setError('the scan did not finish in time')
          setPhase('error')
          cleanup()
          return
        }
      }
    } catch (cause) {
      if (cancelledRef.current) return
      setError(describe(cause))
      setPhase('error')
      cleanup()
    }
  }, [cleanup, items, launch])

  React.useEffect(() => {
    void runScan()
    return () => {
      cancelledRef.current = true
      cleanup()
    }
    // Deliberately once: a scan is started by opening the dialog or by
    // Refresh, never by a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (title: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  /**
   * Promote the checked suggestions to real tasks.
   *
   * ONE store.update for the whole batch, not one per row: the store treats
   * each call as a reason to write, so a per-row loop would put a round-trip
   * on the wire for every checkbox.
   */
  const addSelected = (): void => {
    const picked = suggestions.filter((s) => checked.has(s.title))
    if (picked.length === 0) return
    // NOTE the signature: makeItem(title, now, rand, fields) — `fields` is the
    // FOURTH parameter. Passing the options object second would silently make
    // it the `now` timestamp, producing a garbage id and createdAt with no
    // error anywhere.
    store.update((current) => [
      ...current,
      ...picked.map((s) =>
        makeItem(s.title, Date.now(), Math.random, {
          description: s.rationale,
          priority: s.priority,
          status: 'backlog',
        }),
      ),
    ])
    onClose()
  }

  return createPortal(
    <div className="dshtd-modal-backdrop" onClick={onClose}>
      <div
        className="dshtd-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Suggested work"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dshtd-modal-head">
          <strong>Suggested work</strong>
          <button className="dshtd-icon" onClick={onClose} aria-label="Close">
            <Icon path={ICON.close} />
          </button>
        </div>

        <div className="dshtd-modal-body">
          {phase === 'scanning' ? <SuggestSkeleton /> : null}

          {phase === 'error' ? (
            <p className="dshtd-sug-empty">{error ?? 'the scan failed'}</p>
          ) : null}

          {phase === 'ready' && suggestions.length === 0 ? (
            <p className="dshtd-sug-empty">
              Nothing new to suggest — the backlog already covers what the scan found.
            </p>
          ) : null}

          {phase === 'ready' && suggestions.length > 0
            ? suggestions.map((s) => (
                <label className="dshtd-sug-row" key={s.title}>
                  <input
                    type="checkbox"
                    checked={checked.has(s.title)}
                    onChange={() => toggle(s.title)}
                  />
                  <span className="dshtd-sug-body">
                    <span className="dshtd-sug-title">{s.title}</span>
                    {s.rationale ? <span className="dshtd-sug-why">{s.rationale}</span> : null}
                    {s.evidence ? <span className="dshtd-sug-eviden">{s.evidence}</span> : null}
                  </span>
                  <span className="dshtd-badge">{PRIORITY_LABEL[s.priority]}</span>
                </label>
              ))
            : null}
        </div>

        <div className="dshtd-modal-foot">
          <span className="dshtd-sug-status">
            {phase === 'ready' && checked.size > 0 ? `${checked.size} selected` : ''}
          </span>
          <button className="dshtd-btn" onClick={() => void runScan()} disabled={phase === 'scanning'}>
            Refresh
          </button>
          <button
            className="dshtd-btn primary"
            onClick={addSelected}
            disabled={phase !== 'ready' || checked.size === 0}
          >
            Add selected
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
```

Add the imports this needs to the existing `./suggest.ts` and `./types.ts` import lines: `composeScanPrompt`, `type Suggestion`.

- [ ] **Step 4: Extend `TodoRemote` and the launch context**

`TodoRemote` (`client.tsx:771`) needs the two new methods:

```typescript
  scanDigest: (request: { workspaceId: string }) => Promise<RemoteReply<ScanDigestResult>>
  readSuggestions: (request: { workspaceId: string }) => Promise<RemoteReply<ReadSuggestionsResult>>
```

Match the existing reply-unwrapping convention in this file exactly — read how `list`/`replace` unwrap `RemoteReply` at their call sites in `TodoStore.refresh` and mirror it. Pass the store's remote handle into `SuggestDialog` rather than re-probing the context.

- [ ] **Step 5: Add the header button**

In `TodoView` (`client.tsx:2507`), beside the existing header controls. It is gated on the SAME `launch` context the rocket button uses — `sessions` is the one service a scan cannot fake, and `launchContext()` already returns `undefined` when it is unreachable:

```tsx
{launch !== undefined ? (
  <button
    className="dshtd-btn"
    onClick={() => setSuggesting(true)}
    title="Scan the workspace and propose new tasks"
  >
    Suggest
  </button>
) : null}
```

with `const [suggesting, setSuggesting] = React.useState(false)` alongside the other `TodoView` state, and the dialog rendered near the existing `ConfirmDialog` / `LaunchDialog` slots:

```tsx
{suggesting && launch !== undefined ? (
  <SuggestDialog
    launch={launch}
    store={store}
    items={state.items}
    onClose={() => setSuggesting(false)}
  />
) : null}
```

- [ ] **Step 6: Build and check the shipped bundle**

```bash
cd plugins/dsh-todo && node build/build.mjs && node test/smoke.mjs && node test/context-probe.mjs
```

Expected: both pass. `context-probe` is the one that matters here — it mounts the real bundle on a real `Context` and calls the slot's `inject` callback, which is where an unguarded service read lands.

- [ ] **Step 7: Add smoke markers**

In `test/smoke.mjs`, assert against the built `lib/client.js`:

- `dshtd-sug-row` and `dshtd-sug-skel` are present (the CSS shipped)
- `suggestions.json` appears (the prompt names the output path)
- **tasks are added in exactly one place** — mirror the existing single-deletion-path assertion, so a future button cannot bypass `store.update`

- [ ] **Step 8: Run the icon and modal probes**

```bash
cd plugins/dsh-todo && pnpm run test:icons && pnpm run test:modal
```

Expected: both pass. `test:icons` fails on any font-size outside 12/14/16/20 and on rows over 40px; `test:modal` fails if the panel is clipped, off-screen, transparent, or under the Desktop drag strip.

- [ ] **Step 9: Check the theme tokens**

```bash
cd ../.. && node scripts/check-tokens.mjs && node scripts/check-type-scale.mjs && node scripts/check-progress.mjs
```

Expected: all pass. `check-tokens` is what catches a misspelt `var(--dsw-*)`, which never errors at runtime — it silently renders a plausible colour forever and stops following the theme.

- [ ] **Step 10: Commit**

```bash
git add plugins/dsh-todo/src/client.tsx plugins/dsh-todo/test/smoke.mjs
git commit -m "feat(todo): add Suggest dialog with workspace scan"
```

---

### Task 5: End-to-end verification and documentation

**Files:**
- Modify: `plugins/dsh-todo/AGENTS.md`
- Modify: `plugins/dsh-todo/README.md`
- Modify: `README.md` (root, if it enumerates per-plugin features)

**This task is the milestone the spec calls out as the real risk:** the plumbing is ordinary, but whether a scanned digest yields work worth doing is unknown until it runs against a real repository.

- [ ] **Step 1: Full offline suite**

```bash
cd plugins/dsh-todo && pnpm test
```

Expected: every suite green, including the two new ones.

- [ ] **Step 2: Repo-wide checks**

```bash
cd ../.. && pnpm run build && pnpm run test && node scripts/verify.mjs
```

Expected: `verify.mjs` exits zero. It checks versions, resolution, declared dependencies, and entry points.

- [ ] **Step 3: Confirm resolution is not a store path**

```bash
cd plugins/dsh-todo && node -e "const{createRequire}=require('module'),{resolve}=require('path');console.log(createRequire(resolve('lib/index.js')).resolve('@deepseek-ai/cordis'))"
```

Expected: a host install path, never a `.pnpm` store path.

- [ ] **Step 4: Boot a scratch server**

```bash
dsh --profile web --port 38111 --no-open
```

Leave `DSH_HOME` alone. **Never point it at a home another harness is using** — sessions live at `$DSH_HOME/sessions/` and two harnesses corrupt each other's silently. An `ERR_MODULE_NOT_FOUND` here is a broken junction a running server would swallow.

- [ ] **Step 5: Probe the new endpoint**

Real workspace ids live in `~/.dsh/storages/workspace.json` under `tables.workspaces`.

```bash
curl -s -X POST http://127.0.0.1:38111/api/dshTodo/scanDigest -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"t1","method":"dshTodo/scanDigest","payload":{"args":{"request":{"workspaceId":"<real-id>"}}}}'
```

Expected: `{"type":"server-response","result":{"ok":true,"value":{"digest":"...","truncated":false}}}`.
A **404 means the `./typert` export did not register** — the loader caches its verdict per process, so that needs a full profile restart, not a refresh.

- [ ] **Step 6: Drive the real UI — the judgement step**

Open the web UI, open the Todo tab on a real project, click **Suggest**, and read what comes back. Confirm:

1. The skeleton shows immediately and does not lurch when rows replace it.
2. Suggestions are **specific and grounded** — each rationale references something real, and `evidence` pointers resolve to actual lines.
3. Nothing duplicates an existing unchecked task.
4. **Refresh returns different suggestions**, not a reshuffle of the same list.
5. **Add selected** creates exactly the checked tasks, as `backlog`, with the rationale as the description.
6. Closing mid-scan leaves **no session in the sidebar**.

**Point 6 is the one flagged as unverified in the spec.** `LaunchDialog` only ever leaves *blank* sessions unopened, and blank may be why they stay hidden — a prompted session may appear in the sidebar while it works. If it does, that is cosmetic: note it, and decide whether to archive earlier or accept a briefly visible session.

**If point 2 fails, stop.** Vague suggestions are a prompt problem, not a code problem: iterate on `composeScanPrompt` and the digest's section balance before adding any UI polish. That is the whole reason this task exists.

- [ ] **Step 7: Document it**

Add a `### Scanning for suggestions` section to `plugins/dsh-todo/AGENTS.md` covering: the background-session-plus-file architecture and **why** (no public completion promise on `prompt()`); the digest caps and that truncation is marked; that the result file is deleted on read so a stale list cannot look fresh; the blanked-ref cleanup and its link to the `closeLaunch` outage; and anything learned at Step 6.

Update `plugins/dsh-todo/README.md` with the user-facing description.

- [ ] **Step 8: Commit**

```bash
git add plugins/dsh-todo/AGENTS.md plugins/dsh-todo/README.md README.md
git commit -m "docs(todo): document the workspace suggestion scan"
```

---

## Self-Review

**Spec coverage** — every section maps to a task:

| Spec section | Task |
|---|---|
| `src/scan.ts`, three evidence sources, bounding | 2 |
| `scanDigest` / `readSuggestions` endpoints | 3 |
| Suggestion shape, `evidence`, not stored in the database | 1, 3 |
| `SuggestDialog`, portal, z-index | 4 |
| Skeleton, own loading flag | 4 |
| Rows, checkboxes, nothing checked by default | 4 |
| Refresh with exclusions | 1 (prompt), 4 (wiring) |
| Add selected, one `store.update` | 4 |
| Failure-mode table | 3 (pending/error), 4 (timeout, cancel, empty) |
| Guarded service reads | 4 (reuses `launchContext`) |
| Testing section | 1, 2, 4 |
| Open risk: suggestion quality | 5, Step 6 |

**Placeholder scan:** none. Every code step carries real code; every run step names a command and its expected output.

**Type consistency:** `Suggestion` is defined once in `types.ts` (Task 1) and used unchanged in `suggest.ts`, `remote.ts`, `index.ts`, and `client.tsx`. `buildDigest` returns `{ digest, truncated }` in Task 2 and is consumed with those exact names in Task 3. `parseSuggestions` returns the discriminated `ok` union in Task 1 and is destructured accordingly in Task 3. `SUGGESTIONS_FILE` and `MAX_SUGGESTIONS` live in `types.ts` and are imported, never redeclared.

**One known soft spot:** Task 4 Step 4 says to match the existing `RemoteReply` unwrapping convention by reading its call sites rather than quoting the code. That is deliberate — the wrapper differs between `list` and `replace`, and quoting the wrong one would be worse than pointing at the source of truth.
