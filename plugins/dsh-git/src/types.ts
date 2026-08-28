/**
 * Shared git vocabulary, imported by both halves.
 *
 * Deliberately dependency-free (no cordis, no react, no zod) so the host half,
 * the client half, and the smoke test can all import it without dragging a
 * runtime into the browser bundle.
 *
 * @module @dennisrongo/dsh-git/types
 */

/**
 * How one path differs from HEAD, as a two-slot porcelain code.
 *
 * These are git's own status letters, kept verbatim rather than translated to a
 * friendlier enum: the index and worktree columns are independent (a file can be
 * staged-modified AND worktree-modified at once), and any collapsing here would
 * destroy exactly the distinction the staging UI exists to show.
 */
export type GitStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!' | ' '

/** One changed path in the working tree. */
export interface GitFileChange {
  /** Repo-relative path, forward-slashed (git's own spelling). */
  path: string
  /** Previous path, present only for renames/copies. */
  origPath?: string
  /** Index (staged) column of the porcelain code. */
  index: GitStatusCode
  /** Worktree (unstaged) column of the porcelain code. */
  worktree: GitStatusCode
  /** True when the index column shows work ready to commit. */
  staged: boolean
  /** True when this path has a conflict git wants resolved before commit. */
  conflicted: boolean
  /** True when git has never tracked this path. */
  untracked: boolean
}

/** Where the branch stands against its configured upstream. */
export interface GitUpstream {
  /** Upstream ref name, e.g. `origin/main`. */
  name: string
  /** Commits the local branch has that the upstream does not. */
  ahead: number
  /** Commits the upstream has that the local branch does not. */
  behind: number
}

/**
 * The whole repository snapshot the tab renders.
 *
 * `repo: false` is a first-class state, not an error: an un-initialized
 * directory is the exact case the Initialize button exists for, so it must be
 * representable without failing the call.
 */
export type GitStatus =
  | {
      repo: false
      /** Absolute workspace directory that was probed. */
      root: string
    }
  | {
      repo: true
      /** Absolute path of the repository working-tree root. */
      root: string
      /** Current branch, or undefined on a detached HEAD. */
      branch?: string
      /** Short HEAD sha, absent on a repo with no commits yet. */
      head?: string
      /** True before the very first commit, when HEAD points nowhere. */
      unborn: boolean
      /** Upstream tracking facts, absent when no upstream is configured. */
      upstream?: GitUpstream
      /** Whether any remote at all is configured, which gates push/pull. */
      hasRemote: boolean
      /** Every changed path, staged and unstaged alike. */
      files: GitFileChange[]
      /** Recent commits, newest first, for context in the tab. */
      recent: GitCommit[]
    }

/** One commit in the short log. */
export interface GitCommit {
  sha: string
  subject: string
  author: string
  /** Epoch ms. */
  date: number
}

/** `status` request: probe one workspace. */
export interface StatusRequest {
  workspaceId: string
}

/** `status` reply. */
export interface StatusResult {
  status: GitStatus
}

/**
 * `changeToken` request: cheaply ask whether a repository has changed.
 *
 * This is the polling endpoint, so it must stay far cheaper than `status`: it
 * answers from a filesystem watcher and never spawns git.
 */
export interface ChangeTokenRequest {
  workspaceId: string
}

/** `changeToken` reply. */
export interface ChangeTokenResult {
  /**
   * Monotonic counter that advances when the repository changes.
   *
   * Comparable only against an earlier token for the same workspace; it counts
   * change bursts and carries no wall-clock meaning. `0` means "not a
   * repository", which lets the client stop polling a plain directory.
   */
  token: number
}

/**
 * One path touched by a single commit.
 *
 * Deliberately NOT a {@link GitFileChange}: a commit is already recorded, so the
 * staged/untracked/conflicted distinctions that exist to describe *pending* work
 * are all meaningless here. Only one status letter applies — what this commit
 * did to this path — and inventing an index/worktree pair to reuse the other
 * type would mean fabricating a column git never reported.
 */
