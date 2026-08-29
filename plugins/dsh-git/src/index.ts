/**
 * Host half of dsh-git: the workspace-aware git operator.
 *
 * The browser never touches a repository. This half resolves a workspace id to
 * its canonical directory through `workspaceRegistry`, runs git there, and
 * publishes the results over the Typert bridge; the client half mounts a
 * matching descriptor and calls `ctx.remote.dshGit.*`.
 *
 * There is no storage domain here on purpose — unlike a todo list, the
 * repository IS the durable state, so caching it would only invite the tab and
 * the disk to disagree.
 *
 * @module @dennisrongo/dsh-git
 */
import { basename } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
// Imported for its side effect on the type level: dsh-workspace's module
// augmentation is what declares `ctx.workspaceRegistry` on Context.
import type { Workspace } from '@deepseek-ai/dsh-workspace'
// Imported for its type-level side effect: this augmentation declares
// `ctx.agentDefaultModel`, the source of the commit-message model route.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import {
  MAX_AI_DIFF_BYTES,
  MAX_DIFF_BYTES,
  normalizeBranchName,
  type ChangeTokenRequest,
  type ChangeTokenResult,
  type CommandResult,
  type CommitDiffRequest,
  type CommitDiffResult,
  type CommitFilesRequest,
  type CommitFilesResult,
  type CommitRequest,
  type DiffRequest,
  type DiffResult,
  type InitRequest,
  type StageRequest,
  type BranchRequest,
  type MergeRequest,
  type RefsRequest,
  type RefsResult,
  type StashRequest,
  type StatusRequest,
  type StatusResult,
  type WorktreeRequest,
  type SuggestBranchRequest,
  type SuggestBranchResult,
  type SuggestRequest,
  type SuggestResult,
  type SyncRequest,
} from './types.ts'
import {
  assertSafePath,
  assertSafeRef,
  assertSafeSha,
  assertSafeStashIndex,
  readRefs,
  resolveWorktreePath,
  collectChangeDiff,
  combined,
  parseCommitFiles,
  readStatus,
  repoRoot,
  runGit,
  untrackedPatch,
} from './git.ts'
import { RepoWatcher } from './watch.ts'

export type * from './types.ts'

/** Network git operations deserve a longer leash than local ones. */
const NETWORK_TIMEOUT_MS = 120_000

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshGit: GitService
  }
}

/**
 * Workspace-scoped git operations, exposed to the browser over Typert.
 *
 * Every mutating method funnels through {@link enqueue}, keyed by repository
 * root. Git serializes on `index.lock` and simply FAILS a concurrent writer, so
 * without this chain two quick clicks (stage, then commit) would race and one
 * would die on a lock error rather than run in order.
 */
export class GitService extends TypertRemoteService {
  static inject = ['workspaceRegistry', 'llm', 'agentDefaultModel']

  /** Per-repository write chain, keyed by working-tree root. */
  private readonly tails = new Map()

  /**
   * Filesystem watchers backing {@link changeToken}.
   *
   * Owned by the service rather than created per request so that N tabs on one
   * repository share a single OS handle.
   */
  private readonly watcher = new RepoWatcher()

  /**
   * @param ctx - host context carrying the workspace registry and LLM runtime.
   */
  constructor(ctx: Context) {
    super(ctx, 'dshGit')
  }

