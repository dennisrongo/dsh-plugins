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
  type CommandResult,
  type CommitRequest,
  type DiffRequest,
  type DiffResult,
  type InitRequest,
  type StageRequest,
  type StatusRequest,
  type StatusResult,
  type SuggestRequest,
  type SuggestResult,
  type SyncRequest,
} from './types.ts'
import { assertSafePath, combined, readStatus, repoRoot, runGit } from './git.ts'

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
        const show = await runGit(root, [
          'diff',
          '--no-color',
          '--no-index',
          '--',
          '/dev/null',
          path,
        ])
        const text = show.stdout
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
   * The diff is truncated before it reaches the model: a large refactor would
   * otherwise blow past the context window and fail the whole call, when the
   * first few thousand lines already characterize the change.
   * @param request - workspace and whether to describe the staged diff.
   * @returns a conventional-commit style message.
   */
  @Remote
  async suggestMessage(request: SuggestRequest): Promise<SuggestResult> {
    const dir = this.workspaceDir(request?.workspaceId)
    const root = await repoRoot(dir)
    if (root === undefined) throw new Error('dsh-git: not a git repository')

    const staged = request?.staged === true
    const diffArgs = ['diff', '--no-color', '--no-ext-diff']
    if (staged) diffArgs.push('--cached')
    const diffRun = await runGit(root, diffArgs)
    let diff = diffRun.stdout

    // With nothing staged and nothing modified there may still be brand-new
    // files, which never appear in `git diff`. Fall back to their names so the
    // model can at least describe what is being added.
    if (diff.trim().length === 0) {
      const status = await readStatus(root)
      const names =
        status.repo && status.files.length > 0
          ? status.files
              .map((f) => `${f.untracked ? 'new file' : 'changed'}: ${f.path}`)
              .join('\n')
          : ''
      if (names.length === 0) throw new Error('dsh-git: there are no changes to describe')
      diff = `Files affected (no textual diff available):\n${names}`
    }

    const truncated = diff.length > MAX_AI_DIFF_BYTES
    const body = truncated ? `${diff.slice(0, MAX_AI_DIFF_BYTES)}\n[diff truncated]` : diff

    const system = [
      'You write git commit messages for a software project.',
      'Follow Conventional Commits: a `type(scope): subject` line, where type is one of feat, fix, docs, style, refactor, perf, test, build, ci, chore.',
      'The subject line must be imperative mood, lower case after the colon, no trailing period, and at most 72 characters.',
      'If the change is not trivial, add a blank line and 1-3 short bullet points starting with "- " explaining what changed and why.',
      'Return ONLY the commit message. No quotes, no code fences, no preamble, no explanation.',
    ].join('\n')

    const messages = [
      createUserMessage({
        content: [{ type: 'text', text: `Write a commit message for this diff:\n\n${body}` }],
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
    return { message }
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

  /** Nothing to open; the repository on disk is the state. */
  protected async [Service.init](): Promise<void> {}
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
