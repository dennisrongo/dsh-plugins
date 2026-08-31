#!/usr/bin/env node
/**
 * A SUCCESSFUL launch must never archive the session it just started.
 *
 * The bug this pins: on success `LaunchDialog.launch()` calls BOTH callbacks —
 * `onLaunched(id)` and then `onClose()` — and in `TodoView` those route to
 * `closeLaunch(true)` and `closeLaunch(false)` respectively. `closeLaunch` read
 * the open dialog out of its enclosing render's CLOSURE, and `setLaunching(null)`
 * does not rebind that captured variable, so the second call still saw a live
 * session, fell into the `!launched` branch, and ran `discardSession()` on the
 * session that had just received its prompt.
 *
 * The reported symptom is exactly that: a session starts, gets its brief, opens
 * — and then dies. `discardSession()` swallows every failure by design ("the
 * user cancelled and has moved on"), so nothing reached the console, and the
 * task was left flipped to `in-progress` pointing at an archived session.
 *
 * Two halves, because the obvious wrong fix trades one bug for the other:
 *  1. confirming must archive NOTHING;
 *  2. cancelling must STILL archive, or every dismissed dialog litters the
 *     sidebar — the very thing create-on-open pays `discardSession` to prevent.
 *
 * Asserted against the SOURCE rather than the minified bundle, matching the
 * house pattern in smoke.mjs: the guard is a control-flow shape, and a regex
 * over minified output would match nothing and pass vacuously.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'src/client.tsx'), 'utf8')

// --- 1. behavioural: the double-callback sequence must archive nothing -------
//
// A faithful re-enactment of the real sequence, run against a `closeLaunch`
// built exactly as the component builds it — including the stale closure, which
// is the entire mechanism. `launching` is captured per render, and the setter
// does not rebind the captured constant.
{
  /**
   * Rebuild the component's launch-close wiring over a mutable render cell.
   *
   * @param readsLiveState - true to model a `closeLaunch` that takes the value
   *   from a ref it clears immediately (the fix), false to model the
   *   captured-closure form.
   */
  const simulate = (readsLiveState) => {
    const archived = []
    // The component's state cell and its live mirror. `captured` is what a
    // render closure holds; the ref is what survives an uncommitted handler.
    const ref = { current: { item: { id: 't1' }, session: { id: 's-new' } } }
    const captured = ref.current

    const discard = (id) => archived.push(id)
    const closeLaunch = (launched) => {
      let open
      if (readsLiveState) {
        open = ref.current
        ref.current = null
      } else {
        open = captured
      }
      if (!launched && open?.session) discard(open.session.id)
    }

    // The success path, verbatim from LaunchDialog.launch()'s resolve handler.
    closeLaunch(true) // <- onLaunched(...)
    closeLaunch(false) // <- onClose()
    return archived
  }

  assert.deepEqual(
    simulate(true),
    [],
    'a confirmed launch must archive NOTHING — the session just received its prompt',
  )

  // Proves the harness can actually observe the failure: with the stale
  // closure, the very same sequence archives the live session. A test that
  // never sees red is decoration.
  assert.deepEqual(
    simulate(false),
    ['s-new'],
    'sanity: the stale-closure form must reproduce the bug, or this test proves nothing',
  )
}

