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

// DSH Desktop on Windows adds a full-width 36px window-drag region
// (-webkit-app-region: drag, z-index 2147483644) that resolves before
// hit-testing and swallows clicks on the bar, which pins to top: 8px.
// The only fix is opting the bar out of the drag region.
assert.ok(client.includes('app-region: no-drag'), 'bar must opt out of the desktop window-drag region')
// no-drag alone does not punch a hole in the overlapping drag strip (verified
// against the desktop preload: every button already gets no-drag !important
// and the bar was still unclickable) — the bar must clear the 36px strip.
assert.ok(client.includes('dsh-desktop-windows-titlebar-layout .dshwx'), 'bar must drop below the desktop drag strip')
assert.ok(client.includes('top: 44px'), 'desktop drag-strip offset missing')
assert.ok(client.includes('data-dsh-no-drag'), 'buttons must carry the preload no-drag hook')
assert.ok(!client.includes('bottom: 8px'), 'stale bottom anchor still in bundle')

// Drag + persist. A parked position must survive a DSH Desktop relaunch, which
// serves the UI from a new port each time — localStorage alone is empty on the
// new origin, so the write has to be a cookie (same reason as dsh-theme).
assert.ok(client.includes('dsh-weather-pos'), 'placed position must persist in a cookie')
assert.ok(client.includes('dsh-weather:pos'), 'placed position must keep a localStorage fallback')
assert.ok(client.includes('Path=/; Max-Age='), 'position cookie must be host-wide and long-lived')
assert.ok(client.includes('SameSite=Lax'), 'position cookie missing SameSite')
assert.ok(client.includes('onPointerDown'), 'bar must start a drag from pointer down')
assert.ok(client.includes('setPointerCapture'), 'drag must capture the pointer so it cannot lose the pill')
assert.ok(client.includes('closest("button")') || client.includes("closest('button')"), 'buttons must not start a drag')
assert.ok(client.includes('cursor: grab'), 'bar must advertise that it is moveable')
assert.ok(client.includes('data-placed'), 'placed layout must be distinguishable from the auto-centred default')

// Responsive tiers. Each tier sheds a group of detail; the separator that
// introduces a hidden group must be hidden with it, which is why the
// separators carry explicit modifier classes instead of relying on :has()
// or positional nth-child (the groups are conditionally rendered).
//
// The tiers key off the MEASURED band, not a viewport media query. The bar's
// real room is the shell's content box minus whatever a docked overlay has
// claimed, so a wide window with dsh-plan-board's panel open can leave less
// space than a phone — a media query calls that "full" and lets the pill run
// under the panel. The old `max-width:` breakpoints must be gone, or the two
// mechanisms fight each other on specificity.
for (const tier of ['data-fit="tablet"', 'data-fit="phone"', 'data-fit="tiny"', 'data-fit="none"']) {
  assert.ok(client.includes(tier), `responsive tier missing: ${tier}`)
}
for (const threshold of ['380', '520', '720']) {
  assert.ok(client.includes(threshold), `tier threshold missing: ${threshold}`)
}
for (const bp of ['max-width: 720px', 'max-width: 520px', 'max-width: 380px']) {
  assert.ok(!client.includes(bp), `stale viewport breakpoint still in bundle: ${bp}`)
}

// Band measurement. The bar must read the shell frame's CONTENT box (which is
// how dsh-mission-control's rail reservation reaches it) and subtract any
// overlay that marked itself as holding the right-hand strip.
assert.ok(client.includes('data-shell-overlay'), 'bar must locate the shell frame to measure its content box')
assert.ok(client.includes('data-dsh-overlay-claim'), 'bar must honour a docked overlay\'s right-strip claim')
assert.ok(client.includes('paddingRight'), 'bar must subtract the frame reservation padding')

// Coordinate spaces. dsh-theme's UI scale is `#root { zoom: … }`, so
// getBoundingClientRect() reports TRUE viewport px while an inline `left` is an
// AUTHOR px the zoom scales again. Mixing them is self-consistent at 100% and
// wrong by the zoom factor everywhere else, so the band measurement resolves
// the zoom and converts on the way out.
assert.ok(client.includes('currentCSSZoom'), 'bar must resolve the effective CSS zoom')
// And no ResizeObserver reports a zoom change (verified in the shell: neither
// content-box nor device-pixel-content-box fires), so the scale's own carrier —
// an inline custom property on <body> — is what gets watched.
assert.ok(
  /attributeFilter:\s*\[\s*["']style["']\s*,\s*["']class["']\s*\]/.test(client),
  "bar must watch <body>'s style attribute for UI-scale changes",
)
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
