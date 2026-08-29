import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.CDP_PORT ?? 39666)

// Assert against the BUILT bundle: every icon must be a 16px svg on a matching
// 0 0 16 16 viewBox (the shell pairs each size with its own viewBox), every text
// size must come from the shell's 12/14/16 scale, and rows must not grow.
const bundle = readFileSync('lib/client.js', 'utf8')

const svgs = [...bundle.matchAll(/width:"(\d+)",height:"(\d+)",viewBox:"0 0 (\d+) (\d+)"/g)]
const badBox = svgs.filter(m => !(m[1] === m[3] && m[2] === m[4]))
console.log('inline svgs found:', svgs.length)
for (const m of svgs) console.log('  ' + m[1] + 'x' + m[2] + ' viewBox ' + m[3] + 'x' + m[4])

const start = bundle.indexOf('.dshtd {')
const css = bundle.slice(start, bundle.indexOf(String.fromCharCode(96), start))

// Every declared font-size must be on the shell scale.
const ALLOWED = new Set(['12', '14', '16', '20'])
const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map(m => m[1])
const offScale = [...new Set(sizes.filter(s => !ALLOWED.has(s)))]
console.log('declared font sizes:', [...new Set(sizes)].sort((a,b)=>a-b).join(', '))

const html = '<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#111}' + css +
  '</style><div class="dshtd"><ul class="dshtd-list">' +
  '<li class="dshtd-row" id="row">' +
  '<input type="checkbox" class="dshtd-check" id="check">' +
  '<span class="dshtd-text" id="text">Write the thing</span>' +
  // The metadata chips ride the same 20px line as the icon button. They are in
  // the fixture because the 40px budget is only meaningfully asserted against
  // the row as it is ACTUALLY rendered — chips included.
  '<span class="dshtd-chips" id="chips">' +
  '<span class="dshtd-chip p0">P0</span>' +
  '<span class="dshtd-chip rel">1.5</span>' +
  '<span class="dshtd-chip due-over" id="due">Mar 14</span>' +
  '<select class="dshtd-status s-in-progress" id="pill"><option>In Progress</option></select>' +
  '</span>' +
  '<span class="dshtd-age" id="age">2h</span>' +
  '<span class="dshtd-rowbtns" id="btns" style="opacity:1">' +
  '<button class="dshtd-icon" id="btn"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" id="g"><path d="M8 12.5v-9"/></svg></button>' +
  '</span></li>' +
  '<li class="dshtd-row archived" id="arow">' +
  '<span class="dshtd-badge" id="badge"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M3.5 8.5l3 3 6-6"/></svg></span>' +
  '<span class="dshtd-text">Archived thing</span>' +
  '<span class="dshtd-chip rel">v1.1.0</span></li>' +
  '</ul></div>'

const dir = mkdtempSync(join(tmpdir(), 'dshtd-icon-'))
const page = join(dir, 'icon.html')
writeFileSync(page, html)
const profile = mkdtempSync(join(tmpdir(), 'dshtd-cdp-'))
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
  'const g = q("g"), b = q("btn"), r = q("row"), c = q("check"), ar = q("arow"), bd = q("badge");' +
  'const ch = q("chips"), pl = q("pill");' +
  'const cs = getComputedStyle(document.getElementById("text"));' +
  'return JSON.stringify({glyph:[Math.round(g.width),Math.round(g.height)],btn:[Math.round(b.width),Math.round(b.height)],' +
  'check:[Math.round(c.width),Math.round(c.height)],badge:[Math.round(bd.width),Math.round(bd.height)],' +
  'chipsH:Math.round(ch.height),pillH:Math.round(pl.height),' +
  'rowH:Math.round(r.height),archRowH:Math.round(ar.height),textFs:cs.fontSize,textLh:cs.lineHeight}); })()'
const { result } = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true }, sid)
const m = JSON.parse(result.result.value)
console.log('measured:', JSON.stringify(m))

ws.close(); chrome.kill()
await new Promise(r => setTimeout(r, 300))
for (const d of [dir, profile]) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }) } catch {} }

const fail = []
if (badBox.length) fail.push(badBox.length + ' svg(s) whose width/height do not match their viewBox')
if (svgs.some(s => s[1] !== '16')) fail.push('an inline svg is not 16px')
if (!svgs.length) fail.push('no inline svg icons found in the bundle')
if (offScale.length) fail.push('off-scale font-size(s): ' + offScale.map(s => s + 'px').join(', '))
if (m.glyph[0] !== 16 || m.glyph[1] !== 16) fail.push('glyph is ' + m.glyph.join('x') + ', expected 16x16')
if (m.btn[0] !== 20 || m.btn[1] !== 20) fail.push('icon button is ' + m.btn.join('x') + ', expected 20x20')
if (m.check[0] !== 16) fail.push('checkbox is ' + m.check.join('x') + ', expected 16 wide')
if (m.badge[0] !== 16) fail.push('archived badge is ' + m.badge.join('x') + ', expected 16 wide')
if (m.textFs !== '14px') fail.push('row text is ' + m.textFs + ', expected 14px')
// Named separately from rowH so a regression says WHICH control grew, rather
// than only that the row did.
if (m.chipsH > 20) fail.push('metadata chips are ' + m.chipsH + 'px, expected 20 (they set the row height)')
if (m.pillH > 20) fail.push('status pill is ' + m.pillH + 'px, expected 20 (it sets the row height)')
if (m.rowH > 40) fail.push('row grew to ' + m.rowH + 'px')
if (m.archRowH > 40) fail.push('archived row grew to ' + m.archRowH + 'px')
if (fail.length) { console.log(''); console.log('FAIL:'); for (const f of fail) console.log('  x ' + f); process.exit(1) }
console.log('')
console.log('  ok  every inline icon is 16px on a matching 16-unit viewBox')
console.log('  ok  every declared font-size is on the shell 12/14/16 scale')
console.log('  ok  glyph 16x16 in a 20x20 button; check/badge 16px; row ' + m.rowH + 'px, text ' + m.textFs + '/' + m.textLh)
console.log('  ok  chips ' + m.chipsH + 'px and status pill ' + m.pillH + 'px stay on the 20px row line')
