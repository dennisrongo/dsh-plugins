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
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, resolve as resolvePath, dirname } from 'node:path'
import {
  type GitBranch,
  type GitStash,
  type GitWorktree,
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

/** Where one repository keeps its state, resolved in a single git call. */
export interface RepoPaths {
  /** Absolute working-tree root. */
  root: string
  /** Absolute git directory for THIS worktree (holds HEAD, index, MERGE_HEAD). */
  gitDir: string
  /** Absolute shared git directory (holds refs/stash and the object store). */
  commonDir: string
}

/**
 * Resolve a repository's three directories in ONE git process.
 *
 * `rev-parse` accepts several flags at once and prints one value per line, so
 * this costs exactly what the old `--show-toplevel`-only probe cost. That
 * matters because {@link readStatus} runs on every change-token move, and
 * because `changeToken` itself is built on this call.
 *
 * The two directory flags come back RELATIVE to the cwd — run at a repository
 * root, `--git-dir` prints `.git`, not an absolute path (verified on git
 * 2.50). Resolving them is not cosmetic: an unresolved `.git` read from the
 * host's own cwd finds nothing, and the merge probe then reports `merging:
 * false` on a repository that is mid-merge — failing open, which is the worst
 * direction for a flag that gates an Abort button.
 *
 * The distinction between the two also matters. A linked worktree's `.git` is a
 * FILE pointing into `<common>/worktrees/<name>`, where per-worktree state
 * (HEAD, index, MERGE_HEAD) lives, while `refs/stash` stays in the common
 * directory shared by every worktree. Reading either from the wrong one is
 * silently wrong rather than an error.
 *
 * @param dir - directory to probe.
 * @returns the three paths, or undefined when `dir` is not in a repository.
 */
export async function repoPaths(dir: string): Promise<RepoPaths | undefined> {
  try {
    const run = await runGit(dir, [
      'rev-parse',
      '--show-toplevel',
      '--git-dir',
      '--git-common-dir',
    ])
    if (run.code !== 0) return undefined
    const [root, gitDir, commonDir] = run.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (!root) return undefined
    // A very old git may not know --git-common-dir; fall back to the git dir
    // rather than reporting a repository with no object store.
    const git = gitDir ? resolvePath(dir, gitDir) : resolvePath(root, '.git')
    return {
      root,
      gitDir: git,
      commonDir: commonDir ? resolvePath(dir, commonDir) : git,
    }
  } catch {
    return undefined
  }
}

/**
 * Read the in-progress merge state without spawning git.
 *
 * `MERGE_HEAD` exists for exactly as long as a merge is unconcluded, which is
 * the question the banner and the Abort button ask. `MERGE_MSG`'s first line is
 * used for the label because `MERGE_HEAD` holds a bare sha, which tells a
 * reader nothing about what they are merging.
 *
 * @param gitDir - this worktree's git directory.
 * @returns whether a merge is in progress, and how git describes it.
 */
export async function readMergeState(
  gitDir: string,
): Promise<{ merging: boolean; mergeHead?: string }> {
  try {
    await stat(resolvePath(gitDir, 'MERGE_HEAD'))
  } catch {
    return { merging: false }
  }
  try {
    const msg = await readFile(resolvePath(gitDir, 'MERGE_MSG'), 'utf8')
    const first = msg.split('\n').map((s) => s.trim()).find((s) => s.length > 0)
    return first ? { merging: true, mergeHead: first } : { merging: true }
  } catch {
    return { merging: true }
  }
}

/**
 * Count stash entries without spawning git.
 *
 * Git's stash IS the reflog of `refs/stash`, so counting its lines is the exact
 * same number `git stash list` prints — not an approximation. No stash has ever
 * been taken when the file is absent, which is not an error.
 *
 * @param commonDir - the SHARED git directory; stash does not live per-worktree.
 * @returns how many entries the stash stack holds.
 */
export async function readStashCount(commonDir: string): Promise<number> {
  try {
    const raw = await readFile(resolvePath(commonDir, 'logs', 'refs', 'stash'), 'utf8')
    return raw.split('\n').filter((line) => line.trim().length > 0).length
  } catch {
    return 0
  }
}

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
  return (await repoPaths(dir))?.root
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
  const paths = await repoPaths(dir)
  if (paths === undefined) return { repo: false, root: dir }
  const root = paths.root

  // The merge and stash probes are filesystem reads, deliberately: this runs on
  // every change-token move, so anything added here has to cost nothing. They
  // join the same Promise.all rather than trailing it for the same reason.
  const [porcelain, remotesRun, headRun, merge, stashCount] = await Promise.all([
    readPorcelain(root),
    runGit(root, ['remote']),
    runGit(root, ['rev-parse', '--short', 'HEAD']),
    readMergeState(paths.gitDir),
    readStashCount(paths.commonDir),
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
    merging: merge.merging,
    ...(merge.mergeHead !== undefined ? { mergeHead: merge.mergeHead } : {}),
    stashCount,
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
 * Reject anything that is not a plain, safe git ref name.
 *
 * The sibling of {@link assertSafeSha}, and it exists for the same reason: a ref
 * arrives from the browser and is handed to git verbatim. The risk is not a
 * shell ({@link runGit} uses an argument array) but git's own argument grammar
 * and revision syntax. A value starting with `-` is read as a FLAG, so
 * `--exec=...` as a "branch name" reaches git as an option. `..` and `...`
 * form revision RANGES, `~` and `^` walk ancestry, `:` addresses the index or
 * another ref, and `@{` opens reflog syntax — every one of them names commits
 * the UI never offered.
 *
 * Slashes ARE permitted: `feature/x` and `origin/feature/x` are ordinary,
 * and refusing them would break the common case to no benefit.
 *
 * @param ref - untrusted ref name.
 * @returns the same ref when it is safe to pass to git.
 */
export function assertSafeRef(ref: unknown): string {
  if (typeof ref !== 'string' || ref.trim().length === 0) {
    throw new Error('dsh-git: a branch name is required')
  }
  const name = ref.trim()
  if (name.length > 255) throw new Error('dsh-git: branch name is too long')
  // Leading '-' is the flag-injection case; leading '.' and a trailing '.lock'
  // or '/' are refused by git's own check-ref-format.
  if (name.startsWith('-') || name.startsWith('.') || name.startsWith('/')) {
    throw new Error(`dsh-git: invalid branch name ${name}`)
  }
  if (name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) {
    throw new Error(`dsh-git: invalid branch name ${name}`)
  }
  if (name.includes('..') || name.includes('@{') || name.includes('//')) {
    throw new Error(`dsh-git: invalid branch name ${name}`)
  }
  // Control characters, whitespace, and every character git's revision grammar
  // gives a meaning to.
  if (/[\u0000-\u001f\u007f ~^:?*[\\]/.test(name)) {
    throw new Error(`dsh-git: invalid branch name ${name}`)
  }
  return name
}

/**
 * Reject a stash address that is not a plain non-negative integer.
 *
 * The value is interpolated into `stash@{N}`, so anything else would smuggle
 * reflog syntax into a ref the caller controls.
 * @param index - untrusted stash position.
 * @returns the same index when usable.
 */
export function assertSafeStashIndex(index: unknown): number {
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 10_000) {
    throw new Error(`dsh-git: invalid stash index ${String(index)}`)
  }
  return index
}

/**
 * Resolve and validate a worktree directory.
 *
 * A worktree lives OUTSIDE the repository by definition, so
 * {@link assertSafePath} — which refuses absolute paths and `..` — is the wrong
 * check here. This is the one place the plugin creates a directory the workspace
 * does not contain, so the validation is about intent rather than containment: a
 * relative path is resolved against the repository's PARENT (where sibling
 * worktrees conventionally go, and what a user typing `../feature` means), and a
 * leading `-` is refused because git would read it as a flag.
 *
 * Git itself refuses to create a worktree in a non-empty directory, which is the
 * backstop against clobbering anything that already exists.
 *
 * @param root - repository working-tree root.
 * @param input - untrusted path from the browser.
 * @returns an absolute directory path for git.
 */
export function resolveWorktreePath(root: string, input: unknown): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error('dsh-git: a worktree path is required')
  }
  const raw = input.trim()
  if (raw.startsWith('-')) {
    throw new Error(`dsh-git: invalid worktree path ${raw}`)
  }
  if (/[\u0000-\u001f]/.test(raw)) {
    throw new Error('dsh-git: worktree path contains control characters')
  }
  // Relative paths hang off the repo's parent, so `feature` and `../feature`
  // both land beside the repository rather than inside it.
  return isAbsolute(raw) ? resolvePath(raw) : resolvePath(dirname(root), raw)
}

/** Field separator for ref formats: a byte that cannot occur in a ref or subject. */
const REF_SEP = '\u001f'

/**
 * Parse `git branch` output emitted with {@link REF_SEP}-delimited fields.
 *
 * Ahead/behind are left UNDEFINED rather than zero when git reports no upstream,
 * because "in sync with origin" and "has no upstream at all" are different facts
 * and the menu renders them differently.
 *
 * @param raw - the command's stdout verbatim.
 * @returns one entry per branch, in git's order.
 */
export function parseBranches(raw: string): GitBranch[] {
  const out: GitBranch[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [name, head, upstream, track, subject] = line.split(REF_SEP)
    if (!name) continue
    // A remote HEAD pointer ('origin/HEAD -> origin/main') is a symref, not a
    // branch anyone can check out; listing it would offer a dead menu row.
    if (name.includes(' -> ')) continue
    const remote = name.startsWith('remotes/') || /^[^/]+\/.+$/.test(name) && upstream === undefined
    const clean = name.startsWith('remotes/') ? name.slice('remotes/'.length) : name
    const ahead = /ahead (\d+)/.exec(track ?? '')
    const behind = /behind (\d+)/.exec(track ?? '')
    out.push({
      name: clean,
      current: (head ?? '').trim() === '*',
      remote: name.startsWith('remotes/') || remote,
      ...(upstream ? { upstream } : {}),
      ...(upstream && ahead ? { ahead: Number(ahead[1]) } : upstream ? { ahead: 0 } : {}),
      ...(upstream && behind ? { behind: Number(behind[1]) } : upstream ? { behind: 0 } : {}),
      ...(subject ? { subject } : {}),
    })
  }
  return out
}

/**
 * Parse `git stash list` output.
 *
 * The index is taken from the `stash@{N}` selector git prints rather than from
 * the array position, so the address always matches what git would accept even
 * if a line is ever skipped.
 *
 * @param raw - the command's stdout verbatim.
 * @returns one entry per stash, newest first.
 */
export function parseStashes(raw: string): GitStash[] {
  const out: GitStash[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [selector, message, at] = line.split(REF_SEP)
    const found = /stash@\{(\d+)\}/.exec(selector ?? '')
    if (!found) continue
    // Git writes 'WIP on main: <sha> <subject>' or 'On main: <message>'.
    const branch = /^(?:WIP on|On) ([^:]+):/.exec(message ?? '')
    const date = Number(at ?? 0) * 1000
    out.push({
      index: Number(found[1]),
      message: message ?? '',
      ...(branch ? { branch: branch[1] } : {}),
      ...(Number.isFinite(date) && date > 0 ? { date } : {}),
    })
  }
  return out
}

/**
 * Parse `git worktree list --porcelain`.
 *
 * The porcelain form is record-oriented — blank-line-separated blocks of
 * `key value` lines — rather than columnar, so a path containing spaces (the
 * case the human-readable form mangles) survives intact.
 *
 * @param raw - the command's stdout verbatim.
 * @param currentRoot - the worktree the caller is sitting in, marked `current`.
 * @returns one entry per worktree, main first as git lists it.
 */
export function parseWorktrees(raw: string, currentRoot?: string): GitWorktree[] {
  const out: GitWorktree[] = []
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  let current: Partial<GitWorktree> & { path?: string } = {}
  const flush = (): void => {
    if (current.path === undefined) return
    out.push({
      path: current.path,
      ...(current.branch !== undefined ? { branch: current.branch } : {}),
      ...(current.head !== undefined ? { head: current.head } : {}),
      // Git lists the MAIN worktree first, always.
      main: out.length === 0,
      prunable: current.prunable === true,
      locked: current.locked === true,
      current: currentRoot !== undefined && norm(current.path) === norm(currentRoot),
    })
    current = {}
  }
  for (const line of raw.split('\n')) {
    const text = line.trimEnd()
    if (text.length === 0) {
      flush()
      continue
    }
    const space = text.indexOf(' ')
    const key = space < 0 ? text : text.slice(0, space)
    const value = space < 0 ? '' : text.slice(space + 1)
    if (key === 'worktree') {
      flush()
      current.path = value
    } else if (key === 'HEAD') current.head = value.slice(0, 7)
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'locked') current.locked = true
    else if (key === 'prunable') current.prunable = true
  }
  flush()
  return out
}

