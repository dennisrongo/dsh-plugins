/**
 * Browser half of dsh-plan-board: the panel that docks beside the conversation
 * when a plan is presented, and the tab that keeps every plan the workspace has
 * produced.
 *
 * ## Two seats, for two different jobs
 *
 * The **dock** is a `shell.overlay` entry. That seat is shell-scoped and always
 * mounted, which is the whole reason it is used: a `conversation.view` tab is
 * rendered one-at-a-time by the session body (`only: <active id>`), so a tab
 * cannot mount itself when a plan appears — only the already-active view is
 * running. An overlay is owned end to end by this plugin, so "show the plan the
 * moment there is one" is something it can actually guarantee.
 *
 * `shell.overlay` is not a layout sibling of the chat, though, so the panel
 * cannot simply take half a column: it is `position: fixed`, measures the
 * conversation column, and pushes it aside by its own width. See {@link useDock}
 * for why that is anchored to `data-slot` rather than to the class names beside
 * it, and for the two observers that keep it honest.
 *
 * The **tab** is a `conversation.view` entry: the history browser, opened by
 * hand, listing every plan for the workspace with its outcome. The dock shows
 * the plan in play; the tab is for the ones that already settled.
 *
 * ## How it approves without hijacking the question service
 *
 * `exit_plan_mode` presents the plan through `ctx.userQuestions.ask()`, and that
 * service documents ONE active provider per context — the shipped question UI
 * holds it. Registering a second provider to put Approve buttons here would
 * hijack every question in the harness, so this plugin never does.
 *
 * It does not need to. A raised question reaches the client as a `PendingWait`
 * carrier on the owning session's conversation snapshot, and the carrier owns
 * the answer, not the provider. This panel reads
 * `sessions.binding(id).session.getSnapshot().pending` and calls `respond()` —
 * a second remote control for one specific wait. The shipped decision card
 * keeps rendering and keeps working; whichever answers first settles it and the
 * other gets a `not-pending` receipt. See {@link usePlanReview}.
 *
 * Revising is the same channel: `exit_plan_mode` treats ANY `custom` text as
 * keep-planning, whatever option label rides with it, so an edited plan cannot
 * be approved — it goes back as feedback and the model presents it again.
 *
 * @module @dennisrongo/dsh-plan-board/client
 */
import React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { PLANS_REMOTE } from './remote.ts'
import { Markdown } from './markdown.tsx'
import type { PlanMeta, PlanRecord } from './types.ts'

export { PLANS_REMOTE }

/**
 * Required services. `remote.dshPlans` is deliberately absent: this plugin
 * mounts that contract itself, so requiring it up front would park apply()
 * forever waiting on a service only apply() can create.
 */
export const inject = ['slots', 'remote', 'workspaces', 'sessions']

/** How often the change token is polled while the tab is visible, in millis. */
const POLL_MS = 2_000

/**
 * Every mounted remote call resolves to an ENVELOPE, never the bare payload.
 *
 * The gateway returns `{ ok: true, value }` or `{ ok: false, error }`, and it
 * resolves rather than rejects on a host-side failure. Typing the payload
 * directly compiles fine and then reads `undefined` off every reply at
 * runtime — silently, because the promise still succeeds: the view just never
 * leaves its loading state. Declaring the envelope forces each call site to
 * unwrap.
 */
type Reply<T> = { ok: true; value: T } | { ok: false; error: { message?: string } }

/** The host contract as this half calls it. */
interface PlansRemote {
  list(request: { workspaceId: string }): Promise<Reply<{ plans: PlanMeta[]; token: number }>>
  get(request: { workspaceId: string; id: string }): Promise<Reply<{ plan?: PlanRecord }>>
  changeToken(request: { workspaceId: string }): Promise<Reply<{ token: number; openPlanId?: string }>>
  discard(request: { workspaceId: string; id: string }): Promise<Reply<{ ok: boolean; token: number }>>
  pin(request: {
    workspaceId: string
    messageId: string
  }): Promise<Reply<{ ok: true; id: string; token: number } | { ok: false; reason: string }>>
}

/** Minimal shape of the client's observable session list. */
interface SessionListLike {
  getSnapshot(): { current: string | undefined }
  subscribe(fn: () => void): () => void
}

/** Minimal shape of the client's observable workspace list. */
interface WorkspaceListLike {
  getSnapshot(): { items: readonly { workspaceId: string; path: string; sessionIds: readonly string[] }[] }
  subscribe(fn: () => void): () => void
}

/**
 * Subscribe to one of the harness's observable stores.
 * @param store - anything with getSnapshot/subscribe.
 * @returns the current snapshot, re-rendering on change.
 */
function useObservable<T>(store: { getSnapshot(): T; subscribe(fn: () => void): () => void }): T {
  return React.useSyncExternalStore(
    React.useCallback((fn) => store.subscribe(fn), [store]),
    React.useCallback(() => store.getSnapshot(), [store]),
  )
}

/**
 * The workspace owning the session currently open, and its directory.
 * @param ctx - client root context.
 * @returns the workspace id and path, or undefined when nothing is open.
 */
