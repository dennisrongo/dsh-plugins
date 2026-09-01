#!/usr/bin/env node
/**
 * A scan session the user OPENED must not be archived out from under them.
 *
 * The scan runs in a real background session, and `cleanup()` archives it on
 * every exit path — ready, error, timeout, the catch, and unmount. That is what
 * keeps an abandoned scan out of the sidebar, and it must stay. But once the
 * modal offers **Open scan session**, the same archive becomes hostile: the user
 * clicks through to watch the conversation, the poll lands a second later, and
 * the session they are reading disappears from the sidebar while they read it.
 *
 * The fix is ADOPTION: opening the session hands ownership to the user, and
 * `cleanup()` then skips the discard — while still blanking `sessionRef`, so it
 * stays idempotent across all five callers. That last half matters as much as
 * the first: the ref-blank-on-read discipline is what stopped a stale render
 * closure archiving a just-prompted session in the launch flow (see the
 * `closeLaunch` outage in AGENTS.md), and adoption must not quietly convert
 * `cleanup()` into something that can run twice with two different answers.
 *
 * Two halves, because the obvious wrong fix trades one bug for the other, and
 * this mirrors `launch-lifecycle.mjs` deliberately:
 *  1. an ADOPTED session must archive NOTHING;
 *  2. a NON-adopted one must STILL archive, or every abandoned scan litters the
 *     sidebar — the very thing the discard exists to prevent.
 *
 * Asserted against the SOURCE for the structural half, matching the house
 * pattern: the guard is a control-flow shape, and a regex over minified output
 * would match nothing and pass vacuously.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'src/client.tsx'), 'utf8')

/** The SuggestDialog body, delimited exactly as smoke.mjs delimits it. */
const dialog = /export function SuggestDialog\(\{[\s\S]*?\n\}\n\n\/\*\*\n \* The full task detail dialog/.exec(source)
assert.ok(dialog, 'SuggestDialog must exist and be delimited for this check')
const dialogSrc = dialog[0]

// --- 1. behavioural: adoption suppresses the archive, absence keeps it -------
//
// A faithful re-enactment of `cleanup()`, run over the same two flags the
// component holds. Both halves come from ONE simulator, so a fix that deletes
// the discard outright fails the second half rather than quietly passing the
// first.
{
  /**
   * Rebuild `cleanup()` over mutable refs, then run it the way the component
   * does — repeatedly, from several exit paths.
   *
   * @param adopted - true once the user has opened the scan session.
   * @param runs - how many times to call cleanup, to prove idempotency.
   */
  const simulate = (adopted, runs = 1) => {
    const archived = []
    const sessionRef = { current: 's-scan' }
    const adoptedRef = { current: adopted }

    const cleanup = () => {
      const id = sessionRef.current
      sessionRef.current = null
      if (id !== null && !adoptedRef.current) archived.push(id)
    }

    for (let i = 0; i < runs; i += 1) cleanup()
    return { archived, left: sessionRef.current }
  }

  assert.deepEqual(
    simulate(true).archived,
    [],
    'an ADOPTED scan session must archive NOTHING — the user opened it to watch it',
  )

  // The half that stops this trading one bug for another. Deleting the discard
  // makes the first assertion pass and leaves every abandoned scan in the
  // sidebar, which is exactly what create-on-open pays discardSession to prevent.
  assert.deepEqual(
    simulate(false).archived,
    ['s-scan'],
    'a NON-adopted scan session must STILL be archived, or every abandoned scan litters the sidebar',
  )

  // Idempotency survives adoption: cleanup is called from five paths (ready,
  // error, timeout, the catch, unmount) and must blank the ref on the first
  // read regardless of which branch it then takes.
  assert.deepEqual(
    simulate(false, 4).archived,
    ['s-scan'],
    'cleanup must stay idempotent — blanking the ref on read is what makes the five callers safe',
  )
  assert.equal(
    simulate(true, 4).left,
    null,
    'an adopted cleanup must STILL blank sessionRef, or the ref-blank-on-read discipline is lost',
  )
}

// --- 2. the source must implement it that way -------------------------------
{
  const match = /const cleanup = React\.useCallback\(\(\): void => \{[\s\S]*?\n  \}, \[[^\]]*\]\)/.exec(dialogSrc)
  assert.ok(match, 'SuggestDialog must define cleanup as a useCallback')
  const body = match[0]

  // The existing shape is preserved exactly: take the id, blank the ref, and
  // only then decide. Converting this to state would reintroduce the stale
  // render-closure read that archived a just-prompted session in the launch flow.
  const take = body.indexOf('const id = sessionRef.current')
  const clear = body.indexOf('sessionRef.current = null')
  assert.ok(
    take !== -1 && clear > take,
    'cleanup must still take the session id and blank the ref in the SAME step',
  )

  // Adoption is read from a REF too, for the same reason the session is: both
  // calls can happen inside one handler before React commits anything.
  assert.ok(
    /adoptedRef\.current/.test(body),
    'cleanup must consult an adoption ref — a state read here is one commit behind',
  )
  assert.ok(
    /discardSession\(/.test(body),
    'cleanup must still discard a scan session the user never adopted',
  )
  // The blank must not be conditional on adoption: a cleanup that leaves the
  // ref set when adopted is no longer idempotent.
  assert.ok(
    clear < body.indexOf('adoptedRef.current'),
    'sessionRef must be blanked BEFORE the adoption branch, so cleanup stays idempotent either way',
  )

  // A state mirror would be exactly as stale as the closure the launch flow lost to.
  assert.ok(
    !/const \[adopted, setAdopted\]/.test(dialogSrc) || /adoptedRef/.test(dialogSrc),
    'adoption must be tracked in a ref, not by state alone',
  )
}

// --- 3. the open button, and what gates it ----------------------------------
{
  // It navigates through the public call the launch flow already uses.
  assert.ok(
    /launch\.sessions\.open\(/.test(dialogSrc),
    'the scan modal must offer navigation through sessions.open — the same public call launch uses',
  )

  // Opening ADOPTS. Without this the button hands the user a session the very
  // next poll archives.
  const opener = /const openScanSession = [\s\S]*?\n  \}/.exec(dialogSrc)
  assert.ok(opener, 'SuggestDialog must define openScanSession')
  assert.ok(
    /adoptedRef\.current = true/.test(opener[0]),
    'opening the scan session must ADOPT it, or cleanup archives what the user is reading',
  )
  const adoptAt = opener[0].indexOf('adoptedRef.current = true')
  const openAt = opener[0].indexOf('launch.sessions.open(')
  assert.ok(
    adoptAt !== -1 && openAt !== -1 && adoptAt < openAt,
    'adoption must be recorded BEFORE navigating — a poll landing mid-navigation must already see it',
  )

  // The button may only render when an id is actually held. During
  // digest-building there is no session yet, and on the error path cleanup has
  // already blanked sessionRef — so the id is kept in state for rendering, and
  // an absent one means NO button rather than one that fails on click.
  assert.ok(
    /const \[scanSessionId, setScanSessionId\]/.test(dialogSrc),
    'the rendered id must live in state — a ref does not re-render the button into existence',
  )
  assert.ok(
    /scanSessionId !== null/.test(dialogSrc),
    'the open button must be gated on actually holding a session id',
  )
  // ...and it must NOT resurrect an archived session: adoption is what stops
  // the archive, so the button never un-archives anything. Pinned by absence.
  assert.ok(
    !/unarchive|restoreSession/i.test(dialogSrc),
    'the open button must not try to resurrect an archived session',
  )
  // Cleared when a new scan starts, or Refresh leaves a button pointing at the
  // previous run's session.
  assert.ok(
    /setScanSessionId\(null\)/.test(dialogSrc),
    'a new scan must clear the previous run session id, or the button points at the old run',
  )
}

// --- 4. the scan session is NAMED, and the rename cannot fail a scan --------
{
  assert.ok(
    /\.rename === 'function'/.test(dialogSrc),
    'the rename must be guarded — it is a borrowed face, absent on an older binding',
  )
  const rename = /if \([^)]*rename === 'function'\) \{[\s\S]*?\n      \}/.exec(dialogSrc)
  assert.ok(rename, 'the scan rename must be guarded by a typeof check')
  assert.ok(
    /try \{[\s\S]*?await[\s\S]*?rename\([\s\S]*?\} catch/.test(rename[0]),
    'the AWAIT must be inside a try — a rename failure must never fail a scan over a cosmetic title',
  )
  // The title itself is built by a named helper so it can be asserted on
  // directly rather than inferred from a template literal buried in the flow.
  assert.ok(
    /scanSessionTitle\(/.test(dialogSrc),
    'the scan rename must go through scanSessionTitle, which owns the normalisation',
  )
  assert.ok(
    /Scan: /.test(source),
    'the scan session must be named so it is identifiable once opened',
  )

  // The connection normalises and REFUSES a blank title with `title-invalid`,
  // so the helper must never produce one — a workspace with no usable name
  // falls back rather than spending a round-trip to be told no.
  const helper = /export function scanSessionTitle\([\s\S]*?\n\}/.exec(source)
  assert.ok(helper, 'scanSessionTitle must exist')
  assert.ok(
    /replace\(\/\\s\+\/g, ' '\)/.test(helper[0]) && /\.trim\(\)/.test(helper[0]),
    'the title must mirror the connection\'s own normalisation, as sessionTitleFor does',
  )
  assert.ok(
    /normalized\.length === 0/.test(helper[0]),
    'a workspace with no usable name must fall back, never send a blank the wire refuses',
  )
}

// --- 5. honest phase captions ----------------------------------------------
//
// The client genuinely knows two different things during `scanning`: it is
// building the digest, or it has handed the prompt over and is waiting. Saying
// one static sentence for both is the loading rule's own failure mode — a
// loading state that makes a claim it cannot support.
{
  const skel = /function SuggestSkeleton\(\{[\s\S]*?\n\}/.exec(source)
  assert.ok(skel, 'SuggestSkeleton must exist and take props for the stage')

  assert.ok(
    /Reading the workspace/.test(skel[0]),
    'the digest stage must say it is reading the workspace',
  )
  assert.ok(
    /Waiting for the scan session/.test(skel[0]),
    'the polling stage must say it is waiting on the session',
  )
  // Still ONE live region, still an aria-hidden ticker: the caption changed,
  // the accessibility contract did not.
  assert.equal(
    (skel[0].match(/role="status"/g) ?? []).length,
    1,
    'exactly one live region — the new caption must not add a second',
  )
  assert.ok(
    /className="dshtd-sug-elapsed"[^>]*aria-hidden="true"/.test(skel[0]),
    'the ticking caption must stay aria-hidden',
  )
  assert.ok(
    /\{elapsed\}s/.test(skel[0]),
    'the elapsed seconds must survive the caption change',
  )
  // The stage is local state the client already owns — no harness internals.
  assert.ok(
    /const \[stage, setStage\]/.test(dialogSrc),
    'the stage must be plain local state, derived from what the client itself did',
  )
  // Comments are STRIPPED before this match, exactly as smoke.mjs strips them
  // before counting store.update calls. The prose above these call sites NAMES
  // the internals it is refusing to use — `uiConversation`'s binding snapshot,
  // `owner.eventSource` — and a check that cannot tell code from a comment
  // about the code fails against correct source, which trains you to relax it.
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.ok(
    !/uiConversation|eventSource|ConversationNodeAssembler/.test(codeOnly),
    'the caption must not read harness conversation internals — that is the bet this package has lost four times',
  )
}

// --- 6. an in-flight scan SURVIVES navigation, because the view unmounts ----
//
// `TodoView` registers into `conversation.view`, a PER-SESSION view ring. The
// modal's own **Open scan session** navigates to the scan, which swaps the ring
// to that session's — so TodoView unmounts entirely and takes SuggestDialog,
// every `useState` in it and the poll loop with it. Returning to the Todo tab
// gave a fresh empty dialog and the running scan was orphaned: nothing was left
// holding the runId, so its result file could never be collected.
//
// The fix keys the in-flight scan by workspaceId in MODULE scope — outside the
// slot, following the same shape `stores` already uses for TodoStore — so a
// remount can resume it.
{
  const registry = /const scans = new Map<string, ScanEntry>\(\)/.exec(source)
  assert.ok(
    registry,
    'the in-flight scan must live in a module-scope Map — component state dies with the slot',
  )
  // Keyed by workspace, because the tab is per-workspace and two workspaces
  // must never share one scan.
  assert.ok(
    /export function scanFor\(workspaceId: string\)/.test(source),
    'the scan registry must be keyed by workspaceId, not global',
  )

  // It must live OUTSIDE the component, or it is exactly the state that just died.
  const scansAt = source.indexOf('const scans = new Map<string, ScanEntry>()')
  const dialogAt = source.indexOf('export function SuggestDialog({')
  assert.ok(
    scansAt !== -1 && scansAt < dialogAt,
    'the registry must be declared at module scope, before the component that uses it',
  )

  // Exactly the five fields needed to resume, and NOT the suggestions: the user
  // chose not to cache results, so a completed scan that was never collected
  // must not resurface later dressed as fresh.
  const entry = /interface ScanEntry \{[\s\S]*?\n\}/.exec(source)
  assert.ok(entry, 'ScanEntry must be declared')
  for (const field of ['runId', 'sessionId', 'startedAt', 'adopted', 'seen']) {
    assert.ok(
      new RegExp(`\\b${field}\\b`).test(entry[0]),
      `a resumable scan must persist \`${field}\``,
    )
  }
  assert.ok(
    !/\bsuggestions\b/.test(entry[0]),
    'suggestions must NOT be persisted — a stale completed scan must not resurface as fresh',
  )
}

// --- 7. resuming picks up the in-flight scan, never starts a second ---------
{
  // A faithful re-enactment of the mount decision, over the same registry the
  // component reads. The whole bug was that mounting could only ever START.
  const simulate = (existing) => {
    const created = []
    const polledFrom = []
    const scans = new Map()
    if (existing) scans.set('w1', existing)

    const mount = () => {
      const found = scans.get('w1')
      if (found !== undefined) {
        // Resume: poll the persisted runId, create nothing.
        polledFrom.push(found.runId)
        return 'resumed'
      }
      const runId = 'run-new'
      created.push('session')
      scans.set('w1', { runId, sessionId: 's-new', startedAt: Date.now(), adopted: false, seen: [] })
      polledFrom.push(runId)
      return 'started'
    }

    return { verdict: mount(), created, polledFrom }
  }

  const cold = simulate(null)
  assert.equal(cold.verdict, 'started', 'with no scan in flight, mounting must start one')
  assert.deepEqual(cold.created, ['session'], 'a cold start must create its session')

  const warm = simulate({
    runId: 'run-abc',
    sessionId: 's-scan',
    startedAt: Date.now() - 5_000,
    adopted: true,
    seen: ['already proposed'],
  })
  assert.equal(warm.verdict, 'resumed', 'returning to the tab must RESUME the in-flight scan')
  // The assertion the bug report asks for by name.
  assert.deepEqual(
    warm.created,
    [],
    'resuming must NOT call sessions.create a second time — the first scan is still running',
  )
  assert.deepEqual(
    warm.polledFrom,
    ['run-abc'],
    'a resumed scan must poll the PERSISTED runId, or its result file can never be found',
  )

  // And the source must actually take that branch. Asserted on the MOUNT
  // EFFECT and on the CALL, not on the vocabulary: an earlier version of this
  // check tested that the words `resume` and `scanFor(` appeared anywhere in
  // the dialog, which stayed true when the branch was deleted — `resumeScan`
  // was still DEFINED, merely never called. A sabotage that replaced the whole
  // branch with a bare `void runScan()` passed it. Naming a symbol is not
  // calling it.
  const mount = /const inFlight = resumedRef\.current[\s\S]*?\n  \}, \[\]\)/.exec(dialogSrc)
  assert.ok(mount, 'the mount effect must read the registry before deciding what to do')
  assert.ok(
    /void resumeScan\(inFlight\)/.test(mount[0]),
    'the mount effect must RESUME an in-flight scan, not merely define a way to',
  )
  assert.ok(
    /else void runScan\(\)/.test(mount[0]),
    'a cold mount must still start a scan — resuming must not replace starting',
  )

  // The registry is what the decision is made from, and it is read per workspace.
  assert.ok(
    /scanFor\(launch\.workspaceId\)/.test(dialogSrc),
    'the dialog must consult the registry for THIS workspace',
  )

  // Resuming must reach the poll loop without passing through session creation.
  const resumeFn = /const resumeScan = React\.useCallback\([\s\S]*?\n  \)/.exec(dialogSrc)
  assert.ok(resumeFn, 'resumeScan must exist')
  assert.ok(
    !/sessions\.create\(/.test(resumeFn[0]),
    'resuming must NOT create a session — the run it is rejoining already has one',
  )
  assert.ok(
    !/scanDigest\(/.test(resumeFn[0]),
    'resuming must NOT rebuild the digest — that work is already done and blocks the host',
  )
  assert.ok(
    /pollUntilDone\(entry\.runId, entry\.startedAt\)/.test(resumeFn[0]),
    'resuming must poll the PERSISTED runId on the PERSISTED clock',
  )
}

// --- 8. the timeout is measured from startedAt, not from the remount --------
//
// The dishonest version restarts the 180s clock every time the user comes back,
// so a scan that has already run 170s gets another full timeout — and a wedged
// scan can be kept alive forever by navigating. The deadline belongs to the
// RUN, so it must be derived from the persisted start.
{
  const SCAN_TIMEOUT_MS = 180_000

  // The fix: deadline = startedAt + TIMEOUT.
  const deadlineFrom = (startedAt) => startedAt + SCAN_TIMEOUT_MS
  // The bug: deadline = now + TIMEOUT, recomputed on every mount.
  const deadlineFromRemount = (now) => now + SCAN_TIMEOUT_MS

  const now = 1_000_000
  const startedAt = now - 170_000 // 170s of the 180s budget already spent

  assert.equal(
    deadlineFrom(startedAt) - now,
    10_000,
    'a scan resumed at 170s must have 10s left, not a fresh 180',
  )
  // The sanity row: the buggy form must NOT produce the same answer, or this
  // test could pass against the defect it exists to catch.
  assert.notEqual(
    deadlineFromRemount(now) - now,
    10_000,
    'sanity: measuring from the remount would grant a full fresh timeout',
  )

  // ...and it must actually expire. A resumed scan past its deadline ends now.
  assert.ok(
    now > deadlineFrom(now - 190_000),
    'a resumed scan already past its deadline must time out immediately, not poll on',
  )

  // The source must read the deadline off the persisted start.
  assert.ok(
    /startedAt \+ SCAN_TIMEOUT_MS/.test(dialogSrc),
    'the deadline must be startedAt + SCAN_TIMEOUT_MS — anything off Date.now() restarts the clock',
  )
  assert.ok(
    !/Date\.now\(\) \+ SCAN_TIMEOUT_MS/.test(dialogSrc),
    'the deadline must NOT be recomputed from the current time, or navigating resets the timeout',
  )

  // The elapsed caption continues from the same instant, for the same reason:
  // a counter that restarts at zero tells the user the scan is younger than it is.
  const skeleton = /function SuggestSkeleton\(\{[\s\S]*?\n\}/.exec(source)
  assert.ok(skeleton, 'SuggestSkeleton must stay delimitable — keep its signature on one line')

  // BEHAVIOURAL, not textual. Lift the elapsed expression out of the source and
  // RUN it: an earlier version matched the substring `Date.now() - startedAt`,
  // which a sabotage satisfied while computing `Date.now() - Date.now()` and
  // reporting 0s forever. A regex can confirm a token is present; only
  // executing the arithmetic can confirm it MEANS anything.
  // The capture tolerates NESTED parens, because the defect it is hunting has
  // them: `Date.now() - Date.now()`. A `[^)]*` class stops at the first inner
  // `)`, captures nothing, and an empty match set then vacuously satisfies a
  // loop — which is exactly how the first version of this check passed the
  // sabotage it exists to catch. Hence both the greedy body and the count
  // guard below: a check that examines nothing must fail, not pass.
  const exprs = [...skeleton[0].matchAll(/Math\.floor\(\((.+?)\) \/ 1000\)/g)].map((m) => m[1])
  assert.equal(
    exprs.length,
    2,
    'the skeleton must compute elapsed seconds in exactly two places (the seed and the tick)',
  )
  for (const expr of exprs) {
    const elapsedOf = new Function('startedAt', 'Date', `return Math.floor((${expr}) / 1000)`)
    const fixedNow = 1_000_000
    const FakeDate = { now: () => fixedNow }
    assert.equal(
      elapsedOf(fixedNow - 42_000, FakeDate),
      42,
      `elapsed must be measured from startedAt (got a constant from \`${expr}\`)`,
    )
    // ...and it must MOVE with startedAt, which a Date.now()-Date.now() form
    // cannot do however the tokens are arranged.
    assert.equal(
      elapsedOf(fixedNow - 170_000, FakeDate),
      170,
      `a scan resumed at 170s must report 170s, not restart (\`${expr}\`)`,
    )
  }
  // The precise defect: seeding a local `started = Date.now()` inside the
  // component is what restarted the counter on every remount.
  assert.ok(
    !/const started = Date\.now\(\)/.test(skeleton[0]),
    'the skeleton must not mint its own start time — that is what reset the counter on return',
  )
  // ...and the run's start must reach it from the dialog, not be re-derived.
  assert.ok(
    /startedAt=\{startedAtRef\.current\}/.test(dialogSrc),
    'the dialog must pass the RUN\'s start to the skeleton',
  )
}

// --- 9. closing CLEARS the entry; navigating away PRESERVES it --------------
//
// The two look identical from inside the component — both unmount SuggestDialog
// — so the difference has to be recorded by the deliberate act, not inferred
// from the teardown. Getting this backwards strands a scan forever (close that
// preserves) or loses the one being watched (navigate that clears).
{
  const simulate = (act) => {
    const scans = new Map()
    const archived = []
    scans.set('w1', { runId: 'r1', sessionId: 's1', startedAt: 0, adopted: false, seen: [] })

    // The deliberate close runs FIRST and is what discards.
    const endScan = () => {
      const found = scans.get('w1')
      scans.delete('w1')
      if (found !== undefined && !found.adopted) archived.push(found.sessionId)
    }
    // The unmount teardown is shared by both paths and must preserve.
    const unmount = () => {}

    if (act === 'close') endScan()
    unmount()
    return { kept: scans.has('w1'), archived }
  }

  const closed = simulate('close')
  assert.equal(closed.kept, false, 'closing the modal must CLEAR the entry, or the scan is stranded')
  assert.deepEqual(
    closed.archived,
    ['s1'],
    'closing must still archive the scan session, exactly as today',
  )

  const navigated = simulate('navigate')
  assert.equal(
    navigated.kept,
    true,
    'navigating away must PRESERVE the entry — that is the whole point of resuming',
  )
  assert.deepEqual(
    navigated.archived,
    [],
    'navigating away must NOT archive: the user is on their way to watch that very session',
  )

  // The source must route the deliberate close through its own named path,
  // separate from the effect teardown that both paths share. Asserted on the
  // CALL as well as the definition: a `dismiss` that forgot to call `endScan`
  // left the entry behind on a real close, stranding the scan — and an earlier
  // version of this check, testing only that `endScan` was defined, passed
  // against exactly that.
  assert.ok(
    /const endScan = /.test(dialogSrc),
    'the deliberate close must have its own named path, distinct from the unmount teardown',
  )
  const dismissFn = /const dismiss = \(\): void => \{[\s\S]*?\n  \}/.exec(dialogSrc)
  assert.ok(dismissFn, 'SuggestDialog must define dismiss as the single deliberate-close door')
  assert.ok(
    /endScan\(\)/.test(dismissFn[0]),
    'dismiss must END the scan — a close that only hides the modal strands the run forever',
  )
  assert.ok(
    /onClose\(\)/.test(dismissFn[0]),
    'dismiss must still close the dialog',
  )
  // Every user-driven exit goes through that one door, so none can skip the
  // clear. Pinned the way smoke.mjs pins the single delete path.
  for (const [handler, why] of [
    ['onClick={dismiss}', 'the backdrop and the X must dismiss, not bare-close'],
    ['dismiss()', 'Escape must dismiss'],
  ]) {
    assert.ok(dialogSrc.includes(handler), why)
  }
  assert.ok(
    !/onClick=\{onClose\}/.test(dialogSrc),
    'no close control may call onClose directly — it would bypass endScan and strand the scan',
  )
  // The unmount teardown must NOT clear the registry, or navigating loses the scan.
  const teardown = /return \(\): void => \{[\s\S]*?\n    \}/.exec(dialogSrc)
  assert.ok(teardown, 'the mount effect must have a teardown')
  assert.ok(
    !/clearScan\(/.test(teardown[0]),
    'the unmount teardown must NOT clear the scan — it cannot tell navigation from a close',
  )
  // ...and cleanup() must not archive on a bare unmount either, for the same reason.
  assert.ok(
    !/cleanup\(\)/.test(teardown[0]),
    'unmount must not archive the scan session — navigating away is not abandoning it',
  )
}

// --- 9b. the modal itself must COME BACK ------------------------------------
//
// Persisting the scan is only half a fix. `suggesting` — the boolean that
// renders SuggestDialog at all — is state on TodoView, which is the component
// the navigation unmounts. Seeded `false`, the user returns to the Todo tab, no
// dialog appears, and the resumed scan is unreachable however well the registry
// remembered it. This is the assertion that ties the registry to something the
// user can actually see.
{
  const view = /export function TodoView\(\{[\s\S]*?\n\}\n/.exec(source)
  assert.ok(view, 'TodoView must exist and be delimitable')

  const seed = /const \[suggesting, setSuggesting\] = React\.useState\(([\s\S]*?)\n  \)/.exec(
    view[0],
  )
  assert.ok(
    seed,
    'suggesting must be seeded from a lazy initialiser — a bare false cannot reopen the modal',
  )
  assert.ok(
    /scanFor\(launch\.workspaceId\)/.test(seed[1]),
    'suggesting must be seeded from the scan registry, or returning to the tab shows no dialog',
  )
  // The precise defect being pinned.
  assert.ok(
    !/React\.useState\(false\)[\s\S]{0,40}suggesting/.test(view[0]),
    'suggesting must not start unconditionally false — that is what left the user with no way back',
  )
  // It must be workspace-scoped here too: a global probe would pop the modal
  // open on a workspace that has no scan running.
  assert.ok(
    /launch !== undefined/.test(seed[1]),
    'the seed must tolerate an absent launch context, exactly as the button does',
  )
}

// --- 10. two workspaces do not share scan state -----------------------------
{
  const scans = new Map()
  scans.set('w1', { runId: 'r1', sessionId: 's1', startedAt: 1, adopted: false, seen: ['a'] })
  scans.set('w2', { runId: 'r2', sessionId: 's2', startedAt: 2, adopted: true, seen: ['b'] })

  assert.equal(scans.get('w1').runId, 'r1', 'each workspace keeps its own runId')
  assert.equal(scans.get('w2').runId, 'r2', 'a second workspace must not see the first run')
  assert.notDeepEqual(
    scans.get('w1').seen,
    scans.get('w2').seen,
    'seen titles must not leak between workspaces',
  )

  // Clearing one must leave the other untouched.
  scans.delete('w1')
  assert.equal(scans.has('w2'), true, 'closing one workspace scan must not clear another workspace')

  // And a scan must not outlive its workspace: the registry is pruned when the
  // store cache is, so a closed workspace leaves nothing behind.
  assert.ok(
    /scans\.clear\(\)/.test(source),
    'the scan registry must be cleared alongside the store cache, or a scan outlives its workspace',
  )
  const storesClear = source.indexOf('stores.clear()')
  const scansClear = source.indexOf('scans.clear()')
  assert.ok(
    storesClear !== -1 && scansClear !== -1,
    'the registry must be torn down with the same effect that clears the stores',
  )

  // Every registry read must name a workspace. A bare module-level `let` for
  // the current scan is the shape that leaks across workspaces.
  assert.ok(
    !/^let (currentScan|activeScan)\b/m.test(source),
    'there must be no single module-level current scan — that shape leaks between workspaces',
  )
}

console.log(
  'suggest-lifecycle OK (adopted scan kept, unadopted still archived, session named, captions honest, ' +
    'scan resumes across navigation, timeout honest from startedAt, close clears / navigate preserves, ' +
    'workspaces isolated)',
)
