/**
 * dsh-git — a per-workspace source-control tab for the DeepSeek Harness web UI.
 *
 * Registers into the additive `conversation.view` slot, so the changes appear
 * as their own tab beside Chat, Trajectory, and Todo, and fill the session pane.
 *
 * Nothing git-related happens in the browser: this half mounts a Typert Remote
 * descriptor for the host's `dshGit` service and calls it. The repository on
 * disk is the single source of truth, so the view always re-reads status from
 * the host after every command rather than guessing at the new state.
 */
import React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { GIT_REMOTE } from './remote.ts'
import type {
  CommandResult,
  GitFileChange,
  GitStatus,
  StageAction,
  SyncAction,
} from './types.ts'

// Re-exported so the smoke test can assert the contribution stays strict — a
// non-strict codec makes the browser's $mount throw and the tab vanish.
export { GIT_REMOTE }

/**
 * Required services. `remote` is the Typert client bridge (used here only for
 * `$mount`), `workspaces` maps the active session onto its workspace, and
 * `slots` hosts the tab.
 *
 * The mounted namespace `remote.dshGit` is deliberately NOT listed: this plugin
 * mounts that contract itself, so requiring it up front would park apply()
 * forever waiting on a service only apply() can create.
 */
export const inject = ['slots', 'remote', 'workspaces']

// ---------------------------------------------------------------------------
// Pure logic (exported for the smoke test)
// ---------------------------------------------------------------------------

/** Counts the header and buttons key off. */
export interface GitCounts {
  staged: number
  unstaged: number
  conflicted: number
  total: number
}

/**
 * Count the working tree by section.
 *
 * A file can be BOTH staged and unstaged at once (staged edit, then edited
 * again), so these buckets deliberately overlap and `total` counts paths, not
 * the sum of the buckets.
 * @param files - every changed path.
 * @returns per-section counts.
 */
export function countChanges(files: readonly GitFileChange[]): GitCounts {
  let staged = 0
  let unstaged = 0
  let conflicted = 0
  for (const f of files) {
    if (f.conflicted) conflicted += 1
    else {
      if (f.staged) staged += 1
      if (f.worktree !== ' ' || f.untracked) unstaged += 1
    }
  }
  return { staged, unstaged, conflicted, total: files.length }
}

/** The staged slice, in git's order. */
export function stagedFiles(files: readonly GitFileChange[]): GitFileChange[] {
  return files.filter((f) => !f.conflicted && f.staged)
}

/** The unstaged slice: worktree edits and untracked files alike. */
export function unstagedFiles(files: readonly GitFileChange[]): GitFileChange[] {
  return files.filter((f) => !f.conflicted && (f.worktree !== ' ' || f.untracked))
}

/** The conflicted slice, which must be resolved before a commit can land. */
export function conflictedFiles(files: readonly GitFileChange[]): GitFileChange[] {
  return files.filter((f) => f.conflicted)
}

/**
 * One-letter badge for a row, chosen from the column that section displays.
 * @param file - the change.
 * @param section - which side of the index the row is rendered under.
 * @returns the letter to show.
 */
export function badgeFor(file: GitFileChange, section: 'staged' | 'unstaged'): string {
  if (file.conflicted) return '!'
  if (file.untracked) return 'U'
  const raw = section === 'staged' ? file.index : file.worktree
  return raw === ' ' ? 'M' : raw
}

/** Long-form label for a status letter, used as a row tooltip. */
export function describeCode(letter: string): string {
  switch (letter) {
    case 'M':
      return 'Modified'
    case 'A':
      return 'Added'
    case 'D':
      return 'Deleted'
    case 'R':
      return 'Renamed'
    case 'C':
      return 'Copied'
    case 'U':
      return 'Untracked'
    case '!':
      return 'Conflicted'
    default:
      return 'Changed'
  }
}

/** Trailing path segment, for the emphasized part of a row label. */
export function baseName(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

/** Leading directory, for the dimmed part of a row label. Empty at the root. */
export function dirName(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i + 1)
}

/**
 * Whether a commit can be attempted right now.
 *
 * Conflicts block unconditionally: git refuses the commit anyway, and failing
 * in the UI beforehand explains why instead of surfacing a raw git error.
 * @param status - the current snapshot.
 * @param message - the message in the box.
 * @returns true when the Commit button should be live.
 */
export function canCommit(status: GitStatus, message: string): boolean {
  if (!status.repo) return false
  if (message.trim().length === 0) return false
  const counts = countChanges(status.files)
  if (counts.conflicted > 0) return false
  // With nothing staged, the UI commits with `-a`, which still needs some
  // tracked modification to pick up.
  return counts.staged > 0 || counts.unstaged > 0
}

/**
 * Short summary of where the branch stands, for the header.
 * @param status - the current snapshot.
 * @returns a compact human string.
 */
