
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.CDP_PORT ?? 39355)
const bundle = readFileSync('lib/client.js', 'utf8')
const start = bundle.indexOf('.dshgit {')
const end = bundle.indexOf(String.fromCharCode(96), start)
const css = bundle.slice(start, end)

let rows = ''
for (let i = 0; i < 40; i++) rows += '<li class="dshgit-row" id="r' + i + '">file-' + i + '.ts</li>'

const html = '<!doctype html><meta charset=utf-8><style>' +
  'html,body{margin:0;height:100%;background:#111}' +
  '#host{height:100vh;display:flex;flex-direction:column}' + css + '</style>' +
  '<div id=host><div class="dshgit" id="root">' +
  '<div class="dshgit-head"><span class="dshgit-branch">main</span></div>' +
  '<div class="dshgit-commit"><textarea class="dshgit-msg"></textarea></div>' +
  '<div class="dshgit-panes">' +
    '<div class="dshgit-scroll" id="list"><div class="dshgit-section">' +
      '<ul class="dshgit-list">' + rows + '</ul>' +
    '</div></div>' +

  '</div>' +
  '<div class="dshgit-foot">footer</div></div></div>'

const dir = mkdtempSync(join(tmpdir(), 'dshgit-jump-'))
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
  throw new Error('no cdp')
}
const version = await waitForCdp()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r, { once: true }))
let id = 1
const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
function send(method, params = {}, sessionId) {
  const i = id++
  return new Promise(res => { pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
}
const { result: target } = await send('Target.createTarget', { url: 'about:blank' })
const { result: att } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
const sid = att.sessionId
await send('Page.enable', {}, sid); await send('Runtime.enable', {}, sid)

async function evaluate(expr) {
  const { result } = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sid)
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}

async function run(width, label, fail, atBottom) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false }, sid)
  await send('Page.navigate', { url: 'file:///' + page.replace(/\\/g, '/') }, sid)
  await new Promise(r => setTimeout(r, 400))
  // Simulate the click that opens a diff: React mounts the diff pane and flags
  // the panes container. Nothing about the list itself may change.
  const out = await evaluate('(() => {' +
    'const R=(i)=>{const b=document.getElementById("r"+i).getBoundingClientRect();return {y:Math.round(b.y),x:Math.round(b.x),w:Math.round(b.width)}};' +
    'const list=document.getElementById("list");' +
    (atBottom ? 'list.scrollTop=list.scrollHeight;document.body.offsetHeight;' : '') +
    'const beforeScrollH=list.scrollHeight;const beforeClientH=list.clientHeight;' +
    'const before=[R(0),R(8),R(20)];' +
    'document.querySelector(".dshgit-panes").classList.add("hasdiff");' +
    'const dv=document.createElement("div");dv.className="dshgit-diff";dv.id="diff";' +
    'dv.innerHTML=String.fromCharCode(60)+"div class=\\"dshgit-diffhead\\">a.ts"+String.fromCharCode(60)+"/div>";' +
    'document.querySelector(".dshgit-panes").appendChild(dv);' +
    'document.body.offsetHeight;' +
    'const after=[R(0),R(8),R(20)];' +
    'const afterClientH=list.clientHeight;' +
    'const dnode=document.getElementById("diff");const dr=dnode.getBoundingClientRect();const lr=list.getBoundingClientRect();' +
    'return JSON.stringify({before,after,beforeClientH,afterClientH,beforeScrollH,scrollTop:list.scrollTop,' +
    'diffX:Math.round(dr.x),diffY:Math.round(dr.y),listRight:Math.round(lr.right),listBottom:Math.round(lr.bottom)});})()')
  const d = JSON.parse(out)
  console.log('== ' + label + ' (' + width + 'px) ==')
  const names = ['row0','row8','row20']
  d.before.forEach((b, i) => {
    const a = d.after[i]
    console.log('  ' + names[i] + ': y ' + b.y + ' -> ' + a.y + '  (dy ' + (a.y - b.y) + ')   w ' + b.w + ' -> ' + a.w)
  })
  console.log('  list clientHeight: ' + d.beforeClientH + ' -> ' + d.afterClientH + ' (content ' + d.beforeScrollH + ')')
  // The click must not move a single row. A row that shifts vertically slid out
  // from under the pointer; a row that changes width reflowed and re-truncated
  // its filename. Both read to a user as "the list jumped".
  d.before.forEach((b, i) => {
    const a = d.after[i]
    if (a.y !== b.y) fail.push(label + ': row ' + i + ' moved ' + (a.y - b.y) + 'px vertically')
    // 1px of slack: the diff's own scrollbar may claim a pixel from the column.
    if (Math.abs(a.w - b.w) > 1) fail.push(label + ': row ' + i + ' width changed ' + b.w + ' -> ' + a.w)
  })
  // A shorter scrollport is allowed — shrinking one does not move its content,
  // because max scrollTop rises as the port shrinks so nothing gets clamped.
  // What is NOT allowed is the diff covering the rows: it must sit below the
  // list (stacked) or to its right (side by side), never on top of it.
  const below = d.diffY >= d.listBottom - 1
  const right = d.diffX >= d.listRight - 1
  if (!below && !right) {
    fail.push(label + ': diff covers the list (diff at ' + d.diffX + ',' + d.diffY +
      ' vs list right ' + d.listRight + ' bottom ' + d.listBottom + ')')
  }
}

const fail = []
// Top of the list and, crucially, scrolled hard to the BOTTOM: that is where a
// resize has the least room to absorb and where occlusion bugs surface.
await run(1200, 'WIDE top', fail, false)
await run(560, 'NARROW top', fail, false)
await run(1200, 'WIDE bottom', fail, true)
await run(560, 'NARROW bottom', fail, true)

if (fail.length) { console.log(''); console.log('FAIL:'); for (const f of fail) console.log('  x ' + f) }

ws.close(); chrome.kill()
await new Promise(r => setTimeout(r, 300))
for (const d of [dir, profile]) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }) } catch {} }

if (fail.length) process.exit(1)
console.log('')
console.log('  ok  opening a diff moves no row, at the top and at the bottom of a long list');console.log('  ok  the diff never covers the file list')