function useCurrentWorkspace(ctx: ClientContext): { workspaceId: string; path: string } | undefined {
  const anyCtx = ctx as unknown as { sessions: { list: SessionListLike }; workspaces: { list: WorkspaceListLike } }
  const sessions = useObservable(anyCtx.sessions.list)
  const workspaces = useObservable(anyCtx.workspaces.list)
  return React.useMemo(() => {
    const current = sessions.current
    if (current === undefined) return undefined
    for (const ws of workspaces.items) {
      if (ws.sessionIds.includes(current)) return { workspaceId: ws.workspaceId, path: ws.path }
    }
    return undefined
  }, [sessions, workspaces])
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

/**
 * Poll the host's change token for one workspace.
 *
 * Polling stops while the document is hidden, and resumes with an immediate
 * read on `visibilitychange` — a background tab that keeps a timer running
 * costs a request every two seconds for a window nobody is looking at, and the
 * `focus` re-read is what makes returning to the tab feel instant anyway.
 * @param remote - the mounted host contract, or undefined before it mounts.
 * @param workspaceId - workspace to watch.
 * @returns the latest token and pending plan id.
 */
function usePlanToken(
  remote: PlansRemote | undefined,
  workspaceId: string | undefined,
): { token: number; openPlanId?: string } {
  const [state, setState] = React.useState<{ token: number; openPlanId?: string }>({ token: 0 })

  React.useEffect(() => {
    if (remote === undefined || workspaceId === undefined) return
    let cancelled = false
    let timer: number | undefined

    const read = async () => {
      try {
        const reply = await remote.changeToken({ workspaceId })
        if (cancelled || !reply.ok) return
        const next = reply.value
        // Replace only on a real change, so an unchanged poll does not
        // re-render every consumer twice a second.
        setState((prev) => (prev.token === next.token && prev.openPlanId === next.openPlanId ? prev : next))
      } catch {
        // A failed poll is not worth surfacing: the next one is 2s away, and a
        // restarting host would otherwise paint an error banner every cycle.
      }
    }

    const tick = () => {
      if (document.visibilityState === 'visible') void read()
      timer = window.setTimeout(tick, POLL_MS)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void read()
    }

    void read()
    timer = window.setTimeout(tick, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [remote, workspaceId])

  return state
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** Human label and token for one plan status. */
const STATUS: Record<PlanMeta['status'], { label: string; token: string }> = {
  pending: { label: 'Awaiting review', token: 'var(--dsw-alias-state-warn-primary)' },
  approved: { label: 'Approved', token: 'var(--dsw-alias-state-success-primary)' },
  rejected: { label: 'Kept planning', token: 'var(--dsw-alias-state-business-primary)' },
  proposed: { label: 'Proposed', token: 'var(--dsw-alias-label-tertiary)' },
}

/**
 * A status pill.
 * @param props.status - the plan's status.
 * @returns the pill.
 */
function StatusPill({ status }: { status: PlanMeta['status'] }): React.ReactElement {
  const { label, token } = STATUS[status]
  return (
    <span className="dshpb-pill" style={{ color: token, borderColor: token }}>
      {label}
    </span>
  )
}

/**
 * Format an epoch as a short local date-time.
 * @param at - epoch millis.
 * @returns e.g. `29 Aug, 12:15`.
 */
function when(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return ''
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * The plan window.
 * @param props.plan - the plan to show.
 * @param props.onClose - dismiss handler.
 * @returns the overlay panel.
 */
/**
 * The conversation column, addressed by the one hook the harness makes stable.
 *
 * Every slot host carries `data-slot="<slot name>"`, and slot names ARE the
 * documented plugin API — unlike the class names beside them, which are hashed
 * CSS-module identifiers (`wSkVaW_composerStack`) that change on any harness
 * build. Anchoring to the attribute is the difference between a dock that
 * survives a dsh upgrade and one that silently detaches.
 * @returns the conversation column element, or null before the session mounts.
 */
function conversationColumn(): HTMLElement | null {
  const host = document.querySelector<HTMLElement>('[data-slot="conversation"]')
  if (host === null) return null
  // The slot host itself is `display: contents` — a zero-size wrapper that
  // cannot be measured or padded. The element that actually lays out is its
  // single child (the column's flex root). Reaching it by structure rather than
  // by class name is the point: the classes beside it are hashed CSS-module
  // identifiers that change on any harness build.
  return (host.firstElementChild as HTMLElement | null) ?? host.parentElement
}

/**
 * The shell frame — the element other overlays reserve space on.
 *
 * `dsh-mission-control` docks its rail by setting `padding-right` on this
 * element (it reaches it the same way, via `[data-shell-overlay]`), which
 * shrinks the grid and with it the conversation column. The dock has to respect
 * that reservation: aligning only to the column's right edge puts this panel's
 * top-right corner — its Close button — underneath the rail whenever the two
 * measurements disagree, which they do while the rail is opening and whenever
 * the column has not caught up yet.
 * @returns the frame element, or null when the shell is not mounted.
 */
function shellFrame(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-shell-overlay]')?.parentElement ?? null
}

/**
 * The cross-plugin marker for "an overlay is holding this strip".
 *
 * `shell.overlay` has no width-reservation API — `dsh-mission-control` invented
 * one by padding the shell frame, which works because its rail is flush to the
 * viewport edge and outside the frame's content box. This dock is flush to the
 * CONTENT edge instead, so frame padding cannot describe it: padding the frame
 * by the dock's width would shrink the column the dock measures itself from,
 * and the two would chase each other.
 *
 * So the dock states its claim on itself, and floating chrome that centres in
 * the shell measures what is left. `dsh-weather` reads it: its bar is centred
 * on the free span rather than on the viewport, so it slides out of the panel's
 * way instead of being painted over. Anything that does not know the attribute
 * is unaffected.
 */
const DOCK_CLAIM = 'data-dsh-overlay-claim'

/** Attribute this plugin sets on the column while the dock is open. */
const DOCK_ATTR = 'data-dshpb-docked'
/** Custom property carrying the dock's current width to the column's padding. */
const DOCK_WIDTH_VAR = '--dshpb-dock-w'

/**
 * The effective CSS zoom on an element's subtree.
 *
 * `dsh-theme`'s UI scale is `#root { zoom: var(--dshth-ui-scale, 1) }`, and
 * everything in the shell — including this overlay — renders inside it. That
 * makes two coordinate spaces, and a docked panel has to be fluent in both:
 *
 * - `getBoundingClientRect()` returns TRUE viewport pixels, already scaled.
 * - A length written to `style.width` / `style.right` is an AUTHOR pixel, which
 *   the zoom then multiplies on the way to the screen.
 *
 * Measuring in one and writing in the other is silently self-consistent at
 * 100%, which is why it survived every check here, and 10% wrong at the 90%
 * step: a panel told `height: 1680px` rendered 1512 and stopped 168px short of
 * the window, and one told `right: 377px` sat 339px in, 22px under mission
 * control's rail. Every measurement below is converted before it is written.
 * @param el - an element inside the subtree in question.
 * @returns the zoom factor; 1 when there is none or it cannot be derived.
 */
function zoomOf(el: HTMLElement): number {
  // Chromium exposes the resolved factor directly on modern builds.
  const own = (el as unknown as { currentCSSZoom?: number }).currentCSSZoom
  if (typeof own === 'number' && own > 0) return own
  // Otherwise derive it: offsetWidth is author px, the rect is viewport px.
  const width = el.getBoundingClientRect().width
  return el.offsetWidth > 0 && width > 0 ? width / el.offsetWidth : 1
}

/** Narrowest useful dock, in px — below this the markdown stops being readable. */
const DOCK_MIN = 280
/** Widest dock, in px, so a maximised window does not give the plan 900px of line length. */
const DOCK_MAX = 720

/**
 * Dock the panel against the conversation column and keep it there.
 *
 * The panel is `position: fixed` (it lives in `shell.overlay`, which is not a
 * layout sibling of the chat), so its geometry has to be measured rather than
 * inherited. Two observers keep it honest: a `ResizeObserver` on the column for
 * sidebar toggles, window resizes and panel transitions, and a
 * `MutationObserver` for the case that actually bites — React re-rendering the
 * column and dropping the attribute this plugin set on it, which would leave the
 * chat un-shrunk with the dock still covering it. Re-applying on mutation makes
 * that self-healing instead of a stuck layout.
 *
 * Degrading is deliberate: if the column cannot be found at all, the panel still
 * renders against the viewport edge and simply overlays the chat rather than
 * pushing it. A plan you can read on top of the conversation beats no plan.
 * @param open - whether the dock is currently showing.
 * @returns the measured geometry to position the panel with.
 */
function useDock(open: boolean): { top: number; height: number; right: number; width: number } | null {
  const [box, setBox] = React.useState<{ top: number; height: number; right: number; width: number } | null>(null)

  React.useEffect(() => {
    const column = conversationColumn()

    if (!open) {
      // Always release the column, even if it was found on a previous pass.
      if (column) {
        column.removeAttribute(DOCK_ATTR)
        column.style.removeProperty(DOCK_WIDTH_VAR)
        column.style.removeProperty('padding-right')
      }
      setBox(null)
      return
    }

    if (column === null) {
      // No column to dock against — fall back to the viewport's right edge.
      // Still zoom-corrected: the panel renders inside the scaled subtree
      // whether or not there is a column to measure.
      const apply = () => {
        const frame = shellFrame()
        const zoom = frame === null ? 1 : zoomOf(frame)
        setBox({
          top: 0,
          height: Math.round(window.innerHeight / zoom),
          right: 0,
          width: Math.round(
            Math.max(DOCK_MIN, Math.min(DOCK_MAX, (window.innerWidth / zoom) * 0.5)),
          ),
        })
      }
      apply()
      window.addEventListener('resize', apply)
      return () => window.removeEventListener('resize', apply)
    }

    // A dock that mounts before the column has been laid out measures 0 and has
    // nothing to position against. ResizeObserver is not a reliable rescue here
    // — the panel can mount into a subtree that is display:none and gains size
    // without the observer firing usefully — so an explicit frame retry runs
    // until the first real measurement. Bounded, because a column that is still
    // 0 after a second is not coming.
    let frames = 0
    let raf = 0

    /** Measure the column and push it aside by exactly the dock's width. */
    const sync = () => {
      const rect = column.getBoundingClientRect()
      if (rect.width === 0) {
        if (frames < 90) {
          frames += 1
          raf = requestAnimationFrame(sync)
        }
        return
      }
      frames = 0
      // Everything measured below is in viewport px; everything written is in
      // author px. See zoomOf() for why conflating the two is a 10%-wrong
      // panel that looks perfect at the default UI scale.
      const zoom = zoomOf(column)
      // Never extend past whatever the shell has reserved on the right. The
      // frame's padding is how a docked overlay (mission control's rail) claims
      // that space, so its content edge — not the viewport edge, and not the
      // column's own right edge — is the real boundary. getComputedStyle
      // resolves that padding in AUTHOR px, so it has to be scaled up into the
      // viewport space `frameRect` is measured in before the two can be
      // subtracted.
      const frame = shellFrame()
      let boundary = rect.right
      if (frame !== null) {
        const frameRect = frame.getBoundingClientRect()
        const reserved = (parseFloat(getComputedStyle(frame).paddingRight) || 0) * zoom
        boundary = Math.min(boundary, frameRect.right - reserved)
      }
      // The readability clamp is about rendered text, but it is applied to the
      // author width because that is what the width is finally written as.
      const width = Math.round(
        Math.max(DOCK_MIN, Math.min(DOCK_MAX, (rect.width / zoom) * 0.5)),
      )
      column.setAttribute(DOCK_ATTR, '')
      // Inline, not a stylesheet rule. The column's own class selector has the
      // same specificity as an attribute selector, and which stylesheet lands
      // last is not this plugin's to decide — an inline declaration is the only
      // one that reliably wins. The MutationObserver below re-applies it if a
      // React re-render wipes the style attribute.
      column.style.setProperty(DOCK_WIDTH_VAR, `${width}px`)
      column.style.paddingRight = `${width}px`
      setBox((prev) => {
        // The full height of the column, top to bottom. An earlier version
        // started below the tab strip to duck under `dsh-weather`'s bar, by
        // measuring `[data-slot="conversation.view"]`'s first child — but that
        // child is the Chat view root INSIDE the scrollport, not the view area,
        // so its `top` goes negative the moment the conversation scrolls
        // (-1748px on a 2342px-tall chat in a 594px scrollport). The guard then
        // rejected it and fell back here anyway, silently restoring the very
        // geometry it was meant to remove. Ducking is now done by claiming the
        // strip (see DOCK_CLAIM) instead of by measuring a sibling.
        //
        // Divided by the zoom on the way out: these become inline lengths, and
        // the zoom multiplies them again when it renders them.
        const next = {
          top: Math.round(rect.top / zoom),
          height: Math.round(rect.height / zoom),
          right: Math.round((window.innerWidth - boundary) / zoom),
          width,
        }
        return prev &&
          prev.top === next.top &&
          prev.height === next.height &&
          prev.right === next.right &&
          prev.width === next.width
          ? prev
          : next
      })
    }

    sync()
    const resize = new ResizeObserver(sync)
    resize.observe(column)
    // Changing `dsh-theme`'s UI scale re-renders the shell at a different zoom,
    // which moves every number this dock is built from — and NO ResizeObserver
    // reports it. Measured in the shell across 1.0 → 0.8 → 1.0: a content-box
    // observer fired zero times, and so did a device-pixel-content-box one,
    // because a CSS zoom rewrites the rendered result without resizing any
    // observed box. The panel therefore kept geometry computed for the previous
    // scale until an unrelated window resize rescued it.
    //
    // The scale is an inline custom property on <body> (dsh-theme's boot script
    // does `body.style.setProperty('--dshth-ui-scale', …)`), so the style
    // attribute is the thing that actually changes. Watching it is cheap: the
    // shell writes there rarely, and sync() is idempotent.
    const scaleWatch = new MutationObserver(sync)
    scaleWatch.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] })
    // The frame's CONTENT box shrinks when another overlay reserves space, even
    // though its border box stays the full width — which is exactly the event
    // that moves this dock's boundary, and it does not always resize the column
    // in the same frame.
    const frameEl = shellFrame()
    if (frameEl !== null) resize.observe(frameEl)
    // The column's own attributes, not its subtree: a React re-render that
    // strips DOCK_ATTR is the failure this is here for, and watching children
    // would fire on every streamed token.
    const mutation = new MutationObserver(() => {
      if (!column.hasAttribute(DOCK_ATTR) || column.style.paddingRight === '') sync()
    })
    mutation.observe(column, { attributes: true, attributeFilter: [DOCK_ATTR, 'style'] })
    const frameWatch = new MutationObserver(sync)
    if (frameEl !== null) frameWatch.observe(frameEl, { attributes: true, attributeFilter: ['style'] })
    window.addEventListener('resize', sync)

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      resize.disconnect()
      scaleWatch.disconnect()
      mutation.disconnect()
      frameWatch.disconnect()
      window.removeEventListener('resize', sync)
      column.removeAttribute(DOCK_ATTR)
      column.style.removeProperty(DOCK_WIDTH_VAR)
      column.style.removeProperty('padding-right')
    }
  }, [open])

  return box
}

