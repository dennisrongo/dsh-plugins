/**
 * Verify the INSTALLED plugin copy (profile node_modules) — the artifact the
 * running GUI actually serves. Mirrors test/smoke.mjs's bootstrap checks:
 * module registration, exported apply/inject, and overlay slot registration
 * through a stub ctx.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRequire = createRequire(join(pkgRoot, 'package.json'))

/**
 * The profile copy this checks is whatever the GUI actually serves, so it is
 * machine state rather than something the repo owns. Point DSH_PROFILE_COPY at
 * it, or set DSH_PROFILE to name a profile under $DSH_HOME (default ~/.dsh).
 * Absent, this exits 0 with a note: a contributor without that profile should
 * not see a red test for a check that cannot apply to them.
 */
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profile = process.env.DSH_PROFILE ?? 'mission-control'
const installed = process.env.DSH_PROFILE_COPY
  ?? join(dshHome, 'profiles', profile, 'node_modules', '@dennisrongo', 'dsh-mission-control')

if (!existsSync(join(installed, 'lib', 'client.js'))) {
  console.log(`installed-copy: no profile copy at ${installed} — skipping`)
  console.log('  set DSH_PROFILE_COPY or DSH_PROFILE to check a specific install')
  process.exit(0)
}
const code = readFileSync(`${installed}/lib/client.js`, 'utf8')
assert.ok(code.includes('dshmc-burn-row'), 'installed bundle has two-row burn block')
assert.ok(code.includes('dshmc-burn-model'), 'installed bundle has model chips')
assert.ok(!code.includes('#7170ff'), 'installed bundle has no leftover purple')
assert.ok(code.includes('--dsw-specific-sidebar-fill'), 'installed bundle uses sidebar tokens')
assert.ok(code.includes('dshmc-llm'), 'installed bundle has the LLM activity line')
assert.ok(code.includes('dshmc-tool-head'), 'installed bundle has expandable tool rows')
assert.ok(code.includes('--mc-msg-size'), 'installed bundle unifies tile message size')
assert.ok(code.includes('dshmc-settings-select'), 'installed bundle has the settings drawer')
// The subagents stat must animate while a swarm is live, and must register for
// host catalog membership updates or the count never moves at all.
assert.ok(code.includes('is-swarm-live'), 'installed bundle has the swarm (subagents) live tone')
// Per-session subagent collapse: a real button, keyboard reachable, that does
// not double as row selection.
assert.ok(code.includes('dshmc-rowcaret'), 'installed bundle has the per-session collapse toggle')
assert.ok(code.includes('orderSubagents'), 'installed bundle orders subagents newest/most-urgent first')
assert.ok(code.includes('dshmc-rowcaret-spacer'), 'childless rows keep their alignment')
assert.ok(code.includes('stopPropagation'), 'toggling subagents does not also select the session')
assert.ok(code.includes('aria-expanded'), 'collapse toggle exposes expanded state to AT')
assert.ok(code.includes('focus-visible'), 'collapse toggle has a visible focus ring')
assert.ok(code.includes('mc-stat-glow-accent'), 'installed bundle animates the subagents card')
assert.ok(code.includes('setSubagentCatalogOpen'), 'installed bundle subscribes to catalog membership')
assert.ok(
  /is-swarm-live[\s\S]{0,400}animation: none/.test(code) || code.includes('.dshmc-stat.is-swarm-live::after'),
  'swarm animation participates in the reduced-motion block',
)
assert.ok(code.includes('dshmc-group-more'), 'installed bundle has the show-more control')
assert.ok(code.includes('dsh-mission-control:settings'), 'installed bundle persists panel settings')
assert.ok(code.includes('Sessions per workspace'), 'installed bundle exposes the per-workspace limit')
assert.ok(code.includes('Sort sessions by'), 'installed bundle exposes the fleet sort control')
assert.ok(code.includes('Most recently active'), 'installed bundle offers the default recency order')
// Inbox questions must render the session's real options, not a generic approve/deny
assert.ok(code.includes('dshmc-q-options'), 'installed bundle renders real question options')
assert.ok(code.includes('dshmc-q-option-desc'), 'installed bundle renders option descriptions')
assert.ok(code.includes('dshmc-q-custom'), 'installed bundle offers a custom answer field')
assert.ok(code.includes('radiogroup'), 'installed bundle uses radiogroup semantics for single-select')
// Stage tiles must hydrate their own history window: the host opens it for the
// STAGED session only, so off-stage tiles used to render "status only".
assert.ok(code.includes('shouldOpenHistory'), 'installed bundle opens cold history windows')
// Stage tiles name their workspace — a tile is detached from the grouped list.
assert.ok(code.includes('dshmc-stage-tile-ws'), 'installed bundle labels stage tiles with their workspace')
// A session waiting on a human must show WHAT it is waiting for inside its own
// Stage tile — an amber border alone left the question invisible on the Stage.
assert.ok(code.includes('dshmc-stage-tile-wait'), 'installed bundle renders waits inside stage tiles')
assert.ok(code.includes('Waiting on you'), 'installed bundle labels the in-tile wait')
// esbuild escapes non-ASCII in string literals, so the em dash lands as \u2014.
assert.ok(code.includes(String.raw`waiting \u2014 answer below`), 'installed bundle points the operator at the in-tile answer')
// Pomodoro break timer, pinned to the panel footer.
assert.ok(code.includes('dshmc-pomo'), 'installed bundle has the pomodoro footer')
assert.ok(code.includes('dshmc-pomo-clock'), 'installed bundle renders the countdown clock')
assert.ok(code.includes('Pomodoro break timer'), 'installed bundle labels the timer for screen readers')
assert.ok(code.includes('Focus minutes'), 'installed bundle exposes configurable work length')
assert.ok(code.includes('Break minutes'), 'installed bundle exposes configurable break length')
assert.ok(code.includes('Long break minutes'), 'installed bundle exposes configurable long-break length')
// The footer must reserve its own row rather than float over fleet/burn data.
assert.ok(/\.dshmc-pomo \{[^}]*flex: none/.test(code), 'pomodoro footer is a flex row, not an overlay')
// REGRESSION: both gear buttons (header + pomodoro footer) open AND close the
// settings drawer. The pomodoro gear once called setSettingsOpen(true), which
// re-opened the drawer on every click and could never close it. esbuild
// minifies true/false to !0/!1, so match those forms too.
assert.deepEqual(
  code.match(/setSettingsOpen\((?:!0|!1|true|false)\)/g) ?? [],
  [],
  'no gear hardcodes the drawer open/closed',
)
assert.equal(
  (code.match(/setSettingsOpen\(\(?\w+\)?\s*=>\s*!\w+\)/g) ?? []).length,
  2,
  'both gears toggle the drawer functionally',
)
assert.ok(code.includes('dshmc-pomo-btn.on'), 'pomodoro gear reflects the open drawer')


