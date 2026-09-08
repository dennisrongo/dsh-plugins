/**
 * Browser half of dsh-hooks: the contextual skill-hint strip above the composer.
 *
 * ## Why `conversation.input.dock`
 *
 * It is a `list` slot, session-scoped, sitting full-width directly above the
 * composer card — so an entry is additive (the goal strip already lives there
 * at order 10) and the chips read as a suggestion about what to type next
 * rather than as a footer. The alternatives were all worse: `conversation.
 * composer.dock` sits BELOW the card and reads as a status line;
 * `conversation.input.overlay` floats INSIDE the card and collides with the
 * slash/@ popup `dsh-client-ui-commands` self-registers there; and
 * `shell.overlay` would need the fixed-position measuring machinery
 * `dsh-plan-board` documents at length, for a strip that wants to be in normal
 * flow anyway.
 *
 * ## Why a chip writes the draft instead of submitting it
 *
 * The shipped `/`-menu resolves a pick as `{ text: '/${name} ' }`
 * (`dsh-client-ui-skill/lib/client.js`), so `inputActions.setDraft('/name ')`
 * reproduces exactly what picking the skill from the slash menu does — the user
 * still confirms with Enter, and can edit or abandon it. A chip that submitted
 * on a single click would start a turn from a stray click near the composer.
 * The `▶` affordance is the explicit opt-in to that.
 *
 * ## Why it polls
 *
 * There is no plugin-defined host→client event: `dsh-api-remotes`'
 * `remote-events` is a fixed allowlist. So the host owns a counter that moves
 * only when the computed hint list actually changes, and this half polls that
 * counter — the pattern `dsh-git` and `dsh-plan-board` both use. An idle
 * session therefore polls a constant and never refetches.
 *
 * @module @dennisrongo/dsh-hooks/client
 */
import React from 'react'
import { HOOKS_REMOTE } from './remote.ts'
import type { SkillHint } from './hints.ts'

export { HOOKS_REMOTE }

/**
 * Required services.
 *
 * `remote.dshHooks` is deliberately absent: this plugin mounts that contract
 * itself, so requiring it up front would park `apply()` forever waiting on a
 * service only `apply()` can create. It is picked up in a child fiber instead.
 */
export const inject = ['slots', 'remote']

/** How often the change token is polled while the strip is visible, in millis. */
const POLL_MS = 1_500

/**
 * The shape of a client root context this half actually uses.
 *
 * Declared locally rather than imported from
 * `@deepseek-ai/dsh-client-runtime/client`: that package is not present in
 * every dsh install (it is absent from the one this repo currently anchors
 * against), and a type-only import of a missing module turns `npx tsc
 * --noEmit` red for a file that compiles and runs perfectly. Everything below
 * is structural, so the real context satisfies it.
 */
interface HooksClientContext {
  effect(callback: () => void | (() => void), label?: string): unknown
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register(descriptor: SlotDescriptor, view: (props: never) => React.ReactNode): () => void
  }
}

/** The subset of a slot registration descriptor this plugin writes. */
interface SlotDescriptor {
  name: string
  id: string
  order?: number
  inject?: (sessionId: string) => unknown
}

/**
 * Every mounted remote call resolves to an ENVELOPE, never the bare payload.
 *
 * The gateway returns `{ ok: true, value }` or `{ ok: false, error }`, and it
 * RESOLVES rather than rejects on a host-side failure. Typing the payload
 * directly compiles fine and then reads `undefined` off every reply at
 * runtime — silently, because the promise still succeeded, so the strip simply
 * never appears. Declaring the envelope forces each call site to unwrap.
 */
type Reply<T> = { ok: true; value: T } | { ok: false; error: { message?: string } }

/** The host contract as this half calls it. */
interface HooksRemote {
  hints(request: { sessionId: string }): Promise<Reply<{ hints: SkillHint[]; token: number }>>
  hintsToken(request: { sessionId: string }): Promise<Reply<{ token: number }>>
  dismissHint(request: { sessionId: string; id: string }): Promise<Reply<{ ok: boolean; token: number }>>
}