// ---------------------------------------------------------------------------
// Answering the live review
// ---------------------------------------------------------------------------

/**
 * Reaching the plan review WITHOUT taking the user-questions provider.
 *
 * `exit_plan_mode` raises its review through `ctx.userQuestions.ask()`, and that
 * service documents ONE active provider per context — the shipped question UI
 * holds it. Registering a second provider to put an Approve button here would
 * hijack every question in the harness, which is why this plugin has always
 * refused to (see the module doc). None of that applies to what follows.
 *
 * A raised question is dispatched to the client as a `PendingWait` carrier on
 * the owning session's conversation snapshot, and the carrier — not the
 * provider — owns the answer. Reading `session.getSnapshot().pending` and
 * calling `respond()` makes this panel a SECOND remote control for one specific
 * wait; the shipped decision card keeps rendering in the composer and keeps
 * working. Whichever surface answers first settles it, and the other's receipt
 * comes back `{accepted: false, reason: 'not-pending'}` — a clean, reported
 * no-op rather than a corrupted answer. That is the whole reason this is safe
 * where a provider would not be.
 */

/** One option the asker offered on a question. */
interface QuestionOptionLike {
  label: string
  description?: string
}

/** One question of a request, as the pending carrier delivers it. */
interface QuestionItemLike {
  id: string
  question: string
  detail?: string
  multiSelect?: boolean
  options?: QuestionOptionLike[]
  intent?: { kind?: string; approve?: string }
}

/** The runtime's pending-interaction carrier, narrowed to what this panel uses. */
interface PendingWaitLike {
  kind: string
  sessionId: string
  payload?: { questions?: QuestionItemLike[] }
  respond(result: unknown): Promise<{ accepted: boolean; reason?: string }>
}

/** The session face: the conversation snapshot source plus its behaviour verbs. */
interface SessionFaceLike {
  getSnapshot(): { pending?: readonly PendingWaitLike[] }
  subscribe(fn: () => void): () => void
}

/** A pending question narrowed to a renderable plan decision. */
interface PlanReviewLike {
  /** The reviewed question's id, echoed in the answer. */
  id: string
  /** The plan markdown under review — matched against the stored plan. */
  plan: string
  /** The option that approves it. */
  approve: QuestionOptionLike
  /** The option that declines it; absent when the asker offered no other. */
  decline?: QuestionOptionLike
}

