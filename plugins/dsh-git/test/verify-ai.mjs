/**
 * Verify the AI commit-message path end-to-end against the RUNNING server:
 * click "AI message" in the live tab and assert real text lands in the box.
 *
 * This is the one feature no offline test can cover — it needs credentials, a
 * live model, and the whole Typert bridge working in both directions.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_UNDER_TEST = process.env.DSH_URL ?? 'http://127.0.0.1:38080/'
const CHROME =
  process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.CDP_PORT ?? 39224)

const profile = mkdtempSync(join(tmpdir(), 'dsh-git-ai-'))
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
   '--no-first-run', '--disable-gpu', '--window-size=1400,900', 'about:blank'],
  { stdio: 'ignore' },
)

async function waitForCdp() {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return r } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('no cdp')
}

let ws, nextId = 1
const pending = new Map()
function send(method, params = {}, sessionId) {
  const id = nextId++
  const p = { id, method, params }
  if (sessionId) p.sessionId = sessionId
  ws.send(JSON.stringify(p))
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    setTimeout(() => { if (pending.delete(id)) rej(new Error('timeout ' + method)) }, 180000)
  })
}
async function evaluate(s, e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, s)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description)
  return r.result.value
}

const CLICK_FN = `function __click(el){for(const t of ['pointerdown','mousedown','pointerup','mouseup','click']){el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}))}}`

let failed = false
function check(name, ok, detail) {
  if (ok) console.log(`  ok  ${name}`)
  else { console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); failed = true }
}

try {
  const ver = await waitForCdp()
  const { webSocketDebuggerUrl } = await ver.json()
  ws = new WebSocket(webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => rej(new Error('ws')), { once: true })
  })
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id)
      m.error ? rej(new Error(m.error.message)) : res(m.result)
    }
  })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Runtime.enable', {}, sessionId)
  await send('Page.navigate', { url: URL_UNDER_TEST }, sessionId)
  await new Promise((r) => setTimeout(r, 8000))

  // Pick a session under a workspace that HAS changes. The AI button is
  // correctly disabled on a clean tree, so testing generation against an
  // arbitrary session measures which session was newest, not the feature.
  const WORKSPACE = process.env.DSH_WORKSPACE ?? 'dsh-git-tree'
  const opened = await evaluate(
    sessionId,
    `(() => { ${CLICK_FN}
      const ws = Array.from(document.querySelectorAll('*')).find(
        e => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(WORKSPACE)});
      if (!ws) return 'no-workspace';
      // Expand the workspace, then take its first session row.
      __click(ws);
      return 'expanded';
    })()`,
  )
  check('the target workspace is present', opened === 'expanded', opened)
  await new Promise((r) => setTimeout(r, 2500))

  const picked = await evaluate(
    sessionId,
    `(() => { ${CLICK_FN}
      const rows = Array.from(document.querySelectorAll('[class*="sessionRow"]'))
        .filter(r => !/New Session/i.test(r.textContent || ''));
      if (rows.length === 0) return 'no-rows';
      __click(rows[0]);
      return (rows[0].textContent || '').trim().slice(0, 50);
    })()`,
  )
  console.log('  ..  opened session:', picked)
  await new Promise((r) => setTimeout(r, 7000))

  await evaluate(sessionId, `(() => { ${CLICK_FN}
    const tab = Array.from(document.querySelectorAll('button,[role="tab"]'))
      .find(e => (e.textContent || '').trim() === 'Changes');
    if (tab) __click(tab); return true; })()`)
  await new Promise((r) => setTimeout(r, 5000))

  // The AI button is disabled until a status with changes has loaded. Clicking
  // before then reads as "disabled" and is a race in the TEST, not the plugin.
  let ready = false
  const readyBy = Date.now() + 45000
  while (Date.now() < readyBy) {
    const state = JSON.parse(
      await evaluate(sessionId, `JSON.stringify({
        rows: document.querySelectorAll('.dshgit-row').length,
        disabled: (document.querySelector('.dshgit-btn.ai')||{}).disabled,
        foot: (document.querySelector('.dshgit-foot')||{}).innerText || ''
      })`),
    )
    if (state.rows > 0 && state.disabled === false) { ready = true; break }
    await new Promise((r) => setTimeout(r, 1000))
  }
  check('the tab loaded changes and enabled the AI button', ready)

  const before = await evaluate(sessionId, `(document.querySelector('.dshgit-msg')||{}).value || ''`)
  check('the commit box starts empty', before.trim() === '', JSON.stringify(before.slice(0, 60)))

  const clicked = await evaluate(sessionId, `(() => { ${CLICK_FN}
    const btn = document.querySelector('.dshgit-btn.ai');
    if (!btn) return 'no-button';
    if (btn.disabled) return 'disabled';
    __click(btn); return 'clicked'; })()`)
  check('the AI button is clickable', clicked === 'clicked', clicked)

  // Generation is a real model call; poll rather than guess a fixed delay.
  let message = ''
  const deadline = Date.now() + 150000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    message = await evaluate(sessionId, `(document.querySelector('.dshgit-msg')||{}).value || ''`)
    if (message.trim().length > 0) break
    const err = await evaluate(sessionId, `(document.querySelector('.dshgit-out.err')||{}).innerText || ''`)
    if (err.trim().length > 0) { message = ''; console.log('  error strip:', err.slice(0, 200)); break }
  }

  check('a commit message was generated', message.trim().length > 0)
  if (message.trim()) {
    const subject = message.split('\n')[0]
    check('the subject follows Conventional Commits',
      /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+\))?: .+/.test(subject), subject)
    check('the subject stays within 72 characters', subject.length <= 72, `${subject.length} chars`)
    console.log('\n--- generated message ---\n' + message + '\n-------------------------')
  }
} finally {
  try { ws?.close() } catch {}
  chrome.kill()
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
}

if (failed) { console.error('\nAI checks failed'); process.exit(1) }
console.log('\nAI checks passed')
