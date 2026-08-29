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
      /**
       * True while a merge is in progress and not yet concluded.
       *
       * Read from the presence of `MERGE_HEAD` in the git directory, NOT from a
       * git process: `status` runs on every change-token move, so anything added
       * here has to be free. It is a first-class field rather than something the
       * client infers from conflicts, because a merge with every conflict already
       * resolved has no conflicted files and is still very much in progress —
       * inferring it would hide exactly the state the Abort button exists for.
       *
       * OPTIONAL on purpose. The host always sets it, but the two halves deploy
       * at different speeds — a browser refresh ships the new client while the
       * host half needs a profile restart — so during that window the field is
       * genuinely absent. Typing it as required would let the client read
       * `undefined` as a boolean and render a merge banner it cannot dismiss.
       */
      merging?: boolean
      /**
       * What is being merged, as git itself describes it.
       *
       * The first line of `MERGE_MSG` (e.g. "Merge branch 'feature'"), because
       * `MERGE_HEAD` holds a bare sha that means nothing to a reader. Absent when
       * git wrote no message.
       */
      mergeHead?: string
      /**
       * How many stash entries exist.
       *
       * Counted from the `refs/stash` reflog, which IS git's stash list — this is
       * exact, not an estimate — and again without spawning git. Carried in
       * `status` so the Repo tab can show a badge without first fetching the
       * whole list.
       *
       * Optional for the same stale-host reason as {@link merging}.
       */
      stashCount?: number
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


/**
 * One branch as the tab lists it.
 *
 * Local and remote-tracking branches share one type because the branch menu
 * shows both in one list; `remote` is what lets it group them without a second
 * shape. Ahead/behind are omitted rather than zero-filled when git has no
 * upstream to compare against, so "in sync" and "no upstream" stay distinct.
 */
export interface GitBranch {
  /** Short name, e.g. `main` or `origin/main`. */
  name: string
  /** True for the branch HEAD currently points at. */
  current: boolean
  /** True for a remote-tracking branch rather than a local one. */
  remote: boolean
  /** Configured upstream ref, when this local branch has one. */
  upstream?: string
  /** Commits ahead of the upstream, absent when there is no upstream. */
  ahead?: number
  /** Commits behind the upstream, absent when there is no upstream. */
  behind?: number
  /** Subject of the commit this branch points at, for context in the menu. */
  subject?: string
}

/** One stash entry, in git's own newest-first order. */
export interface GitStash {
  /**
   * Position in the stash stack, which is also its address.
   *
   * Git addresses a stash as `stash@{index}`, and the index SHIFTS whenever an
   * earlier entry is dropped or popped — so it is a cursor into a live list, not
   * an identifier. The client must re-read after any mutation rather than reuse
   * an index it captured earlier.
   */
  index: number
  /** Message git recorded, e.g. `WIP on main: 1a2b3c4 subject`. */
  message: string
  /** Branch the stash was taken on, when git recorded one. */
  branch?: string
  /** Epoch ms of when it was stashed. */
  date?: number
}

/** One worktree attached to this repository. */
export interface GitWorktree {
  /** Absolute path of the worktree directory. */
  path: string
  /** Short branch name checked out there, absent on a detached HEAD. */
  branch?: string
  /** Commit the worktree's HEAD points at. */
  head?: string
  /** True for the main worktree, which cannot be removed. */
  main: boolean
  /** True when the directory is gone but the administrative entry remains. */
  prunable: boolean
  /** True when this worktree is locked against pruning. */
  locked: boolean
  /** True when this is the worktree the current workspace sits in. */
  current: boolean
}

/** `refs` request: read the branch, stash and worktree lists together. */
export interface RefsRequest {
  workspaceId: string
}

/**
 * `refs` reply — a discriminated outcome, never bare arrays.
 *
 * The same lesson `commitFiles` paid for: a client bundle newer than the host
 * half 404s these endpoints, and collapsing that into empty arrays renders as
 * "this repository has no branches" instead of "restart the profile". A repo
 * genuinely having no stashes and the lookup having failed must not look alike.
 */
export type RefsResult =
  | {
      ok: true
      branches: GitBranch[]
      stashes: GitStash[]
      worktrees: GitWorktree[]
    }
  | {
      ok: false
      /** Why the lookup failed, shown verbatim in the pane. */
      error: string
    }

/** Which branch operation to run. */
export type BranchAction =
  | 'create'
  | 'switch'
  | 'createSwitch'
  | 'delete'
  | 'rename'
  /**
   * Stash the working tree, then switch — the explicit second step offered
   * after a plain `switch` was refused. Never taken implicitly: an auto-stash
   * whose later pop conflicts strands work the user never chose to hide.
   */
  | 'stashSwitch'

/** `branch` request. */
export interface BranchRequest {
  workspaceId: string
  action: BranchAction
  /** Branch to act on; the NEW name for `rename`. */
  name?: string
  /** Where a created branch starts, defaulting to the current HEAD. */
  startPoint?: string
  /** Force a delete of a branch that is not fully merged. */
  force?: boolean
}

/** Which merge operation to run. */
export type MergeAction = 'merge' | 'abort' | 'continue'

/** `merge` request. */
export interface MergeRequest {
  workspaceId: string
  action: MergeAction
  /** Branch merged INTO the current one; required for `merge`. */
  from?: string
  /** Force a merge commit even when a fast-forward was possible. */
  noFF?: boolean
}