/** The composer actions the owning slot hands every `conversation.input.dock` entry. */
interface InputActionsLike {
  setDraft(text: string): void
  submit(): void
}

/**
 * Read a hint list out of a reply, tolerating a shape we did not ask for.
 *
 * `scripts/check-context.mjs` mounts this bundle against a stub proxy that
 * answers EVERY remote method with `{ ok: true, value: { list: {...} } }`. A
 * loader that trusted `value.hints` to be an array would throw inside the
 * check's deferred path, so anything that is not a hint array is read as empty.
 * The same guard covers a host on an older version of this contract.
 * @param reply - whatever the gateway resolved with.
 * @returns the hints and token, defaulted when the shape is unexpected.
 */
function readHints(reply: unknown): { hints: SkillHint[]; token: number } {
  if (reply === null || typeof reply !== 'object') return { hints: [], token: 0 }
  const envelope = reply as { ok?: unknown; value?: unknown }
  if (envelope.ok !== true || envelope.value === null || typeof envelope.value !== 'object') {
    return { hints: [], token: 0 }
  }
  const value = envelope.value as { hints?: unknown; token?: unknown }
  const hints = Array.isArray(value.hints)
    ? (value.hints as unknown[]).filter(
        (hint): hint is SkillHint =>
          hint !== null && typeof hint === 'object' && typeof (hint as SkillHint).skill === 'string',
      )
    : []
  return { hints, token: typeof value.token === 'number' ? value.token : 0 }
}

/**
 * Read a token out of a reply, treating anything unexpected as "unchanged".
 * @param reply - whatever the gateway resolved with.
 * @returns the token, or undefined when the reply said nothing usable.
 */
function readToken(reply: unknown): number | undefined {
  if (reply === null || typeof reply !== 'object') return undefined
  const envelope = reply as { ok?: unknown; value?: unknown }
  if (envelope.ok !== true || envelope.value === null || typeof envelope.value !== 'object') return undefined
  const token = (envelope.value as { token?: unknown }).token
  return typeof token === 'number' ? token : undefined
}

/** Props of the strip. */
interface HintStripProps {
  sessionId: string
  remote: HooksRemote | undefined
  /**
   * The composer actions for THIS session.
   *
   * Threaded as a prop rather than held in a module variable: the shell can
   * render two session-scoped docks at once, and a single module-level holder
   * would let a chip in one session write the other's draft.
   */
  inputActions: InputActionsLike | undefined
}

/**
 * The chip strip.
 *
 * Renders `null` with no hints, which is what keeps the dock taking zero
 * height in the overwhelmingly common case — an entry that always drew a
 * container would shrink the conversation for every user of this plugin,
 * whether or not it ever had something to say.
 * @param props - the session and the resolved host contract.
 * @returns the strip, or null.
 */