  /**
   * Resolve a workspace id to its canonical directory.
   *
   * The registry is the only accepted source: taking a path from the browser
   * would let any caller point this service at an arbitrary directory on the
   * machine.
   * @param workspaceId - the workspace to resolve.
   * @returns the canonical workspace directory.
   */
  private workspaceDir(workspaceId: unknown): string {
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      throw new Error('dsh-git: workspaceId must be a non-empty string')
    }
    const registry = this.ctx.workspaceRegistry
    const workspace = registry.list().find((w: Workspace) => String(w.id) === workspaceId)
    if (workspace === undefined) throw new Error(`dsh-git: unknown workspace ${workspaceId}`)
    return workspace.path
  }

  /**
   * Read the current repository snapshot. A directory that is not a repository
   * is reported as `repo: false`, never as a failure.
   * @param request - the workspace to inspect.
   * @returns the snapshot.
   */
  @Remote
  async status(request: StatusRequest): Promise<StatusResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    return { status: await readStatus(dir) }
  }

  /**
   * Report whether this repository has changed, without running git.
   *
   * This is the endpoint the tab polls, so its cost is the whole point: it
   * reads a counter maintained by a filesystem watcher and returns an integer.
   * Polling `status` instead would spawn four git processes per tick per
   * open tab, which is exactly the penalty this avoids.
   *
   * A directory that is not a repository reports `0` so the client can stop
   * polling rather than watch nothing forever.
   * @param request - the workspace to observe.
   * @returns the current monotonic change token.
   */
  @Remote
  async changeToken(request: ChangeTokenRequest): Promise<ChangeTokenResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const root = await repoRoot(dir)
    if (root === undefined) return { token: 0 }
    return { token: this.watcher.token(root) }
  }

  /**
   * Read a unified diff for one path, or for the whole tree.
   *
   * Untracked files have no diff to ask git for, so their contents are
   * synthesized into a `/dev/null` patch — otherwise clicking a new file in
   * the tab would show a blank pane and look broken.
   * @param request - workspace, optional path, and staged/worktree selector.
   * @returns the patch text, truncated when very large.
   */
  @Remote
  async diff(request: DiffRequest): Promise<DiffResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const root = await repoRoot(dir)
    if (root === undefined) return { patch: '', binary: false }

    const path =
      typeof request?.path === 'string' && request.path.length > 0
        ? assertSafePath(request.path)
        : undefined
    const staged = request?.staged === true

    if (path !== undefined) {
      // An untracked path is unknown to both the index and HEAD; `git diff`
      // would print nothing at all, so diff it against the empty device.
      const tracked = await runGit(root, ['ls-files', '--error-unmatch', '--', path])
      if (tracked.code !== 0) {
        const text = await untrackedPatch(root, path)
        if (text.includes('Binary files')) {
          return { patch: 'Binary file — no textual diff.', binary: true }
        }
        return { patch: clamp(text), binary: false }
      }
    }

    const args = ['diff', '--no-color', '--no-ext-diff']
    if (staged) args.push('--cached')
    args.push('--')
    if (path !== undefined) args.push(path)

    const run = await runGit(root, args)
    const text = run.stdout
    if (text.includes('Binary files')) {
      return { patch: 'Binary file — no textual diff.', binary: true }
    }
    return { patch: clamp(text), binary: false }
  }

  /**
   * List the paths one commit touched.
   *
   * Reads with `--name-status` rather than a full patch because the history
   * pane shows the file list first and fetches a patch only for the file the
   * user actually clicks — a commit touching hundreds of files would otherwise
   * ship its entire diff to render a list of names.
   * @param request - workspace and the commit to inspect.
   * @returns one entry per path, in git's order.
   */
  @Remote
  async commitFiles(request: CommitFilesRequest): Promise<CommitFilesResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const sha = assertSafeSha(request?.sha)
    const root = await repoRoot(dir)
    if (root === undefined) return { files: [] }

    const run = await runGit(root, [
      'show',
      '--name-status',
      '-z',
      '--no-color',
      // Without this a MERGE commit prints no file list at all, so its row would
      // expand into a convincing but false "no files changed".
      '--first-parent',
      '--format=',
      sha,
    ])
    // A sha that does not resolve exits non-zero; an empty list is the honest
    // answer for the pane, which already renders "no files" as a state.
    if (run.code !== 0) return { files: [] }
    return { files: parseCommitFiles(run.stdout) }
  }

  /**
   * Read the patch one commit introduced, for one path or in full.
   *
   * Returns the same shape as {@link diff} so the history pane and the changes
   * pane can share one renderer.
   * @param request - workspace, commit, and optional path.
   * @returns the patch text, truncated when very large.
   */
  @Remote
  async commitDiff(request: CommitDiffRequest): Promise<CommitDiffResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const sha = assertSafeSha(request?.sha)
    const root = await repoRoot(dir)
    if (root === undefined) return { patch: '', binary: false }

    const path =
      typeof request?.path === 'string' && request.path.length > 0
        ? assertSafePath(request.path)
        : undefined

    const args = ['show', '--no-color', '--no-ext-diff', '--first-parent', '--format=', sha]
    if (path !== undefined) args.push('--', path)

    const run = await runGit(root, args)
    if (run.code !== 0) {
      return { patch: combined(run) || 'Could not read this commit.', binary: false }
    }
    const text = run.stdout
    if (text.includes('Binary files')) {
      return { patch: 'Binary file — no textual diff.', binary: true }
    }
    return { patch: clamp(text), binary: false }
  }

  /**
   * Stage, unstage, or discard paths.
   *
   * `discard` is the one destructive action: it restores tracked files from the
   * index and DELETES untracked ones, because a "discard" that leaves new files
   * behind would not match what the button says. The client confirms first.
   * @param request - workspace, action, and target paths (empty means all).
   * @returns command output and the refreshed status.
   */
  @Remote
  async stage(request: StageRequest): Promise<CommandResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const action = request?.action
    const paths = Array.isArray(request?.paths) ? request.paths.map(assertSafePath) : []

    return this.withRepo(dir, async (root: string) => {
      if (action === 'stage') {
        const args = paths.length > 0 ? ['add', '--', ...paths] : ['add', '-A']
        return combined(await runGit(root, args))
      }
      if (action === 'unstage') {
        // `restore --staged` is correct on a born branch; an unborn branch has
        // no HEAD to restore from, where `rm --cached` is the only way back.
        const status = await readStatus(root)
        const unborn = status.repo && status.unborn
        const args = unborn
          ? ['rm', '--cached', '-r', '--', ...(paths.length > 0 ? paths : ['.'])]
          : ['restore', '--staged', '--', ...(paths.length > 0 ? paths : ['.'])]
        return combined(await runGit(root, args))
      }
      if (action === 'discard') {
        const out: string[] = []
        const targets = paths.length > 0 ? paths : ['.']
        // Order matters: restore tracked content first, then sweep untracked
        // leftovers, so a file that is both cannot survive as new.
        out.push(combined(await runGit(root, ['checkout', '--', ...targets])))
        out.push(combined(await runGit(root, ['clean', '-fd', '--', ...targets])))
        return out.filter((s) => s.length > 0).join('\n')
      }
      throw new Error(`dsh-git: unknown stage action ${String(action)}`)
    })
  }

  /**
   * Commit the index.
   *
   * `all` survives for older clients only: the tab's Commit button now requires
   * a non-empty index, so it never asks for the `-a` sweep.
   * @param request - workspace, message, and whether to auto-stage tracked edits.
   * @returns command output and the refreshed status.
   */
  @Remote
  async commit(request: CommitRequest): Promise<CommandResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const message = typeof request?.message === 'string' ? request.message.trim() : ''
    if (message.length === 0) throw new Error('dsh-git: a commit message is required')
    const all = request?.all === true

    return this.withRepo(dir, async (root: string) => {
      const args = ['commit']
      if (all) args.push('-a')
      // `-m` via the argv array keeps the message out of any shell entirely,
      // so newlines and quotes in a generated message are safe verbatim.
      args.push('-m', message)
      return combined(await runGit(root, args))
    })
  }

  /**
   * Initialize a repository in the workspace directory.
   *
   * Refuses when one already exists rather than silently re-initializing.
   * @param request - workspace and desired initial branch.
   * @returns command output and the refreshed status.
   */
  @Remote
  async init(request: InitRequest): Promise<CommandResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const branch = normalizeBranch(request?.branch)

    const existing = await repoRoot(dir)
    if (existing !== undefined) {
      return {
        ok: false,
        output: `Already a git repository at ${existing}`,
        status: await readStatus(dir),
      }
    }

    return this.enqueue(dir, async () => {
      const run = await runGit(dir, ['init', '-b', branch])
      const output = combined(run)
      return { ok: run.code === 0, output, status: await readStatus(dir) }
    })
  }

  /**
   * Run a remote operation: fetch, pull, push, publish, or pull-then-push.
   *
   * `publish` exists as its own verb because a first push needs `-u` and an
   * explicit refspec, which plain `push` does not supply — that mismatch is the
   * usual cause of "fatal: no upstream branch" on a brand-new branch.
   * @param request - workspace and the operation to run.
   * @returns command output and the refreshed status.
   */
  @Remote
  async sync(request: SyncRequest): Promise<CommandResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const action = request?.action

    return this.withRepo(dir, async (root: string) => {
      const status = await readStatus(root)
      const branch = status.repo ? status.branch : undefined

      switch (action) {
        case 'fetch':
          return combined(await runGit(root, ['fetch', '--all', '--prune'], NETWORK_TIMEOUT_MS))
        case 'pull':
          // --ff-only refuses to invent a merge commit in a UI that has no
          // conflict-resolution surface; a divergent branch says so plainly.
          return combined(await runGit(root, ['pull', '--ff-only'], NETWORK_TIMEOUT_MS))
        case 'push':
          return combined(await runGit(root, ['push'], NETWORK_TIMEOUT_MS))
        case 'publish': {
          if (branch === undefined) throw new Error('dsh-git: cannot publish a detached HEAD')
          const remote = await firstRemote(root)
          if (remote === undefined) throw new Error('dsh-git: no remote is configured')
          return combined(await runGit(root, ['push', '-u', remote, branch], NETWORK_TIMEOUT_MS))
        }
        case 'sync': {
          const pull = await runGit(root, ['pull', '--ff-only'], NETWORK_TIMEOUT_MS)
          const pullText = combined(pull)
          // Pushing on top of a failed pull would just be rejected again; stop
          // and report, so the user sees the real cause instead of two errors.
          if (pull.code !== 0) return pullText
          const push = await runGit(root, ['push'], NETWORK_TIMEOUT_MS)
          return [pullText, combined(push)].filter((s) => s.length > 0).join('\n')
        }
        default:
          throw new Error(`dsh-git: unknown sync action ${String(action)}`)
      }
    })
  }

  /**
   * Ask the model to write a commit message for the current changes.
   *
   * The scope is the index whenever anything is staged, and the whole
   * uncommitted tree otherwise — see {@link collectChangeDiff}. The caller may
   * force one or the other, but the default is resolved HERE, from a fresh
   * read, rather than from whatever snapshot the browser last painted.
   *
   * The diff is truncated before it reaches the model: a large refactor would
   * otherwise blow past the context window and fail the whole call, when the
   * first few thousand lines already characterize the change.
   * @param request - workspace and an optional explicit scope.
   * @returns a conventional-commit style message and the scope it describes.
   */
  @Remote
  async suggestMessage(request: SuggestRequest): Promise<SuggestResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const root = await repoRoot(dir)
    if (root === undefined) throw new Error('dsh-git: not a git repository')

    const collected = await collectChangeDiff(root, {
      staged: typeof request?.staged === 'boolean' ? request.staged : undefined,
      maxBytes: MAX_AI_DIFF_BYTES,
    })
    if (collected.text.length === 0) {
      throw new Error(
        collected.scope === 'staged'
          ? 'dsh-git: nothing is staged to describe'
          : 'dsh-git: there are no changes to describe',
      )
    }
    const body = collected.text

    const system = [
      'You write git commit messages for a software project.',
      'Follow Conventional Commits: a `type(scope): subject` line, where type is one of feat, fix, docs, style, refactor, perf, test, build, ci, chore.',
      'The subject line must be imperative mood, lower case after the colon, no trailing period, and at most 72 characters.',
      'If the change is not trivial, add a blank line and 1-3 short bullet points starting with "- " explaining what changed and why.',
      'Return ONLY the commit message. No quotes, no code fences, no preamble, no explanation.',
    ].join('\n')

    // Naming the scope keeps the message honest about what the commit records:
    // told only "this diff", a model handed a staged subset happily writes as
    // if it were describing the whole working tree. Truncation is called out
    // for the same reason — a partial diff read as complete produces a subject
    // line confidently describing a third of the change.
    const preamble = [
      collected.scope === 'staged'
        ? 'Write a commit message for the STAGED changes below. They are exactly what the commit will record; describe nothing else.'
        : 'Write a commit message for all uncommitted changes below.',
      ...(collected.truncated
        ? ['The diff is TRUNCATED — summarize the overall change, do not claim to have seen every file.']
        : []),
    ].join('\n')

    const messages = [
      createUserMessage({
        content: [{ type: 'text', text: `${preamble}\n\n${body}` }],
        source: { kind: 'plugin', plugin: 'dsh-git' },
      }),
    ]

    // `provider` and `model` are REQUIRED by GenerateOptions: without a route
    // the runtime has no adapter to dispatch to and the stream yields nothing,
    // which surfaced as the misleading "produced no commit message". Reuse the
    // model the user already picked for new sessions rather than hardcoding one.
    const selection = this.ctx.agentDefaultModel.currentSelection()

    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream({
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort !== undefined
        ? { reasoningEffort: selection.reasoningEffort }
        : {}),
      messages,
      system,
      maxTokens: 512,
      // NOTE: `purpose` is a closed union ('compaction' | 'session-title') with
      // no commit-message member, so it is deliberately left unset.
    })) {
      assembler.push(chunk)
    }

    // A terminal error finish yields no text; report the provider's own reason
    // rather than the misleading "produced no commit message".
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new Error(`dsh-git: ${finish.failure?.message ?? finish.kind}`)
    }

    const text = assembler
      .blocks()
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('')

    const message = cleanMessage(text)
    if (message.length === 0) throw new Error('dsh-git: the model produced no commit message')
    return { message, scope: collected.scope }
  }


  /**
   * List branches, stashes and worktrees together.
   *
   * One endpoint rather than three because the tab fetches them as a unit: the
   * branch menu wants the first, the Repo pane the other two, and three round
   * trips would triple the latency for no gain. It is fetched LAZILY — on menu
   * open or pane entry — so it never lands on the polling path that
   * {@link changeToken} exists to keep cheap.
   *
   * Returns a discriminated outcome rather than bare arrays, and that is the
   * whole point of the shape. A client bundle newer than the host half 404s this
   * method, and collapsing that into empty arrays would render as "this
   * repository has no branches" instead of "restart the profile" — the exact
   * failure {@link commitFiles} was already reshaped to avoid.
   *
   * @param request - the workspace to inspect.
   * @returns the three lists, or the reason they could not be read.
   */
  @Remote
  async refs(request: RefsRequest): Promise<RefsResult> {
    try {
      const dir = this.workspaceDir(request?.workspaceId)
      const root = await repoRoot(dir)
      if (root === undefined) return { ok: false, error: 'Not a git repository.' }
      const lists = await readRefs(root)
      return { ok: true, ...lists }
    } catch (error) {
      return { ok: false, error: describe(error) }
    }
  }

  /**
   * Create, switch, delete or rename a branch.
   *
   * `stashSwitch` is a distinct action rather than a flag because it is the
   * explicit SECOND step the tab offers after a plain `switch` was refused for
   * local changes. Stashing is never implicit: an auto-stash whose later pop
   * conflicts strands work behind a state the user never chose to enter.
   *
   * @param request - workspace, action and branch names.
   * @returns command output and the refreshed status.
   */
  @Remote
  async branch(request: BranchRequest): Promise<CommandResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const action = request?.action
    // Validated up front, outside withRepo, so a bad name fails as a thrown
    // error at the boundary rather than as command output that reads like git's.
    const name = action === undefined ? undefined : assertSafeRef(request?.name)
    const startPoint =
      typeof request?.startPoint === 'string' && request.startPoint.length > 0
        ? assertSafeRef(request.startPoint)
        : undefined
    const force = request?.force === true

    return this.withRepo(dir, async (root: string) => {
      switch (action) {
        case 'create':
          return combined(
            await runGit(root, ['branch', '--', name!, ...(startPoint ? [startPoint] : [])]),
          )
        case 'switch':
          return combined(await runGit(root, ['checkout', '--', name!]))
        case 'createSwitch':
          return combined(
            await runGit(root, ['checkout', '-b', name!, ...(startPoint ? [startPoint] : [])]),
          )
        case 'delete':
          // -d refuses an unmerged branch; -D is the deliberate override the
          // client only sends after confirming.
          return combined(await runGit(root, ['branch', force ? '-D' : '-d', '--', name!]))
        case 'rename':
          return combined(await runGit(root, ['branch', '-m', '--', name!]))
        case 'stashSwitch': {
          // -u so a brand-new file is carried across too; leaving untracked work
          // behind is exactly the surprise this flow exists to prevent.
          const stash = await runGit(root, [
            'stash',
            'push',
            '-u',
            '-m',
            `dsh-git: switching to ${name!}`,
          ])
          const stashText = combined(stash)
          if (stash.code !== 0) return stashText
          const checkout = await runGit(root, ['checkout', '--', name!])
          return [stashText, combined(checkout)].filter((s) => s.length > 0).join('\n')
        }
        default:
          throw new Error(`dsh-git: unknown branch action ${String(action)}`)
      }
    })
  }

  /**
   * Merge another branch into the current one, or conclude a merge in progress.
   *
   * Unlike {@link sync}'s `pull --ff-only`, this deliberately ALLOWS a merge to
   * conflict and leaves the repository mid-merge. That reverses the old stance
   * ("no conflict-resolution surface") because the surface now exists: the
   * Changes pane already lists conflicts and already blocks Commit while any
   * remain, and `status.merging` drives a banner offering Abort.
   *
   * `--no-edit` matters on every path: git would otherwise open an editor for
   * the merge message, and with no TTY that hangs the request until the timeout.
   *
   * @param request - workspace, action, and the branch to merge from.
   * @returns command output and the refreshed status.
   */
  @Remote
  async merge(request: MergeRequest): Promise<CommandResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const action = request?.action
    const from = action === 'merge' ? assertSafeRef(request?.from) : undefined
    const noFF = request?.noFF === true

    return this.withRepo(dir, async (root: string) => {
      switch (action) {
        case 'merge':
          return combined(
            await runGit(root, [
              'merge',
              '--no-edit',
              ...(noFF ? ['--no-ff'] : []),
              '--',
              from!,
            ]),
          )
        case 'abort':
          return combined(await runGit(root, ['merge', '--abort']))
        case 'continue':
          // `commit --no-edit` rather than `merge --continue`: both conclude the
          // merge, but this one reuses MERGE_MSG without involving an editor at
          // all, and reports unresolved conflicts as plain output.
          return combined(await runGit(root, ['commit', '--no-edit']))
        default:
          throw new Error(`dsh-git: unknown merge action ${String(action)}`)
      }
    })
  }

  /**
   * Push, pop, apply, drop or clear stash entries.
   *
   * A stash index is a CURSOR into a live stack, not an identifier — dropping or
   * popping an earlier entry renumbers everything after it. The client re-reads
   * {@link refs} after every mutation for that reason, and the index is
   * validated here because it is interpolated into `stash@{N}`.
   *
   * @param request - workspace, action, and the entry to act on.
   * @returns command output and the refreshed status.
   */
  @Remote
  async stash(request: StashRequest): Promise<CommandResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const action = request?.action
    const index =
      typeof request?.index === 'number' ? assertSafeStashIndex(request.index) : undefined
    const selector = index === undefined ? undefined : `stash@{${index}}`
    const message = typeof request?.message === 'string' ? request.message.trim() : ''
    const includeUntracked = request?.includeUntracked === true

    return this.withRepo(dir, async (root: string) => {
      switch (action) {
        case 'push': {
          const args = ['stash', 'push']
          if (includeUntracked) args.push('-u')
          if (message.length > 0) args.push('-m', message)
          const run = await runGit(root, args)
          return combined(run)
        }
        case 'pop':
          return combined(
            await runGit(root, ['stash', 'pop', ...(selector ? [selector] : [])]),
          )
        case 'apply':
          return combined(
            await runGit(root, ['stash', 'apply', ...(selector ? [selector] : [])]),
          )
        case 'drop':
          return combined(
            await runGit(root, ['stash', 'drop', ...(selector ? [selector] : [])]),
          )
        case 'clear':
          return combined(await runGit(root, ['stash', 'clear']))
        default:
          throw new Error(`dsh-git: unknown stash action ${String(action)}`)
      }
    })
  }

  /**
   * Add, remove or prune a worktree.
   *
   * This is the one operation that writes OUTSIDE the workspace directory — a
   * worktree lives beside the repository by definition — so the path gets its
   * own validator rather than {@link assertSafePath}, which exists to keep file
   * operations inside the repo. See {@link resolveWorktreePath}.
   *
   * `register` additionally writes to dsh's own workspace registry, which is the
   * only place this plugin reaches outside git. It is opt-in: adding a worktree
   * and then having to register it by hand is the annoying half of the feature,
   * but doing it unasked would silently populate someone's workspace list.
   *
   * @param request - workspace, action, path and branch options.
   * @returns command output and the refreshed status.
   */
  @Remote
  async worktree(request: WorktreeRequest): Promise<CommandResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const action = request?.action
    const branch =
      typeof request?.branch === 'string' && request.branch.length > 0
        ? assertSafeRef(request.branch)
        : undefined
    const newBranch =
      typeof request?.newBranch === 'string' && request.newBranch.length > 0
        ? assertSafeRef(request.newBranch)
        : undefined
    const startPoint =
      typeof request?.startPoint === 'string' && request.startPoint.length > 0
        ? assertSafeRef(request.startPoint)
        : undefined
    const force = request?.force === true
    const register = request?.register === true

    return this.withRepo(dir, async (root: string) => {
      switch (action) {
        case 'add': {
          const target = resolveWorktreePath(root, request?.path)
          const args = ['worktree', 'add']
          if (newBranch !== undefined) args.push('-b', newBranch)
          if (force) args.push('--force')
          args.push('--', target)
          // The commit-ish comes AFTER the path in git's grammar, and it still
          // does with a `--` separator in front (verified on git 2.50):
          // `worktree add -b X -- <path> main` forks from main while HEAD is
          // elsewhere. Omitted, git uses HEAD — the current branch.
          if (newBranch !== undefined && startPoint !== undefined) {
            args.push(startPoint)
          } else if (newBranch === undefined && branch !== undefined) {
            // A bare `worktree add <path>` with no ref checks out a new branch
            // named after the directory; naming the branch is the explicit form.
            args.push(branch)
          }
          const run = await runGit(root, args)
          const output = combined(run)
          if (run.code !== 0 || !register) return output

          // Registration is best-effort ON PURPOSE: the worktree exists on disk
          // at this point, and failing the whole command would report a
          // successful git operation as an error. Say so instead.
          try {
            await this.ctx.workspaceRegistry.create(target, basename(target))
            return [output, `Registered ${target} as a workspace.`]
              .filter((s) => s.length > 0)
              .join('\n')
          } catch (error) {
            return [output, `Worktree created, but could not register it: ${describe(error)}`]
              .filter((s) => s.length > 0)
              .join('\n')
          }
        }
        case 'remove': {
          const target = resolveWorktreePath(root, request?.path)
          const args = ['worktree', 'remove']
          if (force) args.push('--force')
          args.push('--', target)
          return combined(await runGit(root, args))
        }
        case 'prune':
          return combined(await runGit(root, ['worktree', 'prune']))
        default:
          throw new Error(`dsh-git: unknown worktree action ${String(action)}`)
      }
    })
  }

  /**
   * Turn a rough description into a branch name.
   *
   * The model is used HERE and not for the worktree path, deliberately. Naming
   * is a creative problem with many good answers; deriving
   * `../myproj-feat-login` from `feat/login` is arithmetic with exactly ONE
   * right answer, and a model there would buy nondeterminism and latency to
   * compute what a regex already gets right every time.
   *
   * The hint is free text the user typed rather than a diff, because a new
   * worktree is usually for work that has NOT started — there is often nothing
   * in the tree to describe. Existing branch names are supplied so the model
   * does not propose one that already exists, which would fail on create with
   * an error the user did not cause.
   *
   * @param request - workspace and the user's rough description.
   * @returns a valid, safe branch name.
   */
  @Remote
  async suggestBranch(request: SuggestBranchRequest): Promise<SuggestBranchResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const hint = typeof request?.hint === 'string' ? request.hint.trim().slice(0, 500) : ''
    if (hint.length === 0) throw new Error('dsh-git: describe the work first')

    const root = await repoRoot(dir)
    const existing =
      root === undefined
        ? []
        : (await readRefs(root)).branches.filter((b) => !b.remote).map((b) => b.name)

    const system = [
      'You name git branches for a software project.',
      'Return a single branch name and nothing else.',
      'Use the conventional form <type>/<short-kebab-summary>, where type is one of feat, fix, chore, docs, refactor, test, perf.',
      'Lower case, words separated by hyphens, at most 40 characters, no spaces, no quotes, no trailing punctuation.',
      'Return ONLY the branch name. No preamble, no explanation, no code fences.',
    ].join('\n')

    const prompt = [
      'Suggest a branch name for this work:',
      hint,
      ...(existing.length > 0
        ? ['', 'These branches already exist, so do not reuse them:', existing.slice(0, 40).join(', ')]
        : []),
    ].join('\n')

    const selection = this.ctx.agentDefaultModel.currentSelection()
    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream({
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort !== undefined
        ? { reasoningEffort: selection.reasoningEffort }
        : {}),
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'plugin', plugin: 'dsh-git' },
        }),
      ],
      system,
      // A branch name is a few tokens; a bigger budget only buys a longer
      // ramble to throw away.
      maxTokens: 64,
    })) {
      assembler.push(chunk)
    }

    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new Error('dsh-git: ' + (finish.failure?.message ?? finish.kind))
    }

    const text = assembler
      .blocks()
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('')

    // Sanitize rather than trust: models still return quotes or a 'Branch:'
    // label sometimes, and an invalid ref would surface later as an error the
    // user did not cause and cannot act on.
    const name = normalizeBranchName(text)
    if (name.length === 0) throw new Error('dsh-git: the model produced no usable branch name')
    // Final gate: the same validator every other ref goes through.
    return { name: assertSafeRef(name) }
  }

  /**
   * Run one repository mutation on the repo's write chain and report the result.
   * @param dir - workspace directory.
   * @param run - the operation, receiving the resolved repository root.
   * @returns the uniform command result with a refreshed status.
   */
  private async withRepo(
    dir: string,
    run: (root: string) => Promise<string>,
  ): Promise<CommandResult> {
    const root = await repoRoot(dir)
    if (root === undefined) {
      return {
        ok: false,
        output: 'Not a git repository. Initialize one first.',
        status: { repo: false, root: dir },
      }
    }
    return this.enqueue(root, async () => {
      try {
        const output = await run(root)
        return { ok: true, output, status: await readStatus(root) }
      } catch (error) {
        // Git's own non-zero exits already come back as text; this catches the
        // genuine faults (git missing, timeout, refused path) so one bad click
        // renders a message instead of breaking the bridge.
        return { ok: false, output: describe(error), status: await readStatus(root) }
      }
    })
  }

  /**
   * Queue one whole operation behind this repository's prior write.
   * @param key - serialization key, the repository root.
   * @param run - the operation to run once the chain reaches it.
   * @returns whatever the operation resolved to.
   */
  private async enqueue<T>(key: string, run: () => Promise<T>): Promise<T> {
    const prior = (this.tails.get(key) as Promise<unknown> | undefined) ?? Promise.resolve()
    // Run on both settle paths so one failed command does not stall the chain.
    const next = prior.then(run, run)
    // Store the NEUTRALIZED tail: later work must wait for this one but must
    // not inherit its rejection.
    const tail = next.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(key, tail)
    try {
      return await next
    } finally {
      // Release the entry only if nothing newer queued meanwhile, so an idle
      // process does not retain one entry per repository forever.
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }

  /**
   * Nothing to open; the repository on disk is the state.
   *
   * The watchers are released through `ctx.effect()`, whose teardown runs when
   * the owning fiber unloads. Neither of the obvious alternatives works here:
   * cordis's Service declares no stop symbol (only {@link Service.init}), and
   * `dispose` is not a member of its Events map. Getting this wrong leaks an OS
   * watch handle per repository on every plugin reload.
   */
  protected async [Service.init](): Promise<void> {
    this.ctx.effect(() => () => {
      this.watcher.close()
    })
  }
}

