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
