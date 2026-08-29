/**
 * Verify the INSTALLED plugin copy (profile node_modules) — the artifact the
 * running GUI actually serves. Mirrors test/smoke.mjs's bootstrap checks:
 * module registration, exported apply/inject, and overlay slot registration
 * through a stub ctx.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRequire = createRequire(join(pkgRoot, 'package.json'))

const PKG = ['@dennisrongo', 'dsh-mission-control']

/**
 * The profile copy this checks is whatever the GUI actually serves, so it is
 * machine state rather than something the repo owns. Absent any install, this
 * exits 0 with a note: a contributor without a profile should not see a red
 * test for a check that cannot apply to them.
 *
 * Resolution DISCOVERS an install rather than naming one. A hardcoded default
 * profile is why this test rotted unnoticed: it pointed at a profile that did
 * not exist here, so it skipped — reporting success — while the markers it
 * asserts drifted from the source. Scanning means any real install is checked,
 * and the skip is reserved for genuinely having nothing to check.
 *
 * Override with DSH_PROFILE_COPY (an exact path) or DSH_PROFILE (a profile
 * name); either is honoured verbatim, and a miss is then FATAL rather than
 * skipped — naming a target you expect to exist and silently passing is the
 * failure mode this whole comment is about.
 */
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const hasBundle = (dir) => existsSync(join(dir, 'lib', 'client.js'))
/** Windows paths differ in case and trailing separators; compare them normalised. */
const norm = (s) => s.replace(/[\\/]+$/, '').toLowerCase()

/**
 * Cache-buster for the bootstrap import. Node caches an ES module per resolved
 * URL, so two profiles junctioned at the same repo would resolve to one URL and
 * the second import would be a no-op — registering nothing and failing the
 * "registers exactly one module" check for reasons that have nothing to do with
 * the bundle.
 */
let runId = 0

/**
 * Both surfaces keep their own DSH_HOME: the dsh CLI, and DSH Desktop. The same
 * profile NAME exists under both, so each root carries a label — "web" alone
 * would not say which surface failed.
 */
const desktopRoot = join(
  process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
  'dsh-desktop', 'harness', 'profiles',
)
const cliRoot = join(homedir(), '.dsh', 'profiles')

/**
 * Label by which surface the path belongs to, not by which list slot it came
 * from: DSH_HOME frequently points AT the Desktop harness, so keying the label
 * to the env var mislabels Desktop installs as CLI ones.
 */
const rootLabel = (dir) =>
  norm(dir) === norm(desktopRoot) ? 'desktop' : norm(dir) === norm(cliRoot) ? 'dsh' : 'DSH_HOME'

const profileRoots = [join(dshHome, 'profiles'), cliRoot, desktopRoot]
  .map((dir) => ({ dir, label: rootLabel(dir) }))

/** Every install of this package across every profile root, deduped. */
function discoverInstalls() {
  const found = new Map()
  for (const root of profileRoots) {
    if (!existsSync(root.dir)) continue
    let entries
    try { entries = readdirSync(root.dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = join(root.dir, entry.name, 'node_modules', ...PKG)
      if (hasBundle(dir) && !found.has(dir)) found.set(dir, `${root.label}:${entry.name}`)
    }
  }
  return [...found].map(([dir, name]) => ({ dir, name }))
}

let targets
if (process.env.DSH_PROFILE_COPY) {
  targets = [{ dir: process.env.DSH_PROFILE_COPY, name: 'DSH_PROFILE_COPY' }]
} else if (process.env.DSH_PROFILE) {
  const dir = join(dshHome, 'profiles', process.env.DSH_PROFILE, 'node_modules', ...PKG)
  targets = [{ dir, name: process.env.DSH_PROFILE }]
} else {
  targets = discoverInstalls()
  if (targets.length === 0) {
    console.log('installed-copy: no profile has this plugin installed — skipping')
    console.log(`  looked under: ${profileRoots.map((r) => r.dir).join(', ')}`)
    console.log('  set DSH_PROFILE_COPY or DSH_PROFILE to check a specific install')
    process.exit(0)
  }
}

// An explicitly named target that does not exist is an error, not a skip.
for (const t of targets) {
  assert.ok(hasBundle(t.dir), `no client.js at ${t.dir} (${t.name})`)
}
console.log(`installed-copy: checking ${targets.map((t) => t.name).join(', ')}`)

for (const target of targets) {
  await checkInstall(target)
}

async function checkInstall({ dir: installed, name: profileName }) {
  console.log(`\n-- ${profileName}`)
  const code = readFileSync(`${installed}/lib/client.js`, 'utf8')
  // The two-row burn block (dshmc-burn-row / dshmc-burn-model) and its header
  // sparkline were removed: the four-card stats strip replaced the counts, and
  // token burn now reads as a live tok/s rate rather than a retained series.
  assert.ok(!code.includes('dshmc-burn-'), 'installed bundle has no leftover burn block')
  // The activity feed tab was removed along with its diff logic.
  assert.ok(!code.includes('dshmc-feed'), 'installed bundle has no leftover feed styles')
  assert.ok(!code.includes('diffFleetEvents'), 'installed bundle has no leftover feed diff logic')
  assert.ok(code.includes('dshmc-stats'), 'installed bundle has the stats strip')
  assert.ok(code.includes('dshmc-stat-value'), 'installed bundle renders stat cards')
  assert.ok(code.includes('dshmc-rate'), 'installed bundle reports the fleet output rate')
  assert.ok(code.includes('tok/s'), 'installed bundle labels the rate readout')
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
  // REGRESSION: the header gear opens AND closes the settings drawer. A gear once
  // called setSettingsOpen(true), which re-opened the drawer on every click and
  // could never close it. esbuild minifies true/false to !0/!1, so match those
  // forms too.
  assert.deepEqual(
    code.match(/setSettingsOpen\((?:!0|!1|true|false)\)/g) ?? [],
    [],
    'no gear hardcodes the drawer open/closed',
  )
  assert.equal(
    (code.match(/setSettingsOpen\(\(?\w+\)?\s*=>\s*!\w+\)/g) ?? []).length,
    1,
    'the header gear toggles the drawer functionally',
  )
  // The pomodoro footer carries transport controls only — the drawer it used to
  // open is one gear up, in the panel header.
  assert.ok(!code.includes('Configure pomodoro durations'), 'no redundant gear in the pomodoro footer')


  // Bootstrap: registers exactly one module with the loader
  const registered = []
  globalThis.window = { __ModuleLoader__: { load: (e) => registered.push(e) } }
  await import(`${pathToFileURL(`${installed}/lib/client.js`).href}?t=${runId++}`)
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
  // `remote` is load-bearing: cordis throws on an undeclared service get, so
  // omitting it makes apply()'s own `!ctx.remote` guard fail the loader entry
  // and drop DSH Desktop into startup recovery. Regression guard for that.
  assert.deepEqual(
    exports_.inject,
    ['slots', 'remote', 'sessions', 'workspaces', 'modelDirectories'],
    'inject list',
  )
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
}

console.log(`\nINSTALLED_COPY_OK — ${targets.length} deployed bundle(s) verified (markers + bootstrap)`)
