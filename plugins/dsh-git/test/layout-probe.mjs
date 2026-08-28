import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.CDP_PORT ?? 39333)

// Pull the stylesheet out of the BUILT bundle so this tests what actually ships.
const bundle = readFileSync('lib/client.js', 'utf8')
const start = bundle.indexOf('.dshgit {')
if (start < 0) throw new Error('could not find .dshgit in bundle')
const end = bundle.indexOf(String.fromCharCode(96), start)
const css = bundle.slice(start, end)
if (!css.includes('@container')) throw new Error('bundle css missing @container')

const html = '<!doctype html><meta charset=utf-8><style>' +
  'html,body{margin:0;height:100%;background:#111}' +
  '#host{height:100vh;display:flex;flex-direction:column}' + css + '</style>' +
  '<div id=host><div class="dshgit">' +
  '<div class="dshgit-head"><span class="dshgit-branch">main</span></div>' +
  '<div class="dshgit-commit"><textarea class="dshgit-msg"></textarea></div>' +
  '<div class="dshgit-panes hasdiff">' +
    '<div class="dshgit-scroll" id="list"><div class="dshgit-section">' +
      '<ul class="dshgit-list"><li class="dshgit-row">a.ts</li><li class="dshgit-row">b.ts</li></ul>' +
    '</div></div>' +
    '<div class="dshgit-diff" id="diff"><div class="dshgit-diffhead">a.ts</div>' +
      '<pre class="dshgit-diffbody"><div class="dshgit-dl add">+ a fairly long added line used to check that wrapping still holds</div></pre>' +
    '</div>' +
  '</div>' +
  '<div class="dshgit-foot">footer</div></div></div>'

const dir = mkdtempSync(join(tmpdir(), 'dshgit-layout-'))
const page = join(dir, 'probe.html')
writeFileSync(page, html)

const profile = mkdtempSync(join(tmpdir(), 'dshgit-cdp-'))
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', 'about:blank'], { stdio: 'ignore' })

async function waitForCdp() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) return await r.json() } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('chrome devtools endpoint never came up')
}

const version = await waitForCdp()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r, { once: true }))
let id = 1
const pending = new Map()
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
function send(method, params = {}, sessionId) {
  const i = id++
  return new Promise(res => { pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
}

const { result: target } = await send('Target.createTarget', { url: 'about:blank' })
const { result: att } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
const sid = att.sessionId
await send('Page.enable', {}, sid)
await send('Runtime.enable', {}, sid)

const EXPR = '(() => {' +
  'const l = document.getElementById("list").getBoundingClientRect();' +
  'const d = document.getElementById("diff").getBoundingClientRect();' +
  'const p = getComputedStyle(document.querySelector(".dshgit-panes"));' +
  'return JSON.stringify({dir:p.flexDirection,' +
  'list:{x:Math.round(l.x),y:Math.round(l.y),w:Math.round(l.width),h:Math.round(l.height)},' +
  'diff:{x:Math.round(d.x),y:Math.round(d.y),w:Math.round(d.width),h:Math.round(d.height)}});})()'

async function measure(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sid)
  await send('Page.navigate', { url: 'file:///' + page.replace(/\\/g, '/') }, sid)
  await new Promise(r => setTimeout(r, 400))
  const { result } = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true }, sid)
  return JSON.parse(result.result.value)
}

const wide = await measure(1200, 800)
const narrow = await measure(560, 800)
console.log('WIDE  (1200):', JSON.stringify(wide))
console.log('NARROW (560):', JSON.stringify(narrow))

const fail = []
if (wide.dir !== 'row') fail.push('wide: flex-direction ' + wide.dir + ', expected row')
if (!(wide.diff.x >= wide.list.x + wide.list.w - 2)) fail.push('wide: diff not right of list')
if (Math.abs(wide.diff.y - wide.list.y) > 2) fail.push('wide: panes not top-aligned')
if (narrow.dir !== 'column') fail.push('narrow: flex-direction ' + narrow.dir + ', expected column')
// Stacked, the diff sits BELOW the list in normal flow. It must not float over
// the list: an overlay held rows still but hid the row that had just been
// clicked whenever the list was scrolled near its end. Row stability under the
// resize is asserted separately by test:stability.
if (!(narrow.diff.y >= narrow.list.y + narrow.list.h - 2)) fail.push('narrow: diff not below list')
if (Math.abs(narrow.diff.x - narrow.list.x) > 2) fail.push('narrow: diff not left-aligned with list')

ws.close(); chrome.kill()
// Chrome releases its profile lock asynchronously, so a rmSync here races it on
// Windows and throws EPERM. The temp dirs are disposable; failing to unlink one
// must not fail the check.
await new Promise(r => setTimeout(r, 300))
for (const d of [dir, profile]) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }) } catch {} }

if (fail.length) { console.log(''); console.log('FAIL:'); for (const f of fail) console.log('  x ' + f); process.exit(1) }
console.log('')
console.log('  ok  wide: diff sits to the RIGHT of the file list')
console.log('  ok  narrow: diff drops BELOW the file list')