export interface GitCommitFile {
  /** Repo-relative path, forward-slashed. */
  path: string
  /** Previous path, present only for renames/copies. */
  origPath?: string
  /** What the commit did to this path. */
  status: GitStatusCode
}

/** `commitFiles` request: which paths one commit touched. */
export interface CommitFilesRequest {
  workspaceId: string
  /** Commit to inspect, as a hex sha (short or full). */
  sha: string
}

/** `commitFiles` reply. */
export interface CommitFilesResult {
  files: GitCommitFile[]
}

/**
 * `commitDiff` request: the patch one commit introduced.
 *
 * With `path` omitted this is the whole commit, which is what the history pane
 * shows before any file is picked.
 */
export interface CommitDiffRequest {
  workspaceId: string
  sha: string
  /** Repo-relative path; omitted means every path in the commit. */
  path?: string
}

/** `commitDiff` reply: same shape as {@link DiffResult}, so one pane renders both. */
export interface CommitDiffResult {
  patch: string
  binary: boolean
}

/** `diff` request: the patch text for one path, or the whole tree. */
export interface DiffRequest {
  workspaceId: string
  /** Repo-relative path; omitted or empty means the whole tree. */
  path?: string
  /** Read the staged diff (index vs HEAD) instead of the worktree diff. */
  staged?: boolean
}

/** `diff` reply: unified patch text, empty when nothing differs. */
export interface DiffResult {
  patch: string
  /** True when the path is binary, in which case `patch` is a short notice. */
  binary: boolean
}

/** Which staging operation to perform. */
export type StageAction = 'stage' | 'unstage' | 'discard'

/** `stage` request: move paths between the worktree and the index. */
export interface StageRequest {
  workspaceId: string
  action: StageAction
  /** Repo-relative paths; an empty array means "everything". */
  paths: string[]
}

/** `commit` request. */
export interface CommitRequest {
  workspaceId: string
  message: string
  /**
   * Stage every tracked modification first (`git commit -a` semantics).
   *
   * The tab no longer sends this — its Commit button requires a non-empty
   * index — but the host still honours it for older clients.
   */
  all?: boolean
}

/** `suggestMessage` request: ask the model to describe the pending work. */
export interface SuggestRequest {
  workspaceId: string
  /**
   * Force the scope: the index when true, every uncommitted change when false.
   *
   * OMIT IT to get the right answer. The host then resolves the scope from a
   * fresh status read — staged when anything is staged, the whole tree when
   * the index is empty — which the browser cannot do without racing its own
   * snapshot against the disk.
   */
  staged?: boolean
}

/** Which set of changes a drafted commit message describes. */
export type ChangeScope = 'staged' | 'all'

/** `suggestMessage` reply. */
export interface SuggestResult {
  /** Conventional-commit style message: subject line, optional body. */
  message: string
  /** Which set of changes the message actually describes. */
  scope?: ChangeScope
}

/** Which sync operation to run against the remote. */
export type SyncAction = 'pull' | 'push' | 'fetch' | 'sync' | 'publish'

/** `sync` request. */
export interface SyncRequest {
  workspaceId: string
  action: SyncAction
}

/** `init` request: create a repository in the workspace directory. */
export interface InitRequest {
  workspaceId: string
  /** Initial branch name; defaults to `main`. */
  branch?: string
}

/**
 * The uniform reply for every mutating command.
 *
 * Failure is modelled as a value rather than a throw because git's non-zero
 * exits are ordinary, expected outcomes (nothing to commit, rejected push,
 * merge conflict) that the tab must render as text — not as a broken bridge.
 */
export interface CommandResult {
  ok: boolean
  /** Human-readable output, already trimmed; shown verbatim in the tab. */
  output: string
  /** Refreshed status, so a caller never needs a second round trip. */
  status: GitStatus
}

/** Hard cap on diff bytes sent to the browser, so a huge patch cannot wedge the UI. */
export const MAX_DIFF_BYTES = 400_000

/** Hard cap on diff bytes handed to the model when writing a commit message. */
export const MAX_AI_DIFF_BYTES = 60_000

/** How many recent commits the tab shows. */
export const RECENT_COMMITS = 15
