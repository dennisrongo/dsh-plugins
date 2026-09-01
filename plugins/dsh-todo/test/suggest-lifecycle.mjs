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

console.log(
  'suggest-lifecycle OK (adopted scan kept, unadopted still archived, session named, captions honest)',
)
