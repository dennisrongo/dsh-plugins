/**
 * History pane geometry, driven against the BUILT stylesheet in headless Chrome.
 *
 * Two invariants, and they are not the same as the changes list's:
 *
 *  1. Expanding a commit must not move the commit row that was CLICKED. Rows
 *     below it necessarily shift down — that is what expanding means — but the
 *     row under the pointer moving is the bug that made the changes list feel
 *     like it jumped away, and an expander is far more prone to it because it
 *     inserts content into the middle of the list rather than beside it.
 *  2. Commit rows must stay on the same 32px budget as file rows. The icon probe
 *     pins that height for .dshgit-row; history reuses that class, so a sha or
 *     timestamp column with a taller line-height would silently inflate every
 *     row and desynchronise the two lists.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.CDP_PORT ?? 39357)
const bundle = readFileSync('lib/client.js', 'utf8')
const start = bundle.indexOf('.dshgit {')
const end = bundle.indexOf(String.fromCharCode(96), start)
const css = bundle.slice(start, end)

const LT = String.fromCharCode(60)

/** One commit row, shaped exactly as HistoryPane renders it. */
function commitRow(i) {
  return LT + 'li>' +
    LT + 'div class="dshgit-row" id="c' + i + '" role="button" tabindex="0">' +
      LT + 'span class="dshgit-sha">a1b2c3' + i + LT + '/span>' +
      LT + 'span class="dshgit-subject">feat: commit number ' + i + ' with a reasonably long subject line' + LT + '/span>' +
      LT + 'span class="dshgit-when">' + i + 'd' + LT + '/span>' +
    LT + '/div>' +
  LT + '/li>'
}

let commits = ''
for (let i = 0; i < 15; i++) commits += commitRow(i)

const html = '<!doctype html><meta charset=utf-8><style>' +
  'html,body{margin:0;height:100%;background:#111}' +
  '#host{height:100vh;display:flex;flex-direction:column}' + css + '</style>' +
  '<div id=host><div class="dshgit" id="root">' +
  '<div class="dshgit-head"><span class="dshgit-branch">main</span></div>' +
  '<div class="dshgit-modes">' +
    '<button class="dshgit-mode" aria-pressed="false">Changes</button>' +
    '<button class="dshgit-mode" id="mode-history" aria-pressed="true">History</button>' +
  '</div>' +
  '<div class="dshgit-panes">' +
    '<div class="dshgit-scroll" id="list"><div class="dshgit-section">' +
      '<div class="dshgit-sechead"><span>History</span></div>' +
      '<ul class="dshgit-list" id="commits">' + commits + '</ul>' +
    '</div></div>' +
  '</div>' +
  '<div class="dshgit-foot">footer</div></div></div>'

const dir = mkdtempSync(join(tmpdir(), 'dshgit-hist-'))
const page = join(dir, 'probe.html')
writeFileSync(page, html)
const profile = mkdtempSync(join(tmpdir(), 'dshgit-cdp-'))
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', 'about:blank'], { stdio: 'ignore' })

const fail = []
let ws
try {
  async function waitForCdp() {
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) return await r.json() } catch {}
      await new Promise(r => setTimeout(r, 250))
    }
    throw new Error('no cdp')
  }
  const version = await waitForCdp()
  ws = new WebSocket(version.webSocketDebuggerUrl)
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

  async function run(width, label) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false }, sid)
    await send('Page.navigate', { url: 'file:///' + page.replace(/\\/g, '/') }, sid)
    await new Promise(r => setTimeout(r, 400))
    // Expand commit 5: inject the file sub-list exactly where HistoryPane puts
    // it, then re-measure. The clicked row must not have moved.
    const out = await evaluate('(() => {' +
      'const R=(id)=>{const b=document.getElementById(id).getBoundingClientRect();return {y:Math.round(b.y),h:Math.round(b.height)}};' +
      'const before={c5:R("c5"),c0:R("c0")};' +
      'const li=document.getElementById("c5").parentNode;' +
      'const ul=document.createElement("ul");ul.className="dshgit-commitfiles";ul.id="files";' +
      'ul.innerHTML="' + LT + 'li class=\\"dshgit-row\\" id=\\"f0\\">' + LT + 'span class=\\"dshgit-code M\\">M' + LT + '/span>' + LT + 'span class=\\"dshgit-path\\">' + LT + 'span>' + LT + 'span class=\\"dshgit-dir\\">src/' + LT + '/span>' + LT + 'span class=\\"dshgit-base\\">a.ts' + LT + '/span>' + LT + '/span>' + LT + '/span>' + LT + '/li>";' +
      'li.appendChild(ul);' +
      'document.body.offsetHeight;' +
      'const after={c5:R("c5"),c0:R("c0")};' +
      'const fileRow=R("f0");' +
      'const sha=document.querySelector("#c5 .dshgit-sha").getBoundingClientRect();' +
      'return JSON.stringify({before,after,fileRow,shaW:Math.round(sha.width)});})()')
    const d = JSON.parse(out)
    console.log('== ' + label + ' (' + width + 'px) ==')
    console.log('  clicked row c5: y ' + d.before.c5.y + ' -> ' + d.after.c5.y + '  height ' + d.after.c5.h)
    console.log('  row above c0:   y ' + d.before.c0.y + ' -> ' + d.after.c0.y)
    console.log('  expanded file row height: ' + d.fileRow.h)

    if (d.after.c5.y !== d.before.c5.y) {
      fail.push(label + ': the CLICKED commit row moved ' + (d.after.c5.y - d.before.c5.y) + 'px')
    }
    if (d.after.c0.y !== d.before.c0.y) {
      fail.push(label + ': a row ABOVE the expansion moved ' + (d.after.c0.y - d.before.c0.y) + 'px')
    }
    // Same budget the icon probe pins for file rows.
    if (d.after.c5.h !== 32) fail.push(label + ': commit row is ' + d.after.c5.h + 'px, expected 32')
    if (d.fileRow.h !== 32) fail.push(label + ': expanded file row is ' + d.fileRow.h + 'px, expected 32')
    // The sha column must actually render; a collapsed one means the monospace
    // rule never matched and the layout is not what it looks like.
    if (d.shaW <= 0) fail.push(label + ': the sha column has no width')
  }

  await run(1200, 'WIDE')
  await run(560, 'NARROW')
} catch (error) {
  fail.push('probe error: ' + (error && error.message ? error.message : String(error)))
} finally {
  try { ws?.close() } catch {}
  chrome.kill()
  await new Promise(r => setTimeout(r, 300))
  for (const d of [dir, profile]) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }) } catch {} }
}

if (fail.length) {
  console.log('')
  console.log('FAIL:')
  for (const f of fail) console.log('  x ' + f)
  process.exit(1)
}
console.log('')
console.log('  ok  expanding a commit moves neither the clicked row nor any row above it')
console.log('  ok  commit rows and expanded file rows hold the 32px row budget')