export function HintStrip({ sessionId, remote, inputActions }: HintStripProps): React.ReactElement | null {
  const [hints, setHints] = React.useState<SkillHint[]>([])
  const tokenRef = React.useRef<number>(-1)

  React.useEffect(() => {
    if (remote === undefined || sessionId === '') return undefined
    let live = true
    /** True while a request is outstanding, so a slow host cannot stack polls. */
    let inFlight = false

    /**
     * Fetch the list and adopt it.
     * @param token - the token the list is expected to carry.
     */
    const load = async (token: number): Promise<void> => {
      const reply = await remote.hints({ sessionId })
      if (!live) return
      const next = readHints(reply)
      tokenRef.current = next.token === 0 ? token : next.token
      setHints(next.hints)
    }

    /** One poll: read the cheap counter, fetch only when it moved. */
    const tick = async (): Promise<void> => {
      if (inFlight) return
      // A hidden tab is not looking at the composer, and the harness keeps
      // running while it is hidden — polling it burns a request every 1.5s for
      // a strip nobody can see.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      inFlight = true
      try {
        const token = readToken(await remote.hintsToken({ sessionId }))
        if (!live || token === undefined || token === tokenRef.current) return
        await load(token)
      } catch (error) {
        // The strip is ambient: a failed poll shows the last good list rather
        // than an error the user cannot act on.
        console.warn('dsh-hooks: hint poll failed', error)
      } finally {
        inFlight = false
      }
    }

    void tick()
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [remote, sessionId])

  if (hints.length === 0) return null

  /**
   * Drop one chip locally and tell the host to keep it dropped.
   * @param id - the hint id.
   */
  const dismiss = (id: string): void => {
    // Local first: the chip disappears on the click rather than on the next
    // poll, and the host call is what makes it stay gone.
    setHints((current) => current.filter((hint) => hint.id !== id))
    void remote?.dismissHint({ sessionId, id }).catch((error: unknown) => {
      console.warn('dsh-hooks: dismiss failed', error)
    })
  }

  return (
    <div className="dshhk-strip" role="group" aria-label="Suggested skills">
      {hints.map((hint) => (
        <HintChip key={hint.id} hint={hint} onDismiss={dismiss} inputActions={inputActions} />
      ))}
    </div>
  )
}

/** Props of one chip. */
interface HintChipProps {
  hint: SkillHint
  onDismiss: (id: string) => void
  inputActions: InputActionsLike | undefined
}

/**
 * One chip: the skill name, its reason, a run affordance and a dismiss.
 * @param props - the hint, the composer actions and the dismiss callback.
 * @returns the chip.
 */
function HintChip({ hint, onDismiss, inputActions: actions }: HintChipProps): React.ReactElement {
  const draft = `/${hint.skill} `

  return (
    <span className="dshhk-chip" title={`${hint.title} — ${hint.reason}`}>
      <button
        type="button"
        className="dshhk-name"
        onClick={(event) => {
          // Shift-click is the keyboard-only route to the same thing the ▶
          // button does, so the gesture does not require hitting a 16px target.
          actions?.setDraft(draft)
          if (event.shiftKey) actions?.submit()
        }}
        aria-label={`Insert /${hint.skill} into the composer — ${hint.reason}`}
      >
        <span className="dshhk-slash">/</span>
        {hint.skill}
      </button>
      <span className="dshhk-reason">{hint.reason}</span>
      <button
        type="button"
        className="dshhk-run"
        onClick={() => {
          actions?.setDraft(draft)
          actions?.submit()
        }}
        aria-label={`Run /${hint.skill} now`}
        title={`Run /${hint.skill} now`}
      >
        ▶
      </button>
      <button
        type="button"
        className="dshhk-x"
        onClick={() => onDismiss(hint.id)}
        aria-label={`Dismiss the ${hint.skill} suggestion`}
        title="Dismiss for this session"
      >
        ×
      </button>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** The stylesheet this plugin owns, kept so its presence can be re-checked. */
let styleTag: HTMLStyleElement | null = null

/**
 * Add the plugin's stylesheet once.
 *
 * Every colour is a `--dsw-*` alias the harness defines, so the strip follows
 * the active theme (including anything `dsh-theme` overrides) instead of
 * pinning its own palette — a misspelt token would silently use its CSS
 * fallback forever and stop following the theme, which is what
 * `node scripts/check-tokens.mjs` exists to catch. Font sizes are literals on
 * the harness's 11/12/13/14/16/20/24 ladder.
 * @returns a no-op cleanup, so it can be used from an effect.
 */
export function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  // Checked on the ELEMENT, not a one-way boolean: a flag that stays true after
  // something removes the tag leaves every class name intact and no CSS behind
  // them, which survives refreshes and reads as the strip being broken.
  if (styleTag !== null && styleTag.isConnected) return () => {}
  const style = document.createElement('style')
  style.dataset.dshhk = 'true'
  style.textContent = CSS
  document.head.appendChild(style)
  styleTag = style
  return () => {}
}

const CSS = `
.dshhk-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  /* No vertical margin above: the dock already spaces its entries, and a strip
     that adds its own would double the gap under the goal bar. */
  margin: 0 0 6px;
  font-family: var(--dsw-font-family);
}
.dshhk-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  max-width: 100%;
  padding: 3px 4px 3px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
}
.dshhk-chip:hover {
  border-color: var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
}
.dshhk-name {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 1.5;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dshhk-name:hover { color: var(--dsw-alias-brand-primary); }
.dshhk-slash { color: var(--dsw-alias-label-tertiary); }
.dshhk-reason {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshhk-run,
.dshhk-x {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Box dimensions, not type: stated directly so they never drift onto a
     between-the-rungs value derived from a font size. */
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  font-size: 11px;
  line-height: 1;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  /* DSH Desktop on Windows overlays a window-drag strip; the preload grants
     buttons no-drag, and stating it here survives a future narrowing of that
     allowlist at no cost in a browser. */
  -webkit-app-region: no-drag;
}
.dshhk-run:hover { color: var(--dsw-alias-brand-primary); }
.dshhk-x:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-3);
}
`

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------

/**
 * Client plugin body: mount the host contract, then take the composer dock seat.
 * @param ctx - client root context.
 */
export function apply(ctx: HooksClientContext): void {
  const anyCtx = ctx as unknown as {
    remote: { $mount: (contract: unknown) => Promise<() => Promise<void>> }
    inject: (services: readonly string[], callback: (scoped: unknown) => void) => { dispose: () => void }
  }

  ctx.effect(() => injectStyles(), 'dsh-hooks: styles')

  // `$mount` publishes `remote.dshHooks` ASYNCHRONOUSLY, so nothing may read it
  // until that service exists — reading it in apply() captures `undefined`.
  ctx.effect(() => {
    let disposed = false
    let unmount: (() => Promise<void>) | undefined
    void anyCtx.remote
      .$mount(HOOKS_REMOTE)
      .then((dispose) => {
        if (disposed) return void dispose()
        unmount = dispose
      })
      .catch((error: unknown) => {
        console.error('dsh-hooks: failed to mount host remote', error)
      })
    return () => {
      disposed = true
      void unmount?.()
    }
  }, 'dsh-hooks: mount host remote')

  // The seat waits on the mounted namespace. That dependency cannot go in the
  // top-level `inject` array: this plugin mounts its own contract, so requiring
  // it there would deadlock apply() against an effect that never runs.
  ctx.effect(() => {
    const fiber = anyCtx.inject(['remote.dshHooks', 'slots'], (scoped) => {
      const readyCtx = scoped as HooksClientContext

      // Resolve the mounted namespace ONCE, here in the ready context. Reading
      // `ctx.remote.dshHooks` during a React render resolves it to `undefined`
      // — a render is not the fiber `$mount` published into — which leaves the
      // poll effect returning early and the strip permanently empty, with no
      // error to show for it.
      const remote = (readyCtx as unknown as { remote: Record<string, HooksRemote | undefined> }).remote
        ?.dshHooks

      readyCtx.slots.inject('conversation.input.dock', () =>
        readyCtx.slots.register(
          {
            name: 'conversation.input.dock',
            id: 'dsh-hooks-hints',
            // After the goal strip (10). Suggestions are the least important
            // thing in this dock and must not push the goal off the top.
            order: 20,
            inject: (sessionId: string) => ({ sessionId: String(sessionId), remote }),
          },
          // `inputActions` is a SessionStandardProps member the owning slot
          // supplies to every session-scoped entry — it is not something this
          // plugin's own `inject` callback can return, which is why the two
          // halves of the props meet here.
          ({
            sessionId,
            remote: r,
            inputActions,
          }: {
            sessionId: string
            remote: HooksRemote | undefined
            inputActions?: InputActionsLike
          }) => React.createElement(HintStrip, { sessionId, remote: r, inputActions }),
        ),
      )
    })
    return () => {
      fiber.dispose()
    }
  }, 'dsh-hooks: slot registration')
}
