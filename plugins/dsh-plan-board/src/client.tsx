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
 * ## What this window will not do
 *
 * It does not approve plans. `exit_plan_mode` presents the plan through
 * `ctx.userQuestions.ask()`, and that service documents ONE active provider per
 * context — the shipped question UI already holds it. Registering a second one
 * to put Approve/Keep-planning buttons here would hijack every question in the
 * harness, not just plan reviews. So this window is a reading surface: the plan
 * at full size, and a line telling you where the real control is.
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
  changeToken(request: { workspaceId: string }): Promise<Reply<{ token: number; pendingId?: string }>>
  discard(request: { workspaceId: string; id: string }): Promise<Reply<{ ok: boolean; token: number }>>
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
): { token: number; pendingId?: string } {
  const [state, setState] = React.useState<{ token: number; pendingId?: string }>({ token: 0 })

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
        setState((prev) => (prev.token === next.token && prev.pendingId === next.pendingId ? prev : next))
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

/** Attribute this plugin sets on the column while the dock is open. */
const DOCK_ATTR = 'data-dshpb-docked'
/** Custom property carrying the dock's current width to the column's padding. */
const DOCK_WIDTH_VAR = '--dshpb-dock-w'

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
      const apply = () => {
        setBox({
          top: 0,
          height: window.innerHeight,
          right: 0,
          width: Math.max(DOCK_MIN, Math.min(DOCK_MAX, window.innerWidth * 0.5)),
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
      const width = Math.round(Math.max(DOCK_MIN, Math.min(DOCK_MAX, rect.width * 0.5)))
      column.setAttribute(DOCK_ATTR, '')
      // Inline, not a stylesheet rule. The column's own class selector has the
      // same specificity as an attribute selector, and which stylesheet lands
      // last is not this plugin's to decide — an inline declaration is the only
      // one that reliably wins. The MutationObserver below re-applies it if a
      // React re-render wipes the style attribute.
      column.style.setProperty(DOCK_WIDTH_VAR, `${width}px`)
      column.style.paddingRight = `${width}px`
      setBox((prev) => {
        const next = {
          top: Math.round(rect.top),
          height: Math.round(rect.height),
          right: Math.round(window.innerWidth - rect.right),
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
    // The column's own attributes, not its subtree: a React re-render that
    // strips DOCK_ATTR is the failure this is here for, and watching children
    // would fire on every streamed token.
    const mutation = new MutationObserver(() => {
      if (!column.hasAttribute(DOCK_ATTR) || column.style.paddingRight === '') sync()
    })
    mutation.observe(column, { attributes: true, attributeFilter: [DOCK_ATTR, 'style'] })
    window.addEventListener('resize', sync)

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      resize.disconnect()
      mutation.disconnect()
      window.removeEventListener('resize', sync)
      column.removeAttribute(DOCK_ATTR)
      column.style.removeProperty(DOCK_WIDTH_VAR)
      column.style.removeProperty('padding-right')
    }
  }, [open])

  return box
}

function PlanWindow({ plan, onClose }: { plan: PlanRecord; onClose: () => void }): React.ReactElement {
  // Esc closes, matching every other dismissible surface in the shell.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
        <Markdown source={plan.body} />
      </div>

      <div className="dshpb-foot">
        {plan.status === 'pending' ? (
          // Say plainly where the control is. A reading panel with no approve
          // button reads like a broken approve button unless it explains itself.
          <span>Approve or keep planning from the review prompt in the conversation.</span>
        ) : plan.feedback !== undefined && plan.feedback !== '' ? (
          <span className="dshpb-feedback">{plan.feedback}</span>
        ) : (
          <span>Saved to .dsh/plans/{plan.id}.md</span>
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
  const { token, pendingId } = usePlanToken(remote, workspace?.workspaceId)

  const [plan, setPlan] = React.useState<PlanRecord | undefined>(undefined)
  // The plan the window is showing. Held separately from `pendingId` so the
  // window does NOT vanish the moment the review settles — the decision is
  // exactly when the outcome becomes worth reading, and a window that
  // disappears as you answer reads like a crash. Only Close clears it.
  const [openId, setOpenId] = React.useState<string | undefined>(undefined)
  // Plans the user already closed, so dismissing one does not suppress the next.
  const [dismissed, setDismissed] = React.useState<ReadonlySet<string>>(() => new Set())

  // A newly presented plan opens the window, unless it was already closed once.
  React.useEffect(() => {
    if (pendingId === undefined || dismissed.has(pendingId)) return
    setOpenId(pendingId)
  }, [pendingId, dismissed])

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
  return <PlanWindow plan={plan} onClose={close} />
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

  React.useEffect(() => injectStyles(), [])

  React.useEffect(() => {
    if (remote === undefined || workspaceId === null) return
    let cancelled = false
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** Whether the stylesheet has been added to this document. */
let stylesInjected = false

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
  if (stylesInjected || typeof document === 'undefined') return () => {}
  stylesInjected = true
  const style = document.createElement('style')
  style.dataset.dshpb = 'true'
  style.textContent = CSS
  document.head.appendChild(style)
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
  background: var(--dsw-specific-menu);
  /* Only the inner edge is drawn: the panel is flush with the column's right
     side, so a full border would double up against the shell's own chrome. */
  border-left: 1px solid var(--dsw-alias-border-l2);
  font-family: var(--dsw-font-family);
  color: var(--dsw-alias-label-primary);
  z-index: 40;
  overflow: hidden;
  opacity: 1;
  /* The shell's overlay layer is pointer-events: none so it cannot swallow
     clicks meant for the app underneath. A child that wants to be clickable —
     this panel's Close button — has to opt back in, or it renders perfectly and
     does nothing. */
  pointer-events: auto;
  animation: dshpb-slide 160ms ease;
}
/* Transform only. An opacity keyframe leaves the panel invisible whenever the
   animation is reverted or never runs (a tab that mounts while the window is
   hidden), which is indistinguishable from the panel being broken. */
@keyframes dshpb-slide {
  from { transform: translateX(12px); }
  to { transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  .dshpb-dock { animation: none; }
}
.dshpb-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
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
.dshpb-body { flex: 1 1 auto; overflow: auto; padding: 16px; }
.dshpb-foot {
  flex: 0 0 auto;
  padding: 10px 16px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
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
