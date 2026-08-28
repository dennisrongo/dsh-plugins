/**
 * Modal probe: the task dialog must ESCAPE the tab's scroll container.
 *
 * The list is `overflow-y: auto`, so a dialog rendered inside it would be
 * clipped — the reason TodoModal portals to document.body. This drives real
 * Chrome against the BUILT bundle's CSS and asserts the rendered geometry:
 * the panel is fully visible, centred, and clear of DSH Desktop's 36px
 * window-drag strip, which swallows clicks regardless of z-index.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.CDP_PORT ?? 39667)
const DRAG_STRIP = 36

const bundle = readFileSync('lib/client.js', 'utf8')
const start = bundle.indexOf('.dshtd {')
const css = bundle.slice(start, bundle.indexOf(String.fromCharCode(96), start))

// A short scroll container with a tall list: anything rendered INSIDE it and
// positioned beyond its box would be clipped, which is exactly the bug.
const html = '<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#111}' + css +
  // The tab is deliberately SHORT and near the top: a dialog rendered inside
  // its scroller could not reach the middle of a 600px viewport.
  '</style><div class="dshtd" style="height:200px">' +
  '<div class="dshtd-scroll" id="scroll" style="height:200px">' +
  '<ul class="dshtd-list"><li class="dshtd-row"><span class="dshtd-text">Task</span></li></ul>' +
  '</div></div>' +
  // Portalled sibling of the tab, as createPortal(document.body) renders it.
  '<div class="dshtd-modal-backdrop" id="backdrop">' +
  '<div class="dshtd-modal" id="panel" role="dialog" aria-modal="true">' +
  '<div class="dshtd-modal-head"><input class="dshtd-modal-title" id="title" value="A task"></div>' +
  '<div class="dshtd-modal-body"><textarea class="dshtd-modal-desc" id="desc"></textarea></div>' +
  '<div class="dshtd-modal-foot"><span>Created 2d ago</span></div>' +
  '</div></div>'

const dir = mkdtempSync(join(tmpdir(), 'dshtd-modal-'))
const page = join(dir, 'modal.html')
writeFileSync(page, html)
const profile = mkdtempSync(join(tmpdir(), 'dshtd-mcdp-'))
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' })

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
let id = 1; const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
function send(method, params = {}, sessionId) { const i = id++; return new Promise(res => { pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })) }) }

const { result: target } = await send('Target.createTarget', { url: 'about:blank' })
const { result: att } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
const sid = att.sessionId
await send('Page.enable', {}, sid); await send('Runtime.enable', {}, sid)
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false }, sid)
await send('Page.navigate', { url: 'file:///' + page.replace(/\\/g, '/') }, sid)
await new Promise(r => setTimeout(r, 400))

const EXPR = '(() => { const q = i => document.getElementById(i).getBoundingClientRect();' +
  'const p = q("panel"), b = q("backdrop"), s = q("scroll");' +
  'const bs = getComputedStyle(document.getElementById("backdrop"));' +
  'const ps = getComputedStyle(document.getElementById("panel"));' +
  'const hit = document.elementFromPoint(Math.round(p.left + p.width / 2), Math.round(p.top + 8));' +
  'return JSON.stringify({' +
  'panel:[Math.round(p.left),Math.round(p.top),Math.round(p.width),Math.round(p.height)],' +
  'backdrop:[Math.round(b.width),Math.round(b.height)],' +
  'scrollBottom:Math.round(s.bottom), z:bs.zIndex, pos:bs.position, panelBg:ps.backgroundColor,' +
  'topHit: hit ? (hit.id || hit.className) : null, vh: window.innerHeight, vw: window.innerWidth}); })()'
const { result } = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true }, sid)
const m = JSON.parse(result.result.value)
console.log('measured:', JSON.stringify(m))

ws.close(); chrome.kill()
await new Promise(r => setTimeout(r, 300))
for (const d of [dir, profile]) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }) } catch {} }

const [px, py, pw, ph] = m.panel
const fail = []
if (m.pos !== 'fixed') fail.push('backdrop is position:' + m.pos + ', expected fixed (it must escape the scroller)')
if (m.backdrop[0] !== m.vw || m.backdrop[1] !== m.vh) fail.push('backdrop does not cover the viewport')
// The whole point: the panel outlives the 200px scroll container.
if (py + ph <= m.scrollBottom) fail.push('panel fits inside the scroll container — the probe is not proving escape')
if (py < 0 || px < 0) fail.push('panel is clipped off-screen at ' + px + ',' + py)
if (py + ph > m.vh) fail.push('panel bottom ' + (py + ph) + ' exceeds viewport ' + m.vh)
if (py < DRAG_STRIP) fail.push('panel top ' + py + 'px sits under the ' + DRAG_STRIP + 'px desktop drag strip, which swallows clicks')
if (Number(m.z) >= 2147483644) fail.push('z-index ' + m.z + ' collides with the desktop drag region')
// A transparent panel would leave the list bleeding through the dialog.
if (/rgba\(0, 0, 0, 0\)|transparent/.test(m.panelBg)) fail.push('panel background is transparent')
if (m.topHit === null) fail.push('nothing hit-tests at the panel top edge')
if (fail.length) { console.log(''); console.log('FAIL:'); for (const f of fail) console.log('  x ' + f); process.exit(1) }
console.log('')
console.log('  ok  backdrop is fixed and covers the viewport (escapes .dshtd-scroll)')
console.log('  ok  panel ' + pw + 'x' + ph + ' at ' + px + ',' + py + ' is fully on-screen and outlives the scroller')
console.log('  ok  panel clears the ' + DRAG_STRIP + 'px desktop drag strip and sits below z-index 2147483644')
