import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.CDP_PORT ?? 39444)

// Assert against the BUILT bundle: every icon must be a 16px svg on a matching
// 0 0 16 16 viewBox (the shell pairs each size with its own viewBox), and every
// icon button must be a 24px square so file rows keep a stable height.
const bundle = readFileSync('lib/client.js', 'utf8')

const svgs = [...bundle.matchAll(/width:"(\d+)",height:"(\d+)",viewBox:"0 0 (\d+) (\d+)"/g)]
const bad = svgs.filter(m => !(m[1] === m[3] && m[2] === m[4]))
console.log('inline svgs found:', svgs.length)
for (const m of svgs) console.log('  ' + m[1] + 'x' + m[2] + ' viewBox ' + m[3] + 'x' + m[4])

const start = bundle.indexOf('.dshgit {')
const css = bundle.slice(start, bundle.indexOf(String.fromCharCode(96), start))

const html = '<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#111}' + css +
  '</style><div class="dshgit"><ul class="dshgit-list">' +
  '<li class="dshgit-row" id="row"><span class="dshgit-code M">M</span>' +
  '<span class="dshgit-path"><span><span class="dshgit-base">a.ts</span></span></span>' +
  '<span class="dshgit-rowbtns" style="opacity:1">' +
  '<button class="dshgit-icon" id="btn"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" id="g"><path d="M3.5 8h9"/></svg></button>' +
  '</span></li></ul></div>'

const dir = mkdtempSync(join(tmpdir(), 'dshgit-icon-'))
const page = join(dir, 'icon.html')
writeFileSync(page, html)
const profile = mkdtempSync(join(tmpdir(), 'dshgit-cdp-'))
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
const EXPR = '(() => { const b = document.getElementById("btn").getBoundingClientRect();' +
  'const g = document.getElementById("g").getBoundingClientRect();' +
  'const r = document.getElementById("row").getBoundingClientRect();' +
  'return JSON.stringify({btn:[Math.round(b.width),Math.round(b.height)],glyph:[Math.round(g.width),Math.round(g.height)],rowH:Math.round(r.height)}); })()'
const { result } = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true }, sid)
const m = JSON.parse(result.result.value)
console.log('measured:', JSON.stringify(m))

ws.close(); chrome.kill()
await new Promise(r => setTimeout(r, 300))
for (const d of [dir, profile]) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }) } catch {} }

const fail = []
if (bad.length) fail.push(bad.length + ' svg(s) whose width/height do not match their viewBox')
if (svgs.some(s => s[1] !== '16')) fail.push('an inline svg is not 16px')
if (m.glyph[0] !== 16 || m.glyph[1] !== 16) fail.push('rendered glyph is ' + m.glyph.join('x') + ', expected 16x16')
if (m.btn[0] !== 20 || m.btn[1] !== 20) fail.push('icon button is ' + m.btn.join('x') + ', expected 20x20')
// 32px is the pre-existing row height (20px button + 2x5px padding + 2x1px border).
if (m.rowH > 32) fail.push('row grew to ' + m.rowH + 'px, expected <= 32')
if (fail.length) { console.log(''); console.log('FAIL:'); for (const f of fail) console.log('  x ' + f); process.exit(1) }
console.log('')
console.log('  ok  every inline icon is 16px on a matching 16-unit viewBox')
console.log('  ok  glyph renders 16x16 in a 20x20 button, row height ' + m.rowH + 'px')