/**
 * Narrow a question batch to a plan review, or undefined.
 *
 * Deliberately the same rules the shipped decision card applies: one question,
 * declaring the `plan-review` intent, carrying the plan as its detail, single
 * select, at most two options, and an option whose label the intent names as
 * the approving one. A batch this panel cannot answer completely is a batch it
 * must not offer buttons for — the intent changes presentation, never which
 * answers are reachable.
 * @param questions - the request's whole question batch.
 * @returns the narrowed review, or undefined.
 */
function planReviewOf(questions: readonly QuestionItemLike[]): PlanReviewLike | undefined {
  if (questions.length !== 1) return undefined
  const question = questions[0]
  const approveLabel = question.intent?.approve
  if (question.intent?.kind !== 'plan-review' || question.detail === undefined) return undefined
  if (approveLabel === undefined || question.multiSelect === true) return undefined
  const options = question.options ?? []
  if (options.length > 2) return undefined
  const approve = options.find((option) => option.label === approveLabel)
  if (approve === undefined) return undefined
  const decline = options.find((option) => option.label !== approveLabel)
  return { id: question.id, plan: question.detail, approve, ...(decline === undefined ? {} : { decline }) }
}

/** Snapshot handed back when there is no session to read — a stable identity, so uSES does not loop. */
const NO_PENDING: { pending: readonly PendingWaitLike[] } = { pending: [] }

/** The face used when the plan's session cannot be bound. */
const NO_SESSION: SessionFaceLike = {
  getSnapshot: () => NO_PENDING,
  subscribe: () => () => {},
}

/**
 * The live plan review for one session, if it is showing.
 * @param ctx - client root context.
 * @param sessionId - the session that raised the plan.
 * @returns the carrier and the narrowed review, or undefined.
 */
function usePlanReview(
  ctx: ClientContext,
  sessionId: string | undefined,
): { wait: PendingWaitLike; review: PlanReviewLike } | undefined {
  const face = React.useMemo(() => {
    if (sessionId === undefined || sessionId === '') return NO_SESSION
    const sessions = (ctx as unknown as {
      sessions: { binding?: (id: string) => { session: SessionFaceLike } | undefined }
    }).sessions
    // `binding` mints the session scope lazily and is documented render-safe,
    // but it fails loud on an id the runtime does not know — which is exactly
    // what a plan whose session has been pruned carries.
    try {
      return sessions.binding?.(sessionId)?.session ?? NO_SESSION
    } catch {
      return NO_SESSION
    }
  }, [ctx, sessionId])

  const snapshot = useObservable(face)

  return React.useMemo(() => {
    for (const wait of snapshot.pending ?? []) {
      if (wait.kind !== 'question') continue
      const review = planReviewOf(wait.payload?.questions ?? [])
      if (review !== undefined) return { wait, review }
    }
    return undefined
  }, [snapshot])
}

/**
 * Send one decision for a live review.
 *
 * The encoding is the wire contract's, not a convenience of this panel:
 * `selected` carries the asker's own option label verbatim, and `custom` is the
 * free-text channel `exit_plan_mode` turns into the model's feedback. Note that
 * ANY `custom` makes it keep planning — the tool checks `custom !== undefined`
 * before it looks at the label — so approving and revising are mutually
 * exclusive by the harness's design, not by a choice made here.
 * @param wait - the pending carrier.
 * @param id - the reviewed question's id.
 * @param label - the option label being selected.
 * @param custom - free-text feedback, omitted entirely when approving.
 */
async function answerReview(
  wait: PendingWaitLike,
  id: string,
  label: string,
  custom?: string,
): Promise<void> {
  const receipt = await wait.respond({
    ok: true,
    value: {
      sessionId: wait.sessionId,
      answer: { answers: [{ id, selected: [label], ...(custom === undefined ? {} : { custom }) }] },
    },
  })
  if (!receipt.accepted) {
    throw new Error(
      receipt.reason === 'not-pending'
        ? 'that review was already answered elsewhere'
        : `the host rejected the answer (${receipt.reason ?? 'unknown'})`,
    )
  }
}

/**
 * The lead-in wrapped around a revised plan before it is sent as feedback.
 *
 * The body alone arrives at the model as the bare text of
 * "The user chose to keep planning; their feedback: …", which reads as a
 * comment on the plan rather than a replacement for it. One sentence makes the
 * intent unambiguous, and asking for it back through `exit_plan_mode` keeps the
 * revised version inside the review loop instead of ending it.
 * @param body - the edited plan markdown.
 * @returns the feedback text to send.
 */
function revisionFeedback(body: string): string {
  return `I edited the plan. Present this revised version again with exit_plan_mode, changing it only where it cannot work:\n\n${body}`
}

