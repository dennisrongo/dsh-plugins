/**
 * Suggestion vocabulary: prompt composition and result parsing.
 *
 * Reads the BUILT lib/suggest.js, matching how launch.js is tested — the
 * client bundle inlines the same source but minified, so asserting against
 * that would mean matching renamed identifiers.
 */
import { strict as assert } from 'node:assert'
import { composeScanPrompt, makeRunId, parseSuggestions, suggestionsFileFor } from '../lib/suggest.js'

// The caps are stated as LITERALS, not imported: types.ts is bundled into each
// entry point and never emitted as lib/types.js, and a test that imported the
// same constant the code clamps with could only prove the code agrees with
// itself. These are the stored caps from types.ts (MAX_TEXT / MAX_DESC /
// MAX_LABEL) — if one moves, this test should fail and be re-read.
const MAX_TEXT = 500
const MAX_DESC = 5000
const MAX_LABEL = 60

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
  const prompt = composeScanPrompt('DIGEST-MARKER', [], 'run1')
  assert.ok(prompt.includes('DIGEST-MARKER'))
})

test('existing titles are listed as exclusions', () => {
  const prompt = composeScanPrompt('d', ['Fix token refresh', 'Add dark mode'], 'run1')
  assert.ok(prompt.includes('Fix token refresh'))
  assert.ok(prompt.includes('Add dark mode'))
})

test('an empty exclusion list does not emit an empty heading', () => {
  // An empty "Already planned:" section teaches the model the field is
  // meaningless, exactly as composePrompt() avoids an empty "Priority: —".
  const prompt = composeScanPrompt('d', [], 'run1')
  assert.ok(!/already planned/i.test(prompt))
})

test('the prompt names the output path and demands JSON only', () => {
  const prompt = composeScanPrompt('d', [], 'run1')
  assert.ok(prompt.includes('.dsh/suggestions-run1.json'))
  assert.ok(/json/i.test(prompt))
})

// --- run identity ----------------------------------------------------------
// The prompt names a PER-RUN file, and the host reads only that one. This is
// what makes a late writer harmless: `discardSession` archives a scan session
// (uiWorkspace.archiveSession — sidebar visibility) and does not cancel it, so
// a run that timed out or whose modal was closed keeps working and eventually
// writes. Against one fixed path, the next run's poll reads that write within
// 1.5s and presents it as its own — computed against a stale exclusion set.

test('the prompt names a path unique to the run it was composed for', () => {
  const a = composeScanPrompt('d', [], 'aaa111')
  const b = composeScanPrompt('d', [], 'bbb222')
  assert.ok(a.includes('.dsh/suggestions-aaa111.json'))
  assert.ok(b.includes('.dsh/suggestions-bbb222.json'))
  // Neither may name the other's file, or the two runs share a rendezvous.
  assert.ok(!a.includes('bbb222'))
  assert.ok(!b.includes('aaa111'))
})

test('the prompt never names the legacy workspace-global path', () => {
  // The exact regression: a fixed path carries no run identity at all, so
  // reintroducing it re-opens both failure paths (timeout, and closed modal).
  const prompt = composeScanPrompt('d', [], 'run1')
  assert.ok(!/`\.dsh\/suggestions\.json`/.test(prompt))
})

test('the run id reaches the prompt as-is, so the host can match it', () => {
  // The two ends of one contract in different modules: the client mints the id,
  // the prompt tells the model where to write, and readSuggestions builds the
  // same path from the same id. A transform on either side (case-folding, a
  // prefix) would leave the model writing where nobody reads.
  const runId = makeRunId(1_700_000_000_000, () => 0.5)
  assert.ok(composeScanPrompt('d', [], runId).includes(`.dsh/suggestions-${runId}.json`))
})

test('the prompt path is built by the same helper the host reads with', () => {
  // One implementation, two ends. If the prompt composed its path by hand the
  // two could drift silently — the model would write where nobody polls, and
  // the modal would simply time out with no error to explain it.
  const runId = 'zz9'
  assert.ok(composeScanPrompt('d', [], runId).includes(suggestionsFileFor(runId)))
  assert.equal(suggestionsFileFor(runId), '.dsh/suggestions-zz9.json')
})

