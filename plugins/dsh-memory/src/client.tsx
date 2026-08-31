/**
 * Browser half of dsh-memory: the Memory tab.
 *
 * Two jobs, both of which the harness could not do before:
 *
 *   * **See what loaded.** Every `AGENTS.md` / `CLAUDE.md` the loader
 *     discovered for this workspace, in model precedence order, with its size
 *     and — the part that matters — whether the byte budget actually kept it.
 *     A file that exists, is discovered, and is silently dropped for budget
 *     looks exactly like a file the agent is ignoring for no reason.
 *   * **Write one.** A box that appends a fact to the project file, the local
 *     overlay, or the user-global file, and then says which path it wrote.
 *
 * @module @dennisrongo/dsh-memory/client
 */
import React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { MEMORY_REMOTE } from './remote.ts'
import { MEMORY_SCOPES, type InstructionReport, type MemoryScope } from './types.ts'

export { MEMORY_REMOTE }

/**
 * Required services. `remote.dshMemory` is deliberately absent: this plugin
 * mounts that contract itself, so requiring it up front would park apply()
 * forever waiting on a service only apply() can create.
 */
export const inject = ['slots', 'remote', 'workspaces']

/**
 * Every mounted remote call resolves to an ENVELOPE, never the bare payload.
 *
 * The gateway returns `{ ok: true, value }` or `{ ok: false, error }`, and it
 * resolves rather than rejects on a host-side failure. Typing the payload
 * directly compiles fine and then reads `undefined` off every reply at
 * runtime — which is silent, because the promise still succeeds: the view
 * simply never leaves its loading state. Declaring the envelope is what makes
 * the compiler force each call site to unwrap.
 */
type Reply<T> = { ok: true; value: T } | { ok: false; error: { message?: string } }

/** Message from a failed envelope, for display. */
function replyError(reply: { ok: false; error: { message?: string } }): string {
  return reply.error?.message ?? 'the host rejected the request'
}

/** The host contract as this half calls it. */
interface MemoryRemote {
  inspect(request: { workspaceId: string }): Promise<Reply<{ report: InstructionReport }>>
  remember(request: {
    workspaceId: string
    fact: string
    scope: MemoryScope
  }): Promise<Reply<{ ok: true; path: string; line: string } | { ok: false; reason: string }>>
  read(request: { workspaceId: string; absolutePath: string }): Promise<Reply<{ text?: string }>>
}

/** Minimal shape of the client's observable workspace list. */
interface WorkspaceListLike {
  getSnapshot(): { items: readonly { workspaceId: string; sessionIds: readonly unknown[] }[] }
  subscribe(fn: () => void): () => void
}

/** How each scope is labelled and explained in the chooser. */
const SCOPE_COPY: Record<MemoryScope, { label: string; hint: string }> = {
  project: { label: 'Project', hint: 'AGENTS.md at the project root — travels with the repository' },
  local: { label: 'Local', hint: 'AGENTS.local.md — this checkout only, usually gitignored' },
  user: { label: 'User', hint: '$DSH_HOME/AGENTS.md — every project on this machine' },
}

/**
 * Format a byte count for a dense table.
 * @param bytes - the size.
 * @returns e.g. `1.2 KB`.
 */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The Memory tab.
 *
 * `remote` arrives as a PROP rather than being read off the context here.
 * Resolving a cordis service is context-sensitive, and a React render is not
 * the fiber that `$mount` published into — reading `ctx.remote.dshMemory`
 * during render yields `undefined`, the load effect returns early, and the tab
 * sits on "Reading…" forever with no error to show for it. The slot's `inject`
 * callback runs in the ready context, so it resolves the service once and
 * hands it down; this is the same shape `dsh-todo` uses.
 * @param props.remote - the mounted host contract.
 * @param props.workspaceId - workspace to inspect, or null outside one.
 * @returns the tab body.
 */
/* Varied widths so the placeholder reads as a list of different paths rather
   than a stack of identical blocks. Five rows suits the handful of AGENTS.md
   files a workspace hierarchy typically yields. */
const SKELETON_WIDTHS = [58, 72, 44, 65, 51]