/**
 * List branches, stashes and worktrees in three parallel git calls.
 *
 * Grouped into one function because the tab fetches them together — the branch
 * menu wants the first and the Repo pane the other two — and three sequential
 * round trips would be three times the latency for no benefit.
 *
 * @param root - repository working-tree root.
 * @returns the three lists.
 */
export async function readRefs(
  root: string,
): Promise<{ branches: GitBranch[]; stashes: GitStash[]; worktrees: GitWorktree[] }> {
  const format = [
    '%(refname:short)',
    '%(HEAD)',
    '%(upstream:short)',
    '%(upstream:track)',
    '%(contents:subject)',
  ].join(REF_SEP)

  const [branchRun, stashRun, worktreeRun] = await Promise.all([
    runGit(root, ['branch', '-a', `--format=${format}`]),
    runGit(root, [
      'stash',
      'list',
      `--pretty=format:%gd${REF_SEP}%gs${REF_SEP}%at`,
    ]),
    runGit(root, ['worktree', 'list', '--porcelain']),
  ])

  return {
    // An unborn branch makes `git branch` exit non-zero with nothing to list,
    // which is a state, not a failure.
    branches: branchRun.code === 0 ? parseBranches(branchRun.stdout) : [],
    stashes: stashRun.code === 0 ? parseStashes(stashRun.stdout) : [],
    worktrees: worktreeRun.code === 0 ? parseWorktrees(worktreeRun.stdout, root) : [],
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