/** A worktree target, resolved and classified. */
export interface WorktreeTarget {
  /** Absolute path, forward-slashed. */
  path: string
  /** True when the target sits inside the repository's own working tree. */
  inside: boolean
}

/**
 * Resolve a worktree path the way a terminal at the repository ROOT would.
 *
 * This lives in types.ts -- the dependency-free module -- deliberately: the host
 * needs it to build the git command and the browser needs it to show the user
 * where their input will land, and two implementations of the same arithmetic
 * would drift. The host cannot simply own it (the browser has no node:path) and
 * the browser must not own it (the host is the security boundary), so neither
 * half owns it and both import it.
 *
 * Resolution is relative to the repository ROOT, not its parent. That is the
 * only spelling that matches what someone typing the path means: running
 * "git worktree add ../feature" where the repository is puts the worktree BESIDE
 * it. Resolving against the parent instead applies the ".." twice, so
 * "../feature" silently lands two levels up -- exactly the bug this replaced,
 * which shipped with a form placeholder that demonstrated it.
 *
 * @param root - repository working-tree root, absolute.
 * @param input - the user's path, absolute or relative to the root.
 * @returns the absolute target and whether it falls inside the repository.
 */
export function resolveWorktreeTarget(root: string, input: string): WorktreeTarget {
  const slash = (value: string): string => value.replace(/\\/g, '/')
  const rootPath = slash(root).replace(/\/+$/, '')
  const raw = slash(input.trim())

  // A Windows drive (C:/...), a UNC share (//host/share) or a POSIX root are
  // already absolute and must not be joined onto anything.
  const absolute = /^[A-Za-z]:\//.test(raw) || raw.startsWith('//') || raw.startsWith('/')
  const source = absolute ? raw : rootPath + '/' + raw

  // Keep the volume prefix out of the segment walk, so a stray ".." can never
  // chew through "C:" and yield a path with no drive at all.
  const drive = /^([A-Za-z]:)\//.exec(source)
  const unc = /^(\/\/[^/]+\/[^/]+)/.exec(source)
  const prefix = drive ? drive[1] : unc ? unc[1] : ''
  const body = source.slice(prefix.length)

  const out: string[] = []
  for (const segment of body.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      out.pop()
      continue
    }
    out.push(segment)
  }
  const path = prefix + '/' + out.join('/')

  // Compare case-insensitively: Windows paths differ only in case constantly,
  // and a containment check that misses on a drive letter's case would wave
  // through exactly the nested worktree this classification exists to catch.
  const norm = (value: string): string => value.replace(/\/+$/, '').toLowerCase()
  const inside = norm(path) === norm(rootPath) || norm(path).startsWith(norm(rootPath) + '/')

  return { path, inside }
}


/**
 * Suggest where a new worktree should live, from the branch it will check out.
 *
 * The convention is a SIBLING of the project named "<project>-<branch>":
 * "myproj" plus "feature/login" gives "../myproj-feature-login". Siblings are
 * the standard layout for an ordinary clone -- the tidier bare-repo layout
 * (project/.bare + project/main + project/feature) cannot be retrofitted onto
 * one, and a dsh workspace always points at an ordinary clone. The project
 * prefix is what makes the worktree sort next to its project in the workspace
 * switcher, which a central worktree store would lose.
 *
 * Flattening the branch is not cosmetic. A branch name may contain slashes, and
 * "../myproj-feature/login" would silently create a directory called
 * "myproj-feature" with the worktree nested inside it -- a layout nobody asked
 * for, discovered only after the fact.
 *
 * @param root - repository working-tree root.
 * @param branch - branch name the worktree will check out.
 * @returns a relative path suggestion, or an empty string when there is no usable branch.
 */
export function suggestWorktreePath(root: string, branch: string): string {
  const project = root.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean).pop()
  if (project === undefined || project.length === 0) return ''
  const clean = branch
    .trim()
    // Anything that is not safe in a directory name becomes a dash: slashes
    // above all, but also spaces and the punctuation git tolerates in refs.
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  if (clean.length === 0) return ''
  return '../' + project + '-' + clean
}

/** Which stash operation to run. */
export type StashAction = 'push' | 'pop' | 'apply' | 'drop' | 'clear'

/** `stash` request. */
export interface StashRequest {
  workspaceId: string
  action: StashAction
  /** Stash position for pop/apply/drop; defaults to the most recent. */
  index?: number
  /** Message for `push`. */
  message?: string
  /** Include untracked files when stashing. */
  includeUntracked?: boolean
}

/** Which worktree operation to run. */
export type WorktreeAction = 'add' | 'remove' | 'prune'

/** `worktree` request. */
export interface WorktreeRequest {
  workspaceId: string
  action: WorktreeAction
  /** Directory to add or remove. Relative paths resolve against the repo's PARENT. */
  path?: string
  /** Existing branch to check out in a new worktree. */
  branch?: string
  /** Create this branch in the new worktree instead of checking one out. */
  newBranch?: string
  /** Remove a worktree with local modifications. */
  force?: boolean
  /**
   * Register the new worktree as a dsh workspace.
   *
   * Opt-in, because it writes to dsh's own registry rather than to git — the
   * one place this plugin reaches outside the repository it was pointed at.
   */
  register?: boolean
}

/** Hard cap on diff bytes sent to the browser, so a huge patch cannot wedge the UI. */
export const MAX_DIFF_BYTES = 400_000

/** Hard cap on diff bytes handed to the model when writing a commit message. */
export const MAX_AI_DIFF_BYTES = 60_000

/** How many recent commits the tab shows. */
export const RECENT_COMMITS = 15