function PlanWindow({
  ctx,
  plan,
  onClose,
}: {
  ctx: ClientContext
  plan: PlanRecord
  onClose: () => void
}): React.ReactElement {
  // The live review, but only when it is unambiguously THIS plan's. The dock
  // opens on the newest pending-or-proposed plan in the workspace, which is not
  // always the one under review — a plan fenced in a later message outranks it.
  // Bodies are compared because that is the only thing the store and the wire
  // both carry; settling a review from a panel showing something else would be
  // the worst bug this feature could have.
  const found = usePlanReview(ctx, plan.sessionId)
  const live =
    found !== undefined && plan.status === 'pending' && found.review.plan.trim() === plan.body.trim()
      ? found
      : undefined

  // `undefined` is "not editing"; a string is the draft. Kept as one value so
  // the two can never disagree.
  const [draft, setDraft] = React.useState<string | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>(undefined)

  // A different plan, or a review that settled elsewhere, must not leave a
  // stale draft editing a body that is no longer on screen.
  // Hoisted out of the JSX so the declining option narrows once instead of
  // needing a non-null assertion at every use.
  const decline = live?.review.decline
  const reviewing = live !== undefined
  React.useEffect(() => {
    setDraft(undefined)
    setBusy(false)
    setError(undefined)
  }, [plan.id, reviewing])

  const settle = React.useCallback(
    (label: string, custom?: string) => {
      if (live === undefined) return
      setBusy(true)
      setError(undefined)
      void answerReview(live.wait, live.review.id, label, custom)
        .then(() => {
          setDraft(undefined)
          setBusy(false)
        })
        .catch((err: unknown) => {
          setBusy(false)
          setError(err instanceof Error ? err.message : String(err))
        })
    },
    [live],
  )

  // Esc closes, matching every other dismissible surface in the shell — except
  // while editing, where it backs out of the editor instead. Losing an edited
  // plan to the same key that dismisses the panel would be a cruel default.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (draft !== undefined) {
        setDraft(undefined)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, draft])

  const [copied, setCopied] = React.useState(false)
  const copy = React.useCallback(() => {
    void navigator.clipboard
      ?.writeText(plan.body)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        // Clipboard permission is the user's to give; failing silently beats an
        // error banner over a convenience button.
      })
  }, [plan.body])

  const dock = useDock(true)
  const style: React.CSSProperties =
    dock === null
      ? { display: 'none' }
      : { top: dock.top, height: dock.height, right: dock.right, width: dock.width }

  return (
    <aside
      className="dshpb-dock"
      style={style}
      // Complementary, not a dialog: the chat beside it stays live and
      // interactive — the approve control is over there. `role="dialog"` would
      // tell a screen reader the rest of the app is inert, which is a lie.
      role="complementary"
      aria-label={`Plan: ${plan.title}`}
      // Tell floating chrome that this strip is taken (see DOCK_CLAIM).
      {...{ [DOCK_CLAIM]: 'right' }}
    >
      <div className="dshpb-head">
        <div className="dshpb-headline">
          <div className="dshpb-eyebrow">Plan</div>
          <div className="dshpb-title">{plan.title}</div>
          <div className="dshpb-meta">
            <StatusPill status={plan.status} />
            <span>{when(plan.createdAt)}</span>
          </div>
        </div>
        <div className="dshpb-actions">
          <button type="button" className="dshpb-btn" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="dshpb-close"
            onClick={onClose}
            aria-label="Close the plan panel"
            title="Close (Esc)"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="dshpb-body">
        {draft === undefined ? (
          <Markdown source={plan.body} />
        ) : (
          <textarea
            className="dshpb-editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            autoFocus
            aria-label="Revise the plan"
          />
        )}
      </div>

      <div className="dshpb-foot">
        {live !== undefined ? (
          <>
            <span className="dshpb-note">
              {error !== undefined ? (
                <span className="dshpb-error">{error}</span>
              ) : draft !== undefined ? (
                'Sent as review feedback — the model revises and presents again.'
              ) : (
                'Answering here settles the review in the conversation.'
              )}
            </span>
            <span className="dshpb-foot-actions">
              {draft === undefined ? (
                <>
                  <button
                    type="button"
                    className="dshpb-btn"
                    disabled={busy}
                    onClick={() => setDraft(plan.body)}
                    title="Edit the plan and send it back for revision"
                  >
                    Revise
                  </button>
                  {decline !== undefined ? (
                    <button
                      type="button"
                      className="dshpb-btn"
                      disabled={busy}
                      {...(decline.description === undefined ? {} : { title: decline.description })}
                      onClick={() => settle(decline.label)}
                    >
                      {decline.label}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="dshpb-primary"
                    disabled={busy}
                    {...(live.review.approve.description === undefined
                      ? {}
                      : { title: live.review.approve.description })}
                    onClick={() => settle(live.review.approve.label)}
                  >
                    {live.review.approve.label}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="dshpb-btn" disabled={busy} onClick={() => setDraft(undefined)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="dshpb-primary"
                    disabled={busy || draft.trim() === ''}
                    // Any `custom` is keep-planning to `exit_plan_mode`, whatever
                    // label rides with it, so the honest label is the declining
                    // one — the review really does stay open.
                    onClick={() => settle((decline ?? live.review.approve).label, revisionFeedback(draft.trim()))}
                  >
                    Send revision
                  </button>
                </>
              )}
            </span>
          </>
        ) : plan.status === 'pending' ? (
          // A pending plan with no reachable review: the session that raised it
          // is not bound here, or the card was already answered. Say where the
          // control is rather than showing buttons that cannot settle anything.
          <span className="dshpb-note">
            Approve or keep planning from the review prompt in the conversation.
          </span>
        ) : plan.status === 'proposed' ? (
          // No review was raised for this one, so do not imply one is waiting.
          <span className="dshpb-note">Proposed in the conversation — no approval was requested.</span>
        ) : plan.feedback !== undefined && plan.feedback !== '' ? (
          <span className="dshpb-note dshpb-feedback">{plan.feedback}</span>
        ) : (
          <span className="dshpb-note">Saved to .dsh/plans/{plan.id}.md</span>
        )}
      </div>
    </aside>
  )
}

/**
 * The overlay entry: watches for a presented plan and opens the window.
 * @param props.ctx - client root context.
 * @returns the window, or nothing.
 */
function PlanOverlay({ ctx, remote }: { ctx: ClientContext; remote: PlansRemote | undefined }): React.ReactElement | null {
  const workspace = useCurrentWorkspace(ctx)
  const { token, openPlanId } = usePlanToken(remote, workspace?.workspaceId)

  const [plan, setPlan] = React.useState<PlanRecord | undefined>(undefined)
  // The plan the window is showing. Held separately from `openPlanId` so the
  // window does NOT vanish the moment the review settles — the decision is
  // exactly when the outcome becomes worth reading, and a window that
  // disappears as you answer reads like a crash. Only Close clears it.
  const [openId, setOpenId] = React.useState<string | undefined>(undefined)
  // Plans the user already closed, so dismissing one does not suppress the next.
  const [dismissed, setDismissed] = React.useState<ReadonlySet<string>>(() => new Set())

  // A newly presented plan opens the window, unless it was already closed once.
  React.useEffect(() => {
    if (openPlanId === undefined || dismissed.has(openPlanId)) return
    setOpenId(openPlanId)
  }, [openPlanId, dismissed])

  // Re-read on every token move, so the status pill follows the decision and a
  // plan deleted from the tab closes the window instead of stranding it.
  React.useEffect(() => {
    if (remote === undefined || workspace === undefined || openId === undefined) {
      setPlan(undefined)
      return
    }
    let cancelled = false
    void remote
      .get({ workspaceId: workspace.workspaceId, id: openId })
      .then((reply) => {
        if (!cancelled) setPlan(reply.ok ? reply.value.plan : undefined)
      })
      .catch(() => {
        if (!cancelled) setPlan(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [remote, workspace, openId, token])

  React.useEffect(() => injectStyles(), [])

  const close = React.useCallback(() => {
    if (openId !== undefined) setDismissed((prev) => new Set(prev).add(openId))
    setOpenId(undefined)
  }, [openId])

  if (plan === undefined) return null
  return <PlanWindow ctx={ctx} plan={plan} onClose={close} />
}

/* Varied widths so the placeholder reads as a list of different plan titles
   rather than a stack of identical blocks. Six rows fills the 280px column
   without implying a specific count. */
const SKELETON_WIDTHS = [74, 52, 88, 61, 45, 69]

/**
 * Placeholder shown while the plan list is being read.
 *
 * A skeleton rather than a spinner: the tab is a large surface, and bars in the
 * list's own shape read as "this content is arriving" instead of blanking the
 * area. It also replaces a FALSE empty state — before this existed the tab
 * rendered "No plans yet" during the read, which is a claim about the workspace
 * rather than a description of the wait.
 *
 * The wrapper carries the live region so a screen reader is told the list is
 * loading without narrating six decorative rows.
 * @returns the loading placeholder.
 */
function PlanSkeleton(): React.ReactElement {
  return (
    <div className="dshpb-skel" role="status" aria-live="polite" aria-busy="true">
      <span className="dshpb-sronly">Reading plans…</span>
      {SKELETON_WIDTHS.map((width, i) => (
        <div className="dshpb-skel-row" key={i} aria-hidden="true">
          {/* The bar is an inner <i> so the outer span can hold the real row's
              LINE height while the bar keeps its own 10px. */}
          <span className="dshpb-skel-title" style={{ width: `${width}%` }}>
            {/* Staggering the shimmer makes it sweep down the list instead of
                every bar flashing in lockstep. */}
            <i style={{ animationDelay: `${i * 70}ms` }} />
          </span>
          <span className="dshpb-skel-meta">
            <span className="dshpb-skel-pill" style={{ animationDelay: `${i * 70}ms` }} />
            <span className="dshpb-skel-when" style={{ animationDelay: `${i * 70}ms` }} />
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * The history tab.
 * @param props.ctx - client root context.
 * @param props.workspaceId - workspace whose plans to list.
 * @returns the tab body.
 */
function PlansTab({
  remote,
  workspaceId,
}: {
  remote: PlansRemote | undefined
  workspaceId: string | null
}): React.ReactElement {
  const { token } = usePlanToken(remote, workspaceId ?? undefined)
  const [plans, setPlans] = React.useState<PlanMeta[]>([])
  const [selected, setSelected] = React.useState<PlanRecord | undefined>(undefined)
  const [selectedId, setSelectedId] = React.useState<string | undefined>(undefined)
  const [error, setError] = React.useState<string | undefined>(undefined)
  /* Loading is its OWN flag, never inferred from `plans.length === 0`. An empty
     list means "this workspace has no plans" and an unread one means "we have
     not looked yet" — collapsing them rendered the "No plans yet" copy during
     every read, telling the user something false and sending them looking for a
     plan the tab had simply not fetched.

     It starts FALSE and is armed by the effect that actually fetches. Starting
     true would strand the tab on a skeleton forever in the deployments where
     that effect early-returns — no host half, or no workspace open — which are
     precisely the cases the empty states below exist to explain. */
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => injectStyles(), [])

  React.useEffect(() => {
    if (remote === undefined || workspaceId === null) return
    let cancelled = false
    setLoading(true)
    void remote
      .list({ workspaceId })
      .then((reply) => {
        if (cancelled) return
        if (!reply.ok) {
          setError(reply.error?.message ?? 'the host rejected the request')
          return
        }
        setPlans(reply.value.plans)
        setError(undefined)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      /* Cleared on BOTH paths, and only when this read is still the current one:
         a settle that lost its race must not lift the flag for the read that
         replaced it. */
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [remote, workspaceId, token])

  React.useEffect(() => {
    if (remote === undefined || workspaceId === null || selectedId === undefined) {
      setSelected(undefined)
      return
    }
    let cancelled = false
    void remote
      .get({ workspaceId, id: selectedId })
      .then((reply) => {
        if (!cancelled) setSelected(reply.ok ? reply.value.plan : undefined)
      })
      .catch(() => {
        if (!cancelled) setSelected(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [remote, workspaceId, selectedId, token])

  if (workspaceId === null) {
    return <div className="dshpb-empty">Open a session in a workspace to see its plans.</div>
  }
  if (error !== undefined) {
    return <div className="dshpb-empty">Could not read plans: {error}</div>
  }
  /* Ordered deliberately: the workspace and error branches above are real
     ANSWERS and outrank a pending read, while the empty state below is a claim
     about the workspace that must not be made until the list has been read.
     Only a FIRST read shows the skeleton — a token-driven refresh keeps the
     current list on screen rather than flashing bars over plans already
     rendered. */
  if (loading && plans.length === 0) {
    return <PlanSkeleton />
  }
  if (plans.length === 0) {
    return (
      <div className="dshpb-empty">
        No plans yet. Switch the session to plan mode; every plan presented through
        <code className="dshpb-icode"> exit_plan_mode </code>
        is saved here.
      </div>
    )
  }

  return (
    <div className="dshpb-tab">
      <div className="dshpb-list" role="list">
        {plans.map((plan) => (
          <button
            type="button"
            role="listitem"
            key={plan.id}
            className={`dshpb-row${plan.id === selectedId ? ' dshpb-row-on' : ''}`}
            onClick={() => setSelectedId(plan.id === selectedId ? undefined : plan.id)}
          >
            <span className="dshpb-row-title">{plan.title}</span>
            <span className="dshpb-row-meta">
              <StatusPill status={plan.status} />
              <span>{when(plan.createdAt)}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="dshpb-detail">
        {selected === undefined ? (
          <div className="dshpb-empty">Select a plan to read it.</div>
        ) : (
          <>
            <Markdown source={selected.body} />
            {selected.feedback !== undefined && selected.feedback !== '' ? (
              <div className="dshpb-feedback dshpb-feedback-block">{selected.feedback}</div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The per-message action that sends an assistant reply to the plan panel.
 *
 * The escape hatch for the marker: when the model writes a plan without fencing
 * it, nothing is captured automatically, and this is the only other route in.
 * The seat supplies just a `messageId`, so the host resolves the text — it is
 * already watching every assistant message for fences and keeps the recent ones
 * for exactly this.
 * @param props.remote - the mounted host contract.
 * @param props.workspaceId - workspace to file the plan under.
 * @param props.messageId - the message the seat addressed.
 * @returns the action button.
 */
function PinAction({
  remote,
  workspaceId,
  messageId,
}: {
  remote: PlansRemote | undefined
  workspaceId: string | null
  messageId: string
}): React.ReactElement | null {
  const [state, setState] = React.useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  const [reason, setReason] = React.useState<string | undefined>(undefined)

  React.useEffect(() => injectStyles(), [])

  if (remote === undefined || workspaceId === null) return null

  const pin = () => {
    setState('busy')
    void remote
      .pin({ workspaceId, messageId })
      .then((reply) => {
        if (!reply.ok) {
          setReason(reply.error?.message ?? 'the host rejected the request')
          setState('failed')
          return
        }
        if (reply.value.ok) {
          setState('done')
          return
        }
        // "already saved" is the common one, and it is not a failure worth a
        // red state — the plan the user wanted IS in the panel.
        setReason(reply.value.reason)
        setState(reply.value.reason.includes('already') ? 'done' : 'failed')
      })
      .catch((err: unknown) => {
        setReason(err instanceof Error ? err.message : String(err))
        setState('failed')
      })
  }

  return (
    <button
      type="button"
      className="dshpb-pin"
      onClick={pin}
      disabled={state === 'busy' || state === 'done'}
      title={reason ?? 'Save this message as a plan and open it in the panel'}
      aria-label="Send to plan panel"
    >
      {state === 'done' ? 'In plan panel' : state === 'failed' ? 'Could not pin' : 'Pin as plan'}
    </button>
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
 * Every colour is a `--dsw-*` alias the harness defines, so the window follows
 * the active theme (including anything `dsh-theme` overrides) instead of
 * pinning its own palette. Font sizes are literals on the harness's
 * 11/12/13/14/16/20/24 ladder — the tokens are not what dsh's own UI follows,
 * so matching the values is what buys visual consistency.
 * @returns a no-op cleanup, so it can be used from an effect.
 */
export function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  // Checked on the ELEMENT, not a one-way boolean: a flag that stays true after
  // something removes the tag leaves every class name intact and no CSS behind
  // them, which survives refreshes and reads as the panel being broken.
  if (styleTag !== null && styleTag.isConnected) return () => {}
  const style = document.createElement('style')
  style.dataset.dshpb = 'true'
  style.textContent = CSS
  document.head.appendChild(style)
  styleTag = style
  return () => {}
}

const CSS = `
/* The conversation column gives up exactly the dock's width while it is open.
   Keyed on the attribute this plugin sets, so nothing changes for anyone who
   never opens a plan — and if the harness ever re-renders the column and drops
   the attribute, the rule simply stops applying and the panel overlays instead
   of stranding a permanent gap. */
/* Padding is applied inline by the dock (specificity); this only animates it. */
[data-dshpb-docked] {
  transition: padding-right 160ms ease;
}
@media (prefers-reduced-motion: reduce) {
  [data-dshpb-docked] { transition: none; }
}

.dshpb-dock {
  position: fixed;
  display: flex;
  flex-direction: column;
  /* The measured box IS the panel. Under content-box the two 1px borders push
     the panel 1px past the column's right edge and 1px below its bottom, which
     is exactly the seam a docked panel must not have. */
  box-sizing: border-box;
  background: var(--dsw-specific-menu);
  /* Only the inner edge is drawn: the panel is flush with the column's right
     side, so a full border would double up against the shell's own chrome. */
  border-left: 1px solid var(--dsw-alias-border-l2);
  border-top: 1px solid var(--dsw-alias-border-l2);
  border-top-left-radius: 10px;
  font-family: var(--dsw-font-family);
  color: var(--dsw-alias-label-primary);
  /* Above dsh-weather's bar (2147482900), below mission control's rail
     (2147483000). The overlay layer is one stacking context, so a plugin that
     leaves itself near the bottom of it is painted over by every sibling that
     touches it — this panel sat at 40 and lost to a decorative weather bar. The
     bar now slides aside instead (see DOCK_CLAIM); this is what stops it being
     covered on a viewport with nowhere for the bar to go. */
  z-index: 2147482950;
  overflow: hidden;
  opacity: 1;
  /* The shell's overlay layer is pointer-events: none so it cannot swallow
     clicks meant for the app underneath. A child that wants to be clickable —
     this panel's Close button — has to opt back in, or it renders perfectly and
     does nothing. */
  pointer-events: auto;
  /* No entrance animation, and this is a correctness rule rather than taste.
     An earlier version slid in with translateX(12px) -> 0 and dropped an
     opacity keyframe because "a tab that mounts while the window is hidden"
     leaves the animation reverted or never run. The transform half has the
     same failure and a worse consequence: observed in the shell with
     getAnimations() reporting startTime: null and currentTime: 0, the panel was
     pinned at the FROM keyframe forever — computed transform
     matrix(1,0,0,1,12,0) — so a dock measured flush to the column's right edge
     at 863 actually painted to 875, leaving 4px between it and mission
     control's rail instead of 16. This panel's position is measured against a
     boundary; nothing may offset it after the fact. The column's own
     padding-right transition still animates, so the arrival is not abrupt. */
  /* DSH Desktop on Windows overlays a 36px window-drag strip across the top of
     the viewport (#dsh-desktop-windows-drag-region, -webkit-app-region: drag,
     z-index 2147483644). The compositor resolves a drag region BEFORE
     hit-testing, so it swallows clicks that land in it no matter what z-index
     the covered element carries, and no-drag on the covered element does not
     punch a hole through it (dsh-weather verified both). The panel spans the
     full window, so its header has to be inset out of the strip instead — see
     .dshpb-head. Non-Windows desktop and plain web get 0px. */
  --dshpb-titlebar-h: 0px;
}
body.dsh-desktop-windows-titlebar-layout .dshpb-dock {
  --dshpb-titlebar-h: 36px;
}
.dshpb-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: calc(14px + var(--dshpb-titlebar-h)) 16px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  /* Belt-and-braces against the desktop drag strip. The preload already grants
     buttons no-drag; stating it here survives a future narrowing of that
     allowlist, and costs nothing in a browser. */
  -webkit-app-region: no-drag;
}
.dshpb-head button { -webkit-app-region: no-drag; }
/* A glyph never swallows its button's click: the preload's no-drag allowlist
   covers "button" but not "svg", so an svg left as its own hit target could
   land back inside the drag region. */
.dshpb-close > svg { pointer-events: none; }
.dshpb-headline { flex: 1 1 auto; min-width: 0; }
.dshpb-eyebrow {
  font-size: 11px;
  line-height: 1.2;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
  margin-bottom: 3px;
}
.dshpb-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshpb-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dshpb-close:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshpb-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--dsw-alias-label-tertiary);
  min-width: 0;
}
.dshpb-meta > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshpb-actions { display: flex; gap: 6px; flex: 0 0 auto; }
.dshpb-btn {
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dshpb-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshpb-pin {
  font-family: var(--dsw-font-family);
  /* The action row is an icon strip, so it offers very little width and a
     two-word label wraps into a three-line box beside 16px icons. */
  white-space: nowrap;
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dshpb-pin:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshpb-pin:disabled { opacity: 0.6; cursor: default; }
.dshpb-pill {
  display: inline-block;
  flex: 0 0 auto;
  /* The dock is half a column wide, so "Awaiting review" wraps to two lines and
     the pill grows into a box. It is a label, not a paragraph. */
  white-space: nowrap;
  font-size: 11px;
  line-height: 1;
  padding: 3px 7px;
  border-radius: 999px;
  border: 1px solid currentColor;
}
.dshpb-body { flex: 1 1 auto; overflow: auto; padding: 16px; display: flex; flex-direction: column; }
/* The revision editor takes the body whole. Code font and 12px because the
   content is markdown being edited as source, matching .dshpb-pre. */
.dshpb-editor {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  resize: none;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major);
  color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 1.5;
  tab-size: 2;
}
.dshpb-editor:focus {
  outline: none;
  border-color: var(--dsw-alias-brand-primary);
}
/* A column, not a row. Three decision buttons plus a sentence do not fit
   across a 280px dock — measured: 265px of buttons into 248px of content box,
   which pushed Approve out through the panel's own overflow:hidden and clipped
   it. Stacking gives the buttons the full width and the note a readable line,
   and the wrap below covers the narrowest dock the clamp allows. */
.dshpb-foot {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.dshpb-note { min-width: 0; line-height: 1.4; }
.dshpb-foot-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  align-items: center;
}
.dshpb-error { color: var(--dsw-alias-state-error-primary); }
.dshpb-primary {
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  cursor: pointer;
}
.dshpb-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dshpb-primary:disabled, .dshpb-btn:disabled { opacity: 0.6; cursor: default; }
.dshpb-foot .dshpb-btn { white-space: nowrap; }
.dshpb-feedback { color: var(--dsw-alias-state-business-primary); white-space: pre-wrap; }
.dshpb-feedback-block {
  margin-top: 16px;
  padding: 10px 12px;
  border-left: 2px solid var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 0 6px 6px 0;
  font-size: 12px;
}

.dshpb-tab {
  display: flex;
  height: 100%;
  min-height: 0;
  font-family: var(--dsw-font-family);
  color: var(--dsw-alias-label-primary);
}
.dshpb-list {
  flex: 0 0 280px;
  overflow: auto;
  border-right: 1px solid var(--dsw-alias-border-l1);
  padding: 8px;
}
.dshpb-row {
  display: block;
  width: 100%;
  text-align: left;
  font-family: inherit;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  color: inherit;
}
.dshpb-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshpb-row-on { background: var(--dsw-alias-interactive-bg-active); }
.dshpb-row-title {
  display: block;
  font-size: 13px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshpb-row-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
/* ---- loading skeleton ----
   Shaped like the real plan list rather than a centred spinner, because the tab
   is a large surface and a spinner blanks it. Geometry is copied from
   .dshpb-row: the same 8px/10px padding on the 280px column, a title bar on the
   13px line, and a meta line 4px below carrying a pill-shaped status bar and a
   short date bar.

   Bar heights are box dimensions stated directly, never calc() off a font size
   — arithmetic on a scale step lands between rungs by construction. */
.dshpb-skel { padding: 8px; }
.dshpb-skel-row { padding: 8px 10px; border-radius: 6px; }
.dshpb-skel-row + .dshpb-skel-row { margin-top: 2px; }
/* The BAR is 10px, but the LINE it sits on must match the real row's, or the
   skeleton is shorter than what replaces it and the list jumps on arrival.

   Each bar is wrapped in a box of the height the real text occupies, and the
   10px bar is centred inside it. The heights are the MEASURED line boxes of the
   real row's children (.dshpb-row-title 18.2px, .dshpb-row-meta 19px), taken
   from the browser rather than computed here — 13px x 1.4 is not a round
   number, and a product stated in a comment drifts from what the browser does.
   Re-measure with scripts/progress-probe.mjs after touching either.

   A line-height alone does NOT work: these are flex children, and a flex
   container blockifies its children, so an empty span carries no line box and
   the row collapses to the bars' own height. That version measured 42px against
   the real row's 57.2px. */
.dshpb-skel-title {
  display: flex; align-items: center;
  height: 18.2px;
}
.dshpb-skel-title > i { display: block; height: 10px; width: 100%; border-radius: 3px; }
.dshpb-skel-meta {
  display: flex; align-items: center; gap: 8px; margin-top: 4px;
  height: 19px;
}
/* Rounded to a pill so it reads as the StatusPill it stands in for. */
.dshpb-skel-pill { height: 10px; width: 54px; border-radius: 999px; flex: none; }
.dshpb-skel-when { height: 10px; width: 42px; border-radius: 3px; flex: none; }
/* The shimmer animates BACKGROUND-POSITION over an oversized gradient, never a
   transform or a box dimension, so it cannot nudge layout while it sweeps.

   border-l2, NOT border-l1. Both are alpha over the surface, and on the LIGHT
   theme l1 is #0000000a — black at 4% — which renders the bars at 1.11:1 and
   leaves the pane reading as blank. l2 (#0000001a) is the token dsh-git and
   dsh-todo already use for their own skeleton tones. Caught by
   progress-probe.mjs, which measures both themes for exactly this. */
.dshpb-skel-title > i, .dshpb-skel-pill, .dshpb-skel-when {
  background: linear-gradient(
    90deg,
    var(--dsw-alias-border-l2) 0%,
    var(--dsw-alias-interactive-bg-hover) 40%,
    var(--dsw-alias-border-l2) 80%
  );
  background-size: 300% 100%;
  animation: dshpb-shimmer 1.4s ease-in-out infinite;
}
@keyframes dshpb-shimmer {
  0% { background-position: 180% 0; }
  100% { background-position: -80% 0; }
}
/* Placed AFTER the shimmer, not in the docked-transition block near the top of
   this sheet. Both selectors have equal specificity, so the LATER rule wins —
   parked above, the animation-none declaration was silently overridden and the
   bars kept sweeping under reduced motion. The browser probe caught it;
   source-reading could not, because the rule is correct in isolation.

   (No backtick in this comment: the stylesheet is a template literal, so one
   closes it early and silently truncates every rule below.) */
@media (prefers-reduced-motion: reduce) {
  /* Hold the bars at a flat mid-tone: the skeleton still communicates "loading"
     by being there, without the sweep. */
  .dshpb-skel-title > i, .dshpb-skel-pill, .dshpb-skel-when {
    animation: none;
    background: var(--dsw-alias-border-l2);
  }
}
/* Visually hidden, still announced. */
.dshpb-sronly {
  position: absolute; width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}

.dshpb-detail { flex: 1 1 auto; overflow: auto; padding: 16px 20px; min-width: 0; }
.dshpb-empty {
  padding: 24px;
  font-family: var(--dsw-font-family);
  font-size: 13px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
}

.dshpb-md { font-size: 13px; line-height: 1.65; }
.dshpb-h1 { font-size: 16px; font-weight: 600; line-height: 1.35; margin: 20px 0 8px; }
.dshpb-h1:first-child { margin-top: 0; }
.dshpb-h2 { font-size: 14px; font-weight: 600; line-height: 1.4; margin: 18px 0 6px; }
.dshpb-h3 { font-size: 13px; font-weight: 600; line-height: 1.4; margin: 14px 0 4px; color: var(--dsw-alias-label-secondary); }
.dshpb-p { margin: 0 0 10px; }
.dshpb-ul, .dshpb-ol { margin: 0 0 10px; padding-left: 20px; }
.dshpb-ul li, .dshpb-ol li { margin: 3px 0; }
.dshpb-pre {
  margin: 0 0 12px;
  padding: 10px 12px;
  overflow: auto;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 1.5;
}
.dshpb-icode {
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1);
}
.dshpb-quote {
  margin: 0 0 10px;
  padding-left: 12px;
  border-left: 2px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.dshpb-hr { border: 0; border-top: 1px solid var(--dsw-alias-border-l1); margin: 16px 0; }
`

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------

/**
 * Client plugin body: mount the host contract, then take the overlay seat and
 * the conversation view ring.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const anyCtx = ctx as never as {
    remote: { $mount: (c: unknown) => Promise<() => Promise<void>> }
    inject: (services: readonly string[], callback: (scoped: unknown) => void) => { dispose: () => void }
  }

  // `$mount` publishes `remote.dshPlans` ASYNCHRONOUSLY, so nothing may read it
  // until that service exists — reading it in apply() captures `undefined`.
  ctx.effect(() => {
    let disposed = false
    let unmount: (() => Promise<void>) | undefined
    void anyCtx.remote
      .$mount(PLANS_REMOTE)
      .then((dispose) => {
        if (disposed) return void dispose()
        unmount = dispose
      })
      .catch((error: unknown) => {
        console.error('dsh-plan-board: failed to mount host remote', error)
      })
    return () => {
      disposed = true
      void unmount?.()
    }
  }, 'dsh-plan-board: mount host remote')

  // Both seats wait on the mounted namespace. The dependency cannot go in the
  // top-level `inject` array: this plugin mounts its own contract, so requiring
  // it there would deadlock apply() against an effect that never runs.
  ctx.effect(() => {
    const fiber = anyCtx.inject(['remote.dshPlans', 'workspaces', 'sessions', 'slots'], (scoped) => {
      const readyCtx = scoped as ClientContext & {
        workspaces: { list: WorkspaceListLike }
      }

      // Resolve the mounted namespace ONCE, here in the ready context. Reading
      // `ctx.remote.dshPlans` during a React render resolves it to `undefined`
      // — a render is not the fiber `$mount` published into — which leaves
      // every load effect returning early and the UI stuck on its empty state
      // with no error to show for it.
      const remote = (readyCtx as unknown as { remote: Record<string, PlansRemote | undefined> }).remote
        ?.dshPlans

      readyCtx.slots.inject('shell.overlay', () =>
        readyCtx.slots.register({ name: 'shell.overlay', id: 'dsh-plan-board' }, () =>
          React.createElement(PlanOverlay, { ctx: readyCtx, remote }),
        ),
      )

      readyCtx.slots.inject('conversation.chat.assistant-actions', () =>
        readyCtx.slots.register(
          { name: 'conversation.chat.assistant-actions', id: 'pin-as-plan', order: 60 },
          ({ messageId }: { messageId: string }) => {
            // The seat is shell-wide; resolve the workspace from the session the
            // message belongs to, the same way the tab does.
            const items = readyCtx.workspaces.list.getSnapshot().items
            const current = (
              readyCtx as unknown as { sessions: { list: SessionListLike } }
            ).sessions.list.getSnapshot().current
            const hit = items.find((ws) => ws.sessionIds.some((id) => String(id) === String(current)))
            return React.createElement(PinAction, {
              remote,
              workspaceId: hit?.workspaceId ?? null,
              messageId: String(messageId),
            })
          },
        ),
      )

      readyCtx.slots.inject('conversation.view', () =>
        readyCtx.slots.register(
          {
            name: 'conversation.view',
            id: 'plans',
            // After Chat (0), Trajectory (10) and Todo (20); this is reference
            // material, not something you work in.
            order: 30,
            label: () => 'Plans',
            inject: (sessionId: string) => {
              const items = readyCtx.workspaces.list.getSnapshot().items
              // Compare as strings: the harness brands SessionId, and the slot
              // hands this callback the branded value while the workspace
              // entries carry the same brand — `includes` across the two reads
              // as a type error even though the runtime values are equal.
              const hit = items.find((ws) => ws.sessionIds.some((id) => String(id) === String(sessionId)))
              return { workspaceId: hit?.workspaceId ?? null, remote }
            },
          },
          ({ workspaceId, remote: r }: { workspaceId: string | null; remote: PlansRemote | undefined }) =>
            React.createElement(PlansTab, { remote: r, workspaceId }),
        ),
      )
    })
    return () => {
      fiber.dispose()
    }
  }, 'dsh-plan-board: slot registration')
}
