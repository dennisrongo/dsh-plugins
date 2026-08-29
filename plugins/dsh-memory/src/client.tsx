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

/** The host contract as this half calls it. */
interface MemoryRemote {
  inspect(request: { workspaceId: string }): Promise<{ report: InstructionReport }>
  remember(request: {
    workspaceId: string
    fact: string
    scope: MemoryScope
  }): Promise<{ ok: true; path: string; line: string } | { ok: false; reason: string }>
  read(request: { workspaceId: string; absolutePath: string }): Promise<{ text?: string }>
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
 * @param props.ctx - client root context.
 * @param props.workspaceId - workspace to inspect, or null outside one.
 * @returns the tab body.
 */
function MemoryTab({ ctx, workspaceId }: { ctx: ClientContext; workspaceId: string | null }): React.ReactElement {
  const remote = (ctx as unknown as { remote: Record<string, MemoryRemote | undefined> }).remote?.dshMemory
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
        setReport(reply.report)
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
        if (!cancelled) setBody(reply.text)
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
        if (reply.ok) {
          setFact('')
          // Name the exact file. "Saved" leaves the user guessing which of four
          // candidate files in the hierarchy it landed in.
          setNotice(`Wrote to ${reply.path}`)
          setRevision((n) => n + 1)
        } else {
          setNotice(reply.reason)
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
        <div className="dshmem-empty">Reading…</div>
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
            <pre className="dshmem-body">{body ?? 'Reading…'}</pre>
          ) : null}
        </>
      )}
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
 * Every colour is a `--dsw-*` alias the harness defines, so the tab follows the
 * active theme rather than pinning its own palette. Font sizes are literals on
 * the harness's 11/12/13/14/16/20/24 ladder.
 * @returns a no-op cleanup, so it can be used from an effect.
 */
export function injectStyles(): () => void {
  if (stylesInjected || typeof document === 'undefined') return () => {}
  stylesInjected = true
  const style = document.createElement('style')
  style.dataset.dshmem = 'true'
  style.textContent = CSS
  document.head.appendChild(style)
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
              return { workspaceId: hit?.workspaceId ?? null }
            },
          },
          ({ workspaceId }: { workspaceId: string | null }) =>
            React.createElement(MemoryTab, { ctx: readyCtx, workspaceId }),
        ),
      )
    })
    return () => {
      fiber.dispose()
    }
  }, 'dsh-memory: conversation.view registration')
}
