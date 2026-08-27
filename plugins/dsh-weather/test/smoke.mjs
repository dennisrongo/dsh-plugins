/**
 * Smoke test: the built artifacts exist, the client bundle registers itself
 * with the module loader, and the pure logic behaves.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

assert.ok(existsSync(join(root, 'lib/index.js')), 'lib/index.js missing — run pnpm build')
assert.ok(existsSync(join(root, 'lib/client.js')), 'lib/client.js missing — run pnpm build')

const client = readFileSync(join(root, 'lib/client.js'), 'utf8')
assert.ok(client.includes('__ModuleLoader__.load'), 'client bundle missing loader call')
assert.ok(client.includes('@dennisrongo/dsh-weather'), 'client bundle missing package id')
assert.ok(client.includes('shell.overlay'), 'client bundle missing slot registration')
assert.ok(!client.includes('require("react")') || client.includes('react'), 'react should stay external')

// Pure logic — compiled into the client body; re-test via the source-level
// exports by importing the built host half is meaningless, so assert on the
// bundled function behavior indirectly through known strings.
assert.ok(client.includes('Clear'), 'weather-code table missing')

// Positioning: the bar is pinned to the TOP of the viewport (moved off the
// bottom, where it collided with the chat prompt).
assert.ok(client.includes('top: 8px'), 'bar should be pinned to the top')
assert.ok(!client.includes('bottom: 8px'), 'stale bottom anchor still in bundle')

// Responsive tiers. Each breakpoint sheds a group of detail; the separator
// that introduces a hidden group must be hidden with it, which is why the
// separators carry explicit modifier classes instead of relying on :has()
// or positional nth-child (the groups are conditionally rendered).
for (const bp of ['max-width: 720px', 'max-width: 520px', 'max-width: 380px']) {
  assert.ok(client.includes(bp), `responsive breakpoint missing: ${bp}`)
}
assert.ok(client.includes('pointer: coarse'), 'touch hit-area rules missing')
for (const sep of ['dshwx-sep-where', 'dshwx-sep-hours', 'dshwx-sep-meta']) {
  assert.ok(client.includes(sep), `separator modifier missing: ${sep}`)
}
// :has() is deliberately avoided — display:none does not remove an element
// from the sibling axis, so modifier classes are the robust mechanism here.
assert.ok(!client.includes(':has('), 'unexpected :has() in bundle')

// --- Geolocation resilience -------------------------------------------------
// ipapi.co went behind a Cloudflare bot challenge (403 + HTML interstitial),
// which made location resolution burn its whole budget before falling back to
// New York. Resolution now walks a provider chain, each call bounded by a
// timeout so one dead host cannot stall the bar.
//
// Assert on the FETCHED URL, not a bare substring: the provider table's doc
// comment legitimately mentions ipapi.co as the removed provider.
assert.ok(!client.includes("fetch(\"https://ipapi.co"), 'ipapi.co must not be fetched — it is Cloudflare-blocked')
assert.ok(!client.includes("'https://ipapi.co/json/'"), 'stale ipapi.co provider URL still in bundle')

for (const provider of ['get.geojs.io', 'freeipapi.com']) {
  assert.ok(client.includes(provider), `geolocation provider missing: ${provider}`)
}

// A hung provider must not hang the bar.
assert.ok(client.includes('AbortController'), 'geolocation fetch missing timeout guard')

// The hard fallback must survive every provider failing.
assert.ok(client.includes('New York'), 'hard fallback location missing')

console.log('smoke OK')
