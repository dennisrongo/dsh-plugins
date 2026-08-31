#!/usr/bin/env node
/**
 * Measure every plugin's loading skeleton in a REAL browser.
 *
 * `check-progress.mjs` reads source and can prove the rule is *written*; only a
 * browser can prove it *renders*. Three things are invisible to a static check:
 *
 *   1. The skeleton row must occupy the SAME BOX as the row it stands in for.
 *      That is what stops the swap from lurching, and it is a computed result of
 *      padding, line-height and the flex box — not something a regex can see.
 *   2. The shimmer must actually be RUNNING (a keyframes block that no rule
 *      references animates nothing).
 *   3. `prefers-reduced-motion` must actually STOP it. The media query can be
 *      present and still be outranked, or name a class that no longer exists.
 *
 * Modelled on `plugins/dsh-git/test/skeleton-probe.mjs`, which does the same for
 * dsh-git's diff pane. Deliberately NOT part of `pnpm test`: it needs Chrome on
 * the machine, and the suite has to stay runnable offline on a bare checkout.
 *
 * Usage:
 *   node scripts/progress-probe.mjs
 *   CHROME="/path/to/chrome" node scripts/progress-probe.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.CDP_PORT ?? 39412)

/**
 * Slice a plugin's WHOLE stylesheet out of its built browser bundle.
 *
 * The anchor names a rule known to be inside the sheet; the slice then runs
 * from the opening backtick of that template literal to its close, so the page
 * gets every rule the plugin injects.
 *
 * Slicing forward from the anchor RULE instead is the trap this probe hit
 * first: dsh-plan-board declares its skeleton's `prefers-reduced-motion`
 * counterpart above `.dshpb-tab`, so a forward slice silently dropped it and
 * the probe reported a reduced-motion bug the plugin does not have. The plugin
 * injects ONE sheet — a fixture that takes half of it is testing the fixture.
 */
function cssOf(plugin, anchor) {
  const bundle = readFileSync(join(repoRoot, 'plugins', plugin, 'lib', 'client.js'), 'utf8')
  const at = bundle.indexOf(anchor)
  if (at < 0) throw new Error(`${plugin}: could not find ${anchor} in the built bundle`)
  const tick = String.fromCharCode(96)
  const start = bundle.lastIndexOf(tick, at)
  const end = bundle.indexOf(tick, at)
  if (start < 0 || end < 0) throw new Error(`${plugin}: could not bound the stylesheet literal`)
  return bundle.slice(start + 1, end)
}

/*
 * Each case renders the SKELETON and the REAL row it replaces side by side in
 * one page, so the comparison is a measurement rather than two numbers recorded
 * at different times.
 */
const CASES = [
  {
    plugin: 'dsh-todo',
    anchor: '.dshtd {',
    skeleton: `<ul class="dshtd-skel" id="skel"><li class="dshtd-skel-row" id="srow"><span class="dshtd-skel-lead"><i id="bar"></i></span><span class="dshtd-skel-bar" style="width:62%"></span></li></ul>`,
    real: `<ul class="dshtd-list"><li class="dshtd-row" id="rrow"><span class="dshtd-badge">x</span><span class="dshtd-text">Ship the thing</span></li></ul>`,
    wrapper: 'dshtd',
  },
  {
    plugin: 'dsh-memory',
    anchor: '.dshmem {',
    skeleton: `<div class="dshmem-skel" id="skel"><div class="dshmem-skel-row" id="srow"><span class="dshmem-skel-path" style="width:58%"><i id="bar"></i></span><span class="dshmem-skel-stats"><i></i></span></div></div>`,
    real: `<div class="dshmem-files"><button class="dshmem-file" id="rrow"><span class="dshmem-path">AGENTS.md</span><span class="dshmem-stats"><span>2 KB</span></span></button></div>`,
    wrapper: 'dshmem',
  },
  {
    plugin: 'dsh-plan-board',
    anchor: '.dshpb-tab {',
    skeleton: `<div class="dshpb-skel" id="skel"><div class="dshpb-skel-row" id="srow"><span class="dshpb-skel-title" style="width:74%"><i id="bar"></i></span><span class="dshpb-skel-meta"><span class="dshpb-skel-pill"></span><span class="dshpb-skel-when"></span></span></div></div>`,
    real: `<div class="dshpb-list"><button class="dshpb-row" id="rrow"><span class="dshpb-row-title">Unify progress indicators</span><span class="dshpb-row-meta"><span class="dshpb-pill">approved</span><span>2h ago</span></span></button></div>`,
    wrapper: 'dshpb-tab',
  },
]

const dir = mkdtempSync(join(tmpdir(), 'dsh-progress-'))
const profile = mkdtempSync(join(tmpdir(), 'dsh-progress-cdp-'))
const pages = []

for (const testCase of CASES) {
  const css = cssOf(testCase.plugin, testCase.anchor)
  /*
   * The `#root { zoom: … }` wrapper is how dsh-theme applies its UI scale, and
   * it must be REAL here: without it the 90% pass renders identically to 100%
   * and reports a pass having exercised nothing.
   */
  const html =
    '<!doctype html><meta charset=utf-8><style>' +
    'html,body{margin:0;background:#111;color:#eee}' +
    '#root{zoom:var(--dshth-ui-scale,1)}' +
    css +
    '</style>' +
    '<div id="root">' +
    `<div class="${testCase.wrapper}">` +
    testCase.skeleton +
    testCase.real +
    '</div>' +
    '</div>'
  const page = join(dir, `${testCase.plugin}.html`)
  writeFileSync(page, html)
  pages.push({ ...testCase, page })
}

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function waitForCdp() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version')
      if (r.ok) return await r.json()
    } catch {
      /* chrome is still coming up */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('chrome never exposed a CDP endpoint')
}

