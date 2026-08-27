/**
 * The git engine: a thin, injection-safe wrapper over the `git` CLI plus the
 * parsers that turn its porcelain output into this plugin's vocabulary.
 *
 * Every call goes through {@link runGit}, which uses `execFile` with an ARGUMENT
 * ARRAY — never a shell string. That is a security boundary, not a style choice:
 * branch names, paths, and commit messages are attacker-influenced text, and a
 * shell would let `;` or `$(...)` in any of them execute arbitrary commands.
 *
 * @module @dennisrongo/dsh-git/git
 */
import { execFile } from 'node:child_process'
import {
  RECENT_COMMITS,
  type GitCommit,
  type GitFileChange,
  type GitStatus,
  type GitStatusCode,
  type GitUpstream,
} from './types.ts'

/** One finished git invocation. */
export interface GitRun {
  code: number
  stdout: string
  stderr: string
}

/** Ceiling on captured output, so a pathological repo cannot exhaust memory. */
const MAX_BUFFER = 32 * 1024 * 1024

/** Wall-clock ceiling for one git call; network ops get their own longer bound. */
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Run one git command in `cwd`.
 *
 * A non-zero exit is returned, not thrown: git uses exit codes for ordinary
 * outcomes (nothing to commit, rejected push) that callers must render rather
 * than treat as a crash. Only a failure to SPAWN git rejects.
 *
 * @param cwd - working directory for the command.
 * @param args - argv after `git`, passed without a shell.
 * @param timeoutMs - wall-clock ceiling for this call.
 * @returns the exit code and captured streams.
 */
export function runGit(cwd: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GitRun> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: {
          ...process.env,
          // Never let git stop for credentials or an editor: this runs with no
          // attached TTY, so an interactive prompt would hang the request until
          // the timeout instead of failing with a message the tab can show.
          GIT_TERMINAL_PROMPT: '0',
          GIT_EDITOR: 'true',
          GIT_PAGER: 'cat',
          GIT_OPTIONAL_LOCKS: '0',
        },
      },
      (error, stdout, stderr) => {
        const out = typeof stdout === 'string' ? stdout : String(stdout ?? '')
        const err = typeof stderr === 'string' ? stderr : String(stderr ?? '')
        if (error && typeof (error as { code?: unknown }).code === 'number') {
          resolve({ code: (error as unknown as { code: number }).code, stdout: out, stderr: err })
          return
        }
        if (error) {
          // ENOENT (git absent) and timeouts land here: a real spawn failure.
          reject(error)
          return
        }
        resolve({ code: 0, stdout: out, stderr: err })
      },
    )
  })
}

/** Join a run's streams into the single text blob the tab displays. */
export function combined(run: GitRun): string {
  return [run.stdout.trim(), run.stderr.trim()].filter((s) => s.length > 0).join('\n').trim()
}

/**
 * Resolve the working-tree root, or undefined when `dir` is not in a repo.
 *
 * The root is re-derived rather than assumed equal to the workspace path so a
 * workspace opened on a SUBDIRECTORY of a repo still shows that repo's changes.
 * @param dir - directory to probe.
 * @returns absolute working-tree root, or undefined.
 */
export async function repoRoot(dir: string): Promise<string | undefined> {
  try {
    const run = await runGit(dir, ['rev-parse', '--show-toplevel'])
    if (run.code !== 0) return undefined
    const root = run.stdout.trim()
    return root.length > 0 ? root : undefined
  } catch {
    return undefined
  }
}

/** Map one porcelain status letter onto the code vocabulary. */
function code(ch: string): GitStatusCode {
  switch (ch) {
    case 'M':
    case 'A':
    case 'D':
    case 'R':
    case 'C':
    case 'U':
    case '?':
    case '!':
      return ch
    default:
      return ' '
  }
}

/**
 * Parse `git status --porcelain=v1 -z` into file changes.
 *
 * The NUL-delimited (`-z`) form is mandatory rather than convenient: the plain
 * form quotes and escapes any path containing a space, quote, or non-ASCII byte,
 * so parsing it would corrupt exactly the filenames users are most likely to
 * have trouble with. With `-z`, paths are emitted raw.
 *
 * @param raw - the command's stdout verbatim.
 * @returns one entry per changed path, in git's order.
 */
export function parseStatus(raw: string): GitFileChange[] {
  const out: GitFileChange[] = []
  // Trailing NUL yields a final empty field; drop it rather than parse it.
  const fields = raw.split('\0')
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i]
    if (!entry || entry.length < 3) continue
    const index = code(entry[0])
    const worktree = code(entry[1])
    const path = entry.slice(3)
    if (path.length === 0) continue

    // A rename/copy entry is followed by its ORIGINAL path in the very next
    // NUL field, which must be consumed here or it would be misread as another
    // changed file on the following iteration.
    let origPath: string | undefined
    if (index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C') {
      const next = fields[i + 1]
      if (typeof next === 'string' && next.length > 0) {
        origPath = next
        i += 1
      }
    }

    const untracked = index === '?' && worktree === '?'
    // 'U' on either side, or the AA/DD pairs, are git's unmerged states.
    const conflicted =
      index === 'U' ||
      worktree === 'U' ||
      (index === 'A' && worktree === 'A') ||
      (index === 'D' && worktree === 'D')

    out.push({
      path,
      ...(origPath !== undefined ? { origPath } : {}),
      index,
      worktree,
      // Untracked files have no index entry, and a conflict is not "staged
      // work" even though git writes stage markers for it.
      staged: !untracked && !conflicted && index !== ' ',
      conflicted,
      untracked,
    })
  }
  return out
}

