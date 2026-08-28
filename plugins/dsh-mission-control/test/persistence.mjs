/**
 * The state cell end to end: client serializer -> wire schemas -> real host.
 *
 * Each half is already covered alone. smoke.mjs round-trips the envelope
 * through pack/parse in memory; host-service.mjs round-trips opaque bytes
 * through the disk cell; contract.mjs checks the descriptors. None of them
 * would notice the two halves disagreeing — a client writing an envelope the
 * host's schema rejects, or a payload that survives pack/parse but not a real
 * save/load, still passes all three.
 *
 * This is the feature that shipped broken (the panel's timer vanished on every
 * DSH Desktop restart), so it gets a test that crosses the whole seam: the
 * client's own serializer, validated by the published wire schemas, against the
 * real service writing a real file.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const local = (p) => import(pathToFileURL(join(root, p)).href)

// --- client half, materialized the way the browser's module loader does
const registered = []
globalThis.window = { __ModuleLoader__: { load: (e) => registered.push(e) } }
await local('lib/client.js')
const moduleTable = { react: require('react'), 'react/jsx-runtime': require('react/jsx-runtime') }
const client = registered[0].factory((id) => {
  if (!(id in moduleTable)) throw new Error(`unexpected require: ${id}`)
  return moduleTable[id]
})

// --- host half + the published wire contract
const { default: MissionControlService, MAX_STATE_BYTES } = await local('lib/index.js')
const { TYPERT } = await local('lib/typert.host.js')
const wire = Object.fromEntries(TYPERT.invocations.map((d) => [d.method, d]))
const saveRequest = wire.save.parameters[0].codec.schema
const loadResult = wire.load.result.schema

const {
  packPomodoroEnvelope,
  parsePomodoroEnvelope,
  serializePomodoroState,
  startPomodoro,
  pausePomodoro,
  initialPomodoro,
} = client

const config = { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15 }
const homes = []

/**
 * A host service bound to its own empty DSH_HOME, plus a caller that enforces
 * the published schemas on the way in and out — the gateway validates both
 * ends, so a test that skips validation is testing a laxer path than production.
 * @returns `{ save, load }` mirroring the client's `ctx.remote.dshMissionControl`.
 */
function hostBridge() {
  const home = mkdtempSync(join(tmpdir(), 'mc-persist-'))
  homes.push(home)
  const svc = new MissionControlService(new Context())
  const withHome = async (fn) => {
    const prior = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      return await fn()
    } finally {
      if (prior === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prior
    }
  }
  return {
    async save(request) {
      assert.ok(saveRequest.safeParse(request).success, 'the client\'s save request satisfies the wire schema')
      return withHome(() => svc.save(request))
    },
    async load(request = {}) {
      const result = await withHome(() => svc.load(request))
      assert.ok(loadResult.safeParse(result).success, 'the host\'s load result satisfies the wire schema')
      return result
    },
  }
}

// --- 1) a running timer survives the restart that originally broke it.
// DSH Desktop serves the UI from a new ephemeral port each launch, so
// localStorage is a fresh origin every time; only the host cell carries state
// across. This is that path, end to end.
{
  const host = hostBridge()
  const running = startPomodoro(initialPomodoro(config), 1_000, config)

  await host.save({ state: packPomodoroEnvelope(running, 5_000) })

  // ...restart: a brand new client with an empty localStorage seed.
  const { state } = await host.load()
  const restored = parsePomodoroEnvelope(state, config)
  assert.ok(restored, 'the cell rehydrates into an envelope')
  assert.equal(restored.updatedAt, 5_000, 'the write timestamp survives the restart')
  assert.deepEqual(restored.state, running, 'the running timer survives the restart intact')
}

// --- 2) a fresh profile must read as "nothing saved", NOT as a reset. parse()
// returning null is what makes the panel keep its defaults instead of stamping
// an empty state over a timer it simply has not loaded yet.
{
  const host = hostBridge()
  const { state } = await host.load()
  assert.equal(state, null, 'an untouched profile has no cell')
  assert.equal(parsePomodoroEnvelope(state, config), null, 'and the client reads that as "nothing", not a reset')
}

// --- 3) newer-write-wins across the two stores. The panel reconciles a
// localStorage seed against the host cell by timestamp; if the cell did not
// preserve updatedAt, a stale seed would silently clobber the live timer.
{
  const host = hostBridge()
  const older = pausePomodoro(startPomodoro(initialPomodoro(config), 0, config), 60_000)
  const newer = startPomodoro(initialPomodoro(config), 10_000, config)

  await host.save({ state: packPomodoroEnvelope(older, 100) })
  const seeded = parsePomodoroEnvelope((await host.load()).state, config)

  await host.save({ state: packPomodoroEnvelope(newer, 200) })
  const latest = parsePomodoroEnvelope((await host.load()).state, config)

  assert.ok(latest.updatedAt > seeded.updatedAt, 'the later write outranks the earlier one')
  assert.deepEqual(latest.state, newer, 'and carries the newer state')
}

// --- 4) the legacy bare-state payload (written before the envelope existed)
// still loads out of the host cell, reading as updatedAt 0 so any real write
// outranks it. This is the upgrade path for anyone who ran the old build.
{
  const host = hostBridge()
  const state = pausePomodoro(startPomodoro(initialPomodoro(config), 0, config), 60_000)
  await host.save({ state: serializePomodoroState(state) })
  const restored = parsePomodoroEnvelope((await host.load()).state, config)
  assert.ok(restored, 'a legacy bare-state cell still loads')
  assert.equal(restored.updatedAt, 0, 'legacy payloads rank below every real write')
  assert.deepEqual(restored.state, state, 'and still carry the timer')
}

// --- 5) a corrupt cell degrades to "keep what you have". The host hands back
// whatever bytes are there (it never parses), so the client is the only line of
// defence — a throw here would take the whole panel down on one bad file.
{
  const host = hostBridge()
  await host.save({ state: 'not json at all {{{' })
  const { state } = await host.load()
  assert.equal(state, 'not json at all {{{', 'the host returns the corrupt bytes verbatim')
  assert.equal(parsePomodoroEnvelope(state, config), null, 'the client absorbs it as "nothing usable"')
}

// --- 6) a real envelope must sit far under the host's cap. If the panel's
// state ever grew past it, saves would start throwing in production while every
// in-memory test kept passing.
{
  const state = startPomodoro(initialPomodoro(config), 1_000, config)
  const envelope = packPomodoroEnvelope(state, Number.MAX_SAFE_INTEGER)
  assert.ok(
    envelope.length * 20 < MAX_STATE_BYTES,
    `a real envelope (${envelope.length}B) leaves >20x headroom under the ${MAX_STATE_BYTES}B cap`,
  )
}

// --- 7) the client's serializer output is valid wire traffic. pack() produces
// the string the panel hands to ctx.remote.dshMissionControl.save, so it has to
// satisfy the request schema the gateway validates against.
{
  const state = pausePomodoro(startPomodoro(initialPomodoro(config), 0, config), 60_000)
  const parsed = saveRequest.safeParse({ state: packPomodoroEnvelope(state, 1) })
  assert.ok(parsed.success, 'pack() output is a valid save request')
  assert.equal(typeof JSON.parse(parsed.data.state).updatedAt, 'number', 'the envelope is timestamped JSON')
}

for (const home of homes) rmSync(home, { recursive: true, force: true })
console.log('PERSISTENCE_OK — client<->host cell verified across %d profiles', homes.length)