test('a minted run id is file-name safe and unique per call', () => {
  // It is interpolated into a path and matched by the host's sweep regex, so
  // anything outside [a-z0-9] would either break the path or escape the sweep.
  assert.match(makeRunId(), /^[a-z0-9]+$/)
  const ids = new Set(Array.from({ length: 200 }, () => makeRunId()))
  assert.ok(ids.size > 1, 'run ids must differ between scans, or two runs collide')
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

// --- fence shapes a model actually emits -----------------------------------
// Each of these fell through to ok:false before the unfence rewrite. The
// wrapper KEYS stay narrow deliberately ({suggestions:[...]} only) — this is
// mechanical string handling, not key guessing.

test('a fence followed by trailing prose is unwrapped', () => {
  const raw = '```json\n[{"title":"T","rationale":"R","priority":"p2"}]\n```\n\nDone!'
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions.length, 1)
})

test('a fence preceded by prose is unwrapped', () => {
  const raw = 'Here you go:\n```json\n[{"title":"T","rationale":"R","priority":"p2"}]\n```'
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions.length, 1)
})

test('a fence with no newline before the close is unwrapped', () => {
  const raw = '```json\n[{"title":"T","rationale":"R","priority":"p2"}]```'
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions.length, 1)
})

test('an uppercase language tag is unwrapped', () => {
  const raw = '```JSON\n[{"title":"T","rationale":"R","priority":"p2"}]\n```'
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions.length, 1)
})

test('CRLF line endings still unwrap', () => {
  // A regression pin on the newline handling, NOT evidence the widening works:
  // CRLF parsed under the original anchored regex too, so this row could not
  // have gone red in the sabotage that verified the other fence shapes.
  const raw = '```json\r\n[{"title":"T","rationale":"R","priority":"p2"}]\r\n```'
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions.length, 1)
})

// --- the other side of the boundary: backticks as CONTENT, not a fence ------
// Widening the fence search to find a run anywhere made an UNFENCED payload
// that merely quotes backticks get mined as if it were fenced, truncating the
// array to a fragment. The prompt asks the model to cite TODO/FIXME/HACK
// evidence, so a code snippet inside a `rationale` is invited behaviour.
// Both rows are pinned because the failure has a THRESHOLD: one run was
// always harmless, two or more broke it.

test('an unfenced payload quoting two backtick runs still parses', () => {
  const fence = '```'
  const raw = `[{"title":"T","rationale":"use ${fence}code${fence} here","priority":"p2"}]`
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions.length, 1)
  // The rationale must survive INTACT — a truncating unwrap that still happened
  // to parse would be just as wrong as one that throws.
  assert.equal(out.suggestions[0].rationale, `use ${fence}code${fence} here`)
})

test('an unfenced payload quoting one backtick run still parses', () => {
  const fence = '```'
  const raw = `[{"title":"T","rationale":"use ${fence}code here","priority":"p2"}]`
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions.length, 1)
  assert.equal(out.suggestions[0].rationale, `use ${fence}code here`)
})

test('prose with no fence and no JSON still fails', () => {
  // The guard against the opposite error: extraction must not become so eager
  // that it manufactures a parse out of ordinary sentences.
  const out = parseSuggestions('I looked at the codebase but found nothing to suggest.')
  assert.equal(out.ok, false)
  assert.ok(out.error.length > 0)
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

// --- length clamps ---------------------------------------------------------
// This module is the boundary for MODEL-generated text, and was the only one
// in the package that did not clamp. Sibling boundaries: index.ts:388/397/403,
// client.tsx:544, cli.ts:418.

test('an overlong title is clamped to MAX_TEXT', () => {
  const raw = JSON.stringify([{ title: 'a'.repeat(5000), rationale: 'R', priority: 'p2' }])
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions[0].title.length, MAX_TEXT)
})

test('an overlong rationale is clamped to MAX_DESC', () => {
  const raw = JSON.stringify([{ title: 'T', rationale: 'b'.repeat(90_000), priority: 'p2' }])
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions[0].rationale.length, MAX_DESC)
})

