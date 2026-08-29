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
  MAX_AI_DIFF_BYTES,
  RECENT_COMMITS,
  type ChangeScope,
  type GitCommit,
  type GitCommitFile,
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
 * Git environment variables that choose WHICH repository a command operates on.
 *
 * Git reads these BEFORE it considers cwd, so any one of them silently
 * overrides the directory this module was asked to work in — turning every
 * result into a confident answer about the wrong repository. Since git exports
 * them to every hook it runs, a harness launched from a pre-commit hook, from
 * `git rebase --exec`, or from a CI step nested inside a git operation inherits
 * them and reports another repo's files as the workspace's own.
 *
 * This is a DENYLIST, not a blanket scrub of GIT_*, and that distinction is
 * load-bearing in the opposite direction from the watcher's allowlist: transport
 * and credential settings (GIT_SSH_COMMAND, GIT_ASKPASS, GIT_CONFIG_GLOBAL, the
 * proxy variables) are how users configure push and pull, and wiping them would
 * trade this silent bug for a different silent bug.
 */
const REPO_LOCATION_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_GRAFT_FILE',
  'GIT_PREFIX',
  'GIT_INDEX_VERSION',
]

/**
 * Build the environment for one git child process.
 *
 * Copies `process.env` rather than mutating it — the scrub must not be visible
 * to the rest of the host, which shares this process.
 * @returns the child environment, with repository-location variables removed.
 */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const name of REPO_LOCATION_ENV) delete env[name]
  // Never let git stop for credentials or an editor: this runs with no
  // attached TTY, so an interactive prompt would hang the request until
  // the timeout instead of failing with a message the tab can show.
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_EDITOR = 'true'
  env.GIT_PAGER = 'cat'
  env.GIT_OPTIONAL_LOCKS = '0'
  return env
}
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
        env: gitEnv(),
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
 * Reject anything that is not a plain hex object name.
 *
 * A sha arrives from the browser and is handed to git verbatim, exactly like a
 * path — so it needs the same treatment {@link assertSafePath} gives one. The
 * concrete risk is not a shell (there is none: {@link runGit} uses an argument
 * array) but git's own argument grammar: a value starting with `-` is read as a
 * FLAG, and revision syntax like `HEAD`, `main..dev` or `:/secret` would let a
 * caller address commits the UI never offered. Hex-only refuses all of it.
 * @param sha - untrusted commit identifier.
 * @returns the same sha when it is a valid object name.
 */
export function assertSafeSha(sha: unknown): string {
  if (typeof sha !== 'string' || !/^[0-9a-fA-F]{4,40}$/.test(sha)) {
    throw new Error(`dsh-git: invalid commit sha ${String(sha)}`)
  }
  return sha
}

/**
 * Parse `git show --name-status -z` into per-commit file entries.
 *
 * The `-z` form is mandatory for the same reason it is in {@link parseStatus}:
 * the plain form quotes and escapes exactly the paths users struggle with most.
 * Its layout differs though — the status letter and the path are SEPARATE
 * NUL-delimited fields here, rather than one fixed-width `XY path` record, and a
 * rename carries two path fields after its letter instead of one.
 *
 * @param raw - the command's stdout verbatim.
 * @returns one entry per path the commit touched, in git's order.
 */
export function parseCommitFiles(raw: string): GitCommitFile[] {
  const out: GitCommitFile[] = []
  const fields = raw.split('\0')
  for (let i = 0; i < fields.length; i += 1) {
    const token = fields[i]
    if (!token) continue
    // A rename/copy letter carries a similarity score (R100, C075); the letter
    // itself is the only part that describes the change.
    const letter = token[0]
    if (!/^[A-Z]/.test(token)) continue
    const status = code(letter)

    // R and C emit TWO path fields (from, to) — consuming only one would leave
    // the destination to be misread as the next entry's status token.
    if (status === 'R' || status === 'C') {
      const from = fields[i + 1]
      const to = fields[i + 2]
      if (typeof from !== 'string' || typeof to !== 'string' || to.length === 0) break
      out.push({ path: to, origPath: from, status })
      i += 2
      continue
    }

    const path = fields[i + 1]
    if (typeof path !== 'string' || path.length === 0) break
    out.push({ path, status })
    i += 1
  }
  return out
}

/** One porcelain status read, already split into header facts and files. */
interface Porcelain {
  branch?: string
  upstream?: GitUpstream
  /** As reported by the branch header alone; {@link readStatus} corroborates it. */
  unborn: boolean
  files: GitFileChange[]
}

/**
 * Run one `git status` and parse it.
 *
 * Split out because the working set is all most callers need, and the rest of
 * {@link readStatus} — the remote probe, the HEAD probe, the commit log — is
 * four more git processes they would pay for and discard.
 * @param root - repository working-tree root.
 * @returns the branch facts and the changed files.
 */
async function readPorcelain(root: string): Promise<Porcelain> {
  const run = await runGit(root, [
    'status',
    '--porcelain=v1',
    '-b',
    '-z',
    '--untracked-files=all',
  ])
  const raw = run.stdout
  // With -z the branch header is itself NUL-terminated, so split it off first.
  const firstNul = raw.indexOf('\0')
  const header = firstNul >= 0 ? raw.slice(0, firstNul) : raw
  const rest = firstNul >= 0 ? raw.slice(firstNul + 1) : ''

  return {
    ...(header.startsWith('## ') ? parseBranchHeader(header.slice(3)) : {}),
    unborn: header.includes('No commits yet'),
    files: parseStatus(rest),
  }
}

