/**
 * Bundle suite: asserts against the BUILT artifacts, not the sources.
 *
 * `lib/client.js` is what the browser receives byte-for-byte, so the markers
 * that matter — the loader wrapper, the slot it registers into, the four
 * layer sources, the storage keys — are checked in the shipped text. Running
 * this against stale output is the failure mode that rotted a sibling
 * package's markers unnoticed, which is why `pnpm test` builds first.
 *
 * The client half is deliberately NOT imported: it is a browser bundle wrapped
 * in `window.__ModuleLoader__.load`, so importing it under Node fails by
 * design. The wrapper and its contents are validated as text instead.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCENTS, FONTS, THEMES, apply, bootScript } from '../lib/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const client = readFileSync(join(root, 'lib/client.js'), 'utf8')

let checks = 0
const has = (needle, why) => {
  assert.ok(client.includes(needle), `lib/client.js is missing ${JSON.stringify(needle)} — ${why}`)
  checks += 1
}
const lacks = (needle, why) => {
  assert.ok(!client.includes(needle), `lib/client.js unexpectedly contains ${JSON.stringify(needle)} — ${why}`)
  checks += 1
}

// --- the module-loader contract -------------------------------------------

has('window.__ModuleLoader__.load({', 'the client half must use the loader convention')
has('id: "@dennisrongo/dsh-theme"', 'the loader id must match the package name')
has('factory: (require) =>', 'the factory receives the loader require')

// --- what it registers -----------------------------------------------------

has('settings.section', 'the Themes page registers into the settings section list')
has('"dsh-theme"', 'the section registration carries this id')
has('slots', 'registration goes through the slots service')
has('theme/change', 'the panel follows a light/dark flip made while it is open')

// --- the four layers -------------------------------------------------------

has('@dennisrongo/dsh-theme:palette', 'the theme layer source')
has('@dennisrongo/dsh-theme:accent', 'the accent layer source')
has('@dennisrongo/dsh-theme:font', 'the interface font layer source')
has('@dennisrongo/dsh-theme:scale', 'the UI scale layer source')
has('overrideTokens', 'layers are applied through the theme runtime')

// --- persistence -----------------------------------------------------------

has('dsh-theme:theme', 'the localStorage fallback key')
has('dsh-theme:accent', 'the localStorage fallback key')
has('dsh-theme:font', 'the localStorage fallback key')
has(
  'document.cookie',
  'the selection rides a cookie: DSH Desktop serves from a new ephemeral port each launch, so localStorage is a fresh origin every time while a cookie is not isolated by port',
)
has('SameSite=Lax', 'the cookie is written with sane attributes')
has('dsh-theme:contrast', 'contrast is its own persisted axis, independent of the palette')
has('dsh-theme:scale', 'UI scale is its own persisted axis')
lacks(
  'settingsScope',
  'selection is deliberately localStorage-backed: a settings scope no-ops on a non-loopback connection and its refresh resets the built-in theme preference',
)

// --- the catalogue reached the bundle --------------------------------------

for (const theme of THEMES) has(`"${theme.id}"`, `theme ${theme.id} must ship in the client bundle`)
for (const font of FONTS) has(`"${font.id}"`, `font ${font.id} must ship in the client bundle`)
has('--ds-font-family-code', 'one font choice sets the code face as well as the interface one')
for (const accent of ACCENTS) has(`"${accent.id}"`, `accent ${accent.id} must ship in the client bundle`)
has('--dsw-alias-bg-base', 'the token builder must be bundled, not tree-shaken away')
has('--dsw-font-family', 'the font layer targets the one token every typography token reads')
has('--shiki-token-keyword', 'syntax colours are part of a theme')
has('--dshth-ui-scale', 'the scale token the injected zoom rule reads')
has(
  'zoom',
  'scale works by zoom because the harness hardcodes 305 of its font sizes — scaling the typography tokens would move a seventh of the UI and leave the rest',
)
// JSX compiles attributes to props, so the marker is the prop value.
has('"range"', 'contrast and scale are sliders, not lists')
has('dshth-slider', 'the sliders carry the plugin-namespaced class')

// --- bundled faces ---------------------------------------------------------
//
// The harness serves no route for a .woff2, so a font that ships with this
// plugin travels inside client.js as a data URL. Without these the catalogue
// would silently fall through to whatever the machine happens to have.

const faces = [...client.matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g)]
checks += 1
assert.equal(faces.length, 6, `expected 6 bundled faces, found ${faces.length}`)
checks += 1
assert.ok(client.includes('@font-face'), 'the bundled faces need @font-face rules to be usable')
checks += 1
assert.ok(
  client.includes('font-display:swap'),
  'a face that somehow fails to decode must fall back to the stack, not to invisible text',
)
for (const family of ['Geist Mono', 'JetBrains Mono']) {
  checks += 1
  assert.ok(client.includes(family), `${family} is missing from the bundle`)
}
checks += 1
assert.ok(
  !client.includes('Berkeley Mono') || client.includes('"Berkeley Mono", "TX-02"'),
  'Berkeley Mono is a paid licence: it may only appear as a stack entry for owners, never bundled',
)
checks += 1
assert.ok(
  faces.reduce((total, m) => total + m[1].length, 0) < 200 * 1024,
  'the bundled faces are past their byte budget — check the subset and weights',
)
has(
  '--dsw-alias-state-business-primary',
  'the accent reaches model labels, chips and mission-control — routing it only to brand-primary left it applied but invisible',
)

// --- presentation contract -------------------------------------------------

has('dshth', 'CSS classes are namespaced per plugin')
has('radiogroup', 'each axis is a keyboard-navigable radio group')
has('aria-checked', 'selection state is exposed to assistive tech')
has('focus-visible', 'focus styling is kept')
lacks('!important', 'the presenter writes tokens inline; nothing here needs to outrank it')
lacks('transition:', 'an animated palette swap is a reduced-motion problem and a repaint amplifier')

// --- the host half ---------------------------------------------------------

checks += 1
assert.equal(typeof apply, 'function', 'the host half must export apply()')
checks += 1
assert.doesNotThrow(
  () => apply(),
  'apply() must tolerate being called with no context — it is invoked that way here and by any loader that mounts it bare',
)

checks += 1
const injected = []
apply({ on: (event, listener) => (event === 'webserver/index-inject' ? listener(injected) : undefined) })
assert.equal(injected.length, 1, 'the host half contributes exactly one index-injection row')
checks += 1
assert.deepEqual(
  { kind: injected[0].kind, placement: injected[0].placement },
  { kind: 'script', placement: 'body' },
  'the bootstrap is an inline body script, so it runs before the shell mounts',
)

// --- the first-paint bootstrap ---------------------------------------------
//
// Without this the shell paints the stock palette for a few hundred
// milliseconds on every load: measured, `#root` already had rendered content
// by the time the plugin bundle executed.

const boot = bootScript()
checks += 1
assert.ok(boot.startsWith('(() =>'), 'the bootstrap is a self-invoking expression')
for (const theme of THEMES) {
  checks += 1
  assert.ok(boot.includes(`"${theme.id}"`), `theme ${theme.id} is missing from the first-paint table`)
}
checks += 1
assert.ok(boot.includes('--dsw-alias-bg-base'), 'the bootstrap paints the base background')
checks += 1
assert.ok(boot.includes('--dsw-specific-sidebar-fill'), 'the bootstrap paints the sidebar')
checks += 1
assert.ok(boot.includes('--dsw-font-family'), 'the bootstrap paints the font')
checks += 1
assert.ok(
  boot.includes('--dshth-ui-scale'),
  'the bootstrap applies the scale, or the shell paints once at 100% and visibly jumps',
)
checks += 1
assert.ok(
  boot.includes('"high-contrast"'),
  'the bootstrap carries renamed ids, so a cookie written before the rename still paints',
)
checks += 1
assert.ok(boot.includes('data-ds-dark-theme'), 'the bootstrap reads the scheme the harness bootstrap already set')
checks += 1
assert.ok(boot.includes('dsh-theme:theme'), 'the bootstrap reads the localStorage fallback')
checks += 1
assert.ok(
  boot.includes('document.cookie'),
  'the bootstrap reads the cookie FIRST — otherwise the flash fix works on the CLI and fails on the Desktop, which is the surface that needs it',
)
checks += 1
assert.ok(
  boot.includes('try {') && boot.includes('catch'),
  'the bootstrap runs before the app exists; a theme preference must never break a page load',
)
checks += 1
assert.ok(!boot.includes('</script'), 'the bootstrap is inlined into HTML and must not be able to close its own tag')
checks += 1
assert.ok(
  boot.length < 32 * 1024,
  `the bootstrap ships in every index render; ${boot.length} bytes is past the budget for a flash fix`,
)

console.log(
  `ok — ${checks} bundle checks (${(client.length / 1024).toFixed(1)}kb client bundle, ` +
    `${(boot.length / 1024).toFixed(1)}kb inline bootstrap)`,
)
