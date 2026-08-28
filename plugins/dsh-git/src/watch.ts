/**
 * Repository change detection: a filesystem watcher that answers "has anything
 * happened here?" without running git.
 *
 * The tab used to re-read status only when the user asked. Polling `status`
 * instead would spawn four git processes per tick per open tab, which is the
 * cost this module exists to avoid. Watching is event-driven and idles at zero,
 * so the expensive read happens only after the filesystem says it is warranted.
 *
 * The watcher deliberately publishes a monotonic TOKEN rather than the status
 * itself. A token comparison is an integer check the client can afford every
 * second; deriving what actually changed stays the client's decision, made once
 * per real change instead of once per poll.
 *
 * @module @dennisrongo/dsh-git/watch
 */
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

/**
 * Quiet period after an event before the token advances.
 *
 * A single logical action fires many events — git writes `index.lock`, the
 * index, then `ORIG_HEAD`; an editor save often writes a temp file and renames
 * it. Advancing per event would make the client re-read status several times for
 * one change, so events inside this window collapse into one bump.
 */
const DEBOUNCE_MS = 120

/**
 * Hard ceiling on how long a continuous burst may defer the token.
 *
 * Without it the debounce is a starvation bug rather than an optimisation: a
 * watch-mode build emitting an event every 100 ms re-arms the timer forever and
 * the tab never updates while anything is happening.
 */
const MAX_DEBOUNCE_MS = 1000

/**
 * Process-wide seed so a token is never reused after a watch is torn down.
 *
 * Restarting each new watch at 1 looks harmless because the client compares with
 * `!==`. It is not: a plugin reload clears the map, and a client still holding
 * the very common baseline of 1 would then see 1 again and read every subsequent
 * edit as "no change" until the counter climbed past it. Monotonic across the
 * process removes the coincidence entirely.
 */
let tokenSeed = 0

/**
 * The only `.git` entries that change what the tab renders.
 *
 * This is an ALLOWLIST, and it has to be. The obvious denylist — filter out
 * `index.lock` and friends — lets `objects` through, and merely READING a
 * repository touches `.git/objects`. Since the tab's own status read is such a
 * read, a denylist makes the feature feed itself: status → objects event → token
 * bump → status, forever, on a repository nobody is touching. That loop was
 * measured (token advanced on an idle repo with only status reads running) and
 * is exactly the runaway polling this design exists to avoid.
 *
 * So enumerate what actually matters instead:
 *   index       — staging changed
 *   HEAD        — commit, checkout, or reset moved the branch pointer
 *   MERGE_HEAD  — a merge, rebase, or conflict state began or ended
 *
 * Ref FILES matter too but live in subdirectories (`refs/heads/...`), which a
 * non-recursive watch reports as the bare directory name `refs`; `packed-refs`
 * covers the packed form. Both are included, and both are genuinely low-rate.
 */
const GIT_SIGNIFICANT = new Set([
  'index',
  'HEAD',
  'refs',
  'packed-refs',
  'MERGE_HEAD',
  'REBASE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
  'MERGE_MSG',
])

/**
 * Whether a top-level `.git` entry means the tab's view changed.
 *
 * Exported so the probe can pin it directly: the behavioural tests for this are
 * timing-sensitive and quietly stop proving anything as the repository's state
 * drifts, which already happened once here.
 * @param entry - first path segment of the event name.
 * @returns true when the entry warrants advancing the token.
 */
export function isSignificantGitEntry(entry: string): boolean {
  if (entry.length === 0) return false
  // Redundant with the allowlist today — no `.lock` name is in GIT_SIGNIFICANT,
  // so this cannot currently change an answer, and no test can distinguish it.
  // Kept as a guard on the allowlist rather than on the input: adding a bare
  // 'refs' or 'index' entry is natural, and the matching '.lock' churn (git
  // writes the lock, then renames it into place, firing a SECOND event for the
  // real name) would then start double-bumping the token silently.
  if (entry.endsWith('.lock')) return false
  return GIT_SIGNIFICANT.has(entry)
}

/**
 * Worktree directories that churn constantly and almost never appear in `git
 * status` — they are gitignored in essentially every project that has them.
 *
 * A dependency install or a watch-mode build writes thousands of files a second
 * into these. None of it changes the tab, but every event still costs a wakeup
 * and re-arms the debounce, which can starve the token and keep the list stale
 * for as long as the build runs — the opposite of the goal.
 *
 * This is a pragmatic prefix list, not a gitignore parser: reading `.gitignore`
 * properly means honouring nested files, negations, and `core.excludesFile`, which
 * is git's job. A rare false skip here costs one delayed refresh; the user's own
 * edits live outside these directories.
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.gradle',
  '.idea',
  '.vscode',
])

/**
 * One watched repository, shared by every client looking at it.
 *
 * Deliberately NOT reference-counted. Watches are keyed by repository root and
 * every tab on that root shares one, so the map is bounded by the number of
 * distinct repositories the user has opened in this process — a handful, not a
 * function of traffic. Refcounting would mean tearing a watch down when the last
 * tab closes and paying a cold restart (plus a lost first change) when it
 * reopens, for no measurable saving.
 */