/**
 * Build the whole repository snapshot for one directory.
 * @param dir - the workspace directory to probe.
 * @returns the snapshot, including the `repo: false` case.
 */
export async function readStatus(dir: string): Promise<GitStatus> {
  const root = await repoRoot(dir)
  if (root === undefined) return { repo: false, root: dir }

  const [porcelain, remotesRun, headRun] = await Promise.all([
    readPorcelain(root),
    runGit(root, ['remote']),
    runGit(root, ['rev-parse', '--short', 'HEAD']),
  ])

  const unborn = porcelain.unborn || headRun.code !== 0
  const recent = unborn ? [] : await recentCommits(root)

  return {
    repo: true,
    root,
    ...(porcelain.branch !== undefined ? { branch: porcelain.branch } : {}),
    ...(!unborn && headRun.code === 0 ? { head: headRun.stdout.trim() } : {}),
    unborn,
    ...(porcelain.upstream !== undefined ? { upstream: porcelain.upstream } : {}),
    hasRemote: remotesRun.code === 0 && remotesRun.stdout.trim().length > 0,
    files: porcelain.files,
    recent,
  }
}

/**
 * Diff an untracked file against the empty device.
 *
 * A file that is in neither the index nor any tree is invisible to every form
 * of `git diff` — including `git diff HEAD` — so without this a brand-new file
 * contributes nothing at all to a patch. `--no-index` exits non-zero whenever
 * the two sides differ, which is the normal case here, so the exit code is
 * deliberately ignored and only stdout is read.
 *
 * @param root - repository working-tree root.
 * @param path - repo-relative path, already validated by the caller.
 * @returns the synthesized patch, or an empty string when git produced none.
 */
export async function untrackedPatch(root: string, path: string): Promise<string> {
  const run = await runGit(root, ['diff', '--no-color', '--no-index', '--', '/dev/null', path])
  return run.stdout
}

/** The patch handed to the model, plus what it actually covers. */
export interface ChangeDiff {
  /** `staged` when the index alone was described, `all` for every uncommitted change. */
  scope: ChangeScope
  /** Unified diff text, already capped. Empty means there was nothing to describe. */
  text: string
  /** Whether the byte budget cut the text short. */
  truncated: boolean
}

/**
 * Assemble the diff that describes what a commit would record.
 *
 * The scope is chosen the way the commit button behaves: with anything staged,
 * only the index matters, because that is exactly what `git commit` would
 * write. With an empty index there is no commit to describe yet, so the whole
 * uncommitted picture is used instead — which is what someone reaching for a
 * drafted message before staging expects to see summarized.
 *
 * @param root - repository working-tree root.
 * @param options - explicit scope override and byte budget.
 * @returns the patch text and the scope it covers.
 */
export async function collectChangeDiff(
  root: string,
  options: { staged?: boolean | undefined; maxBytes?: number } = {},
): Promise<ChangeDiff> {
  const maxBytes = options.maxBytes ?? MAX_AI_DIFF_BYTES
  const { files, unborn } = await readPorcelain(root)
  const staged = options.staged ?? files.some((f) => f.staged)
  const scope: ChangeScope = staged ? 'staged' : 'all'

  const args = ['diff', '--no-color', '--no-ext-diff']
  if (staged) {
    args.push('--cached')
  } else if (!unborn) {
    // `git diff HEAD` is the whole uncommitted picture — index AND worktree —
    // where a bare `git diff` silently drops anything already staged. An
    // unborn branch has no HEAD to name, and the bare form is the only one
    // that runs there at all.
    args.push('HEAD')
  }

  const run = await runGit(root, args)
  const parts: string[] = []
  let used = 0
  if (run.stdout.trim().length > 0) {
    parts.push(run.stdout)
    used += run.stdout.length
  }

  // Untracked files need synthesizing in the `all` scope only: once staged, a
  // new file is an ordinary addition that `--cached` already carries.
  const omitted: string[] = []
  if (!staged) {
    for (const file of files) {
      if (!file.untracked) continue
      if (used >= maxBytes) {
        omitted.push(file.path)
        continue
      }
      const patch = await untrackedPatch(root, file.path)
      if (patch.trim().length === 0) {
        omitted.push(file.path)
        continue
      }
      parts.push(patch)
      used += patch.length
    }
  }
  if (omitted.length > 0) {
    parts.push(`New files, contents not shown:\n${omitted.map((p) => `- ${p}`).join('\n')}`)
  }

  let text = parts.join('\n').trim()

  // Binary edits, mode changes and permission-only churn all produce a status
  // entry with no textual diff. Naming them still lets the model say what the
  // change touched, where an empty patch would only produce a refusal.
  if (text.length === 0) {
    const named = staged ? files.filter((f) => f.staged) : files
    if (named.length === 0) return { scope, text: '', truncated: false }
    text = `Files affected (no textual diff available):\n${named
      .map((f) => `${f.untracked ? 'new file' : 'changed'}: ${f.path}`)
      .join('\n')}`
  }

  const truncated = text.length > maxBytes
  return {
    scope,
    text: truncated ? `${text.slice(0, maxBytes)}\n[diff truncated]` : text,
    truncated,
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