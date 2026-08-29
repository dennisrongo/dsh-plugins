/**
 * Branch-menu and Repo-pane geometry, against the BUILT stylesheet in headless
 * Chrome. Three invariants the other probes cannot see:
 *
 *  1. The menu must STACK ABOVE the panes. It is position: fixed with a z-index,
 *     and the panes below it create their own stacking contexts; get that wrong
 *     and the menu renders behind the file list, which reads as the button
 *     doing nothing at all.
 *  2. The menu must stay ON SCREEN at a narrow width. The tab is resized by the
 *     shell's panels independently of the viewport, so a menu anchored to a
 *     button near the right edge is the normal case, not the edge case.
 *  3. Stash and worktree rows reuse .dshgit-row and must hold the same 32px
 *     budget the icon probe pins for file rows. They carry extra columns (a
 *     path, tags), and a tag with a taller line box would silently inflate every
 *     row and desynchronise the Repo pane from the Changes list.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.CDP_PORT ?? 39361)
const bundle = readFileSync('lib/client.js', 'utf8')
const start = bundle.indexOf('.dshgit {')
const end = bundle.indexOf(String.fromCharCode(96), start)
const css = bundle.slice(start, end)

const LT = String.fromCharCode(60)

/** One stash row, shaped as RepoPane renders it. */
function stashRow(i) {
  return LT + 'li class="dshgit-row" id="s' + i + '">' +
    LT + 'span class="dshgit-code A">S' + LT + '/span>' +
    LT + 'span class="dshgit-rowmain">WIP on main: 1a2b3c4 a reasonably long stash subject line' + LT + '/span>' +
    LT + 'span class="dshgit-rowmeta">3d' + LT + '/span>' +
    LT + 'span class="dshgit-rowbtns">' + LT + 'button class="dshgit-icon">' + LT + '/button>' + LT + '/span>' +
  LT + '/li>'
}

/** One worktree row, including the tags that could inflate it. */
function treeRow(i) {
  return LT + 'li class="dshgit-row" id="w' + i + '">' +
    LT + 'span class="dshgit-code R">W' + LT + '/span>' +
    LT + 'span class="dshgit-rowmain">feature/some-branch' + LT + '/span>' +
    LT + 'span class="dshgit-rowmeta">C:/Users/me/projects/some-worktree-' + i + LT + '/span>' +
    LT + 'span class="dshgit-tag">main' + LT + '/span>' +
    LT + 'span class="dshgit-tag ok">current' + LT + '/span>' +
    LT + 'span class="dshgit-tag warn">missing' + LT + '/span>' +
    LT + 'span class="dshgit-rowbtns">' + LT + 'button class="dshgit-icon danger">' + LT + '/button>' + LT + '/span>' +
  LT + '/li>'
}

let stashes = ''
for (let i = 0; i < 4; i++) stashes += stashRow(i)
let trees = ''
for (let i = 0; i < 3; i++) trees += treeRow(i)

let menuItems = ''
// Enough branches for the menu to reach its 60vh cap and actually OVERLAP the
// stacked diff pane. With a short menu the fixture never reaches the sticky
// diff head and the stacking assertion is decorative — that was the first
// version of this probe, and deleting the menu's z-index did not fail it.
for (let i = 0; i < 20; i++) {
  menuItems += LT + 'button class="dshgit-menu-item" id="m' + i + '">' +
    LT + 'span class="dshgit-menu-label">feature/branch-number-' + i + LT + '/span>' +
    LT + 'span class="dshgit-menu-sub">up2 down1' + LT + '/span>' +
  LT + '/button>'
}