interface RepoWatch {
  watchers: FSWatcher[]
  token: number
  timer: NodeJS.Timeout | undefined
  /** First event of the current debounce burst, for the starvation cap. */
  burstStart: number
}

/**
 * Filesystem-backed change tokens for repository roots.
 *
 * A token is meaningful only when compared with an earlier token for the SAME
 * root: it counts observed change bursts and carries no wall-clock meaning.
 */
export class RepoWatcher {
  private readonly repos = new Map<string, RepoWatch>()

  /**
   * Current change token for a root, starting a watcher on first use.
   *
   * Reading the token is what registers interest, so a client that stops asking
   * lets the watch expire on its own; nothing has to remember to unsubscribe.
   * @param root - repository working-tree root.
   * @returns the monotonic token for this root.
   */
  token(root: string): number {
    const existing = this.repos.get(root)
    if (existing !== undefined) return existing.token
    const created = this.start(root)
    return created.token
  }

  /**
   * Begin watching one root.
   *
   * Two watches are needed, not one. The worktree watch is `recursive` and sees
   * edits to files; the `.git` watch is what sees staging, commits, and branch
   * switches, because git's own metadata writes do not surface as worktree
   * events. Missing the second is why a watcher can look like it works while
   * never noticing a commit.
   * @param root - repository working-tree root.
   * @returns the newly registered watch record.
   */
  private start(root: string): RepoWatch {
    tokenSeed += 1
    const record: RepoWatch = { watchers: [], token: tokenSeed, timer: undefined, burstStart: 0 }
    this.repos.set(root, record)

    const advance = (): void => {
      record.timer = undefined
      record.burstStart = 0
      record.token += 1
    }

    const bump = (): void => {
      const now = Date.now()
      if (record.burstStart === 0) record.burstStart = now
      // A debounce that only ever RE-ARMS is a starvation bug: a steady trickle
      // of events (a watch-mode build, a long checkout) keeps pushing the deadline
      // out and the token never advances, so the tab stays stale for exactly as
      // long as work is happening. Cap the total wait so it still updates.
      if (now - record.burstStart >= MAX_DEBOUNCE_MS) {
        if (record.timer !== undefined) clearTimeout(record.timer)
        advance()
        return
      }
      if (record.timer !== undefined) clearTimeout(record.timer)
      record.timer = setTimeout(advance, DEBOUNCE_MS)
      // Never hold the process open for a watch: this is a background observer,
      // and an un-unref'd timer would keep a CLI run alive after its work.
      record.timer.unref?.()
    }

    try {
      // `recursive` is supported on Windows and macOS; on Linux it is honoured
      // by newer Node and silently degrades to the top level otherwise. The
      // degraded case still catches .git, which is where staging and commits
      // land, so the tab keeps working rather than failing closed.
      const tree = watch(root, { recursive: true }, (_event, name) => {
        if (typeof name !== 'string' || name.length === 0) return
        // Everything under .git is judged by the .git watcher below; letting it
        // through here too would double every event and defeat that filter.
        const head = name.replace(/\\/g, '/').split('/')[0] ?? ''
        if (IGNORED_DIRS.has(head)) return
        bump()
      })
      tree.on('error', () => {})
      record.watchers.push(tree)
    } catch {
      // An unreadable or vanished directory must not take the service down; the
      // tab simply falls back to its manual refresh.
    }

    try {
      const meta = watch(join(root, '.git'), (_event, name) => {
        if (typeof name !== 'string' || name.length === 0) return
        // A non-recursive watch reports a nested write as its TOP-LEVEL entry
        // (a change to refs/heads/main arrives as 'refs'), so compare the first
        // segment, not the basename. Taking the basename instead would yield
        // 'main' here and match nothing.
        const head = name.replace(/\\/g, '/').split('/')[0] ?? ''
        if (!isSignificantGitEntry(head)) return
        bump()
      })
      meta.on('error', () => {})
      record.watchers.push(meta)
    } catch {
      // A worktree or submodule keeps .git as a FILE, not a directory, so this
      // watch legitimately fails there; the recursive worktree watch still fires.
    }

    return record
  }

  /** Release every watcher; called when the service disposes. */
  close(): void {
    for (const record of this.repos.values()) {
      if (record.timer !== undefined) clearTimeout(record.timer)
      for (const w of record.watchers) {
        try {
          w.close()
        } catch {
          // Already closed by a failed watch; nothing to release.
        }
      }
    }
    this.repos.clear()
  }
}