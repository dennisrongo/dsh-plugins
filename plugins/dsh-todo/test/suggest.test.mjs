/**
 * Suggestion vocabulary: prompt composition and result parsing.
 *
 * Reads the BUILT lib/suggest.js, matching how launch.js is tested — the
 * client bundle inlines the same source but minified, so asserting against
 * that would mean matching renamed identifiers.
 */
import { strict as assert } from 'node:assert'
import { composeScanPrompt, parseSuggestions } from '../lib/suggest.js'

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

process.exitCode = failures === 0 ? 0 : 1
console.log(failures === 0 ? 'suggest: all passed' : `suggest: ${failures} failed`)