const version = await waitForCdp()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let nextId = 1
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
const send = (method, params = {}, sid) => {
  const id = nextId++
  return new Promise((res) => {
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params, sessionId: sid }))
  })
}

const { result: target } = await send('Target.createTarget', { url: 'about:blank' })
const { result: attached } = await send('Target.attachToTarget', {
  targetId: target.targetId,
  flatten: true,
})
const sid = attached.sessionId
await send('Page.enable', {}, sid)
await send('Runtime.enable', {}, sid)
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false }, sid)

const MEASURE = `(() => {
  const box = (id) => {
    const el = document.getElementById(id)
    if (el === null) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return { h: Math.round(r.height * 10) / 10, pad: cs.padding }
  }
  const bar = document.getElementById('bar')
  return JSON.stringify({
    skel: box('srow'),
    real: box('rrow'),
    anims: bar === null ? [] : bar.getAnimations().map((a) => a.animationName || ''),
    animCount: bar === null ? 0 : bar.getAnimations().length,
  })
})()`

const failures = []
const results = []

/*
 * 100% is the scale that hides an entire class of bug in this repo: measuring
 * in viewport px and writing in author px is exactly self-consistent there and
 * wrong by the zoom factor everywhere else. So each skeleton is measured at 90%
 * too, applied the way dsh-theme applies it -- an inline custom property on
 * <body> feeding `#root { zoom: … }` -- rather than as a device pixel ratio,
 * which is a different mechanism with different rounding.
 */
const SCALES = [1, 0.9]

for (const testCase of pages) {
  const perScale = {}

  for (const scale of SCALES) {
    await send(
      'Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] },
      sid,
    )
    await send('Page.navigate', { url: 'file:///' + testCase.page.replace(/\\/g, '/') }, sid)
    await new Promise((r) => setTimeout(r, 420))
    await send(
      'Runtime.evaluate',
      {
        expression: `document.body.style.setProperty('--dshth-ui-scale', '${scale}'); true`,
        returnByValue: true,
      },
      sid,
    )
    await new Promise((r) => setTimeout(r, 140))
    const { result: normal } = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true }, sid)
    const data = JSON.parse(normal.result.value)
    const label = `${Math.round(scale * 100)}%`
    perScale[label] = data

    if (data.skel === null || data.real === null) {
      failures.push(`${testCase.plugin} @ ${label}: fixture did not render both rows`)
      continue
    }
    // The skeleton row must occupy the same box as the row it replaces, or the
    // list jumps when real content arrives. The tolerance follows the zoom,
    // since both sides are reported in true viewport px.
    if (Math.abs(data.skel.h - data.real.h) > 1 * scale + 0.2) {
      failures.push(
        `${testCase.plugin} @ ${label}: skeleton row is ${data.skel.h}px but the real row is ${data.real.h}px — the swap would lurch`,
      )
    }
    if (data.skel.pad !== data.real.pad) {
      failures.push(
        `${testCase.plugin} @ ${label}: skeleton padding ${data.skel.pad} != real row padding ${data.real.pad}`,
      )
    }
    if (data.animCount < 1) {
      failures.push(`${testCase.plugin} @ ${label}: the shimmer is not running — a keyframes block nothing references`)
    }
  }

  // --- reduced motion ----------------------------------------------------
  // Checked once: the media query does not interact with the zoom, and what
  // matters is that it actually STOPS the sweep rather than merely being
  // declared somewhere the cascade ignores.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sid)
  await send('Page.reload', {}, sid)
  await new Promise((r) => setTimeout(r, 450))
  const { result: reduced } = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true }, sid)
  const reducedData = JSON.parse(reduced.result.value)

  results.push({ plugin: testCase.plugin, scales: perScale, reduced: reducedData })

  if (reducedData.animCount !== 0) {
    failures.push(
      `${testCase.plugin}: prefers-reduced-motion did NOT stop the shimmer (${reducedData.animCount} animation(s) still running)`,
    )
  }
}

for (const entry of results) {
  console.log(`\n  ${entry.plugin}`)
  for (const [label, data] of Object.entries(entry.scales)) {
    const geom = data.skel !== null && data.real !== null ? `${data.skel.h}/${data.real.h}px` : 'n/a'
    console.log(`    ${label.padEnd(6)} skeleton/real ${geom.padEnd(16)} ${data.animCount} animation(s)`)
  }
  console.log(`    reduced-motion  ${entry.reduced.animCount} animation(s) running`)
}

ws.close()
chrome.kill()
await new Promise((r) => setTimeout(r, 300))
for (const path of [dir, profile]) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
  } catch {
    /* windows holds the profile briefly after kill */
  }
}

if (failures.length > 0) {
  console.log('\nFAIL:')
  for (const f of failures) console.log('  x ' + f)
  process.exit(1)
}
console.log('')
console.log('  ok  every skeleton row matches the box of the row it replaces')
console.log('  ok  ...at 100% AND 90% UI scale')
console.log('  ok  every shimmer is actually running')
console.log('  ok  prefers-reduced-motion stops every shimmer')
