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
import { resolveWorktreeTarget, suggestWorktreePath } from './types.ts'
import type {
  BranchAction,
  ChangeScope,
  CommandResult,
  GitBranch,
  GitCommit,
  GitCommitFile,
  GitFileChange,
  GitStash,
  GitStatus,
  GitWorktree,
  MergeAction,
  RefsResult,
  StageAction,
  StashAction,
  SyncAction,
  WorktreeAction,
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
 * STAGED CONTENT IS REQUIRED, and a written message with it. The button
 * commits the index and only the index, so what the user staged is what gets
 * recorded — no `-a` sweep that quietly widens the commit past the selection
 * they just made in this very list.
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
  return counts.staged > 0
}

/**
 * Why the Commit button is dead, as a short phrase — empty when it is live.
 *
 * Mirrors {@link canCommit} clause for clause, and orders its checks so the
 * most actionable cause wins: a disabled button with no stated reason is the
 * single most common way a commit box wastes someone's time, and `title` alone
 * does not cover it because browsers suppress tooltips on disabled controls.
 * @param status - the current snapshot.
 * @param message - the message in the box.
 * @returns the blocking reason, or an empty string.
 */
export function commitBlocker(status: GitStatus, message: string): string {
  if (!status.repo) return 'This folder is not a git repository'
  const counts = countChanges(status.files)
  if (counts.conflicted > 0) return 'Resolve the conflicts before committing'
  if (counts.staged === 0) return 'Stage a file to commit'
  if (message.trim().length === 0) return 'Write a commit message'
  return ''
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
  /**
   * Branches, stashes and worktrees — fetched lazily, never polled.
   *
   * null means "not asked yet". A settled value is a discriminated outcome, so
   * "this repo has no stashes" and "we could not ask" stay distinguishable; a
   * client newer than the host half 404s `refs`, and collapsing that into empty
   * lists would render as an empty repository rather than a stale host.
   */
  refs: RefsResult | null
  /** True while a refs read is in flight, so the pane can show it is working. */
  refsLoading: boolean
  /**
   * Branch a switch was refused for, because of uncommitted local changes.
   *
   * Holding it is what turns the refusal into an offer: the tab reveals a
   * "Stash changes and switch" button for exactly this branch. Nothing is
   * stashed until that button is pressed.
   */
  pendingSwitch: string | null
}

