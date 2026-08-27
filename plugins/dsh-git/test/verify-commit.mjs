/**
 * Verify the full write path through the LIVE UI: stage a file, generate a
 * message, commit, and confirm the repository actually advanced.
 *
 * This is the check that proves the whole bridge round-trips — clicking in the
 * browser must change real bytes on disk.
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL_UNDER_TEST = process.env.DSH_URL ?? 'http://127.0.0.1:38080/'
/**
 * Scratch working tree this test stages and commits into.
 *
 * The path is STABLE, not a fresh mkdtemp: dsh-git operates on the workspace of
 * the session the test clicks, so the directory has to be registered as a
 * workspace in the harness (Add workspace -> this path) and stay that way
 * between runs. It is self-provisioned below, so it no longer depends on a
 * hand-maintained repo sitting next to the monorepo.
 */
const REPO = process.env.DSH_REPO ?? join(tmpdir(), 'dsh-git-tree')
/** Seed content for a freshly provisioned scratch tree. */
const SEED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'dsh-git-tree')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 39226

const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' })

/**
 * Make REPO a git repository with at least one commit and one uncommitted
 * change, so the Changes tab always has a row to stage. Idempotent: an existing
 * tree is left alone apart from refreshing the dirty marker file.
 */
function ensureRepo() {
  if (!existsSync(REPO)) mkdirSync(REPO, { recursive: true })
  if (!existsSync(join(REPO, '.git'))) {
    execFileSync('git', ['init', '-q', '-b', 'main', REPO], { encoding: 'utf8' })
    const readme = join(SEED, 'README.md')
    writeFileSync(
      join(REPO, 'README.md'),
      existsSync(readme) ? readFileSync(readme, 'utf8') : '# dsh-git-tree\n\nScratch workspace for the dsh-git Changes tab.\n',
    )
    git('add', 'README.md')
    git('-c', 'user.name=dsh-git test', '-c', 'user.email=test@localhost',
        'commit', '-q', '-m', 'chore: seed the dsh-git scratch tree')
  }
  // Always leave one uncommitted change for the tab to show.
  writeFileSync(join(REPO, 'notes.txt'), `Working notes.\nRegression run marker ${Date.now()}.\n`)
  console.log('  ..  scratch repo:', REPO)
}

ensureRepo()

/** Read the repo's current commit count, tolerating an unborn branch. */
function commitCount() {
  try {
    return Number(
      execFileSync('git', ['-C', REPO, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(),
    )
  } catch {
    return 0
  }
}

const before = commitCount()
console.log('  ..  commits before:', before)

const profile = mkdtempSync(join(tmpdir(), 'dsh-commit-'))
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })

async function waitCdp(){for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/version`);if(r.ok)return r}catch{}await new Promise(r=>setTimeout(r,250))}throw new Error('no cdp')}
let ws,nextId=1;const pending=new Map()
function send(m,p={},s){const id=nextId++;const q={id,method:m,params:p};if(s)q.sessionId=s;ws.send(JSON.stringify(q));return new Promise((res,rej)=>{pending.set(id,{res,rej});setTimeout(()=>{if(pending.delete(id))rej(new Error('timeout '+m))},180000)})}
async function ev(s,e){const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},s);if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result.value}
const CLICK=`function __c(el){for(const t of ['pointerdown','mousedown','pointerup','mouseup','click'])el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}))}`

let failed = false
function check(n, ok, d) {
  if (ok) console.log(`  ok  ${n}`)
  else { console.log(`  FAIL ${n}${d ? ` — ${d}` : ''}`); failed = true }
}

try {
  const v = await waitCdp(); const { webSocketDebuggerUrl } = await v.json()
  ws = new WebSocket(webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }) })
  ws.addEventListener('message', e => { const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) } })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Runtime.enable', {}, sessionId)
  await send('Page.navigate', { url: URL_UNDER_TEST }, sessionId)
  await new Promise(r => setTimeout(r, 9000))

  await ev(sessionId, `(()=>{${CLICK}
    const rows=Array.from(document.querySelectorAll('[class*="sessionRow"]')).filter(r=>!/New Session/i.test(r.textContent||''));
    if(rows[0])__c(rows[0]);return true})()`)
  await new Promise(r => setTimeout(r, 7000))
  await ev(sessionId, `(()=>{${CLICK}
    const t=Array.from(document.querySelectorAll('button,[role="tab"]')).find(e=>(e.textContent||'').trim()==='Changes');
    if(t)__c(t);return true})()`)
  await new Promise(r => setTimeout(r, 8000))

  const rows = await ev(sessionId, `document.querySelectorAll('.dshgit-row').length`)
  check('the tab lists changed files', rows > 0, `rows=${rows}`)

  // Stage the first file via its row "+" button.
  const staged = await ev(sessionId, `(()=>{${CLICK}
    const row=document.querySelector('.dshgit-row');
    if(!row)return 'no-row';
    const btn=Array.from(row.querySelectorAll('button')).find(b=>(b.textContent||'').trim()==='+');
    if(!btn)return 'no-stage-button';
    __c(btn);return 'staged'})()`)
  check('a file can be staged from its row', staged === 'staged', staged)
  await new Promise(r => setTimeout(r, 6000))

  const foot = await ev(sessionId, `(document.querySelector('.dshgit-foot')||{}).innerText||''`)
  check('the footer reports a staged file', /[1-9]\d* staged/.test(foot), foot.replace(/\n/g, ' ').slice(0, 90))

  // Type a message directly (React-safe) and commit.
  await ev(sessionId, `(()=>{
    const ta=document.querySelector('.dshgit-msg');
    if(!ta)return 'no-box';
    const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
    set.call(ta,'test: commit from the dsh-git tab');
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    return 'typed'})()`)
  await new Promise(r => setTimeout(r, 1200))

  const committed = await ev(sessionId, `(()=>{${CLICK}
    const btn=Array.from(document.querySelectorAll('.dshgit-btn.primary')).find(b=>/Commit/i.test(b.textContent||''));
    if(!btn)return 'no-commit-button';
    if(btn.disabled)return 'disabled';
    __c(btn);return 'clicked'})()`)
  check('the Commit button fires', committed === 'clicked', committed)

  // Poll the REPOSITORY, not the UI: the disk is the real assertion.
  let after = before
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000))
    after = commitCount()
    if (after > before) break
  }
  check('the repository gained a commit', after > before, `before=${before} after=${after}`)

  if (after > before) {
    const subject = execFileSync('git', ['-C', REPO, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }).trim()
    check('the commit carries the typed message', subject === 'test: commit from the dsh-git tab', subject)
    console.log('\n--- HEAD ---\n' + execFileSync('git', ['-C', REPO, 'log', '-1', '--stat', '--pretty=%h %s'], { encoding: 'utf8' }).trim())
  }
} finally {
  try { ws?.close() } catch {}
  chrome.kill(); try { rmSync(profile, { recursive: true, force: true }) } catch {}
}

if (failed) { console.error('\ncommit checks failed'); process.exit(1) }
console.log('\ncommit checks passed')