// Bootstrap: registers exactly one module with the loader
const registered = []
globalThis.window = { __ModuleLoader__: { load: (e) => registered.push(e) } }
await import(pathToFileURL(`${installed}/lib/client.js`).href)
assert.equal(registered.length, 1, 'client.js registers exactly one module')

const moduleTable = {
  react: repoRequire('react'),
  'react/jsx-runtime': repoRequire('react/jsx-runtime'),
}
const exports_ = registered[0].factory((id) => {
  const m = moduleTable[id]
  if (!m) throw new Error(`unexpected require: ${id}`)
  return m
})
assert.equal(typeof exports_.apply, 'function', 'exports apply()')
assert.deepEqual(exports_.inject, ['slots', 'sessions', 'workspaces', 'modelDirectories'], 'inject list')
assert.equal(typeof exports_.shouldOpenHistory, 'function', 'exports shouldOpenHistory')
assert.equal(exports_.shouldOpenHistory('cold'), true, 'cold windows are opened by the tile')
assert.equal(exports_.shouldOpenHistory('open'), false, 'open windows are not refetched')

// Pomodoro pure logic is exported and behaves
assert.equal(typeof exports_.advancePomodoro, 'function', 'exports advancePomodoro')
assert.equal(typeof exports_.fmtClock, 'function', 'exports fmtClock')
assert.equal(exports_.fmtClock(90_000), '1:30', 'clock formats mm:ss')
assert.equal(exports_.DEFAULT_WORK_MINUTES, 25, 'default focus stretch is 25 minutes')
assert.equal(exports_.DEFAULT_BREAK_MINUTES, 5, 'default break is 5 minutes')
assert.equal(exports_.parseSettings(null).pomodoroEnabled, true, 'timer shows by default')

// apply() registers into shell.overlay through a stub ctx
const registrations = []
const stubCtx = {
  effect: (fn) => fn(),
  slots: {
    inject: (name, fn) => { assert.equal(name, 'shell.overlay'); return fn() },
    register: (slot, render) => { registrations.push(slot); return () => {} },
  },
}
exports_.apply(stubCtx)
assert.equal(registrations.length, 1, 'registers one slot')
assert.equal(registrations[0].name, 'shell.overlay', 'slot is shell.overlay')
assert.equal(registrations[0].id, 'dsh-mission-control', 'slot id is dsh-mission-control')

console.log('INSTALLED_COPY_OK — deployed bundle verified (markers + bootstrap)')