const INITIAL: GitState = {
  status: null,
  phase: 'loading',
  output: '',
  error: null,
  busy: null,
  refs: null,
  refsLoading: false,
  pendingSwitch: null,
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
  /** How many views currently need the branch/stash/worktree lists kept fresh. */
  private refsWanted = 0

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
  run(label: string, run: () => Promise<RemoteReply<CommandResult>>): Promise<CommandResult | null> {
    const step = async (): Promise<CommandResult | null> => {
      this.publish({ ...this.state, busy: label, error: null })
      try {
        const reply = await run()
        if (!reply.ok) {
          this.publish({ ...this.state, busy: null, error: reply.error.message })
          return null
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
        // Any mutation can invalidate the branch/stash/worktree lists, so refresh
        // them whenever something is actually watching — a commit changes ahead
        // counts, a checkout moves `current`, a stash push adds a row.
        if (this.refsWanted > 0) await this.loadRefs()
        return result
      } catch (error) {
        this.publish({ ...this.state, busy: null, error: describe(error) })
        return null
      }
    }
    this.tail = this.tail.then(step, step)
    return this.tail as Promise<CommandResult | null>
  }


  /**
   * Keep the branch, stash and worktree lists fresh while a view needs them.
   *
   * Reference-counted exactly like {@link watch}, and for the same reason: the
   * branch menu and the Repo pane can both be open, and the last one to leave
   * should stop the work. These lists are NOT polled — they are re-read after a
   * command and when the repository itself changes — because they answer a
   * question nobody is staring at most of the time.
   *
   * @returns a function releasing this view's claim.
   */
  wantRefs(): () => void {
    this.refsWanted += 1
    if (this.refsWanted === 1 || this.state.refs === null) void this.loadRefs()
    // Guarded against a double call for the same reason watch()'s disposer is:
    // React may run a cleanup twice, and a negative count would leave a later
    // mount believing nothing needs refreshing.
    let released = false
    return () => {
      if (released) return
      released = true
      this.refsWanted -= 1
      if (this.refsWanted < 0) this.refsWanted = 0
    }
  }

  /**
   * Read branches, stashes and worktrees from the host.
   *
   * Never rejects and never collapses a failure into empty lists — the outcome
   * is stored verbatim so the pane can say "couldn't read" rather than showing a
   * convincing but false empty repository.
   */
  async loadRefs(): Promise<void> {
    this.publish({ ...this.state, refsLoading: true })
    try {
      const reply = await this.remote.refs({ workspaceId: this.workspaceId })
      this.publish({
        ...this.state,
        refsLoading: false,
        refs: reply.ok ? reply.value : { ok: false, error: reply.error.message },
      })
    } catch (error) {
      this.publish({
        ...this.state,
        refsLoading: false,
        refs: { ok: false, error: describe(error) },
      })
    }
  }

  /** Clear a pending stash-and-switch offer. */
  clearPendingSwitch(): void {
    if (this.state.pendingSwitch === null) return
    this.publish({ ...this.state, pendingSwitch: null })
  }

  /**
   * Switch branches, turning git's refusal into an explicit offer.
   *
   * Git refuses a checkout that would clobber uncommitted work. Rather than
   * auto-stashing — which hides work behind a state the user never chose, and
   * whose later pop can conflict on a branch they did not expect — the refusal
   * is caught here and recorded as {@link GitState.pendingSwitch}, which the tab
   * renders as a "Stash changes and switch" button.
   *
   * @param name - branch to switch to.
   */
  async switchBranch(name: string): Promise<void> {
    const result = await this.branch('switch', { name })
    // Match on git's own wording. A failure for any OTHER reason (no such
    // branch, a lock) must NOT offer to stash, since stashing would not help.
    const refused =
      result !== null && !result.ok && /local changes|would be overwritten|overwritten by checkout/i.test(result.output)
    this.publish({ ...this.state, pendingSwitch: refused ? name : null })
  }

  /** Run one branch operation. */
  branch(
    action: BranchAction,
    options: { name?: string; startPoint?: string; force?: boolean } = {},
  ): Promise<CommandResult | null> {
    return this.run(`branch:${action}`, () =>
      this.remote.branch({ workspaceId: this.workspaceId, action, ...options }),
    )
  }

  /** Merge a branch, or abort/continue a merge already in progress. */
  merge(
    action: MergeAction,
    options: { from?: string; noFF?: boolean } = {},
  ): Promise<CommandResult | null> {
    return this.run(`merge:${action}`, () =>
      this.remote.merge({ workspaceId: this.workspaceId, action, ...options }),
    )
  }

  /** Run one stash operation. */
  stash(
    action: StashAction,
    options: { index?: number; message?: string; includeUntracked?: boolean } = {},
  ): Promise<CommandResult | null> {
    return this.run(`stash:${action}`, () =>
      this.remote.stash({ workspaceId: this.workspaceId, action, ...options }),
    )
  }

  /** Run one worktree operation. */
  worktree(
    action: WorktreeAction,
    options: {
      path?: string
      branch?: string
      newBranch?: string
      force?: boolean
      register?: boolean
    } = {},
  ): Promise<CommandResult | null> {
    return this.run(`worktree:${action}`, () =>
      this.remote.worktree({ workspaceId: this.workspaceId, action, ...options }),
    )
  }

  /**
   * Ask the model to turn a rough description into a branch name.
   *
   * Fails SOFT and returns an empty string: no provider configured, a refused
   * request, or an unusable answer all leave the field exactly as the user left
   * it, with the reason in the log strip. The form stays fully usable by typing
   * a name — this is an accelerator, never a dependency.
   *
   * @param hint - the user's rough description.
   * @returns the suggested branch name, or an empty string on any failure.
   */
  async suggestBranch(hint: string): Promise<string> {
    this.publish({ ...this.state, busy: 'suggestBranch', error: null })
    try {
      const reply = await this.remote.suggestBranch({ workspaceId: this.workspaceId, hint })
      if (!reply.ok) {
        this.publish({ ...this.state, busy: null, error: reply.error.message })
        return ''
      }
      this.publish({ ...this.state, busy: null })
      return reply.value.name
    } catch (error) {
      this.publish({ ...this.state, busy: null, error: describe(error) })
      return ''
    }
  }

  /** Stage, unstage, or discard paths. */
  stage(action: StageAction, paths: string[]): Promise<CommandResult | null> {
    return this.run(`stage:${action}`, () =>
      this.remote.stage({ workspaceId: this.workspaceId, action, paths }),
    )
  }

  /**
   * Commit the index.
   *
   * No `all` flag: the button is live only with something staged, so the
   * index IS the commit. See {@link canCommit}.
   */
  commit(message: string): Promise<CommandResult | null> {
    return this.run('commit', () => this.remote.commit({ workspaceId: this.workspaceId, message }))
  }

  /** Create a repository in this workspace's directory. */
  init(branch: string): Promise<CommandResult | null> {
    return this.run('init', () => this.remote.init({ workspaceId: this.workspaceId, branch }))
  }

  /** Run one remote operation. */
  sync(action: SyncAction): Promise<CommandResult | null> {
    return this.run(`sync:${action}`, () =>
      this.remote.sync({ workspaceId: this.workspaceId, action }),
    )
  }

  /**
   * Ask the host's model for a commit message.
   *
   * The scope is deliberately NOT passed: the host reads status itself and
   * describes the index when anything is staged, the whole working tree when
   * it is empty. Deciding here would bet the message on a snapshot that may be
   * up to a poll interval behind the disk — and a message describing files the
   * commit will not record is worse than a slow one.
   *
   * Returns the text rather than storing it, because the message belongs to the
   * commit box's local editing state — the user must be able to edit or reject
   * it before anything is committed.
   * @returns the suggested message, or an empty string on failure.
   */
  async suggest(): Promise<string> {
    this.publish({ ...this.state, busy: 'suggest', error: null })
    try {
      const reply = await this.remote.suggestMessage({ workspaceId: this.workspaceId })
      if (!reply.ok) {
        this.publish({ ...this.state, busy: null, error: reply.error.message })
        return ''
      }
      // An older host reports no scope; leave the strip alone rather than
      // blanking whatever the last command put there.
      const note = describeScope(reply.value.scope)
      this.publish({ ...this.state, busy: null, ...(note ? { output: note } : {}) })
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
   * List the paths one commit touched.
   *
   * Never rejects — a rejected promise would leave the clicked row stuck in its
   * loading state forever — but it does NOT collapse a failure into an empty
   * list. Those are different facts: "this commit changed nothing" and "we could
   * not ask" look identical as `[]`, and rendering them the same way is what
   * made a 404 from a stale host half read as nothing happening at all.
   * @param sha - the commit to inspect.
   * @returns the touched paths, or the reason the lookup failed.
   */
  async commitFiles(sha: string): Promise<CommitFilesOutcome> {
    try {
      const reply = await this.remote.commitFiles({ workspaceId: this.workspaceId, sha })
      if (!reply.ok) return { ok: false, error: reply.error.message }
      return { ok: true, files: reply.value.files }
    } catch (error) {
      return { ok: false, error: describe(error) }
    }
  }

  /**
   * Fetch the patch one commit introduced, for one path or in full.
   * @param sha - the commit to read.
   * @param path - repo-relative path, or undefined for the whole commit.
   * @returns the patch text, or a short failure notice.
   */
  async commitDiff(sha: string, path: string | undefined): Promise<string> {
    try {
      const reply = await this.remote.commitDiff({
        workspaceId: this.workspaceId,
        sha,
        ...(path !== undefined ? { path } : {}),
      })
      if (!reply.ok) return `Could not read commit: ${reply.error.message}`
      return reply.value.patch
    } catch (error) {
      return `Could not read commit: ${describe(error)}`
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
  commitFiles: (request: {
    workspaceId: string
    sha: string
  }) => Promise<RemoteReply<{ files: GitCommitFile[] }>>
  commitDiff: (request: {
    workspaceId: string
    sha: string
    path?: string
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
  }) => Promise<RemoteReply<{ message: string; scope?: ChangeScope }>>
  changeToken: (request: { workspaceId: string }) => Promise<RemoteReply<{ token: number }>>
  refs: (request: { workspaceId: string }) => Promise<RemoteReply<RefsResult>>
  suggestBranch: (request: {
    workspaceId: string
    hint?: string
  }) => Promise<RemoteReply<{ name: string }>>
  branch: (request: {
    workspaceId: string
    action: BranchAction
    name?: string
    startPoint?: string
    force?: boolean
  }) => Promise<RemoteReply<CommandResult>>
  merge: (request: {
    workspaceId: string
    action: MergeAction
    from?: string
    noFF?: boolean
  }) => Promise<RemoteReply<CommandResult>>
  stash: (request: {
    workspaceId: string
    action: StashAction
    index?: number
    message?: string
    includeUntracked?: boolean
  }) => Promise<RemoteReply<CommandResult>>
  worktree: (request: {
    workspaceId: string
    action: WorktreeAction
    path?: string
    branch?: string
    newBranch?: string
    force?: boolean
    register?: boolean
  }) => Promise<RemoteReply<CommandResult>>
}

type RemoteReply<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/**
 * The result of asking for one commit's files.
 *
 * A discriminated union rather than a bare array so the pane can tell "this
 * commit touched nothing" apart from "the lookup failed" — the distinction the
 * empty-list version threw away.
 */
export type CommitFilesOutcome =
  | { ok: true; files: GitCommitFile[] }
  | { ok: false; error: string }

/**
 * Render an unknown throw as a short message for the status line.
 * @param error - the caught value.
 * @returns a human-readable message.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Say which changes a drafted message covers.
 *
 * Worth a line in the log strip because the two scopes read identically in the
 * box: a message describing the whole tree looks exactly like one describing
 * the three files you staged.
 * @param scope - the host's reported scope, absent on an older host.
 * @returns a short sentence, or an empty string when the host did not say.
 */
export function describeScope(scope: ChangeScope | undefined): string {
  if (scope === 'staged') return 'Message written from the staged changes.'
  if (scope === 'all') return 'Nothing staged — message written from all uncommitted changes.'
  return ''
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
  --g-warn: var(--dsw-alias-state-warn-primary, #f59e0b);
  --g-info: var(--dsw-alias-state-business-primary, #3b82f6);
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

/* ---- sub-tab switcher ----
   Changes and History are two modes of ONE tab, so the switcher is a segmented
   control rather than a second row of tabs: the shell already owns real tabs
   and a nested set of the same weight would read as a peer of Chat/Trajectory.
   Rendered as real buttons with aria-pressed so it is operable from a keyboard
   and announced as a toggle, not as decoration. */
.dshgit-modes {
  flex: none; display: flex; gap: 2px; padding: 8px 20px 0;
}
.dshgit-mode {
  border: none; border-bottom: 2px solid transparent; border-radius: 0;
  background: transparent; color: var(--g-caption);
  font: inherit; font-size: 13px; line-height: 20px; font-weight: 600;
  padding: 4px 10px 6px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
}
.dshgit-mode:hover { color: var(--g-primary); }
.dshgit-mode[aria-pressed='true'] { color: var(--g-primary); border-bottom-color: var(--g-accent); }
.dshgit-mode:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #6b7280); outline-offset: -2px; }

/* ---- history ----
   Commit rows reuse the .dshgit-row box so they inherit the same 32px height
   and 20px line-height the icon probe pins; only the inner columns differ. */
.dshgit-sha {
  flex: none; color: var(--g-caption); font-size: 12px; line-height: 20px;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
}
.dshgit-subject {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--g-secondary);
}
.dshgit-row.active .dshgit-subject, .dshgit-row:hover .dshgit-subject { color: var(--g-primary); }
.dshgit-when { flex: none; color: var(--g-caption); font-size: 12px; line-height: 20px; }
/* The expanded file list is indented so it reads as belonging to the commit
   above it rather than as another commit. */
.dshgit-commitfiles { list-style: none; margin: 0 0 4px; padding: 0 0 0 20px; }
.dshgit-commitfiles .dshgit-row { padding-left: 8px; }
.dshgit-loadingrow {
  padding: 5px 8px 5px 28px; color: var(--g-caption); font-size: 12px; line-height: 20px;
}
.dshgit-loadingrow.err { color: var(--g-danger); }

/* ---- commit box ---- */
.dshgit-commit { flex: none; padding: 12px 20px; border-bottom: 1px solid var(--g-border); }
.dshgit-msg {
  width: 100%; min-height: 58px; max-height: 180px; resize: vertical;
  border: 1px solid var(--g-border); border-radius: 8px;
  background: transparent; color: var(--g-primary); font: inherit;
  padding: 8px 11px; line-height: 1.5;
}
.dshgit-msg::placeholder { color: var(--g-caption); }
.dshgit-msg:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #6b7280); }
.dshgit-commitrow { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
/* The reason the Commit button is dead. min-width: 0 with ellipsis so a narrow
   tab truncates the hint instead of squeezing the button it explains. */
.dshgit-hint {
  color: var(--g-caption); font-size: 12px; line-height: 20px;
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

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
.dshgit-row.active { background: var(--g-hover); border-color: var(--dsw-alias-brand-primary, #6b7280); }
.dshgit-code {
  flex: none; width: 16px; text-align: center; font-size: 12px; line-height: 16px; font-weight: 700;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
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
  background: var(--dsw-alias-bg-layer-1, #16181c);
  color: var(--g-caption); font-size: 12px; line-height: 18px;
}
.dshgit-diffbody {
  margin: 0; padding: 8px 0;
  font: 400 12px/18px var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
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

/* ---- branch button + menu ----
   The branch name is the natural home for branch actions, so it becomes a real
   button rather than growing a separate control in an already busy header.
   The menu is position: fixed and anchored from getBoundingClientRect, because
   the tab lives inside the shell's scrolling panels: an absolutely positioned
   popup would be clipped by the first ancestor with overflow set. */
.dshgit-branchbtn {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid transparent; border-radius: 7px;
  background: transparent; color: var(--g-primary);
  font: inherit; font-size: 14px; line-height: 22px; font-weight: 600;
  padding: 2px 8px 2px 6px; cursor: pointer;
  min-width: 0; max-width: 100%;
}
.dshgit-branchbtn:hover { background: var(--g-hover); border-color: var(--g-border); }
.dshgit-branchbtn[aria-expanded='true'] { background: var(--g-hover); border-color: var(--g-border); }
.dshgit-branchbtn svg { flex: none; }
.dshgit-branchname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshgit-caret { flex: none; color: var(--g-caption); }

.dshgit-menu {
  position: fixed; z-index: 60;
  min-width: 260px; max-width: 380px;
  max-height: 60vh; overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--g-border); border-radius: 10px;
  background: var(--dsw-specific-menu, #232427);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.35), 0 12px 32px rgba(0,0,0,0.4);
}
.dshgit-menu-filter {
  width: 100%; margin: 2px 0 4px;
  border: 1px solid var(--g-border); border-radius: 7px; background: transparent;
  color: var(--g-primary); font: inherit; font-size: 13px; line-height: 20px; padding: 5px 9px;
}
.dshgit-menu-filter:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #6b7280); }
.dshgit-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  border: 0; border-radius: 7px; background: transparent; color: var(--g-secondary);
  font: inherit; font-size: 13px; line-height: 20px; text-align: left;
  padding: 5px 8px; cursor: pointer;
}
.dshgit-menu-item:hover:not(:disabled), .dshgit-menu-item.focused {
  background: var(--g-hover); color: var(--g-primary);
}
.dshgit-menu-item:disabled { opacity: 0.45; cursor: default; }
.dshgit-menu-item.current { color: var(--g-primary); font-weight: 600; }
.dshgit-menu-item .dshgit-menu-sub {
  flex: none; color: var(--g-caption); font-size: 12px; line-height: 18px;
}
.dshgit-menu-label {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshgit-menu-divider { height: 1px; margin: 4px 6px; background: var(--g-border); }
.dshgit-menu-head {
  padding: 6px 8px 2px; color: var(--g-caption);
  font-size: 11px; line-height: 16px; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase;
}
.dshgit-menu-empty { padding: 8px; color: var(--g-caption); font-size: 12px; line-height: 18px; }

/* ---- merge banner ----
   A merge that conflicts leaves durable repository state, so the tab has to say
   so on every render until it is concluded. Warn, not error: being mid-merge is
   a normal place to be, it just is not a place to walk away from silently. */
.dshgit-banner {
  flex: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 20px; border-bottom: 1px solid var(--g-border);
  background: color-mix(in srgb, var(--g-warn) 12%, transparent);
  color: var(--g-primary); font-size: 13px; line-height: 20px;
}
.dshgit-banner .dshgit-banner-icon { flex: none; color: var(--g-warn); display: inline-flex; }
.dshgit-banner-text { flex: 1 1 auto; min-width: 0; }
.dshgit-banner-what {
  color: var(--g-caption); font-size: 12px; line-height: 18px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ---- inline forms (create branch, add worktree) ----
   In-flow rather than modal: these are small, and a dialog for two fields costs
   a focus trap and a portal to say the same thing. */
.dshgit-form {
  display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
  padding: 8px 20px; border-bottom: 1px solid var(--g-border);
}
.dshgit-form input[type='text'] {
  flex: 1 1 160px; min-width: 0;
  border: 1px solid var(--g-border); border-radius: 7px; background: transparent;
  color: var(--g-primary); font: inherit; font-size: 13px; line-height: 20px; padding: 5px 9px;
}
.dshgit-form input[type='text']:focus {
  outline: none; border-color: var(--dsw-alias-brand-primary, #6b7280);
}
/* The resolved target, shown live under the input. Full width so it sits on its
   own line under the controls rather than squeezing them. */
.dshgit-preview {
  flex: 1 0 100%; min-width: 0;
  color: var(--g-caption); font-size: 12px; line-height: 18px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
}
.dshgit-preview.err { color: var(--g-danger); font-family: inherit; }
.dshgit-check {
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--g-caption); font-size: 12px; line-height: 18px; cursor: pointer;
}

/* ---- repo pane rows ----
   Stash and worktree rows reuse .dshgit-row so they inherit the same 32px box
   and 20px line-height the icon probe pins for file rows; only the columns
   inside differ. */
.dshgit-rowmain {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--g-secondary);
}
.dshgit-row:hover .dshgit-rowmain { color: var(--g-primary); }
.dshgit-rowmeta {
  flex: none; color: var(--g-caption); font-size: 12px; line-height: 20px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 45%;
}
.dshgit-tag {
  flex: none; padding: 0 6px; border-radius: 999px;
  border: 1px solid var(--g-border); color: var(--g-caption);
  font-size: 11px; line-height: 16px;
}
.dshgit-tag.warn { color: var(--g-warn); border-color: var(--g-warn); }
.dshgit-tag.ok { color: var(--g-accent); border-color: var(--g-accent); }

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
.dshgit-init input:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #6b7280); }
.dshgit-foot {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 8px 20px; border-top: 1px solid var(--g-border);
  color: var(--g-caption); font-size: 12px; line-height: 18px; min-height: 32px;
}
.dshgit-out {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
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
  caret: 'M4.5 6.5 8 10l3.5-3.5',
  merge: 'M4.5 4.5v7M4.5 3.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm0 7a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm7-3.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm-1.25 1.25H8A3.5 3.5 0 0 1 4.5 4.75',
  warn: 'M8 3.2 14 13.2H2L8 3.2ZM8 6.9v2.6M8 11.1h.01',
  stash: 'M2.5 6.5 8 3.5l5.5 3L8 9.5 2.5 6.5Zm0 3.2L8 12.7l5.5-3',
  tree: 'M3.5 3.5h4v3h-4v-3Zm5 6h4v3h-4v-3Zm-5 0h4v3h-4v-3ZM5.5 6.5v3M10.5 6.5v3M5.5 8h5',
  trash: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8',
  check: 'M3.5 8.5 6.5 11.5 12.5 5',
  open: 'M9.5 3.5h3v3M12.5 3.5 7.5 8.5M12 9.5v2a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2',
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
/**
 * The History pane: the recent commits, each expandable into the files it
 * touched.
 *
 * The commit list itself costs nothing extra — `status.recent` is already
 * fetched with every status read — so only the expansion talks to the host, and
 * only for the one commit the user opened.
 *
 * @param commits - the recent commits, newest first.
 * @param store - the workspace's git store.
 * @param openSha - which commit is expanded, or null.
 * @param onToggle - expand or collapse a commit.
 * @param files - the expanded commit's outcome, or null while it loads.
 * @param selected - the selected "sha:path" key, or null.
 * @param onOpenFile - show one file's patch from a commit.
 * @returns the pane.
 */
function HistoryPane({
  commits,
  openSha,
  onToggle,
  files,
  selected,
  onOpenFile,
}: {
  commits: readonly GitCommit[]
  openSha: string | null
  onToggle: (sha: string) => void
  files: CommitFilesOutcome | null
  selected: string | null
  onOpenFile: (sha: string, path: string) => void
}): React.JSX.Element {
  if (commits.length === 0) {
    return (
      <div className="dshgit-empty">
        <b>No commits yet</b>
        This branch has no history to show.
      </div>
    )
  }

  return (
    <div className="dshgit-section">
      <div className="dshgit-sechead">
        <span>History</span>
        <span className="dshgit-badge-count">{commits.length}</span>
      </div>
      <ul className="dshgit-list">
        {commits.map((commit) => {
          const open = openSha === commit.sha
          return (
            <li key={commit.sha}>
              <div
                className={`dshgit-row${open ? ' active' : ''}`}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                title={`${commit.subject}\n${commit.author} · ${new Date(commit.date).toLocaleString()}`}
                onClick={() => onToggle(commit.sha)}
                onKeyDown={(e) => {
                  // A div with role=button is not natively operable, so the
                  // keyboard contract has to be restored by hand.
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onToggle(commit.sha)
                  }
                }}
              >
                <span className="dshgit-sha">{commit.sha}</span>
                <span className="dshgit-subject">{commit.subject}</span>
                <span className="dshgit-when">{fmtAge(commit.date)}</span>
              </div>
              {open ? (
                files === null ? (
                  <div className="dshgit-loadingrow">Reading commit…</div>
                ) : !files.ok ? (
                  // Say so out loud. Silently rendering an empty list here is
                  // what turned a stale host half's 404 into "nothing happens".
                  <div className="dshgit-loadingrow err" title={files.error}>
                    Couldn&apos;t read this commit — {files.error}
                  </div>
                ) : files.files.length === 0 ? (
                  <div className="dshgit-loadingrow">No files in this commit.</div>
                ) : (
                  <ul className="dshgit-commitfiles">
                    {files.files.map((file) => {
                      const letter = file.status === ' ' ? 'M' : file.status
                      return (
                        <li
                          key={`${commit.sha}:${file.path}`}
                          className={`dshgit-row${selected === `${commit.sha}:${file.path}` ? ' active' : ''}`}
                          onClick={() => onOpenFile(commit.sha, file.path)}
                          title={`${describeCode(letter)} — ${file.path}`}
                        >
                          <span className={`dshgit-code ${letter}`} aria-hidden="true">
                            {letter}
                          </span>
                          <span className="dshgit-path">
                            <span>
                              <span className="dshgit-dir">{dirName(file.path)}</span>
                              <span className="dshgit-base">{baseName(file.path)}</span>
                            </span>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}


/**
 * Guard any destructive action behind a confirmation.
 *
 * The sibling of {@link confirmDiscard}, generalized: deleting a branch,
 * dropping a stash and removing a worktree all destroy work that is not
 * recoverable through the tab. A host without a usable `confirm` refuses rather
 * than proceeding, which is the safe direction for all three.
 *
 * @param message - the question, naming exactly what will be destroyed.
 * @returns true when the user accepted.
 */
function confirmAction(message: string): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false
    return window.confirm(message)
  } catch {
    return false
  }
}

/**
 * Find the workspace registered at a directory, if any.
 *
 * Removing a worktree used to leave its workspace behind, pointing at a
 * directory that no longer exists — registration was one-way. This is the
 * lookup that lets the tab offer to clean up after itself.
 *
 * Comparison is normalized on separators, trailing slash and CASE, because the
 * registry stores a host-side realpath canon while git reports its own spelling
 * and Windows differs in case constantly. A prefix must NOT count as a match:
 * `myproj-two` beside `myproj` is a different workspace, and deleting the wrong
 * one is unrecoverable from here.
 *
 * Returns undefined rather than guessing when nothing matches — a realpath that
 * resolved a symlink differently should mean 'no offer', never 'delete something
 * that looked close'.
 *
 * @param items - the workspace list projection.
 * @param path - directory to look up.
 * @returns the matching workspace, or undefined.
 */
export function findWorkspaceForPath(
  items: readonly { workspaceId?: unknown; path?: unknown; title?: unknown }[],
  path: string,
): { workspaceId: string; title: string } | undefined {
  const norm = (value: string): string =>
    value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const target = norm(path)
  if (target.length === 0) return undefined
  for (const item of items) {
    if (typeof item?.path !== 'string' || typeof item?.workspaceId !== 'string') continue
    if (norm(item.path) !== target) continue
    return {
      workspaceId: item.workspaceId,
      title: typeof item.title === 'string' ? item.title : item.path,
    }
  }
  return undefined
}
/**
 * Pull a workspace id out of whatever shape the shell's create call returned.
 *
 * The id is spelled differently across the shell's own projections (the list
 * feed uses `workspaceId`, other views use `id`) and some wrap the record
 * under `workspace`. Guessing one spelling and being wrong fails SILENTLY —
 * the worktree registers, nothing opens, and the button looks dead — so accept
 * the known shapes and return undefined rather than a broken id when none match.
 *
 * @param view - the create call's result.
 * @returns the workspace id, or undefined when the shape is unrecognised.
 */
export function workspaceIdOf(view: unknown): string | undefined {
  if (typeof view !== 'object' || view === null) return undefined
  const outer = view as { workspace?: unknown; workspaceId?: unknown; id?: unknown }
  const inner =
    typeof outer.workspace === 'object' && outer.workspace !== null
      ? (outer.workspace as { workspaceId?: unknown; id?: unknown })
      : outer
  for (const candidate of [inner.workspaceId, inner.id]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * Where to place the branch menu's left edge so it stays on screen.
 *
 * Pure and exported because the browser probe cannot honestly test it: a probe
 * that re-implements this arithmetic to position a fixture is only testing its
 * own copy. Geometry that depends on CSS belongs in the headless probe; a clamp
 * is arithmetic and belongs in the smoke test.
 *
 * @param anchorLeft - the button's left edge in viewport coordinates.
 * @param viewportWidth - the window's inner width.
 * @param width - the menu's fixed width.
 * @returns the clamped left offset, never off either edge.
 */
export function menuLeft(anchorLeft: number, viewportWidth: number, width: number): number {
  const GUTTER = 8
  // Math.max last: with a viewport narrower than the menu the min() result goes
  // negative, and the gutter has to win over the right-edge fit rather than the
  // other way round -- otherwise a very narrow tab pushes the menu off-screen
  // to the LEFT, which is harder to notice than overflowing to the right.
  return Math.max(GUTTER, Math.min(anchorLeft, viewportWidth - width - GUTTER))
}

/** Describe a branch's divergence for the menu's secondary column. */
export function branchTrack(branch: GitBranch): string {
  if (branch.upstream === undefined) return ''
  const ahead = branch.ahead ?? 0
  const behind = branch.behind ?? 0
  if (ahead === 0 && behind === 0) return 'in sync'
  return [ahead > 0 ? '↑' + ahead : '', behind > 0 ? '↓' + behind : ''].filter(Boolean).join(' ')
}

/**
 * The branch menu: switch, create, and merge, anchored to the branch button.
 *
 * Rendered as position: fixed off the anchor's own rect rather than absolutely
 * inside the header, because the tab sits inside the shell's scrolling panels
 * and an absolute popup is clipped by the first ancestor with overflow set.
 */
function BranchMenu({
  anchor,
  branches,
  loading,
  error,
  currentBranch,
  busy,
  onClose,
  onSwitch,
  onCreate,
  onMerge,
  onDelete,
}: {
  anchor: DOMRect
  branches: GitBranch[]
  loading: boolean
  error: string | null
  currentBranch: string | undefined
  busy: string | null
  onClose: () => void
  onSwitch: (name: string) => void
  onCreate: () => void
  onMerge: (name: string) => void
  onDelete: (name: string) => void
}): React.JSX.Element {
  const [filter, setFilter] = React.useState('')
  const [focused, setFocused] = React.useState(0)
  const ref = React.useRef<HTMLDivElement | null>(null)

  // Close on any click that is not inside the menu, and on Escape. Both are
  // registered on the document because the click that dismisses a popup is by
  // definition somewhere else.
  React.useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const local = branches.filter((b) => !b.remote)
  const shown = local.filter((b) => b.name.toLowerCase().includes(filter.trim().toLowerCase()))
  const others = shown.filter((b) => !b.current)

  const onKeyDown = (event: React.KeyboardEvent): void => {
    // The shell binds global shortcuts; a menu must not leak keys to them.
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setFocused((i) => Math.max(0, Math.min(others.length - 1, i + delta)))
      return
    }
    if (event.key === 'Enter' && others[focused]) {
      event.preventDefault()
      onSwitch(others[focused].name)
    }
  }

  // Keep the menu on screen: anchored under the button, nudged left when it
  // would otherwise run past the viewport's right edge.
  const width = 300
  const left = menuLeft(anchor.left, typeof window !== 'undefined' ? window.innerWidth : 1200, width)

  return (
    <div
      ref={ref}
      className="dshgit-menu"
      role="menu"
      aria-label="Branches"
      style={{ left, top: anchor.bottom + 4, width }}
      onKeyDown={onKeyDown}
    >
      <input
        className="dshgit-menu-filter"
        value={filter}
        placeholder="Filter branches…"
        aria-label="Filter branches"
        autoFocus
        onChange={(e) => {
          setFilter(e.target.value)
          setFocused(0)
        }}
      />
      {error !== null ? (
        <div className="dshgit-menu-empty dshgit-loadingrow err">Couldn&apos;t read branches — {error}</div>
      ) : loading && branches.length === 0 ? (
        <div className="dshgit-menu-empty">Reading branches…</div>
      ) : (
        <>
          {others.length === 0 ? (
            <div className="dshgit-menu-empty">
              {local.length <= 1 ? 'No other branches yet.' : 'No branch matches that filter.'}
            </div>
          ) : (
            <>
              <div className="dshgit-menu-head">Switch to</div>
              {others.map((branch, index) => (
                <button
                  key={branch.name}
                  className={'dshgit-menu-item' + (index === focused ? ' focused' : '')}
                  role="menuitem"
                  disabled={busy !== null}
                  onMouseEnter={() => setFocused(index)}
                  onClick={() => onSwitch(branch.name)}
                >
                  <Icon path={ICON.branch} />
                  <span className="dshgit-menu-label">{branch.name}</span>
                  <span className="dshgit-menu-sub">{branchTrack(branch)}</span>
                </button>
              ))}
            </>
          )}
          <div className="dshgit-menu-divider" />
          <button className="dshgit-menu-item" role="menuitem" disabled={busy !== null} onClick={onCreate}>
            <Icon path={ICON.plus} />
            <span className="dshgit-menu-label">Create branch…</span>
          </button>
          {others.length > 0 ? (
            <>
              <div className="dshgit-menu-head">Merge into {currentBranch ?? 'HEAD'}</div>
              {others.map((branch) => (
                <button
                  key={'merge:' + branch.name}
                  className="dshgit-menu-item"
                  role="menuitem"
                  disabled={busy !== null}
                  onClick={() => onMerge(branch.name)}
                >
                  <Icon path={ICON.merge} />
                  <span className="dshgit-menu-label">{branch.name}</span>
                </button>
              ))}
              <div className="dshgit-menu-divider" />
              <div className="dshgit-menu-head">Delete</div>
              {others.map((branch) => (
                <button
                  key={'del:' + branch.name}
                  className="dshgit-menu-item"
                  role="menuitem"
                  disabled={busy !== null}
                  onClick={() => onDelete(branch.name)}
                >
                  <Icon path={ICON.trash} />
                  <span className="dshgit-menu-label">{branch.name}</span>
                </button>
              ))}
            </>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * The Repo pane: stashes and worktrees.
 *
 * Both lists reuse the file row's box, so they inherit the 32px height and 20px
 * line-height the icon probe pins rather than introducing a second row rhythm
 * beside the Changes list.
 */
function RepoPane({
  refs,
  loading,
  busy,
  onStash,
  onWorktree,
  onAddWorktree,
  onOpenWorktree,
}: {
  refs: RefsResult | null
  loading: boolean
  busy: string | null
  onStash: (action: StashAction, index?: number) => void
  onWorktree: (action: WorktreeAction, path?: string, force?: boolean) => void
  onAddWorktree: () => void
  /**
   * Open a worktree as a workspace and switch to it.
   *
   * Absent when the shell did not supply a workspaces service, in which case the
   * button is not rendered at all rather than rendered dead.
   */
  onOpenWorktree?: ((path: string) => void) | undefined
}): React.JSX.Element {
  if (refs === null && loading) {
    return <div className="dshgit-loadingrow">Reading branches, stashes and worktrees…</div>
  }
  // A failed read must never render as an empty repository: that is exactly how
  // a host half older than this bundle looks, and "no stashes" would be a lie.
  if (refs !== null && !refs.ok) {
    return (
      <div className="dshgit-loadingrow err">
        Couldn&apos;t read this repository — {refs.error}
      </div>
    )
  }
  const stashes: GitStash[] = refs?.ok ? refs.stashes : []
  const worktrees: GitWorktree[] = refs?.ok ? refs.worktrees : []

  return (
    <>
      <div className="dshgit-section">
        <div className="dshgit-sechead">
          <span>Stashes</span>
          {stashes.length > 0 ? <span className="dshgit-badge-count">{stashes.length}</span> : null}
          <span className="dshgit-spacer" />
          <span className="dshgit-secbtns">
            <button
              className="dshgit-icon"
              title="Stash all changes, including untracked files"
              aria-label="Stash all changes"
              disabled={busy !== null}
              onClick={() => onStash('push')}
            >
              <Icon path={ICON.plus} />
            </button>
          </span>
        </div>
        {stashes.length === 0 ? (
          <div className="dshgit-loadingrow">Nothing stashed.</div>
        ) : (
          <ul className="dshgit-list">
            {stashes.map((stash) => (
              <li className="dshgit-row" key={stash.index}>
                <span className="dshgit-code A" aria-hidden="true">
                  <Icon path={ICON.stash} />
                </span>
                <span className="dshgit-rowmain" title={stash.message}>
                  {stash.message}
                </span>
                {stash.date !== undefined ? (
                  <span className="dshgit-rowmeta">{fmtAge(stash.date)}</span>
                ) : null}
                <span className="dshgit-rowbtns">
                  <button
                    className="dshgit-icon"
                    title="Apply this stash and remove it"
                    aria-label={'Pop stash ' + stash.index}
                    disabled={busy !== null}
                    onClick={() => onStash('pop', stash.index)}
                  >
                    <Icon path={ICON.check} />
                  </button>
                  <button
                    className="dshgit-icon"
                    title="Apply this stash but keep it"
                    aria-label={'Apply stash ' + stash.index}
                    disabled={busy !== null}
                    onClick={() => onStash('apply', stash.index)}
                  >
                    <Icon path={ICON.plus} />
                  </button>
                  <button
                    className="dshgit-icon danger"
                    title="Delete this stash"
                    aria-label={'Drop stash ' + stash.index}
                    disabled={busy !== null}
                    onClick={() => onStash('drop', stash.index)}
                  >
                    <Icon path={ICON.trash} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="dshgit-section">
        <div className="dshgit-sechead">
          <span>Worktrees</span>
          {worktrees.length > 0 ? (
            <span className="dshgit-badge-count">{worktrees.length}</span>
          ) : null}
          <span className="dshgit-spacer" />
          <span className="dshgit-secbtns">
            <button
              className="dshgit-icon"
              title="Add a worktree"
              aria-label="Add a worktree"
              disabled={busy !== null}
              onClick={onAddWorktree}
            >
              <Icon path={ICON.plus} />
            </button>
            <button
              className="dshgit-icon"
              title="Forget worktrees whose directory is gone"
              aria-label="Prune worktrees"
              disabled={busy !== null}
              onClick={() => onWorktree('prune')}
            >
              <Icon path={ICON.discard} />
            </button>
          </span>
        </div>
        <ul className="dshgit-list">
          {worktrees.map((tree) => (
            <li className="dshgit-row" key={tree.path}>
              <span className="dshgit-code R" aria-hidden="true">
                <Icon path={ICON.tree} />
              </span>
              <span className="dshgit-rowmain" title={tree.path}>
                {tree.branch ?? baseName(tree.path)}
              </span>
              <span className="dshgit-rowmeta" title={tree.path}>
                {tree.path}
              </span>
              {tree.current ? <span className="dshgit-tag ok">current</span> : null}
              {tree.prunable ? <span className="dshgit-tag warn">missing</span> : null}
              {tree.locked ? <span className="dshgit-tag">locked</span> : null}
              <span className="dshgit-rowbtns">
                {/* Listing worktrees without a way to reach one made the feature
                    read-only: a worktree IS a workspace, so opening it is the
                    point of having it. The current one is already open. */}
                {onOpenWorktree !== undefined && !tree.current ? (
                  <button
                    className="dshgit-icon"
                    title={'Open ' + tree.path + ' as a workspace'}
                    aria-label={'Open worktree ' + tree.path}
                    disabled={busy !== null || tree.prunable}
                    onClick={() => onOpenWorktree(tree.path)}
                  >
                    <Icon path={ICON.open} />
                  </button>
                ) : null}
                {/* The main worktree cannot be removed, and git refuses it —
                    disabling here explains why instead of offering a dead click. */}
                <button
                  className="dshgit-icon danger"
                  title={tree.main ? 'The main worktree cannot be removed' : 'Remove this worktree'}
                  aria-label={'Remove worktree ' + tree.path}
                  disabled={busy !== null || tree.main}
                  onClick={() => onWorktree('remove', tree.path)}
                >
                  <Icon path={ICON.trash} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

export function GitView({
  store,
  openWorktree,
  workspaceLink,
}: {
  store: GitStore | null
  /** Supplied by apply() from ctx.workspaces; absent in tests and in a shell without it. */
  openWorktree?: ((path: string) => void) | undefined
  /**
   * Registry access for the worktree rows, supplied by apply().
   *
   * Absent means the tab simply does not offer to clean up the workspace, which
   * is the old behaviour — never a dead button.
   */
  workspaceLink?:
    | {
        find: (path: string) => { workspaceId: string; title: string } | undefined
        remove: (workspaceId: string) => Promise<void>
      }
    | undefined
}): React.JSX.Element {
  const [message, setMessage] = React.useState('')
  const [branch, setBranch] = React.useState('main')
  const [selected, setSelected] = React.useState<string | null>(null)
  const [patch, setPatch] = React.useState<string>('')
  // Loading is its own flag rather than a sentinel string in `patch`, so a real
  // diff whose text happens to read "Loading diff…" cannot render as a skeleton.
  const [loading, setLoading] = React.useState(false)
  const [mode, setMode] = React.useState<'changes' | 'history' | 'repo'>('changes')
  // Anchor rect for the branch menu; null means closed. Held as a rect rather
  // than a boolean because the menu is position: fixed and needs the button's
  // on-screen box, which is only meaningful at the moment it was opened.
  const [menuRect, setMenuRect] = React.useState<DOMRect | null>(null)
  const branchBtn = React.useRef<HTMLButtonElement | null>(null)
  const [newBranch, setNewBranch] = React.useState<string | null>(null)
  const [worktreeForm, setWorktreeForm] = React.useState<{
    path: string
    branch: string
    register: boolean
    /**
     * Whether the user has typed their own path.
     *
     * Once true the branch field stops rewriting it. Auto-fill that keeps
     * overwriting a hand-typed path is worse than no auto-fill at all.
     */
    pathTouched: boolean
  } | null>(null)
  const [openSha, setOpenSha] = React.useState<string | null>(null)
  // null means "still loading". Anything else is a settled outcome that knows
  // whether it succeeded, so a loading commit, an empty commit, and a failed
  // lookup are three distinct renders rather than one ambiguous blank.
  const [commitFiles, setCommitFiles] = React.useState<CommitFilesOutcome | null>(null)

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

  // Monotonic click counter, shared by every pane that writes the diff.
  //
  // It must be SHARED rather than per-pane: switching modes or expanding another
  // commit while a patch is in flight has to invalidate that reply too, and two
  // independent counters could each believe their own reply was the newest.
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

  /** Expand or collapse one commit, loading its files on expand. */
  const toggleCommit = React.useCallback(
    (sha: string) => {
      if (!store) return
      if (openSha === sha) {
        setOpenSha(null)
        setCommitFiles(null)
        return
      }
      setOpenSha(sha)
      setCommitFiles(null)
      // Stamped with the same counter as the diff: expanding another commit
      // while this list is in flight must discard the slower reply, or a late
      // one would paint the wrong commit's files under the right sha.
      requestSeq.current += 1
      const seq = requestSeq.current
      void store.commitFiles(sha).then((outcome) => {
        if (seq !== requestSeq.current) return
        setCommitFiles(outcome)
      })
    },
    [store, openSha],
  )

  /** Load one file's patch from a commit into the diff pane. */
  const openCommitDiff = React.useCallback(
    (sha: string, path: string) => {
      if (!store) return
      const key = `${sha}:${path}`
      if (selected === key) {
        requestSeq.current += 1
        setSelected(null)
        setPatch('')
        setLoading(false)
        return
      }
      setSelected(key)
      setPatch('')
      setLoading(true)
      requestSeq.current += 1
      const seq = requestSeq.current
      void store.commitDiff(sha, path).then((text) => {
        if (seq !== requestSeq.current) return
        setPatch(text.trim().length === 0 ? 'No textual changes.' : text)
        setLoading(false)
      })
    },
    [store, selected],
  )

  /**
   * Switch panes, dropping any open diff.
   *
   * The selection key means different things in the two modes ("staged:path"
   * versus "sha:path"), so carrying one across would leave the other pane
   * showing a patch it cannot match to any row it renders.
   */
  const switchMode = React.useCallback((next: 'changes' | 'history' | 'repo') => {
    requestSeq.current += 1
    setMode(next)
    setSelected(null)
    setPatch('')
    setLoading(false)
  }, [])

  // Keep the branch/stash/worktree lists fresh only while something shows them.
  // They are re-read after every command and whenever the repository moves, but
  // never polled: nobody is looking at them most of the time.
  React.useEffect(() => {
    if (!store) return
    if (mode !== 'repo' && menuRect === null) return
    return store.wantRefs()
  }, [store, mode, menuRect])

  // A file that stops being changed (staged, discarded, committed) must not
  // leave a stale patch on screen.
  const status = state.status
  //
  // Scoped to the changes pane: a commit's paths are history, not working-tree
  // entries, so testing them against status.files would close every commit diff
  // the moment it opened.
  React.useEffect(() => {
    if (mode !== 'changes' || selected === null || !status || !status.repo) return
    const [, path] = splitKey(selected)
    if (!status.files.some((f) => f.path === path)) {
      requestSeq.current += 1
      setSelected(null)
      setPatch('')
      setLoading(false)
    }
  }, [status, selected, mode])

  // A commit can leave the recent window entirely — a rebase, a reset, or simply
  // fifteen newer commits — and an expansion left pointing at it would show a
  // file list belonging to nothing on screen.
  React.useEffect(() => {
    if (openSha === null || !status || !status.repo) return
    if (!status.recent.some((c) => c.sha === openSha)) {
      requestSeq.current += 1
      setOpenSha(null)
      setCommitFiles(null)
      if (selected !== null && splitKey(selected)[0] === openSha) {
        setSelected(null)
        setPatch('')
        setLoading(false)
      }
    }
  }, [status, openSha, selected])

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

  // Resolved with the SAME function the host uses to build the git command, so
  // the path shown and the directory created cannot disagree.
  const worktreePreview = resolveWorktreeTarget(status.root, worktreeForm?.path ?? '')

  const counts = countChanges(status.files)
  const staged = stagedFiles(status.files)
  const unstaged = unstagedFiles(status.files)
  const conflicts = conflictedFiles(status.files)
  const busy = state.busy
  const commitEnabled = canCommit(status, message) && busy === null
  const blocker = commitBlocker(status, message)
  const up = status.upstream

  /**
   * Draft a branch name from the rough text already in the branch box.
   *
   * The field doubles as the hint input: type "fix login retry", press the
   * sparkle, and it becomes "fix/login-retry". One field rather than two,
   * because a separate hint box would sit empty and unexplained the rest of
   * the time.
   */
  const draftWorktreeBranch = async (): Promise<void> => {
    const form = worktreeForm
    if (form === null || form.branch.trim().length === 0) return
    const name = await store.suggestBranch(form.branch)
    // An empty answer means it failed and already reported why; leave the
    // user's own text alone rather than blanking it.
    if (name.length === 0) return
    setWorktreeForm((current) =>
      current === null
        ? current
        : {
            ...current,
            branch: name,
            ...(current.pathTouched ? {} : { path: suggestWorktreePath(status.root, name) }),
          },
    )
  }
  /** Commit the index, then clear the box only if the commit actually landed. */
  const doCommit = async (): Promise<void> => {
    const text = message.trim()
    if (!text || counts.staged === 0) return
    await store.commit(text)
    setMessage('')
  }

  const doSuggest = async (): Promise<void> => {
    const text = await store.suggest()
    if (text) setMessage(text)
  }

  return (
    <div className={`dshgit${selected !== null ? ' diffopen' : ''}`}>
      <div className="dshgit-head">
        <button
          ref={branchBtn}
          className="dshgit-branchbtn"
          title={status.root}
          aria-haspopup="menu"
          aria-expanded={menuRect !== null}
          onClick={() =>
            setMenuRect((open) =>
              open !== null ? null : (branchBtn.current?.getBoundingClientRect() ?? null),
            )
          }
        >
          <BranchIcon />
          <span className="dshgit-branchname">{branchSummary(status)}</span>
          <span className="dshgit-caret">
            <Icon path={ICON.caret} />
          </span>
        </button>
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

      <div className="dshgit-modes" role="group" aria-label="Source control view">
        <button
          className="dshgit-mode"
          aria-pressed={mode === 'changes'}
          onClick={() => switchMode('changes')}
        >
          Changes
          {counts.total > 0 ? <span className="dshgit-badge-count">{counts.total}</span> : null}
        </button>
        <button
          className="dshgit-mode"
          aria-pressed={mode === 'history'}
          onClick={() => switchMode('history')}
        >
          History
        </button>
        <button
          className="dshgit-mode"
          aria-pressed={mode === 'repo'}
          onClick={() => switchMode('repo')}
        >
          Repo
          {/* The count rides on status, so the badge is correct before the pane
              has ever been opened and its lists fetched. */}
          {(status.stashCount ?? 0) > 0 ? (
            <span className="dshgit-badge-count">{status.stashCount}</span>
          ) : null}
        </button>
      </div>

      {/* Banners sit between the switcher and the panes: a merge in progress and
          a refused switch are both facts about the whole tab, not about one pane. */}
      {status.merging === true ? (
        <div className="dshgit-banner" role="status">
          <span className="dshgit-banner-icon">
            <Icon path={ICON.warn} />
          </span>
          <span className="dshgit-banner-text">
            Merge in progress
            <div className="dshgit-banner-what">
              {status.mergeHead ?? 'Resolve any conflicts, stage them, then commit.'}
            </div>
          </span>
          <button
            className="dshgit-btn"
            title="Finish the merge, reusing git's own merge message"
            disabled={busy !== null || counts.conflicted > 0}
            onClick={() => void store.merge('continue')}
          >
            {busy === 'merge:continue' ? '…' : 'Continue'}
          </button>
          <button
            className="dshgit-btn"
            title="Abandon the merge and restore the pre-merge state"
            disabled={busy !== null}
            onClick={() => {
              if (!confirmAction('Abort this merge? Any conflict resolutions are discarded.')) return
              void store.merge('abort')
            }}
          >
            {busy === 'merge:abort' ? '…' : 'Abort'}
          </button>
        </div>
      ) : null}

      {/* Git refused the switch; offer the stash EXPLICITLY rather than having
          done it silently. */}
      {state.pendingSwitch !== null ? (
        <div className="dshgit-banner" role="status">
          <span className="dshgit-banner-icon">
            <Icon path={ICON.warn} />
          </span>
          <span className="dshgit-banner-text">
            Can&apos;t switch to {state.pendingSwitch} with uncommitted changes
            <div className="dshgit-banner-what">
              Stash them first and they stay safe in the Repo tab.
            </div>
          </span>
          <button
            className="dshgit-btn primary"
            disabled={busy !== null}
            onClick={() => {
              const target = state.pendingSwitch
              if (target === null) return
              store.clearPendingSwitch()
              void store.branch('stashSwitch', { name: target })
            }}
          >
            {busy === 'branch:stashSwitch' ? 'Stashing…' : 'Stash changes and switch'}
          </button>
          <button className="dshgit-btn" onClick={() => store.clearPendingSwitch()}>
            Dismiss
          </button>
        </div>
      ) : null}

      {newBranch !== null ? (
        <div className="dshgit-form">
          <input
            type="text"
            value={newBranch}
            autoFocus
            placeholder="new-branch-name"
            aria-label="New branch name"
            onChange={(e) => setNewBranch(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setNewBranch(null)
              if (e.key === 'Enter' && newBranch.trim().length > 0) {
                void store.branch('createSwitch', { name: newBranch.trim() })
                setNewBranch(null)
              }
            }}
          />
          <button
            className="dshgit-btn primary"
            disabled={busy !== null || newBranch.trim().length === 0}
            onClick={() => {
              void store.branch('createSwitch', { name: newBranch.trim() })
              setNewBranch(null)
            }}
          >
            Create and switch
          </button>
          <button className="dshgit-btn" onClick={() => setNewBranch(null)}>
            Cancel
          </button>
        </div>
      ) : null}

      {worktreeForm !== null ? (
        <div className="dshgit-form">
          <input
            type="text"
            value={worktreeForm.path}
            autoFocus
            placeholder={suggestWorktreePath(status.root, 'my-branch')}
            aria-label="Worktree directory"
            onChange={(e) =>
              setWorktreeForm({ ...worktreeForm, path: e.target.value, pathTouched: true })
            }
            onKeyDown={(e) => e.stopPropagation()}
          />
          <input
            type="text"
            value={worktreeForm.branch}
            placeholder="new branch name"
            aria-label="Branch for the new worktree"
            onChange={(e) => {
              const branch = e.target.value
              setWorktreeForm({
                ...worktreeForm,
                branch,
                // Name the directory after the branch, as a sibling of the
                // project, so it sorts next to it in the workspace switcher —
                // unless the user has already chosen a path themselves.
                ...(worktreeForm.pathTouched
                  ? {}
                  : { path: suggestWorktreePath(status.root, branch) }),
              })
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && worktreeForm.branch.trim().length > 0) {
                e.preventDefault()
                void draftWorktreeBranch()
              }
            }}
          />
          <button
            className="dshgit-btn ai"
            title="Describe the work in the branch box, then let the model name the branch"
            disabled={busy !== null || worktreeForm.branch.trim().length === 0}
            onClick={() => void draftWorktreeBranch()}
          >
            {busy === 'suggestBranch' ? (
              <span className="dshgit-spin">
                <Icon path={ICON.sparkle} />
              </span>
            ) : (
              <Icon path={ICON.sparkle} />
            )}
            {busy === 'suggestBranch' ? 'Naming…' : 'AI name'}
          </button>
          <label className="dshgit-check">
            <input
              type="checkbox"
              checked={worktreeForm.register}
              onChange={(e) => setWorktreeForm({ ...worktreeForm, register: e.target.checked })}
            />
            Open it after creating
          </label>
          <button
            className="dshgit-btn primary"
            disabled={busy !== null || worktreeForm.path.trim().length === 0 || worktreePreview.inside}
            onClick={() => {
              const form = worktreeForm
              const target = worktreePreview.path
              setWorktreeForm(null)
              void store
                .worktree('add', {
                  path: form.path.trim(),
                  ...(form.branch.trim().length > 0 ? { newBranch: form.branch.trim() } : {}),
                  // `register` is deliberately NOT sent. The host would write
                  // workspaceRegistry directly, which the browser's own workspace
                  // list is not guaranteed to learn about until a reload; going
                  // through ctx.workspaces below keeps that list coherent.
                })
                .then((result) => {
                  if (result?.ok && form.register && openWorktree) openWorktree(target)
                })
            }}
          >
            Add worktree
          </button>
          <button className="dshgit-btn" onClick={() => setWorktreeForm(null)}>
            Cancel
          </button>
          {/* Show where it will actually land. "Where does ../x go?" is not a
              question a user should have to answer by trying it. */}
          <div className={'dshgit-preview' + (worktreePreview.inside ? ' err' : '')}>
            {worktreeForm.path.trim().length === 0
              ? 'Relative to the repository, like a terminal opened here.'
              : worktreePreview.inside
                ? 'Inside the repository — pick a path beside it, such as ../' +
                  (worktreeForm.path.trim().split('/').pop() || 'worktree-test')
                : worktreePreview.path}
          </div>
        </div>
      ) : null}

      {mode === 'changes' ? (
      <div className="dshgit-commit">
        <textarea
          className="dshgit-msg"
          value={message}
          placeholder={
            counts.staged > 0
              ? `Commit ${counts.staged} staged file${counts.staged === 1 ? '' : 's'}…`
              : 'Stage a file to commit — AI can draft the message first'
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
            title={
              counts.staged > 0
                ? 'Generate a commit message from the staged changes'
                : 'Generate a commit message from all uncommitted changes'
            }
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
          {/* Only the structural blockers are worth stating out loud; an empty
              message box already explains itself. */}
          {counts.conflicted > 0 || counts.staged === 0 ? (
            <span className="dshgit-hint">{blocker}</span>
          ) : null}
          <button
            className="dshgit-btn primary"
            title={blocker || `Commit ${counts.staged} staged file${counts.staged === 1 ? '' : 's'}`}
            disabled={!commitEnabled}
            onClick={() => void doCommit()}
          >
            {busy === 'commit' ? 'Committing…' : counts.staged > 0 ? `Commit ${counts.staged}` : 'Commit'}
          </button>
        </div>
      </div>
      ) : null}

      <div className={`dshgit-panes${selected !== null ? ' hasdiff' : ''}`}>
        <div className="dshgit-scroll">
          {mode === 'repo' ? (
            <RepoPane
              refs={state.refs}
              loading={state.refsLoading}
              busy={busy}
              onStash={(action, index) => {
                if (action === 'drop' && !confirmAction('Delete this stash? It cannot be recovered.')) {
                  return
                }
                void store.stash(action, {
                  ...(index !== undefined ? { index } : {}),
                  // Stashing without -u leaves brand-new files behind, which is
                  // precisely the work someone stashing expects to be safe.
                  ...(action === 'push' ? { includeUntracked: true } : {}),
                })
              }}
              onWorktree={(action, path) => {
                if (action !== 'remove') {
                  void store.worktree(action, { ...(path !== undefined ? { path } : {}) })
                  return
                }
                if (path === undefined) return
                if (
                  !confirmAction('Remove this worktree? Uncommitted changes inside it are lost.')
                ) {
                  return
                }
                // Look the workspace up BEFORE removing anything, and ask now —
                // a second prompt after the directory is already gone reads as an
                // afterthought, and the user is deciding about one thing.
                const linked = workspaceLink?.find(path)
                const alsoUnregister =
                  linked !== undefined &&
                  confirmAction(
                    'Also remove the workspace "' +
                      linked.title +
                      '"? Otherwise it stays in your workspace list pointing at a directory ' +
                      'that no longer exists. Its sessions are kept.',
                  )
                void store.worktree('remove', { path }).then((result) => {
                  // ONLY unregister when the worktree actually went away. Git
                  // refuses removal of a dirty worktree, and unregistering one
                  // that still exists on disk is the opposite of the bug this
                  // fixes -- it would hide a live worktree from the list.
                  if (!alsoUnregister || linked === undefined) return
                  if (result === null || !result.ok) return
                  void workspaceLink?.remove(linked.workspaceId)
                })
              }}
              onAddWorktree={() =>
                setWorktreeForm({ path: '', branch: '', register: true, pathTouched: false })
              }
              onOpenWorktree={openWorktree}
            />
          ) : mode === 'history' ? (
            <HistoryPane
              commits={status.recent}
              openSha={openSha}
              onToggle={toggleCommit}
              files={commitFiles}
              selected={selected}
              onOpenFile={openCommitDiff}
            />
          ) : counts.total === 0 ? (
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
              {mode === 'history' ? (
                <span className="dshgit-sha">{splitKey(selected)[0]}</span>
              ) : null}
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

      {menuRect !== null ? (
        <BranchMenu
          anchor={menuRect}
          branches={state.refs?.ok ? state.refs.branches : []}
          loading={state.refsLoading}
          error={state.refs !== null && !state.refs.ok ? state.refs.error : null}
          currentBranch={status.branch}
          busy={busy}
          onClose={() => setMenuRect(null)}
          onSwitch={(name) => {
            setMenuRect(null)
            void store.switchBranch(name)
          }}
          onCreate={() => {
            setMenuRect(null)
            setNewBranch('')
          }}
          onMerge={(name) => {
            setMenuRect(null)
            void store.merge('merge', { from: name })
          }}
          onDelete={(name) => {
            setMenuRect(null)
            if (!confirmAction('Delete branch "' + name + '"? Unmerged commits on it are lost.')) {
              return
            }
            void store.branch('delete', { name })
          }}
        />
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
  refs: null,
  refsLoading: false,
  pendingSwitch: null,
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
        workspaces: {
          list: { getSnapshot(): { items: readonly unknown[] } }
          /**
           * Register a path as a workspace. Documented as idempotent — an
           * existing canonical path resolves to its current record — which is
           * what lets ONE call serve both a worktree dsh already knows and one
           * it has never seen.
           */
          create(input: { path: string }): Promise<unknown>
          /** Connect a workspace and OPEN its session; this is what switches the UI. */
          startSession(workspaceId: string): void
          /** Remove a workspace from the registry; its sessions are kept. */
          delete(workspaceId: string): Promise<void>
        }
        remote: Record<string, GitRemote>
      }
      /**
       * Open a worktree directory as a workspace and switch the shell to it.
       *
       * Two calls, because a worktree is only useful if you can get INTO it and
       * in dsh a directory is reached by being a workspace. `create` is
       * idempotent, so this one path covers a worktree registered earlier and one
       * made from a terminal that dsh has never seen — no "is it registered?"
       * branch to get wrong.
       *
       * Registration happens HERE rather than on the host (which can also write
       * the registry) because this is the browser's own workspaces domain: a
       * host-side write is not guaranteed to reach this list without a reload,
       * and a workspace that exists but is not listed is worse than one that
       * does not exist.
       * @param path - absolute worktree directory.
       */
      const openWorktree = (path: string): void => {
        void (async () => {
          try {
            const view = await readyCtx.workspaces.create({ path })
            const id = workspaceIdOf(view)
            if (id !== undefined) readyCtx.workspaces.startSession(id)
            else console.error('dsh-git: workspace created but returned no id', view)
          } catch (error) {
            console.error('dsh-git: could not open worktree as a workspace', error)
          }
        })()
      }

      /**
       * Registry access for worktree rows: find the workspace at a path, and
       * remove it. Read fresh from the list on every call rather than captured,
       * because the list changes as worktrees are opened and removed.
       */
      const workspaceLink = {
        find: (path: string) =>
          findWorkspaceForPath(
            readyCtx.workspaces.list.getSnapshot().items as readonly {
              workspaceId?: unknown
              path?: unknown
              title?: unknown
            }[],
            path,
          ),
        remove: async (workspaceId: string): Promise<void> => {
          try {
            await readyCtx.workspaces.delete(workspaceId)
          } catch (error) {
            // The worktree is already gone by this point, so a failed
            // unregister must not read as a failed removal.
            console.error('dsh-git: could not remove the workspace', error)
          }
        },
      }
      readyCtx.slots.inject('conversation.view', () =>
        readyCtx.slots.register(
          {
            name: 'conversation.view',
            id: 'git',
            order: 30,
            label: () => 'Source Control',
            inject: (sessionId: string) => {
              const workspaces = readyCtx.workspaces.list.getSnapshot().items as readonly {
                workspaceId: string
                sessionIds: readonly string[]
              }[]
              const workspaceId = workspaceIdForSession(workspaces, sessionId)
              if (workspaceId === undefined) return { store: null, openWorktree, workspaceLink }
              let store = stores.get(workspaceId)
              if (store === undefined) {
                store = new GitStore(readyCtx.remote.dshGit, workspaceId)
                stores.set(workspaceId, store)
              }
              return { store, openWorktree, workspaceLink }
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