const html = '<!doctype html><meta charset=utf-8><style>' +
  'html,body{margin:0;height:100%;background:#111}' +
  '#host{height:100vh;display:flex;flex-direction:column}' + css + '</style>' +
  '<div id=host><div class="dshgit" id="root">' +
  '<div class="dshgit-head">' +
    '<button class="dshgit-branchbtn" id="branchbtn" aria-expanded="true">' +
      '<span class="dshgit-branchname">main</span><span class="dshgit-caret">v</span>' +
    '</button><span class="dshgit-spacer"></span>' +
  '</div>' +
  '<div class="dshgit-modes">' +
    '<button class="dshgit-mode" aria-pressed="false">Changes</button>' +
    '<button class="dshgit-mode" aria-pressed="false">History</button>' +
    '<button class="dshgit-mode" id="mode-repo" aria-pressed="true">Repo</button>' +
  '</div>' +
  '<div class="dshgit-banner" id="banner">' +
    '<span class="dshgit-banner-icon">!</span>' +
    '<span class="dshgit-banner-text">Merge in progress' +
      '<div class="dshgit-banner-what">Merge branch feature into main</div></span>' +
    '<button class="dshgit-btn">Continue</button>' +
    '<button class="dshgit-btn">Abort</button>' +
  '</div>' +
  '<div class="dshgit-panes hasdiff">' +
    '<div class="dshgit-scroll" id="list">' +
      '<div class="dshgit-section"><div class="dshgit-sechead"><span>Stashes</span></div>' +
        '<ul class="dshgit-list">' + stashes + '</ul></div>' +
      '<div class="dshgit-section"><div class="dshgit-sechead"><span>Worktrees</span></div>' +
        '<ul class="dshgit-list">' + trees + '</ul></div>' +
    '</div>' +
    // The REAL competitor for the menu: .dshgit-diffhead is position: sticky
    // with z-index: 1, which puts it in a HIGHER paint layer than a positioned
    // element whose z-index is auto. Without it in the fixture the stacking
    // assertion proves nothing — verified by deleting the menu's z-index and
    // watching the probe still pass.
    '<div class="dshgit-diff" id="diff">' +
      '<div class="dshgit-diffhead" id="diffhead"><span>src/some/file.ts</span></div>' +
      '<pre class="dshgit-diffbody">' +
        '<div class="dshgit-dl meta">diff --git a/x b/x</div>' +
        '<div class="dshgit-dl add">+added line</div>' +
        '<div class="dshgit-dl del">-removed line</div>' +
      '</pre>' +
    '</div>' +
  '</div>' +
  // Rendered INSIDE .dshgit and before the footer, exactly where GitView puts
  // it, so DOM order and ancestry match the real thing.
  '<div class="dshgit-menu" id="menu" role="menu">' +
    '<input class="dshgit-menu-filter" id="filter">' +
    '<div class="dshgit-menu-head">Switch to</div>' + menuItems +
  '</div>' +
  '<div class="dshgit-foot">footer</div></div></div>'

const dir = mkdtempSync(join(tmpdir(), 'dshgit-menu-'))
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
    const out = await evaluate('(() => {' +
      'const btn=document.getElementById("branchbtn").getBoundingClientRect();' +
      'const menu=document.getElementById("menu");' +
      // Anchor the menu exactly the way BranchMenu does.
      'const W=300;' +
      'const left=Math.max(8,Math.min(btn.left,window.innerWidth-W-8));' +
      'menu.style.left=left+"px";menu.style.top=(btn.bottom+4)+"px";menu.style.width=W+"px";' +
      'document.body.offsetHeight;' +
      'const m=menu.getBoundingClientRect();' +
      // Sample the menu's WHOLE height: it overlaps the panes only lower down,
      // which is exactly where a stacking mistake shows.
      'const cx=Math.round(m.left+m.width/2);' +
      'let onTop=true, firstBad=null;' +
      'for(const f of [0.1,0.35,0.6,0.85]){' +
        'const cy=Math.round(m.top+m.height*f);' +
        'const hit=document.elementFromPoint(cx,cy);' +
        'if(!(hit&&menu.contains(hit))){onTop=false;if(!firstBad)firstBad=(hit?(hit.className||hit.tagName):"none")+"@"+f}' +
      '}' +
      'const R=(id)=>{const b=document.getElementById(id).getBoundingClientRect();return Math.round(b.height)};' +
      'return JSON.stringify({' +
        'menu:{l:Math.round(m.left),r:Math.round(m.right),w:Math.round(m.width)},' +
        'vw:window.innerWidth, onTop, firstBad,' +
        'stashH:R("s0"), treeH:R("w0"), bannerH:Math.round(document.getElementById("banner").getBoundingClientRect().height)' +
      '});})()')
    const d = JSON.parse(out)
    console.log('== ' + label + ' (' + width + 'px) ==')
    console.log('  menu: left ' + d.menu.l + ' right ' + d.menu.r + ' of viewport ' + d.vw)
    console.log('  menu is topmost down its whole height: ' + d.onTop + (d.firstBad ? ' (covered by ' + d.firstBad + ')' : ''))
    console.log('  stash row ' + d.stashH + 'px, worktree row ' + d.treeH + 'px, banner ' + d.bannerH + 'px')

    if (!d.onTop) {
      fail.push(label + ': the menu renders BEHIND the panes (covered by ' + d.firstBad + ')')
    }
    if (d.menu.r > d.vw) {
      fail.push(label + ': the menu overflows the right edge by ' + (d.menu.r - d.vw) + 'px')
    }
    if (d.menu.l < 0) fail.push(label + ': the menu overflows the LEFT edge to ' + d.menu.l)
    // The same budget the icon probe pins for file rows.
    if (d.stashH !== 32) fail.push(label + ': stash row is ' + d.stashH + 'px, expected 32')
    if (d.treeH !== 32) fail.push(label + ': worktree row is ' + d.treeH + 'px, expected 32')
    if (d.bannerH <= 0) fail.push(label + ': the merge banner has no height')
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
console.log('  ok  the branch menu stacks above the panes at both widths')
console.log('  ok  the branch menu stays inside the viewport when anchored near the edge')
console.log('  ok  stash and worktree rows hold the 32px row budget')
