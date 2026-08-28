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

/**
 * How often to ask the host whether anything changed.
 *
 * This is a token probe, not a status read: the host answers from a filesystem
 * watcher without spawning git, so a tick is one small request. One second is
 * below the threshold where a file list feels stale, while still collapsing a
 * noisy build's worth of writes into a handful of refreshes.
 */
const POLL_MS = 1000

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
  /** Last observed change token; null until the first successful probe. */
  private token: number | null = null
  /** Number of mounted views watching, so one loop serves them all. */
  private watchers = 0
  private timer: number | null = null
  private polling = false
  private onVisible: (() => void) | undefined

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

  /**
   * Begin following the repository, so external edits appear without a click.
   *
   * The loop polls {@link GitRemote.changeToken}, NOT `status`. That endpoint
   * answers from a host-side filesystem watcher without spawning git, so a tick
   * costs a single small request; the expensive status read happens only when
   * the token actually moves. Polling `status` directly at this interval
   * would spawn four git processes per second per open tab.
   *
   * Reference-counted: several mounted views share one loop, and the last one
   * to leave stops it.
   * @returns a function that releases this watcher's claim.
   */
  watch(): () => void {
    this.watchers += 1
    if (this.watchers === 1) this.startPolling()
    // The disposer is guarded because it must be safe to call twice. React may
    // invoke a cleanup more than once, and an unguarded decrement drives the
    // count negative — after which a later mount sees `watchers === 0`, never
    // restarts the loop, and the tab silently stops updating with no error. The
    // same double-call with two views open stops polling while one is still
    // mounted. Both failures are invisible, so guard rather than trust callers.
    let released = false
    return () => {
      if (released) return
      released = true
      this.watchers -= 1
      if (this.watchers <= 0) {
        this.watchers = 0
        this.stopPolling()
      }
    }
  }

  /**
   * Drive one poll tick, refreshing only when the repository actually moved.
   *
   * Exported behaviour worth stating: a token of `0` means the directory is not
   * a repository, and a first observation only records the baseline. Neither
   * triggers a status read, so watching a plain folder costs one tiny request
   * per tick and nothing more.
   */
  private async tick(): Promise<void> {
    // A refresh already in flight owns the next paint; stacking another would
    // just queue duplicate git reads behind it. A running command is skipped for
    // the same reason — and safely, because the token is only ever adopted
    // together with a completed read, so whatever moved is still pending at the
    // next tick rather than being marked as seen here.
    if (this.polling || this.state.busy !== null) return
    this.polling = true
    try {
      const reply = await this.remote.changeToken({ workspaceId: this.workspaceId })
      if (!reply.ok) return
      const token = reply.value.token
      if (token === 0) return
      if (this.token === null) {
        this.token = token
        return
      }
      if (token === this.token) return
      this.token = token
      await this.refresh()
    } catch {
      // A dropped poll is not worth surfacing: the next tick retries, and an
      // error banner for a background probe would fight the user's actual work.
    } finally {
      this.polling = false
    }
  }

  /** Start the interval and re-check as soon as the tab becomes visible. */
  private startPolling(): void {
    if (this.timer !== null) return
    // Hidden tabs are not merely throttled by the browser, they are pointless:
    // nobody is looking. Gating on visibility takes the idle cost to zero and
    // the focus handler makes the list correct the instant it is looked at.
    this.onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void this.tick()
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisible)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.onVisible)
    }
    this.timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void this.tick()
    }, POLL_MS) as unknown as number
  }

  /** Stop the interval and detach the visibility listeners. */
  private stopPolling(): void {
    if (this.timer !== null) {
      clearInterval(this.timer as unknown as ReturnType<typeof setInterval>)
      this.timer = null
    }
    if (this.onVisible) {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.onVisible)
      }
      if (typeof window !== 'undefined') window.removeEventListener('focus', this.onVisible)
      this.onVisible = undefined
    }
  }

  /**
   * Re-read the authoritative snapshot from the host.
   *
   * The change token is re-baselined BEFORE the read, never after. Our own
   * writes move the watcher too, so re-baselining suppresses a redundant second
   * status read on the next tick — but the ordering is what makes it safe:
   * sampling the token first means any change that lands DURING the read leaves
   * a higher token behind and is still picked up. Sampling afterwards (or
   * un-awaited, racing the read) would adopt that newer value as the baseline
   * and silently swallow the change forever.
   */
  async refresh(): Promise<void> {
    // Sample BEFORE the read, and adopt it only after the read succeeds. Any
    // change that lands between these two calls leaves the host's token above
    // this sample, so the next tick still sees a mismatch and re-reads. Adopting
    // a token sampled after (or concurrently with) the status read would baseline
    // away a change the displayed status predates, freezing the tab on stale
    // content until some unrelated event happened to move the token again.
    const sampled = await this.probeToken()
    try {
      const reply = await this.remote.status({ workspaceId: this.workspaceId })
      if (!reply.ok) {
        this.publish({ ...this.state, phase: 'error', error: reply.error.message })
        return
      }
      if (sampled !== null) this.token = sampled
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

  /**
   * Read the current change token without acting on it.
   *
   * Deliberately RETURNS the value instead of assigning `this.token`: writing a
   * baseline from a probe unsynchronised with the status read is what loses
   * updates, so the decision to adopt belongs to the caller that knows the
   * ordering. Returns null when unavailable or not a repository.
   * @returns the token, or null to leave the baseline unchanged.
   */
  private async probeToken(): Promise<number | null> {
    try {
      const reply = await this.remote.changeToken({ workspaceId: this.workspaceId })
      return reply.ok && reply.value.token !== 0 ? reply.value.token : null
    } catch {
      // Returning null leaves the baseline untouched, which costs at most one
      // extra refresh next tick — always the safe direction to fail.
      return null
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
  changeToken: (request: { workspaceId: string }) => Promise<RemoteReply<{ token: number }>>
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
  /* The tab itself is the query container: a container query can never style
     its OWN container, so this must sit above the panes it switches. */
  container-type: inline-size;
  container-name: dshgit;
  color: var(--g-secondary);
  font: 400 14px/22px var(--dsw-font-family, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
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
  font-size: 14px; line-height: 22px; font-weight: 600; color: var(--g-primary);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshgit-branch svg { flex: none; }
.dshgit-spacer { flex: 1 1 auto; }
.dshgit-actions { flex: none; display: flex; gap: 4px; align-items: center; }

/* ---- buttons ---- */
.dshgit-btn {
  border: 1px solid var(--g-border); border-radius: 7px;
  background: transparent; color: var(--g-secondary);
  font: inherit; font-size: 12px; line-height: 18px; padding: 5px 11px; cursor: pointer;
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
  background: var(--g-hover); color: var(--g-caption); font-size: 12px; line-height: 16px; text-align: center;
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

/* ---- panes ----
   The list and the diff share one flex container so a single direction switch
   moves the diff between "beside the list" and "under the list".

   Container queries are used rather than a media query: this is a TAB inside a
   shell whose sidebar and panels resize independently of the viewport, so the
   width that matters is the tab's own, not the window's. inline-size is the
   containment the query needs. */
.dshgit-panes {
  flex: 1 1 auto; min-height: 0; min-width: 0;
  display: flex; flex-direction: column;
}

/* ---- sections ----
   The list's own box must NOT depend on whether a diff is open. Sizing it off
   the open/closed state meant the FIRST click resized the list under the
   pointer — rows reflowed and re-truncated mid-click, which reads as the list
   "jumping". So the list's geometry is reserved up front and identical in both
   states; only the DIFF is switched, via .dshgit-panes.hasdiff. */
.dshgit-scroll { flex: 1 1 auto; min-height: 0; min-width: 0; overflow-y: auto; }
/* Stacked (narrow): the diff takes the lower 55% and the list keeps the rest.
   Shrinking a scrollport does NOT move the content inside it — the viewport gets
   shorter while scrollTop stays put, and because the maximum scrollTop RISES as
   the port shrinks, the browser never has to clamp it. So every row keeps its
   exact screen position and simply ends up below the fold, still reachable by
   scrolling. An earlier attempt floated the diff over the list to avoid the
   resize entirely; that held rows still but hid the row that had just been
   clicked whenever the list was scrolled near its end, which reads as the list
   jumping away. In flow is both stable and visible. */
.dshgit-panes.hasdiff .dshgit-scroll { flex: 0 0 45%; }
.dshgit-panes.hasdiff .dshgit-diff { flex: 0 0 55%; }

/* Wide: side by side. The list holds the same column width in both states, so
   opening a diff changes nothing about the rows the pointer is over. */
@container dshgit (min-width: 720px) {
  .dshgit-panes { flex-direction: row; }
  .dshgit-scroll, .dshgit-panes.hasdiff .dshgit-scroll {
    flex: 0 0 clamp(240px, 34%, 420px); max-height: none;
  }
  .dshgit-panes.hasdiff .dshgit-scroll { border-right: 1px solid var(--g-border); }
  /* Side by side the diff takes the remaining width instead of a height share. */
  .dshgit-panes.hasdiff .dshgit-diff { flex: 1 1 auto; }
}
.dshgit-section { padding: 8px 0 4px; }
.dshgit-sechead {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 20px; color: var(--g-caption);
  font-size: 12px; line-height: 18px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
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
  /* The filename is the tallest thing in the row, so the body's 22px line-height
     would set the row height and undo the compact list. 20px matches the icon
     button and keeps rows at their original height while the text stays 14px. */
  line-height: 20px;
}
.dshgit-row:hover { background: var(--g-hover); border-color: var(--g-border); }
.dshgit-row.active { background: var(--g-hover); border-color: var(--dsw-alias-border-focus, #6b7280); }
.dshgit-code {
  flex: none; width: 16px; text-align: center; font-size: 12px; line-height: 16px; font-weight: 700;
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
/* A 16px glyph centred in a fixed 20px square, so rows keep a stable rhythm
   whichever icon is shown.

   20px, not 24px: the button is the tallest thing in a file row, so its height
   sets the row height. The old glyph buttons measured 20px, and a 24px box
   silently made every row 4px taller. Size the box to the row, and let the glyph
   stay at the shell's 16px. */
.dshgit-icon {
  border: 0; background: transparent; cursor: pointer; color: var(--g-caption);
  width: 20px; height: 20px; padding: 0; border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
}
.dshgit-icon svg, .dshgit-btn svg { display: block; flex: none; }
.dshgit-icon:hover { background: var(--g-hover); color: var(--g-primary); }
.dshgit-icon.danger:hover { color: var(--g-danger); }

/* ---- diff pane ---- */
.dshgit-diff {
  flex: 1 1 auto; min-height: 0; min-width: 0; overflow-y: auto; overflow-x: hidden;
  border-top: 1px solid var(--g-border); background: rgba(0,0,0,0.16);
}
/* Side by side the divider belongs on the list's right edge, not above the
   diff, or the pane reads as a stacked row that happens to sit alongside. */
@container dshgit (min-width: 720px) {
  .dshgit-diff { border-top: 0; }
}
.dshgit-diffhead {
  position: sticky; top: 0; z-index: 1;
  display: flex; align-items: center; gap: 8px;
  padding: 7px 20px; border-bottom: 1px solid var(--g-border);
  background: var(--dsw-alias-bg-l1, #16181c);
  color: var(--g-caption); font-size: 12px; line-height: 18px;
}
.dshgit-diffbody {
  margin: 0; padding: 8px 0;
  font: 400 12px/18px var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2;
}
/* Wrapped lines are indented past the +/- column and the pane no longer scrolls
   sideways, so a continuation reads as part of its line, not a new one. */
.dshgit-dl { padding: 0 20px 0 32px; text-indent: -12px; }
.dshgit-dl.add { background: rgba(34,197,94,0.14); color: #86efac; }
.dshgit-dl.del { background: rgba(239,68,68,0.14); color: #fca5a5; }
.dshgit-dl.hunk { color: var(--g-info); background: rgba(59,130,246,0.10); }
.dshgit-dl.meta { color: var(--g-caption); }

/* ---- diff loading skeleton ----
   Padding and line box are copied from .dshgit-diffbody so the placeholder rows
   land on the same rhythm the real patch will use. */
.dshgit-skel { margin: 0; padding: 8px 0; }
/* Real diff lines pull their first character back with text-indent: -12px (the
   +/- column), so the padding alone would start the bars 12px to the right of
   the text they stand in for. Match the actual glyph position instead. */
.dshgit-skel-line {
  height: 18px; display: flex; align-items: center;
  padding: 0 20px 0 20px;
}
.dshgit-skel-line.add { background: rgba(34,197,94,0.07); }
.dshgit-skel-line.del { background: rgba(239,68,68,0.07); }
.dshgit-skel-line.hunk { background: rgba(59,130,246,0.06); }
/* 10px keeps the bar visually inside the 18px line without touching its edges. */
.dshgit-skel-bar {
  height: 10px; border-radius: 3px;
  background: linear-gradient(
    90deg,
    var(--g-border) 0%,
    var(--g-hover) 40%,
    var(--g-border) 80%
  );
  /* The gradient is wider than the bar so there is off-screen runway to travel;
     animating background-position (not transform) leaves layout untouched, so
     the sweep cannot nudge anything around it. */
  background-size: 300% 100%;
  animation: dshgit-shimmer 1.4s ease-in-out infinite;
}
@keyframes dshgit-shimmer {
  0% { background-position: 180% 0; }
  100% { background-position: -80% 0; }
}
/* Visually hidden, still announced. */
.dshgit-sronly {
  position: absolute; width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}

/* ---- empty + footer ---- */
.dshgit-empty { padding: 40px 20px; text-align: center; color: var(--g-caption); }
.dshgit-empty b { display: block; color: var(--g-secondary); font-weight: 500; margin-bottom: 4px; }
.dshgit-empty .dshgit-btn { margin-top: 14px; }
.dshgit-init { display: flex; gap: 6px; justify-content: center; margin-top: 14px; }
.dshgit-init input {
  border: 1px solid var(--g-border); border-radius: 7px; background: transparent;
  color: var(--g-primary); font: inherit; font-size: 12px; line-height: 18px; padding: 5px 10px; width: 130px;
}
.dshgit-init input:focus { outline: none; border-color: var(--dsw-alias-border-focus, #6b7280); }
.dshgit-foot {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 8px 20px; border-top: 1px solid var(--g-border);
  color: var(--g-caption); font-size: 12px; line-height: 18px; min-height: 32px;
}
.dshgit-out {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}
.dshgit-out.err { color: var(--g-danger); }
/* inline-flex (not inline-block) so the SVG child rotates about the box centre
   rather than drifting on the text baseline. */
.dshgit-spin {
  display: inline-flex; align-items: center; justify-content: center;
  animation: dshgit-rot 900ms linear infinite;
}
@keyframes dshgit-rot { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .dshgit-rowbtns, .dshgit-secbtns { transition: none; }
  .dshgit-spin { animation: none; }
  /* Hold the bars at a flat mid-tone: the skeleton still communicates "loading"
     by being there, without the sweep. */
  .dshgit-skel-bar { animation: none; background: var(--g-border); }
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

/**
 * Icons, matching the shell's own convention: an inline SVG stroked in
 * `currentColor` and marked `aria-hidden`, because every call site already
 * carries a `title`/`aria-label`.
 *
 * Size is fixed at 16 and NOT a prop. The shell draws icons at 12/14/16/20, but
 * it pairs each size with a matching viewBox (a 14px icon is authored on
 * `0 0 14 14`) so the artwork is drawn at its native scale. Rendering this
 * 16-unit geometry into a 14px box instead shrinks the drawing and thins the
 * strokes — which is exactly how these icons first shipped, and why they read as
 * off-size next to the file rows. Spacing belongs to the button box below, not
 * to the glyph.
 *
 * These are inlined rather than imported: the shell's icon set lives in
 * `@deepseek-ai/dsh-client-ui-primitives`, which is a build-time external of the
 * host bundles — it is neither a loadable client module nor served over
 * `/plugins/`, so a plugin cannot import it. Inlining to the same spec is the
 * only way to match, and it keeps the tab free of an icon-font dependency.
 */
function Icon({ path }: { path: string }): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  )
}

/** Path data, keyed by role, so call sites read as names rather than glyphs. */
const ICON = {
  branch: 'M4.5 4.5v7M4.5 3.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm0 7a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm7-7a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm0 2.5v1A2.5 2.5 0 0 1 9 10.5H6.75',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.61-3.89M13.5 2.5v3h-3',
  sync: 'M2.5 5.5h9l-2-2M13.5 10.5h-9l2 2',
  sparkle: 'M8 2.5 9.2 6.3 13 7.5 9.2 8.7 8 12.5 6.8 8.7 3 7.5l3.8-1.2Z',
  close: 'M4 4l8 8M12 4l-8 8',
  plus: 'M8 3.5v9M3.5 8h9',
  minus: 'M3.5 8h9',
  discard: 'M3 8a5 5 0 1 0 1.6-3.68M3 2.5v3h3',
} as const

/** Branch glyph for the header. */
function BranchIcon(): React.JSX.Element {
  return <Icon path={ICON.branch} />
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
            <Icon path={ICON.discard} />
          </button>
        ) : null}
        <button
          className="dshgit-icon"
          title={section === 'staged' ? 'Unstage' : 'Stage'}
          aria-label={`${section === 'staged' ? 'Unstage' : 'Stage'} ${file.path}`}
          onClick={onPrimary}
        >
          <Icon path={section === 'staged' ? ICON.minus : ICON.plus} />
        </button>
      </span>
    </li>
  )
}

/* Placeholder rows, shaped like a real patch: a couple of meta lines, a hunk
   header, then a run of context/add/del at varied widths. Mirroring the eventual
   layout keeps the pane from lurching when the real diff replaces it. */
const SKELETON_ROWS: { kind: string; width: number }[] = [
  { kind: 'meta', width: 42 },
  { kind: 'meta', width: 34 },
  { kind: 'hunk', width: 26 },
  { kind: '', width: 68 },
  { kind: 'add', width: 54 },
  { kind: 'add', width: 76 },
  { kind: '', width: 47 },
  { kind: 'del', width: 61 },
  { kind: '', width: 72 },
  { kind: 'add', width: 39 },
  { kind: '', width: 58 },
  { kind: '', width: 44 },
]

/**
 * Placeholder shown while a patch is in flight.
 *
 * A skeleton rather than a spinner: the pane is a large surface, and shimmering
 * bars in the diff's own shape read as "this content is arriving" instead of
 * blanking the area. The wrapper carries the live region so a screen reader is
 * told the diff is loading without narrating twelve decorative rows.
 * @returns the loading placeholder.
 */
function DiffSkeleton(): React.JSX.Element {
  return (
    <div className="dshgit-skel" role="status" aria-live="polite" aria-busy="true">
      <span className="dshgit-sronly">Loading diff…</span>
      {SKELETON_ROWS.map((row, i) => (
        <div className={`dshgit-skel-line ${row.kind}`} key={i} aria-hidden="true">
          <span
            className="dshgit-skel-bar"
            /* Staggering the shimmer makes it sweep down the pane instead of
               every bar flashing in lockstep. */
            style={{ width: `${row.width}%`, animationDelay: `${i * 70}ms` }}
          />
        </div>
      ))}
    </div>
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
                <Icon path={ICON.discard} />
              </button>
              <button
                className="dshgit-icon"
                title="Stage all"
                onClick={() => void store.stage('stage', paths)}
              >
                <Icon path={ICON.plus} />
              </button>
            </>
          ) : (
            <button
              className="dshgit-icon"
              title="Unstage all"
              onClick={() => void store.stage('unstage', paths)}
            >
              <Icon path={ICON.minus} />
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
  // Loading is its own flag rather than a sentinel string in `patch`, so a real
  // diff whose text happens to read "Loading diff…" cannot render as a skeleton.
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    injectStyles()
  }, [])

  React.useEffect(() => {
    if (store) void store.ensure()
  }, [store])

  // Follow the repository for as long as this view is mounted, so changes made
  // outside the tab (an agent's edit, a terminal checkout, a build) appear on
  // their own. The cleanup is what keeps a closed tab from polling forever.
  React.useEffect(() => {
    if (!store) return
    return store.watch()
  }, [store])

  const state = React.useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : getMissingSnapshot,
    store ? store.getSnapshot : getMissingSnapshot,
  )

  // Monotonic click counter; see the ordering guard in openDiff.
  const requestSeq = React.useRef(0)

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
        setLoading(false)
        return
      }
      setSelected(key)
      setPatch('')
      setLoading(true)
      // Clicking down a list starts overlapping requests, and they can settle out
      // of order — a slow diff landing after a later one would show the wrong
      // file's patch under the right filename. Only the newest click may write.
      requestSeq.current += 1
      const seq = requestSeq.current
      void store.diff(path, staged).then((text) => {
        if (seq !== requestSeq.current) return
        setPatch(text.trim().length === 0 ? 'No textual changes.' : text)
        setLoading(false)
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
      requestSeq.current += 1
      setSelected(null)
      setPatch('')
      setLoading(false)
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
    <div className={`dshgit${selected !== null ? ' diffopen' : ''}`}>
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
            <Icon path={ICON.refresh} />
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
                {busy === 'sync:sync' ? (
                  <span className="dshgit-spin">
                    <Icon path={ICON.refresh} />
                  </span>
                ) : (
                  <Icon path={ICON.sync} />
                )}
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
            {busy === 'suggest' ? (
              <span className="dshgit-spin">
                <Icon path={ICON.sparkle} />
              </span>
            ) : (
              <Icon path={ICON.sparkle} />
            )}
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

      <div className={`dshgit-panes${selected !== null ? ' hasdiff' : ''}`}>
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
                  requestSeq.current += 1
                  setSelected(null)
                  setPatch('')
                  setLoading(false)
                }}
              >
                <Icon path={ICON.close} />
              </button>
            </div>
            {loading ? <DiffSkeleton /> : <DiffBody patch={patch} />}
          </div>
        ) : null}
      </div>

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