/**
 * Placeholder shown while the instruction report is being read.
 *
 * A skeleton rather than a spinner: the tab is a large surface, and bars in the
 * file list's own shape read as "this content is arriving" instead of blanking
 * the area. The wrapper carries the live region so a screen reader is told the
 * report is loading without narrating five decorative rows.
 * @returns the loading placeholder.
 */
function MemorySkeleton(): React.ReactElement {
  return (
    <div className="dshmem-skel" role="status" aria-live="polite" aria-busy="true">
      <span className="dshmem-sronly">Reading instruction files…</span>
      <span className="dshmem-skel-summary" aria-hidden="true" />
      {SKELETON_WIDTHS.map((width, i) => (
        <div className="dshmem-skel-row" key={i} aria-hidden="true">
          {/* Each bar is an inner <i> so its wrapper can hold the line height
              the real text occupies while the bar keeps its own 10px. */}
          <span className="dshmem-skel-path" style={{ width: `${width}%` }}>
            {/* Staggering the shimmer makes it sweep down the list instead of
                every bar flashing in lockstep. */}
            <i style={{ animationDelay: `${i * 70}ms` }} />
          </span>
          <span className="dshmem-skel-stats">
            <i style={{ animationDelay: `${i * 70}ms` }} />
          </span>
        </div>
      ))}
    </div>
  )
}