/**
 * Parse the `## ` branch header `--porcelain=v1 -b` prints first.
 * @param line - the header line, without its `## ` prefix.
 * @returns branch name and upstream divergence when present.
 */
export function parseBranchHeader(line: string): { branch?: string; upstream?: GitUpstream } {
  // Shape: `main...origin/main [ahead 1, behind 2]`, or `No commits yet on main`.
  const unborn = /^No commits yet on (.+?)(?:\.\.\.|$)/.exec(line)
  if (unborn) return { branch: unborn[1].trim() }

  const track = /\[(.+)\]\s*$/.exec(line)
  const head = track ? line.slice(0, track.index) : line
  const parts = head.split('...')
  const branch = parts[0]?.trim()
  const upstreamName = parts[1]?.trim()

  let upstream: GitUpstream | undefined
  if (upstreamName) {
    const ahead = /ahead (\d+)/.exec(track?.[1] ?? '')
    const behind = /behind (\d+)/.exec(track?.[1] ?? '')
    upstream = {
      name: upstreamName,
      ahead: ahead ? Number(ahead[1]) : 0,
      behind: behind ? Number(behind[1]) : 0,
    }
  }

  return {
    ...(branch && branch !== 'HEAD (no branch)' ? { branch } : {}),
    ...(upstream ? { upstream } : {}),
  }
}

/** Field separator for the log format: a byte sequence that cannot occur in a subject. */
const LOG_SEP = '\u001f'

/**
 * Read the recent commit log.
 * @param root - repository working-tree root.
 * @returns newest-first commits, or an empty array on an unborn branch.
 */
export async function recentCommits(root: string): Promise<GitCommit[]> {
  const run = await runGit(root, [
    'log',
    `-${RECENT_COMMITS}`,
    `--pretty=format:%h${LOG_SEP}%s${LOG_SEP}%an${LOG_SEP}%at`,
  ])
  // A repo with no commits exits non-zero here; that is not an error.
  if (run.code !== 0) return []
  const out: GitCommit[] = []
  for (const line of run.stdout.split('\n')) {
    if (!line.trim()) continue
    const [sha, subject, author, at] = line.split(LOG_SEP)
    if (!sha) continue
    out.push({
      sha,
      subject: subject ?? '',
      author: author ?? '',
      date: Number(at ?? 0) * 1000,
    })
  }
  return out
}

/**
 * Build the whole repository snapshot for one directory.
 * @param dir - the workspace directory to probe.
 * @returns the snapshot, including the `repo: false` case.
 */
export async function readStatus(dir: string): Promise<GitStatus> {
  const root = await repoRoot(dir)
  if (root === undefined) return { repo: false, root: dir }

  const [statusRun, remotesRun, headRun] = await Promise.all([
    runGit(root, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all']),
    runGit(root, ['remote']),
    runGit(root, ['rev-parse', '--short', 'HEAD']),
  ])

  const raw = statusRun.stdout
  // With -z the branch header is itself NUL-terminated, so split it off first.
  const firstNul = raw.indexOf('\0')
  const header = firstNul >= 0 ? raw.slice(0, firstNul) : raw
  const rest = firstNul >= 0 ? raw.slice(firstNul + 1) : ''

  const branchInfo = header.startsWith('## ')
    ? parseBranchHeader(header.slice(3))
    : {}

  const unborn = header.includes('No commits yet') || headRun.code !== 0
  const files = parseStatus(rest)
  const recent = unborn ? [] : await recentCommits(root)

  return {
    repo: true,
    root,
    ...(branchInfo.branch !== undefined ? { branch: branchInfo.branch } : {}),
    ...(!unborn && headRun.code === 0 ? { head: headRun.stdout.trim() } : {}),
    unborn,
    ...(branchInfo.upstream !== undefined ? { upstream: branchInfo.upstream } : {}),
    hasRemote: remotesRun.code === 0 && remotesRun.stdout.trim().length > 0,
    files,
    recent,
  }
}

/**
 * Reject a path that tries to escape the repository.
 *
 * Paths arrive from the browser and are handed to git verbatim, so `..`
 * segments and absolute paths must be refused here — otherwise a crafted
 * request could stage or discard files outside the workspace entirely.
 * @param path - untrusted repo-relative path.
 * @returns the same path when safe.
 */
export function assertSafePath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('dsh-git: path must be a non-empty string')
  }
  if (path.startsWith('/') || path.startsWith('\\\\') || /^[a-zA-Z]:/.test(path)) {
    throw new Error(`dsh-git: absolute paths are not accepted: ${path}`)
  }
  const segments = path.split(/[\\/]/)
  if (segments.some((s) => s === '..')) {
    throw new Error(`dsh-git: path may not escape the repository: ${path}`)
  }
  return path
}