export function branchSummary(status: GitStatus): string {
  if (!status.repo) return 'No repository'
  const name = status.branch ?? (status.head ? `detached @ ${status.head}` : 'HEAD')
  if (status.unborn) return `${name} · no commits yet`
  const up = status.upstream
  if (!up) return name
  const bits: string[] = []
  if (up.ahead > 0) bits.push(`↑${up.ahead}`)
  if (up.behind > 0) bits.push(`↓${up.behind}`)
  return bits.length > 0 ? `${name} ${bits.join(' ')}` : name
}

/** Short relative age, e.g. "just now", "5m", "3h", "2d". */
export function fmtAge(from: number, now = Date.now()): string {
  if (!from) return ''
  const ms = Math.max(0, now - from)
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}

/**
 * Resolve which workspace owns a session, from the workspace list projection.
 * Returns undefined when the session is not accounted to any workspace (a
 * brand-new blank session), in which case the view shows a neutral notice
 * rather than operating on the wrong repository.
 * @param items - the workspace projection.
 * @param sessionId - the session being viewed.
 * @returns the owning workspace id, or undefined.
 */
export function workspaceIdForSession(
  items: readonly { workspaceId: string; sessionIds: readonly string[] }[],
  sessionId: string,
): string | undefined {
  for (const ws of items) {
    if (ws.sessionIds.includes(sessionId)) return ws.workspaceId
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Store — one instance per workspace, shared by every mounted tab
// ---------------------------------------------------------------------------

type Listener = () => void

/** What the view renders: the snapshot plus its load/run status. */
export interface GitState {
  status: GitStatus | null
  phase: 'loading' | 'ready' | 'error'
  /** Last command's output, shown in the log strip. Empty when nothing ran. */
  output: string
  error: string | null
  /** Name of the command in flight, so the UI can disable exactly that button. */
  busy: string | null
}

const INITIAL: GitState = {
  status: null,
  phase: 'loading',
  output: '',
  error: null,
  busy: null,
}

/**
 * Per-workspace object layer over the host's git service.
 *
 * Unlike an optimistic list store, nothing here is predicted: every command
 * returns the host's freshly-read status and the store adopts it verbatim.
 * Guessing at git's outcome is exactly how a source-control UI ends up
 * disagreeing with the repository.
 */
export class GitStore {
  private readonly listeners = new Set<Listener>()
  private state: GitState = INITIAL
  private tail: Promise<unknown> = Promise.resolve()
  private loaded = false

  /**
   * @param remote - the host's dshGit remote namespace.
   * @param workspaceId - the workspace whose repository this store owns.
   */
  constructor(
    private readonly remote: GitRemote,
    private readonly workspaceId: string,
  ) {}

  getSnapshot = (): GitState => this.state

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Load once; a failed load stays retryable via {@link refresh}. */
  async ensure(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    await this.refresh()
  }

  /** Re-read the authoritative snapshot from the host. */
  async refresh(): Promise<void> {
    try {
      const reply = await this.remote.status({ workspaceId: this.workspaceId })
      if (!reply.ok) {
        this.publish({ ...this.state, phase: 'error', error: reply.error.message })
        return
      }
      this.publish({
        ...this.state,
        status: reply.value.status,
        phase: 'ready',
        error: null,
      })
    } catch (error) {
      this.publish({ ...this.state, phase: 'error', error: describe(error) })
    }
  }

  /**
   * Run one mutating command, serialized behind any command already in flight.
   *
   * Serialization is the point: git fails a second writer on `index.lock`, so
   * letting two clicks overlap would surface a lock error rather than doing
   * both things in order.
   * @param label - button identity, echoed into `busy`.
   * @param run - issues the actual remote call.
   * @returns resolution once the command and its status refresh have landed.
   */
  run(label: string, run: () => Promise<RemoteReply<CommandResult>>): Promise<void> {
    const step = async (): Promise<void> => {
      this.publish({ ...this.state, busy: label, error: null })
      try {
        const reply = await run()
        if (!reply.ok) {
          this.publish({ ...this.state, busy: null, error: reply.error.message })
          return
        }
        const result = reply.value
        this.publish({
          ...this.state,
          status: result.status,
          phase: 'ready',
          busy: null,
          output: result.output,
          // A non-zero git exit is reported in `output`, not as an error banner:
          // "nothing to commit" is information, not a fault.
          error: result.ok ? null : null,
        })
      } catch (error) {
        this.publish({ ...this.state, busy: null, error: describe(error) })
      }
    }
    this.tail = this.tail.then(step, step)
    return this.tail as Promise<void>
  }

  /** Stage, unstage, or discard paths. */
  stage(action: StageAction, paths: string[]): Promise<void> {
    return this.run(`stage:${action}`, () =>
      this.remote.stage({ workspaceId: this.workspaceId, action, paths }),
    )
  }

  /** Commit, auto-staging tracked edits when the index is empty. */
  commit(message: string, all: boolean): Promise<void> {
    return this.run('commit', () =>
      this.remote.commit({ workspaceId: this.workspaceId, message, all }),
    )
  }

  /** Create a repository in this workspace's directory. */
  init(branch: string): Promise<void> {
    return this.run('init', () => this.remote.init({ workspaceId: this.workspaceId, branch }))
  }

  /** Run one remote operation. */
  sync(action: SyncAction): Promise<void> {
    return this.run(`sync:${action}`, () =>
      this.remote.sync({ workspaceId: this.workspaceId, action }),
    )
  }

  /**
   * Ask the host's model for a commit message.
   *
   * Returns the text rather than storing it, because the message belongs to the
   * commit box's local editing state — the user must be able to edit or reject
   * it before anything is committed.
   * @param staged - describe the staged diff rather than the whole tree.
   * @returns the suggested message.
   */
  async suggest(staged: boolean): Promise<string> {
    this.publish({ ...this.state, busy: 'suggest', error: null })
    try {
      const reply = await this.remote.suggestMessage({
        workspaceId: this.workspaceId,
        staged,
      })
      if (!reply.ok) {
        this.publish({ ...this.state, busy: null, error: reply.error.message })
        return ''
      }
      this.publish({ ...this.state, busy: null })
      return reply.value.message
    } catch (error) {
      this.publish({ ...this.state, busy: null, error: describe(error) })
      return ''
    }
  }

  /**
   * Fetch one file's patch for the diff pane.
   * @param path - repo-relative path, or undefined for the whole tree.
   * @param staged - read the index-vs-HEAD diff.
   * @returns the patch text, or a short failure notice.
   */
  async diff(path: string | undefined, staged: boolean): Promise<string> {
    try {
      const reply = await this.remote.diff({
        workspaceId: this.workspaceId,
        ...(path !== undefined ? { path } : {}),
        staged,
      })
      if (!reply.ok) return `Could not read diff: ${reply.error.message}`
      return reply.value.patch
    } catch (error) {
      return `Could not read diff: ${describe(error)}`
    }
  }

  private publish(next: GitState): void {
    this.state = next
    for (const fn of this.listeners) {
      try {
        fn()
      } catch {
        // One bad subscriber must not stop the rest from updating.
      }
    }
  }
}

/** The host calls this half needs, as the generated Remote face shapes them. */
export interface GitRemote {
  status: (request: { workspaceId: string }) => Promise<RemoteReply<{ status: GitStatus }>>
  diff: (request: {
    workspaceId: string
    path?: string
    staged?: boolean
  }) => Promise<RemoteReply<{ patch: string; binary: boolean }>>
  stage: (request: {
    workspaceId: string
    action: StageAction
    paths: string[]
  }) => Promise<RemoteReply<CommandResult>>
  commit: (request: {
    workspaceId: string
    message: string
    all?: boolean
  }) => Promise<RemoteReply<CommandResult>>
  init: (request: { workspaceId: string; branch?: string }) => Promise<RemoteReply<CommandResult>>
  sync: (request: {
    workspaceId: string
    action: SyncAction
  }) => Promise<RemoteReply<CommandResult>>
  suggestMessage: (request: {
    workspaceId: string
    staged?: boolean
  }) => Promise<RemoteReply<{ message: string }>>
}

type RemoteReply<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/**
 * Render an unknown throw as a short message for the status line.
 * @param error - the caught value.
 * @returns a human-readable message.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------
// Styles — theme exclusively through the shell's --dsw-* tokens
// ---------------------------------------------------------------------------

const VIEW_STYLES = `
.dshgit {
  --g-border: var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
  --g-primary: var(--dsw-alias-label-primary, #f9fafb);
  --g-secondary: var(--dsw-alias-label-secondary, #cfd3d6);
  --g-caption: var(--dsw-alias-label-caption, #81858c);
  --g-accent: var(--dsw-alias-state-success-primary, #22c55e);
  --g-hover: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08));
  --g-danger: var(--dsw-alias-state-error-primary, #ef4444);
  --g-warn: var(--dsw-alias-state-warning-primary, #f59e0b);
  --g-info: var(--dsw-alias-state-info-primary, #3b82f6);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--g-secondary);
  font: 400 13px/1.5 var(--dsw-font-family, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
  font-variant-numeric: tabular-nums;
}
.dshgit *, .dshgit *::before, .dshgit *::after { box-sizing: border-box; }

/* ---- header ---- */
.dshgit-head {
  flex: none; display: flex; align-items: center; gap: 10px;
  padding: 12px 20px 10px; border-bottom: 1px solid var(--g-border);
}
.dshgit-branch {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600; color: var(--g-primary);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshgit-branch svg { flex: none; opacity: 0.7; }
.dshgit-spacer { flex: 1 1 auto; }
.dshgit-actions { flex: none; display: flex; gap: 4px; align-items: center; }

/* ---- buttons ---- */
.dshgit-btn {
  border: 1px solid var(--g-border); border-radius: 7px;
  background: transparent; color: var(--g-secondary);
  font: inherit; font-size: 12px; padding: 5px 11px; cursor: pointer;
  white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;
}
.dshgit-btn:hover:not(:disabled) { background: var(--g-hover); color: var(--g-primary); }
.dshgit-btn:disabled { opacity: 0.4; cursor: default; }
.dshgit-btn.primary {
  background: var(--g-accent); border-color: transparent; color: #06240f; font-weight: 600;
}
.dshgit-btn.primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--g-accent); color: #06240f; }
.dshgit-btn.ai { border-color: var(--g-info); color: var(--g-info); }
.dshgit-btn.ai:hover:not(:disabled) { background: var(--g-info); color: #04121f; }
.dshgit-badge-count {
  display: inline-block; min-width: 16px; padding: 0 4px; border-radius: 999px;
  background: var(--g-hover); color: var(--g-caption); font-size: 10px; text-align: center;
}

/* ---- commit box ---- */
.dshgit-commit { flex: none; padding: 12px 20px; border-bottom: 1px solid var(--g-border); }
.dshgit-msg {
  width: 100%; min-height: 58px; max-height: 180px; resize: vertical;
  border: 1px solid var(--g-border); border-radius: 8px;
  background: transparent; color: var(--g-primary); font: inherit;
  padding: 8px 11px; line-height: 1.5;
}
.dshgit-msg::placeholder { color: var(--g-caption); }
.dshgit-msg:focus { outline: none; border-color: var(--dsw-alias-border-focus, #6b7280); }
.dshgit-commitrow { display: flex; gap: 6px; align-items: center; margin-top: 8px; }

/* ---- sections ---- */
.dshgit-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.dshgit-section { padding: 8px 0 4px; }
.dshgit-sechead {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 20px; color: var(--g-caption);
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
}
.dshgit-sechead .dshgit-spacer { min-width: 8px; }
.dshgit-secbtns { display: flex; gap: 1px; opacity: 0; transition: opacity 100ms ease; }
.dshgit-section:hover .dshgit-secbtns, .dshgit-section:focus-within .dshgit-secbtns { opacity: 1; }

/* ---- rows ---- */
.dshgit-list { list-style: none; margin: 0; padding: 0 12px; }
.dshgit-row {
  display: flex; align-items: center; gap: 9px;
  padding: 5px 8px; border-radius: 7px; border: 1px solid transparent;
  cursor: pointer;
}
.dshgit-row:hover { background: var(--g-hover); border-color: var(--g-border); }
.dshgit-row.active { background: var(--g-hover); border-color: var(--dsw-alias-border-focus, #6b7280); }
.dshgit-code {
  flex: none; width: 16px; text-align: center; font-size: 11px; font-weight: 700;
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}
.dshgit-code.M { color: var(--g-warn); }
.dshgit-code.A { color: var(--g-accent); }
.dshgit-code.U { color: var(--g-accent); }
.dshgit-code.D { color: var(--g-danger); }
.dshgit-code.R, .dshgit-code.C { color: var(--g-info); }
.dshgit-code\\! { color: var(--g-danger); }
.dshgit-path {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; direction: rtl; text-align: left;
}
.dshgit-path > span { direction: ltr; unicode-bidi: embed; }
.dshgit-dir { color: var(--g-caption); }
.dshgit-base { color: var(--g-secondary); }
.dshgit-row:hover .dshgit-base { color: var(--g-primary); }
.dshgit-rowbtns { flex: none; display: flex; gap: 1px; opacity: 0; transition: opacity 100ms ease; }
.dshgit-row:hover .dshgit-rowbtns, .dshgit-row:focus-within .dshgit-rowbtns { opacity: 1; }
.dshgit-icon {
  border: 0; background: transparent; cursor: pointer; color: var(--g-caption);
  font-size: 12px; line-height: 1; padding: 4px 6px; border-radius: 5px;
}
.dshgit-icon:hover { background: var(--g-hover); color: var(--g-primary); }
.dshgit-icon.danger:hover { color: var(--g-danger); }

/* ---- diff pane ---- */
.dshgit-diff {
  flex: none; max-height: 42%; overflow: auto;
  border-top: 1px solid var(--g-border); background: rgba(0,0,0,0.16);
}
.dshgit-diffhead {
  position: sticky; top: 0; z-index: 1;
  display: flex; align-items: center; gap: 8px;
  padding: 7px 20px; border-bottom: 1px solid var(--g-border);
  background: var(--dsw-alias-bg-l1, #16181c);
  color: var(--g-caption); font-size: 11px;
}
.dshgit-diffbody {
  margin: 0; padding: 8px 0;
  font: 400 12px/1.55 var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  white-space: pre; tab-size: 2;
}
.dshgit-dl { padding: 0 20px; }
.dshgit-dl.add { background: rgba(34,197,94,0.14); color: #86efac; }
.dshgit-dl.del { background: rgba(239,68,68,0.14); color: #fca5a5; }
.dshgit-dl.hunk { color: var(--g-info); background: rgba(59,130,246,0.10); }
.dshgit-dl.meta { color: var(--g-caption); }

/* ---- empty + footer ---- */
.dshgit-empty { padding: 40px 20px; text-align: center; color: var(--g-caption); }
.dshgit-empty b { display: block; color: var(--g-secondary); font-weight: 500; margin-bottom: 4px; }
.dshgit-empty .dshgit-btn { margin-top: 14px; }
.dshgit-init { display: flex; gap: 6px; justify-content: center; margin-top: 14px; }
.dshgit-init input {
  border: 1px solid var(--g-border); border-radius: 7px; background: transparent;
  color: var(--g-primary); font: inherit; font-size: 12px; padding: 5px 10px; width: 130px;
}
.dshgit-init input:focus { outline: none; border-color: var(--dsw-alias-border-focus, #6b7280); }
.dshgit-foot {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 8px 20px; border-top: 1px solid var(--g-border);
  color: var(--g-caption); font-size: 11px; min-height: 32px;
}
.dshgit-out {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}
.dshgit-out.err { color: var(--g-danger); }
.dshgit-spin { display: inline-block; animation: dshgit-rot 900ms linear infinite; }
@keyframes dshgit-rot { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .dshgit-rowbtns, .dshgit-secbtns { transition: none; }
  .dshgit-spin { animation: none; }
}
`

let stylesInjected = false
function injectStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dennisrongo/dsh-git'
  tag.textContent = VIEW_STYLES
  document.head.appendChild(tag)
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Branch glyph, inlined so the tab carries no icon-font dependency. */
function BranchIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v5.256a2.251 2.251 0 1 0 1.5 0V9.5a1 1 0 0 1 1-1h2.75a2.75 2.75 0 0 0 2.75-2.75V5.372a2.25 2.25 0 1 0-1.5 0v.378A1.25 1.25 0 0 1 8.75 7H6c-.36 0-.7.076-1 .212V5.372ZM4.25 12.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5ZM12.25 3a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z" />
    </svg>
  )
}

/** One changed-file row. */
function FileRow({
  file,
  section,
  active,
  onOpen,
  onPrimary,
  onDiscard,
}: {
  file: GitFileChange
  section: 'staged' | 'unstaged'
  active: boolean
  onOpen: () => void
  onPrimary: () => void
  onDiscard?: () => void
}): React.JSX.Element {
  const letter = badgeFor(file, section)
  const dir = dirName(file.path)
  const base = baseName(file.path)
  return (
    <li
      className={`dshgit-row${active ? ' active' : ''}`}
      onClick={onOpen}
      title={`${describeCode(letter)} — ${file.path}`}
    >
      <span className={`dshgit-code ${letter}`} aria-hidden="true">
        {letter}
      </span>
      <span className="dshgit-path">
        <span>
          <span className="dshgit-dir">{dir}</span>
          <span className="dshgit-base">{base}</span>
        </span>
      </span>
      <span className="dshgit-rowbtns" onClick={(e) => e.stopPropagation()}>
        {onDiscard ? (
          <button
            className="dshgit-icon danger"
            title="Discard changes to this file"
            aria-label={`Discard changes to ${file.path}`}
            onClick={onDiscard}
          >
            ↺
          </button>
        ) : null}
        <button
          className="dshgit-icon"
          title={section === 'staged' ? 'Unstage' : 'Stage'}
          aria-label={`${section === 'staged' ? 'Unstage' : 'Stage'} ${file.path}`}
          onClick={onPrimary}
        >
          {section === 'staged' ? '−' : '+'}
        </button>
      </span>
    </li>
  )
}

/**
 * Colorize a unified diff line-by-line.
 *
 * Order matters: `+++`/`---` headers must be matched BEFORE the single-character
 * `+`/`-` cases, or every file header would render as an added/removed line.
 * @param patch - unified patch text.
 * @returns the rendered lines.
 */
function DiffBody({ patch }: { patch: string }): React.JSX.Element {
  const lines = React.useMemo(() => patch.split('\n'), [patch])
  return (
    <pre className="dshgit-diffbody">
      {lines.map((line, i) => {
        let cls = ''
        if (line.startsWith('+++') || line.startsWith('---')) cls = 'meta'
        else if (line.startsWith('@@')) cls = 'hunk'
        else if (line.startsWith('+')) cls = 'add'
        else if (line.startsWith('-')) cls = 'del'
        else if (
          line.startsWith('diff ') ||
          line.startsWith('index ') ||
          line.startsWith('new file') ||
          line.startsWith('deleted file') ||
          line.startsWith('similarity ') ||
          line.startsWith('rename ')
        )
          cls = 'meta'
        return (
          <div key={i} className={`dshgit-dl ${cls}`}>
            {line === '' ? ' ' : line}
          </div>
        )
      })}
    </pre>
  )
}

/** A titled group of file rows, with bulk actions in its header. */
function Section({
  title,
  files,
  section,
  selected,
  store,
  onOpen,
}: {
  title: string
  files: GitFileChange[]
  section: 'staged' | 'unstaged'
  selected: string | null
  store: GitStore
  onOpen: (path: string, staged: boolean) => void
}): React.JSX.Element | null {
  if (files.length === 0) return null
  const paths = files.map((f) => f.path)
  return (
    <div className="dshgit-section">
      <div className="dshgit-sechead">
        <span>{title}</span>
        <span className="dshgit-badge-count">{files.length}</span>
        <span className="dshgit-spacer" />
        <span className="dshgit-secbtns">
          {section === 'unstaged' ? (
            <>
              <button
                className="dshgit-icon danger"
                title="Discard all changes in this section"
                onClick={() => {
                  if (confirmDiscard(files.length)) void store.stage('discard', paths)
                }}
              >
                ↺
              </button>
              <button
                className="dshgit-icon"
                title="Stage all"
                onClick={() => void store.stage('stage', paths)}
              >
                +
              </button>
            </>
          ) : (
            <button
              className="dshgit-icon"
              title="Unstage all"
              onClick={() => void store.stage('unstage', paths)}
            >
              −
            </button>
          )}
        </span>
      </div>
      <ul className="dshgit-list">
        {files.map((file) => (
          <FileRow
            key={`${section}:${file.path}`}
            file={file}
            section={section}
            active={selected === `${section}:${file.path}`}
            onOpen={() => onOpen(file.path, section === 'staged')}
            onPrimary={() =>
              void store.stage(section === 'staged' ? 'unstage' : 'stage', [file.path])
            }
            onDiscard={
              section === 'unstaged'
                ? () => {
                    if (confirmDiscard(1, file.path)) void store.stage('discard', [file.path])
                  }
                : undefined
            }
          />
        ))}
      </ul>
    </div>
  )
}

/**
 * The whole git tab. Rendered by the `conversation.view` ring when its tab is
 * active, filling the session pane.
 * @param props - the per-workspace store, or null when no workspace owns the session.
 */
export function GitView({ store }: { store: GitStore | null }): React.JSX.Element {
  const [message, setMessage] = React.useState('')
  const [branch, setBranch] = React.useState('main')
  const [selected, setSelected] = React.useState<string | null>(null)
  const [patch, setPatch] = React.useState<string>('')

  React.useEffect(() => {
    injectStyles()
  }, [])

  React.useEffect(() => {
    if (store) void store.ensure()
  }, [store])

  const state = React.useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : getMissingSnapshot,
    store ? store.getSnapshot : getMissingSnapshot,
  )

  /** Load a file's patch into the diff pane. */
  const openDiff = React.useCallback(
    (path: string, staged: boolean) => {
      if (!store) return
      const key = `${staged ? 'staged' : 'unstaged'}:${path}`
      // Clicking the open row again closes the pane, so the list can reclaim
      // the space without hunting for a separate close control.
      if (selected === key) {
        setSelected(null)
        setPatch('')
        return
      }
      setSelected(key)
      setPatch('Loading diff…')
      void store.diff(path, staged).then((text) => {
        setPatch(text.trim().length === 0 ? 'No textual changes.' : text)
      })
    },
    [store, selected],
  )

  // A file that stops being changed (staged, discarded, committed) must not
  // leave a stale patch on screen.
  const status = state.status
  React.useEffect(() => {
    if (selected === null || !status || !status.repo) return
    const [, path] = splitKey(selected)
    if (!status.files.some((f) => f.path === path)) {
      setSelected(null)
      setPatch('')
    }
  }, [status, selected])

  if (!store) {
    return (
      <div className="dshgit">
        <div className="dshgit-empty">
          <b>No workspace yet</b>
          Source control is scoped to a workspace. Open or create one to see its changes.
        </div>
      </div>
    )
  }

  if (state.phase === 'loading' && status === null) {
    return (
      <div className="dshgit">
        <div className="dshgit-empty">Reading repository…</div>
      </div>
    )
  }

  if (state.phase === 'error' && status === null) {
    return (
      <div className="dshgit">
        <div className="dshgit-empty">
          <b>Couldn&apos;t read the repository</b>
          {state.error}
          <div>
            <button className="dshgit-btn" onClick={() => void store.refresh()}>
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Not a repository yet: the whole tab becomes the initialize affordance.
  if (status && !status.repo) {
    const busy = state.busy === 'init'
    return (
      <div className="dshgit">
        <div className="dshgit-empty">
          <b>Not a git repository</b>
          <div>{status.root}</div>
          <div className="dshgit-init">
            <input
              value={branch}
              aria-label="Initial branch name"
              placeholder="main"
              onChange={(e) => setBranch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button
              className="dshgit-btn primary"
              disabled={busy}
              onClick={() => void store.init(branch.trim() || 'main')}
            >
              {busy ? 'Initializing…' : 'Initialize repository'}
            </button>
          </div>
          {state.output ? <div className="dshgit-out">{state.output}</div> : null}
          {state.error ? <div className="dshgit-out err">{state.error}</div> : null}
        </div>
      </div>
    )
  }

  if (!status || !status.repo) return <div className="dshgit" />

  const counts = countChanges(status.files)
  const staged = stagedFiles(status.files)
  const unstaged = unstagedFiles(status.files)
  const conflicts = conflictedFiles(status.files)
  const busy = state.busy
  const commitEnabled = canCommit(status, message) && busy === null
  const up = status.upstream

  /** Commit, then clear the box only if the commit actually landed. */
  const doCommit = async (): Promise<void> => {
    const text = message.trim()
    if (!text) return
    // With an empty index, commit -a so the obvious intent (commit what I see)
    // works without a separate staging step.
    await store.commit(text, counts.staged === 0)
    setMessage('')
  }

  const doSuggest = async (): Promise<void> => {
    const text = await store.suggest(counts.staged > 0)
    if (text) setMessage(text)
  }

  return (
    <div className="dshgit">
      <div className="dshgit-head">
        <span className="dshgit-branch" title={status.root}>
          <BranchIcon />
          {branchSummary(status)}
        </span>
        <span className="dshgit-spacer" />
        <span className="dshgit-actions">
          <button
            className="dshgit-btn"
            title="Refresh status"
            disabled={busy !== null}
            onClick={() => void store.refresh()}
          >
            ⟳
          </button>
          {status.hasRemote ? (
            <>
              <button
                className="dshgit-btn"
                title="Fetch from every remote"
                disabled={busy !== null}
                onClick={() => void store.sync('fetch')}
              >
                Fetch
              </button>
              <button
                className="dshgit-btn"
                title="Pull (fast-forward only)"
                disabled={busy !== null}
                onClick={() => void store.sync('pull')}
              >
                {busy === 'sync:pull' ? '…' : 'Pull'}
                {up && up.behind > 0 ? (
                  <span className="dshgit-badge-count">{up.behind}</span>
                ) : null}
              </button>
              <button
                className="dshgit-btn"
                title={up ? 'Push to upstream' : 'Publish this branch and set upstream'}
                disabled={busy !== null}
                onClick={() => void store.sync(up ? 'push' : 'publish')}
              >
                {busy === 'sync:push' || busy === 'sync:publish' ? '…' : up ? 'Push' : 'Publish'}
                {up && up.ahead > 0 ? <span className="dshgit-badge-count">{up.ahead}</span> : null}
              </button>
              <button
                className="dshgit-btn"
                title="Pull, then push"
                disabled={busy !== null}
                onClick={() => void store.sync('sync')}
              >
                {busy === 'sync:sync' ? <span className="dshgit-spin">⟳</span> : '⇅'}
              </button>
            </>
          ) : (
            <span title="Add a remote with: git remote add origin <url>">No remote</span>
          )}
        </span>
      </div>

      <div className="dshgit-commit">
        <textarea
          className="dshgit-msg"
          value={message}
          placeholder={
            counts.staged > 0
              ? `Commit ${counts.staged} staged file${counts.staged === 1 ? '' : 's'}…`
              : 'Commit message — or let AI write one'
          }
          aria-label="Commit message"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            // Ctrl/Cmd+Enter commits, matching every other commit box.
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && commitEnabled) {
              e.preventDefault()
              void doCommit()
            }
          }}
        />
        <div className="dshgit-commitrow">
          <button
            className="dshgit-btn ai"
            title="Generate a commit message from the diff"
            disabled={busy !== null || counts.total === 0}
            onClick={() => void doSuggest()}
          >
            {busy === 'suggest' ? <span className="dshgit-spin">✦</span> : '✦'}
            {busy === 'suggest' ? 'Writing…' : 'AI message'}
          </button>
          <span className="dshgit-spacer" />
          <button className="dshgit-btn primary" disabled={!commitEnabled} onClick={() => void doCommit()}>
            {busy === 'commit'
              ? 'Committing…'
              : counts.staged > 0
                ? `Commit ${counts.staged}`
                : 'Commit all'}
          </button>
        </div>
      </div>

      <div className="dshgit-scroll">
        {counts.total === 0 ? (
          <div className="dshgit-empty">
            <b>No changes</b>
            The working tree is clean.
          </div>
        ) : (
          <>
            {conflicts.length > 0 ? (
              <div className="dshgit-section">
                <div className="dshgit-sechead">
                  <span>Conflicts</span>
                  <span className="dshgit-badge-count">{conflicts.length}</span>
                </div>
                <ul className="dshgit-list">
                  {conflicts.map((file) => (
                    <FileRow
                      key={`conflict:${file.path}`}
                      file={file}
                      section="unstaged"
                      active={selected === `unstaged:${file.path}`}
                      onOpen={() => openDiff(file.path, false)}
                      onPrimary={() => void store.stage('stage', [file.path])}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
            <Section
              title="Staged changes"
              files={staged}
              section="staged"
              selected={selected}
              store={store}
              onOpen={openDiff}
            />
            <Section
              title="Changes"
              files={unstaged}
              section="unstaged"
              selected={selected}
              store={store}
              onOpen={openDiff}
            />
          </>
        )}
      </div>

      {selected !== null ? (
        <div className="dshgit-diff">
          <div className="dshgit-diffhead">
            <span>{splitKey(selected)[1]}</span>
            <span className="dshgit-spacer" />
            <button
              className="dshgit-icon"
              title="Close diff"
              onClick={() => {
                setSelected(null)
                setPatch('')
              }}
            >
              ✕
            </button>
          </div>
          <DiffBody patch={patch} />
        </div>
      ) : null}

      <div className="dshgit-foot">
        <span>
          {counts.staged} staged · {counts.unstaged} changed
          {counts.conflicted > 0 ? ` · ${counts.conflicted} conflicted` : ''}
        </span>
        <span className="dshgit-spacer" />
        {state.error ? (
          <span className="dshgit-out err" title={state.error}>
            {state.error}
          </span>
        ) : state.output ? (
          <span className="dshgit-out" title={state.output}>
            {firstLine(state.output)}
          </span>
        ) : status.recent.length > 0 ? (
          <span className="dshgit-out" title={status.recent[0].subject}>
            {status.recent[0].sha} {status.recent[0].subject} ·{' '}
            {fmtAge(status.recent[0].date)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** Split a `section:path` selection key. */
function splitKey(key: string): [string, string] {
  const i = key.indexOf(':')
  return i < 0 ? ['', key] : [key.slice(0, i), key.slice(i + 1)]
}

/** First non-empty line of command output, for the one-line footer. */
function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) return line.trim()
  }
  return ''
}

/**
 * Guard the one destructive action. Discarding rewrites the working tree and
 * deletes untracked files, so it must ask.
 *
 * A host without `confirm` (or one that throws) refuses rather than proceeding:
 * unlike an archive, this cannot be undone.
 * @param count - how many files are affected.
 * @param path - the single path, when only one.
 * @returns true when the user accepted.
 */
function confirmDiscard(count: number, path?: string): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false
    const what = path !== undefined ? `"${path}"` : `${count} file${count === 1 ? '' : 's'}`
    return window.confirm(
      `Discard changes to ${what}? Untracked files are deleted. This cannot be undone.`,
    )
  } catch {
    return false
  }
}

const MISSING: GitState = {
  status: null,
  phase: 'ready',
  output: '',
  error: null,
  busy: null,
}
const noopSubscribe = (): (() => void) => () => {}
const getMissingSnapshot = (): GitState => MISSING

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------

/**
 * Client plugin body: mount the host's git Remote contract, then register the
 * view as a tab in the conversation ring beside Chat (0), Trajectory (10), and
 * Todo (20).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // One store per workspace, so every tab viewing the same workspace shares one
  // snapshot and one in-flight command chain.
  const stores = new Map<string, GitStore>()

  const anyCtx = ctx as never as {
    remote: { $mount: (c: unknown) => Promise<() => Promise<void>> }
    inject: (
      services: readonly string[],
      callback: (scoped: unknown) => void,
    ) => { dispose: () => void }
  }

  // Mount the host contract. `$mount` publishes the namespace as a cordis
  // service named `remote.dshGit`, ASYNCHRONOUSLY — so nothing may read
  // ctx.remote.dshGit until that service exists.
  ctx.effect(() => {
    let disposed = false
    let unmount: (() => Promise<void>) | undefined
    void anyCtx.remote
      .$mount(GIT_REMOTE)
      .then((dispose) => {
        if (disposed) return void dispose()
        unmount = dispose
      })
      .catch((error: unknown) => {
        console.error('dsh-git: failed to mount host remote', error)
      })
    return () => {
      disposed = true
      stores.clear()
      void unmount?.()
    }
  }, 'dsh-git: mount host remote')

  // Register the tab only once the mounted namespace is actually resolvable.
  //
  // This guard is the whole point: `$mount` above resolves asynchronously, so
  // reading `ctx.remote.dshGit` directly in apply() captures `undefined` and
  // every call fails. `ctx.inject(...)` parks a child fiber until the namespace
  // service exists, then runs the body with a context that can resolve it.
  ctx.effect(() => {
    const fiber = anyCtx.inject(['remote.dshGit', 'workspaces', 'slots'], (scoped) => {
      const readyCtx = scoped as ClientContext & {
        workspaces: { list: { getSnapshot(): { items: readonly unknown[] } } }
        remote: Record<string, GitRemote>
      }
      readyCtx.slots.inject('conversation.view', () =>
        readyCtx.slots.register(
          {
            name: 'conversation.view',
            id: 'git',
            order: 30,
            label: () => 'Changes',
            inject: (sessionId: string) => {
              const workspaces = readyCtx.workspaces.list.getSnapshot().items as readonly {
                workspaceId: string
                sessionIds: readonly string[]
              }[]
              const workspaceId = workspaceIdForSession(workspaces, sessionId)
              if (workspaceId === undefined) return { store: null }
              let store = stores.get(workspaceId)
              if (store === undefined) {
                store = new GitStore(readyCtx.remote.dshGit, workspaceId)
                stores.set(workspaceId, store)
              }
              return { store }
            },
          },
          GitView,
        ),
      )
    })
    return () => {
      fiber.dispose()
    }
  }, 'dsh-git: conversation.view registration')
}