function MemoryTab({
  remote,
  workspaceId,
}: {
  remote: MemoryRemote | undefined
  workspaceId: string | null
}): React.ReactElement {
  const [report, setReport] = React.useState<InstructionReport | undefined>(undefined)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [fact, setFact] = React.useState('')
  const [scope, setScope] = React.useState<MemoryScope>('project')
  const [notice, setNotice] = React.useState<string | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)
  const [open, setOpen] = React.useState<string | undefined>(undefined)
  const [body, setBody] = React.useState<string | undefined>(undefined)
  // Bumped after a successful write, so the report re-reads and the new fact
  // shows up in the file's size immediately.
  const [revision, setRevision] = React.useState(0)

  React.useEffect(() => injectStyles(), [])

  React.useEffect(() => {
    if (remote === undefined || workspaceId === null) return
    let cancelled = false
    void remote
      .inspect({ workspaceId })
      .then((reply) => {
        if (cancelled) return
        if (!reply.ok) {
          setError(replyError(reply))
          return
        }
        setReport(reply.value.report)
        setError(undefined)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [remote, workspaceId, revision])

  React.useEffect(() => {
    if (remote === undefined || workspaceId === null || open === undefined) {
      setBody(undefined)
      return
    }
    let cancelled = false
    void remote
      .read({ workspaceId, absolutePath: open })
      .then((reply) => {
        if (!cancelled) setBody(reply.ok ? reply.value.text : replyError(reply))
      })
      .catch(() => {
        if (!cancelled) setBody(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [remote, workspaceId, open, revision])

  const save = React.useCallback(() => {
    if (remote === undefined || workspaceId === null) return
    const trimmed = fact.trim()
    if (trimmed === '') return
    setBusy(true)
    void remote
      .remember({ workspaceId, fact: trimmed, scope })
      .then((reply) => {
        // Two `ok` flags stack here and they mean different things: the
        // envelope's says the CALL reached the host, the value's says the host
        // ACCEPTED the fact. Reading the outer one as the verdict would report
        // a refused memory as written.
        if (!reply.ok) {
          setNotice(replyError(reply))
          return
        }
        const result = reply.value
        if (result.ok) {
          setFact('')
          // Name the exact file. "Saved" leaves the user guessing which of four
          // candidate files in the hierarchy it landed in.
          setNotice(`Wrote to ${result.path}`)
          setRevision((n) => n + 1)
        } else {
          setNotice(result.reason)
        }
      })
      .catch((err: unknown) => setNotice(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }, [remote, workspaceId, fact, scope])

  if (workspaceId === null) {
    return <div className="dshmem-empty">Open a session in a workspace to see its instruction files.</div>
  }

  return (
    <div className="dshmem">
      <div className="dshmem-capture">
        <textarea
          className="dshmem-input"
          value={fact}
          placeholder="Remember something — a convention, a gotcha, a preference…"
          rows={2}
          onChange={(event) => setFact(event.target.value)}
          onKeyDown={(event) => {
            // Enter saves; Shift+Enter is a newline. A memory is a line, so the
            // common case should not need the mouse.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              save()
            }
          }}
        />
        <div className="dshmem-capture-row">
          <div className="dshmem-scopes" role="radiogroup" aria-label="Where to save">
            {MEMORY_SCOPES.map((entry) => (
              <button
                key={entry}
                type="button"
                role="radio"
                aria-checked={entry === scope}
                title={SCOPE_COPY[entry].hint}
                className={`dshmem-scope${entry === scope ? ' dshmem-scope-on' : ''}`}
                onClick={() => setScope(entry)}
              >
                {SCOPE_COPY[entry].label}
              </button>
            ))}
          </div>
          <button type="button" className="dshmem-save" disabled={busy || fact.trim() === ''} onClick={save}>
            {busy ? 'Saving…' : 'Remember'}
          </button>
        </div>
        <div className="dshmem-hint">{notice ?? SCOPE_COPY[scope].hint}</div>
      </div>

      {error !== undefined ? (
        <div className="dshmem-empty">Could not read the instruction files: {error}</div>
      ) : report === undefined ? (
        <MemorySkeleton />
      ) : (
        <>
          <div className="dshmem-summary">
            {report.files.length} file{report.files.length === 1 ? '' : 's'} discovered ·{' '}
            {size(report.discoveredBytes)} of {size(report.maxBytes)} budget
            {report.files.some((file) => !file.included) ? (
              <span className="dshmem-warn"> · some files were dropped for budget</span>
            ) : null}
          </div>
          <div className="dshmem-files">
            {report.files.length === 0 ? (
              <div className="dshmem-empty">
                No AGENTS.md or CLAUDE.md found between the project root and this session&apos;s directory.
                Write one above and it will load on the next session.
              </div>
            ) : (
              report.files.map((file) => (
                <button
                  key={file.absolutePath}
                  type="button"
                  className={`dshmem-file${file.absolutePath === open ? ' dshmem-file-on' : ''}${
                    file.included ? '' : ' dshmem-file-out'
                  }`}
                  onClick={() => setOpen(file.absolutePath === open ? undefined : file.absolutePath)}
                  title={file.absolutePath}
                >
                  <span className="dshmem-path">{file.displayPath}</span>
                  <span className="dshmem-stats">
                    {file.truncatedTo !== undefined ? (
                      <span className="dshmem-tag dshmem-tag-cut">
                        cut to {size(file.truncatedTo)}
                      </span>
                    ) : null}
                    {file.included ? null : <span className="dshmem-tag dshmem-tag-out">not loaded</span>}
                    <span>{size(file.bytes)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
          {open !== undefined ? (
            /* The caption row REPLACES the <pre> rather than sitting inside it:
               as a child it inherited the code font and the pane's border, so a
               one-word status rendered as if it were the file's contents. */
            body === undefined ? (
              <div className="dshmem-loadingrow" role="status" aria-live="polite" aria-busy="true">
                Reading…
              </div>
            ) : (
              <pre className="dshmem-body">{body}</pre>
            )
          ) : null}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** The stylesheet this plugin owns, kept so its presence can be re-checked. */
let styleTag: HTMLStyleElement | null = null

/**
 * Ensure the plugin's stylesheet is in the document.
 *
 * Deliberately NOT guarded by a `let injected = true` boolean. That guard is
 * one-way: if anything ever removes the tag — a host that prunes stylesheets it
 * does not recognise, a devtools edit, a re-mount into a fresh document — the
 * flag stays true, the tag is never re-added, and the tab renders with no CSS
 * at all while every element and class name looks correct. That failure is
 * silent and survives every refresh, so the check is on the ELEMENT still being
 * connected, which makes re-mounting the tab a repair rather than a no-op.
 *
 * Every colour is a `--dsw-*` alias the harness defines, so the tab follows the
 * active theme rather than pinning its own palette. Font sizes are literals on
 * the harness's 11/12/13/14/16/20/24 ladder.
 * @returns a no-op cleanup, so it can be used from an effect.
 */
export function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (styleTag !== null && styleTag.isConnected) return () => {}
  const style = document.createElement('style')
  style.dataset.dshmem = 'true'
  style.textContent = CSS
  document.head.appendChild(style)
  styleTag = style
  return () => {}
}

const CSS = `
.dshmem {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  gap: 14px;
  font-family: var(--dsw-font-family);
  color: var(--dsw-alias-label-primary);
}
.dshmem-capture {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
}
.dshmem-input {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major);
  color: var(--dsw-alias-label-primary);
}
.dshmem-capture-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dshmem-scopes { display: flex; gap: 4px; }
.dshmem-scope {
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
.dshmem-scope:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshmem-scope-on {
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l3);
}
.dshmem-save {
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 7px 14px;
  border-radius: 6px;
  border: 0;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  cursor: pointer;
}
.dshmem-save:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dshmem-save:disabled { opacity: 0.5; cursor: default; }
.dshmem-hint { font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }

.dshmem-summary { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dshmem-warn { color: var(--dsw-alias-state-warn-primary); }

.dshmem-files { display: flex; flex-direction: column; gap: 2px; }
.dshmem-file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  text-align: left;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.4;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.dshmem-file:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshmem-file-on { background: var(--dsw-alias-interactive-bg-active); }
.dshmem-file-out { color: var(--dsw-alias-label-tertiary); }
.dshmem-path {
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshmem-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.dshmem-tag {
  font-size: 11px;
  line-height: 1;
  padding: 3px 7px;
  border-radius: 999px;
  border: 1px solid currentColor;
}
.dshmem-tag-out { color: var(--dsw-alias-state-warn-primary); }
.dshmem-tag-cut { color: var(--dsw-alias-state-business-primary); }

.dshmem-body {
  margin: 0;
  padding: 12px;
  overflow: auto;
  max-height: 50vh;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.dshmem-empty {
  padding: 20px 4px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
}

/* ---- loading ----
   Two treatments, picked by surface. The FILE LIST is a large uniform surface,
   so it gets a skeleton shaped like its own rows (see .dshmem-skel). The file
   BODY is prose in a <pre>, where bars standing in for paragraphs read as noise
   rather than structure — that one keeps a caption row, matching the dim
   12px/20px treatment used for small surfaces across the plugins. */
.dshmem-loadingrow {
  padding: 5px 8px;
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}

/* Visually hidden, still announced. */
.dshmem-sronly {
  position: absolute; width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
/* Geometry copied from .dshmem-summary + .dshmem-file so the swap to real
   content does not lurch: the same 7px/10px row padding, 2px gaps, and a
   space-between split with the path on the left and the stats on the right.

   Bar heights are box dimensions stated directly, never calc() off a font
   size — arithmetic on a scale step lands between rungs. */
.dshmem-skel { display: flex; flex-direction: column; gap: 2px; }
.dshmem-skel-summary { height: 10px; width: 46%; border-radius: 3px; margin-bottom: 6px; }
/* The BAR is 10px, but the row's LINE box must match the real row's, or the
   skeleton is shorter than what replaces it and the list jumps on arrival.
   .dshmem-file is 13px on a 1.4 line (18.2px) inside 7px/10px padding, so the
   ROW's height comes from its tallest child, so each bar is wrapped in a box of
   the height the real text occupies and the 10px bar is centred inside it.

   The heights are the MEASURED line boxes of the real row's own children
   (.dshmem-path at 12px/1.4 = 16.8px, .dshmem-stats at 11px/1.4 = 15.4px),
   taken from the browser rather than computed here: 12 x 1.4 is not a round
   number, and a product stated in a comment drifts from what the browser does.
   Re-measure with scripts/progress-probe.mjs after touching either.

   A line-height alone does NOT work: these are flex children, and a flex
   container blockifies its children, so an empty span carries no line box and
   the row collapses back to the bars' own height. That version measured 24px
   against the real 30.8px. */
.dshmem-skel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 10px;
  border-radius: 6px;
}
.dshmem-skel-path, .dshmem-skel-stats {
  display: flex;
  align-items: center;
  min-width: 0;
}
.dshmem-skel-path { height: 16.8px; }
.dshmem-skel-stats { height: 15.4px; width: 48px; flex: 0 0 auto; }
.dshmem-skel-path > i, .dshmem-skel-stats > i {
  display: block; width: 100%; height: 10px; border-radius: 3px;
}
/* The shimmer animates BACKGROUND-POSITION over an oversized gradient, never a
   transform or a box dimension, so it cannot nudge layout while it sweeps. */
.dshmem-skel-summary, .dshmem-skel-path > i, .dshmem-skel-stats > i {
  background: linear-gradient(
    90deg,
    var(--dsw-alias-border-l1) 0%,
    var(--dsw-alias-interactive-bg-hover) 40%,
    var(--dsw-alias-border-l1) 80%
  );
  background-size: 300% 100%;
  animation: dshmem-shimmer 1.4s ease-in-out infinite;
}
@keyframes dshmem-shimmer {
  0% { background-position: 180% 0; }
  100% { background-position: -80% 0; }
}
@media (prefers-reduced-motion: reduce) {
  /* Hold the bars at a flat mid-tone: the skeleton still communicates "loading"
     by being there, without the sweep. */
  .dshmem-skel-summary, .dshmem-skel-path > i, .dshmem-skel-stats > i {
    animation: none;
    background: var(--dsw-alias-border-l1);
  }
}
`

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------

/**
 * Client plugin body: mount the host contract, then take a seat in the
 * conversation view ring.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const anyCtx = ctx as never as {
    remote: { $mount: (c: unknown) => Promise<() => Promise<void>> }
    inject: (services: readonly string[], callback: (scoped: unknown) => void) => { dispose: () => void }
  }

  // `$mount` publishes `remote.dshMemory` ASYNCHRONOUSLY, so nothing may read
  // it until that service exists — reading it in apply() captures `undefined`.
  ctx.effect(() => {
    let disposed = false
    let unmount: (() => Promise<void>) | undefined
    void anyCtx.remote
      .$mount(MEMORY_REMOTE)
      .then((dispose) => {
        if (disposed) return void dispose()
        unmount = dispose
      })
      .catch((error: unknown) => {
        console.error('dsh-memory: failed to mount host remote', error)
      })
    return () => {
      disposed = true
      void unmount?.()
    }
  }, 'dsh-memory: mount host remote')

  // The dependency cannot go in the top-level `inject` array: this plugin
  // mounts its own contract, so requiring it there would deadlock apply()
  // against an effect that never runs.
  ctx.effect(() => {
    const fiber = anyCtx.inject(['remote.dshMemory', 'workspaces', 'slots'], (scoped) => {
      const readyCtx = scoped as ClientContext & { workspaces: { list: WorkspaceListLike } }

      // Resolve the mounted namespace ONCE, here, and close over it.
      //
      // Two things make this the only correct place. Reading it during a React
      // render resolves to `undefined` — a render is not the fiber `$mount`
      // published into. And resolving it per `inject()` call hands the view a
      // NEW object identity on every render, so the load effect's dependency
      // changes each time, its cleanup marks the in-flight request cancelled,
      // and the reply is discarded forever: the tab sits on "Reading…" with no
      // error to show for it. One lookup, one stable identity.
      const remote = (readyCtx as unknown as { remote: Record<string, MemoryRemote | undefined> }).remote
        ?.dshMemory

      readyCtx.slots.inject('conversation.view', () =>
        readyCtx.slots.register(
          {
            name: 'conversation.view',
            id: 'memory',
            // After Chat (0), Trajectory (10), Todo (20) and Plans (30).
            order: 40,
            label: () => 'Memory',
            inject: (sessionId: string) => {
              const items = readyCtx.workspaces.list.getSnapshot().items
              // Compare as strings: the harness brands SessionId, and comparing
              // the branded values directly reads as a type error even though
              // the runtime values are equal.
              const hit = items.find((ws) => ws.sessionIds.some((id) => String(id) === String(sessionId)))
              return { workspaceId: hit?.workspaceId ?? null, remote }
            },
          },
          ({ workspaceId, remote }: { workspaceId: string | null; remote: MemoryRemote | undefined }) =>
            React.createElement(MemoryTab, { remote, workspaceId }),
        ),
      )
    })
    return () => {
      fiber.dispose()
    }
  }, 'dsh-memory: conversation.view registration')
}
