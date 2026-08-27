/**
 * End-to-end UI check: drive headless Chrome over the DevTools Protocol and
 * assert the Changes tab registers, mounts, and reads the real repository.
 *
 * Raw CDP over a WebSocket rather than Playwright, so the check needs no extra
 * dependency. Serving the bundle proves nothing about registration; only a real
 * page can show the tab appeared.
 *
 * Two navigation facts are load-bearing and were both found the hard way:
 *   1. `conversation.view` tabs exist only INSIDE a session. The app boots to
 *      the Mission Control dashboard, where no tab can be present.
 *   2. Session rows and tabs are divs/buttons with React handlers, so they need
 *      a full pointer/mouse event sequence — `.click()` alone does not navigate.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_UNDER_TEST = process.env.DSH_URL ?? 'http://127.0.0.1:38080/'
const CHROME =
  process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.CDP_PORT ?? 39222)

const profile = mkdtempSync(join(tmpdir(), 'dsh-git-cdp-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1400,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

/** Poll until the DevTools endpoint answers. */
async function waitForCdp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return res
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('chrome devtools endpoint never came up')
}

let ws
let nextId = 1
const pending = new Map()

/** Issue one CDP command and await its reply. */
function send(method, params = {}, sessionId) {
  const id = nextId++
  const payload = { id, method, params }
  if (sessionId) payload.sessionId = sessionId
  ws.send(JSON.stringify(payload))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`CDP timeout: ${method}`))
    }, 45000)
  })
}

/** Evaluate an expression in the page and return its JSON value. */
async function evaluate(sessionId, expression) {
  const r = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate threw')
  }
  return r.result.value
}

/** Dispatch the full pointer/mouse sequence React handlers expect. */
const CLICK_FN = `function __click(el) {
  for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
}`

const failures = []
/** Record one assertion outcome. */
function check(name, ok, detail) {
  if (ok) console.log(`  ok  ${name}`)
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
    failures.push(name)
  }
}

try {
  const verRes = await waitForCdp()
  const { webSocketDebuggerUrl } = await verRes.json()

  ws = new WebSocket(webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('ws failed')), { once: true })
  })

  const consoleErrors = []
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.description ?? a.value).join(' '))
    }
  })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Runtime.enable', {}, sessionId)
  await send('Page.enable', {}, sessionId)
  await send('Page.navigate', { url: URL_UNDER_TEST }, sessionId)
  await new Promise((r) => setTimeout(r, 8000))

  // Open a real existing session, not the "New Session" placeholder.
  const opened = await evaluate(
    sessionId,
    `(() => { ${CLICK_FN}
      const rows = Array.from(document.querySelectorAll('[class*="sessionRow"]'));
      const target = rows.find(r => !/New Session/i.test(r.textContent || ''));
      if (!target) return 'no-row';
      __click(target);
      return 'ok';
    })()`,
  )
  check('an existing session opens', opened === 'ok', opened)
  await new Promise((r) => setTimeout(r, 7000))

  const tabs = JSON.parse(
    await evaluate(
      sessionId,
      `JSON.stringify(Array.from(document.querySelectorAll('button,[role="tab"]'))
        .map(e => (e.textContent || '').trim()))`,
    ),
  )
  check('the Changes tab is registered', tabs.includes('Changes'), tabs.slice(0, 12).join(' | '))
  check('the stock Todo tab still registers', tabs.includes('Todo'))
  check(
    'Changes sits after Todo in the ring',
    tabs.indexOf('Changes') > tabs.indexOf('Todo'),
    `Todo@${tabs.indexOf('Todo')} Changes@${tabs.indexOf('Changes')}`,
  )

  if (tabs.includes('Changes')) {
    await evaluate(
      sessionId,
      `(() => { ${CLICK_FN}
        const tab = Array.from(document.querySelectorAll('button,[role="tab"]'))
          .find(e => (e.textContent || '').trim() === 'Changes');
        if (tab) __click(tab);
        return true;
      })()`,
    )
    await new Promise((r) => setTimeout(r, 6000))

    const view = JSON.parse(
      await evaluate(
        sessionId,
        `(() => {
          const root = document.querySelector('.dshgit');
          return JSON.stringify({
            mounted: !!root,
            styled: !!document.querySelector('style[data-plugin="@dennisrongo/dsh-git"]'),
            hasCommitBox: !!document.querySelector('.dshgit-msg'),
            hasAiButton: !!document.querySelector('.dshgit-btn.ai'),
            rows: document.querySelectorAll('.dshgit-row').length,
            text: root ? root.innerText.slice(0, 500) : '',
          });
        })()`,
      ),
    )

    check('the Changes view mounts', view.mounted)
    check('the plugin stylesheet is injected', view.styled)
    check('the commit box renders', view.hasCommitBox)
    check('the AI message button renders', view.hasAiButton)
    // Either a real repo (rows or a clean tree) or the initialize prompt is
    // valid; a blank pane is not.
    check('the view shows repository state', view.text.trim().length > 0)

    const shot = await send('Page.captureScreenshot', {}, sessionId)
    writeFileSync(join(import.meta.dirname, 'changes-tab.png'), Buffer.from(shot.data, 'base64'))
    console.log('\n--- view text ---\n' + view.text + '\n-----------------')
  }

  const pluginErrors = consoleErrors.filter((e) => /dsh-git/i.test(e))
  check('no dsh-git console errors', pluginErrors.length === 0, pluginErrors.join(' ;; '))
} finally {
  try {
    ws?.close()
  } catch {}
  chrome.kill()
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
}

if (failures.length > 0) {
  console.error(`\n${failures.length} UI check(s) failed`)
  process.exit(1)
}
console.log('\nUI checks passed')