// --- 2. the source must not reintroduce the stale read ----------------------
{
  const match = source.match(/const closeLaunch = \(launched: boolean\): void => \{[\s\S]*?\n  \}/)
  assert.ok(match, 'TodoView must define closeLaunch')
  const body = match[0]

  // The fix: read the live mirror, never the render-time capture.
  // `const open = launching` is exactly the stale read.
  assert.ok(
    !/const open = launching\b/.test(body),
    'closeLaunch must not capture `launching` from the render closure — ' +
      'setLaunching(null) does not rebind it, so the success path\'s second ' +
      'call still sees a live session and archives the session it just launched',
  )
  assert.ok(
    /launchingRef\.current/.test(body),
    'closeLaunch must read the live ref, which is what both calls agree on',
  )
  // Clearing the ref in the same step is what makes the close idempotent: both
  // calls run before React commits, so a mirror refreshed only at render time
  // would be exactly as stale as the closure it replaced.
  const take = body.indexOf('const open = launchingRef.current')
  const clear = body.indexOf('launchingRef.current = null')
  assert.ok(
    take !== -1 && clear > take,
    'closeLaunch must blank the ref immediately after taking it, or the second ' +
      'call re-reads the same live session and archives it anyway',
  )

  // …and it must still discard on the cancel path.
  assert.ok(
    /discardSession\(/.test(body),
    'closeLaunch must still discard a cancelled dialog\'s session',
  )
  assert.ok(
    /!launched/.test(body),
    'the discard must remain gated on the launch NOT having succeeded',
  )
}

// --- 3. the success path genuinely fires both callbacks ---------------------
//
// The whole bug depends on it. If a later refactor drops one, the guard above
// becomes dead code and this test should say so rather than stay quietly green.
{
  const resolve = source.match(/\(launchedSessionId\) => \{[\s\S]{0,300}?\},/)
  assert.ok(resolve, 'LaunchDialog must handle a resolved launch')
  assert.ok(
    /onLaunched\(launchedSessionId\)/.test(resolve[0]) && /onClose\(\)/.test(resolve[0]),
    'the success path calls onLaunched AND onClose — closeLaunch must tolerate both',
  )
}

// --- 4. a launched session is NAMED after its task --------------------------
//
// Behavioural, against the real built module: without a rename the deployment's
// `session-title-first-prompt-llm` provider asks a model to summarise the first
// human message, so a launched session gets a vague paraphrase of the prompt
// instead of the exact name the task already had.
{
  const { launchSession, sessionTitleFor } = await import(
    pathToFileURL(join(root, 'lib/launch.js')).href
  )

  /**
   * A launch context recording the ordered calls a launch makes.
   *
   * `rename` lives on the SESSION BINDING, not on a service: that is the path
   * the shell's own sidebar uses (`sessions.binding(id).session.rename`), and
   * it is the only one reachable from the client — `sessionTitle` is a host
   * service with no `@Remote`, and `dsh-session-title`'s client face is empty.
   */
  const makeCtx = (over = {}) => {
    const calls = []
    return {
      calls,
      ctx: {
        sessions: {
          open: () => calls.push('open'),
          binding: () => ({
            session: {
              prompt: async () => {
                calls.push('prompt')
                return { ok: true }
              },
              rename: async (title) => {
                calls.push(`rename:${title}`)
                return over.renameResult ?? { ok: true }
              },
              ...(over.session ?? {}),
            },
          }),
        },
        remote: { agentPresets: undefined },
        modelDirectories: undefined,
        uiWorkspace: undefined,
      },
    }
  }

  // 4a. the happy path names the session, and does so AFTER the prompt
  {
    const { calls, ctx } = makeCtx()
    await launchSession(ctx, {
      sessionId: 's1',
      presetId: undefined,
      model: undefined,
      prompt: '# Fix token refresh',
      title: 'Fix token refresh',
    })
    assert.deepEqual(
      calls,
      ['prompt', 'rename:Fix token refresh', 'open'],
      'a launch must name the session after its task, after the prompt and before navigating',
    )
  }

  // 4b. a rename FAILURE must not fail a launch the user already confirmed.
  // The session keeps the generated title, which is exactly the status quo.
  for (const [label, session] of [
    ['a thrown rename', { rename: async () => { throw new Error('nope') } }],
    ['an absent rename', { rename: undefined }],
  ]) {
    const { calls, ctx } = makeCtx({ session })
    const id = await launchSession(ctx, {
      sessionId: 's1',
      presetId: undefined,
      model: undefined,
      prompt: 'p',
      title: 'Some task',
    })
    assert.equal(id, 's1', `${label} must still return the launched session`)
    assert.ok(
      calls.includes('prompt') && calls.includes('open'),
      `${label} must not stop the launch — the prompt is away and the session must still open`,
    )
  }

  // 4c. the title itself: normalised, capped, and ABSENT when unusable.
  // The connection refuses a blank title with `title-invalid`, so sending one
  // we already know is invalid is a wasted round-trip.
  assert.equal(sessionTitleFor({ title: '  Fix   token\n refresh ' }), 'Fix token refresh',
    'a title must be trimmed with whitespace runs collapsed, as the wire does on receipt')
  assert.equal(sessionTitleFor({ title: '   ' }), undefined,
    'a whitespace-only title must yield undefined rather than a value the wire will refuse')
  const long = sessionTitleFor({ title: 'x'.repeat(200) })
  assert.ok(long.length <= 81 && long.endsWith('…'),
    'an over-long title must be truncated with an ellipsis')

  // A launch with no usable title must skip the rename entirely.
  {
    const { calls, ctx } = makeCtx()
    await launchSession(ctx, {
      sessionId: 's1', presetId: undefined, model: undefined, prompt: 'p',
      title: sessionTitleFor({ title: '   ' }),
    })
    assert.ok(
      !calls.some((c) => c.startsWith('rename:')),
      'a task with no usable title must not attempt a rename the wire would refuse',
    )
  }
}

console.log('launch-lifecycle OK (session kept on confirm, discarded on cancel, and named after its task)')