/**
 * Resolve the first configured remote, or undefined when there is none.
 * @param root - repository working-tree root.
 * @returns the remote name, or undefined.
 */
async function firstRemote(root: string): Promise<string | undefined> {
  const run = await runGit(root, ['remote'])
  if (run.code !== 0) return undefined
  return run.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)[0]
}

/**
 * Constrain a branch name to git's own rules, conservatively.
 *
 * This value reaches `git init -b`, so a name starting with `-` would be read
 * as a flag rather than a branch.
 * @param value - untrusted branch name.
 * @returns a safe branch name, defaulting to `main`.
 */
function normalizeBranch(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return 'main'
  const name = value.trim()
  if (!/^[A-Za-z0-9._\/-]+$/.test(name) || name.startsWith('-') || name.includes('..')) {
    throw new Error(`dsh-git: invalid branch name ${name}`)
  }
  return name
}

/**
 * Strip the wrappers models add despite instructions: code fences, surrounding
 * quotes, and a leading "Commit message:" label.
 * @param raw - the model's verbatim text.
 * @returns the bare commit message.
 */
function cleanMessage(raw: string): string {
  let text = raw.trim()
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(text)
  if (fence) text = fence[1].trim()
  text = text.replace(/^(?:commit message|message)\s*:\s*/i, '').trim()
  if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).trim()
  }
  return text
}

/**
 * Clamp a patch to the wire budget, marking where it was cut.
 * @param text - the full patch.
 * @returns the patch, truncated when oversized.
 */
function clamp(text: string): string {
  if (text.length <= MAX_DIFF_BYTES) return text
  return `${text.slice(0, MAX_DIFF_BYTES)}\n\n[diff truncated at ${MAX_DIFF_BYTES} bytes]`
}

/**
 * Render an unknown throw as a short message for the output pane.
 * @param error - the caught value.
 * @returns a human-readable message.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default GitService