test('overlong evidence is clamped to MAX_LABEL', () => {
  const raw = JSON.stringify([{ title: 'T', rationale: 'R', priority: 'p2', evidence: 'c'.repeat(400) }])
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions[0].evidence.length, MAX_LABEL)
})

test('a clamp never invents an empty evidence key', () => {
  // The clamp runs before the emptiness check, so the absent-key invariant
  // (absent optional fields are ABSENT KEYS, never '') must still hold.
  const raw = JSON.stringify([{ title: 'T', rationale: 'R', priority: 'p2', evidence: '   ' }])
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.ok(!('evidence' in out.suggestions[0]))
})

test('the list is capped', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ title: 't' + i, rationale: 'r', priority: 'p2' }))
  const out = parseSuggestions(JSON.stringify(many))
  assert.equal(out.suggestions.length, 12)
})

// --- duplicate titles ------------------------------------------------------
// A title is the IDENTITY of a suggestion downstream: client.tsx keys each row
// by it and holds the checked set as a Set<string> of titles. Two rows sharing
// a title therefore collide twice over — one checkbox toggles both, and "Add
// selected" writes the same task twice from one click. Dropping the duplicate
// here is what fixes both at once, and stops it reaching the backlog at all.

test('an exactly duplicated title is dropped', () => {
  const raw = JSON.stringify([
    { title: 'Add retry logic', rationale: 'first', priority: 'p1' },
    { title: 'Add retry logic', rationale: 'second', priority: 'p3' },
    { title: 'Other', rationale: 'r', priority: 'p2' },
  ])
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions.length, 2)
  // The FIRST occurrence is kept, so the earliest-ranked suggestion survives.
  assert.equal(out.suggestions[0].title, 'Add retry logic')
  assert.equal(out.suggestions[0].rationale, 'first')
  assert.equal(out.suggestions[1].title, 'Other')
})

test('case and whitespace variants of a title collapse to one', () => {
  // `Add retry` and `add retry  ` are the same suggestion to a user, and the
  // title is already trimmed before it is stored — so matching must be
  // case-insensitive on the trimmed text or the collision survives the fix.
  const raw = JSON.stringify([
    { title: 'Add retry', rationale: 'r', priority: 'p2' },
    { title: '  add retry  ', rationale: 'r', priority: 'p2' },
    { title: 'ADD RETRY', rationale: 'r', priority: 'p2' },
  ])
  const out = parseSuggestions(raw)
  assert.equal(out.ok, true)
  assert.equal(out.suggestions.length, 1)
  assert.equal(out.suggestions[0].title, 'Add retry')
})

test('distinct titles are all preserved', () => {
  // The guard against over-collapsing: a dedupe that fused near-neighbours
  // would silently throw away suggestions the scan paid for.
  const raw = JSON.stringify([
    { title: 'Add retry', rationale: 'r', priority: 'p2' },
    { title: 'Add retry logic', rationale: 'r', priority: 'p2' },
    { title: 'Add retries', rationale: 'r', priority: 'p2' },
    { title: 'Retry', rationale: 'r', priority: 'p2' },
  ])
  const out = parseSuggestions(raw)
  assert.equal(out.suggestions.length, 4)
})

test('the cap still fills to 12 DISTINCT entries when duplicates are present', () => {
  // Dedupe must happen BEFORE the cap counts an entry. Counting first would
  // spend cap slots on rows that are then discarded, so a duplicate-heavy
  // response would yield 12-minus-the-duplicates instead of 12 usable ideas.
  const dupes = Array.from({ length: 20 }, () => ({ title: 'same', rationale: 'r', priority: 'p2' }))
  const distinct = Array.from({ length: 20 }, (_, i) => ({ title: 'u' + i, rationale: 'r', priority: 'p2' }))
  const out = parseSuggestions(JSON.stringify([...dupes, ...distinct]))
  assert.equal(out.suggestions.length, 12)
  const titles = out.suggestions.map((s) => s.title.toLowerCase())
  assert.equal(new Set(titles).size, 12, 'every capped entry must be distinct')
})

process.exitCode = failures === 0 ? 0 : 1
console.log(failures === 0 ? 'suggest: all passed' : `suggest: ${failures} failed`)
