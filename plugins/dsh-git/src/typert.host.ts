/**
 * Host-face Typert manifest for the `dshGit` service.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `@deepseek-ai/dsh-typert-loader` is what actually publishes a host service's
 * `@Remote` methods to the API gateway. It does NOT scan classes: on every
 * loader entry it resolves the owning package's `package.json`, looks for a
 * `"./typert"` subpath export, imports it, and registers the `TYPERT` manifest
 * it finds there.
 *
 * A package without that export is **skipped silently** — no warning, no error.
 * The service still constructs, which makes the failure look like a working
 * plugin whose methods 404:
 *
 *     client api: dshGit/status failed: ... HTTP 404
 *
 * ...surfaced in the Changes tab as "Couldn't read the repository", which reads
 * like a git problem but is really an unpublished service.
 *
 * Shipped dsh packages get this file from `dsh-typert-generator`. A third-party
 * plugin has no generator step, so — exactly like `src/remote.ts` on the client
 * side — it is written by hand and must satisfy the same validator.
 *
 * The invocation descriptors are derived from the SAME `GIT_REMOTE` contribution
 * the browser mounts, so the two faces cannot drift.
 *
 * Registration requires a full harness RESTART, not a refresh: the loader caches
 * its per-package verdict for the process lifetime.
 *
 * @module @dennisrongo/dsh-git/typert
 */
import { GIT_REMOTE } from './remote.ts'

const PACKAGE = '@dennisrongo/dsh-git'

/** One model member entry per published method. */
const method = (name: string, signature: string, summary: string) => ({
  kind: 'method' as const,
  name,
  signature,
  summary,
})

/**
 * The host manifest. Every required field is enforced by
 * `validateTypertManifest` in dsh-typert-loader: `package` must equal the
 * exporting package, `face` must be `'host'`, `schemas` must be an array of
 * real zod v4 instances (empty is legal), `model` must carry `services`,
 * `events` and `objects` arrays, and each service needs `tags`, `key`,
 * `exportName`, `members` and `types`.
 *
 * `key` must match the cordis service key the host registers, which
 * `GitService` sets by passing `'dshGit'` to `super()`.
 */
export const TYPERT = {
  package: PACKAGE,
  face: 'host' as const,
  schemas: [],
  invocations: GIT_REMOTE.descriptors,
  model: {
    services: [
      {
        tags: [],
        summary: "Per-workspace source control for the workspace's git repository.",
        description:
          'Runs git in the workspace directory resolved through workspaceRegistry, and writes commit messages through llm.',
        key: 'dshGit',
        exportName: 'GitService',
        members: [
          method('status', '@Remote status(request: StatusRequest): Promise<StatusResult>', 'Read one workspace\'s repository snapshot.'),
          method('diff', '@Remote diff(request: DiffRequest): Promise<DiffResult>', 'Read a unified patch for the workspace or one path.'),
          method('commitFiles', '@Remote commitFiles(request: CommitFilesRequest): Promise<CommitFilesResult>', 'List the paths one commit touched.'),
          method('commitDiff', '@Remote commitDiff(request: CommitDiffRequest): Promise<CommitDiffResult>', 'Read the patch one commit introduced.'),
          method('stage', '@Remote stage(request: StageRequest): Promise<CommandResult>', 'Stage, unstage or discard paths.'),
          method('commit', '@Remote commit(request: CommitRequest): Promise<CommandResult>', 'Commit the staged tree.'),
          method('init', '@Remote init(request: InitRequest): Promise<CommandResult>', 'Initialize a repository in the workspace.'),
          method('sync', '@Remote sync(request: SyncRequest): Promise<CommandResult>', 'Pull, push, fetch, sync or publish.'),
          method('suggestMessage', '@Remote suggestMessage(request: SuggestRequest): Promise<SuggestResult>', 'Draft a commit message from the diff via the LLM.'),
          method('refs', '@Remote refs(request: RefsRequest): Promise<RefsResult>', 'List branches, stashes and worktrees together.'),
          method('branch', '@Remote branch(request: BranchRequest): Promise<CommandResult>', 'Create, switch, delete or rename a branch.'),
          method('merge', '@Remote merge(request: MergeRequest): Promise<CommandResult>', 'Merge a branch, or abort/continue a merge in progress.'),
          method('stash', '@Remote stash(request: StashRequest): Promise<CommandResult>', 'Push, pop, apply, drop or clear stash entries.'),
          method('worktree', '@Remote worktree(request: WorktreeRequest): Promise<CommandResult>', 'Add, remove or prune a worktree.'),
          method('suggestBranch', '@Remote suggestBranch(request: SuggestBranchRequest): Promise<SuggestBranchResult>', 'Draft a branch name from a short description via the LLM.'),
          method('stashFiles', '@Remote stashFiles(request: StashFilesRequest): Promise<StashFilesResult>', 'List every path a stash holds, tracked edits and untracked additions alike.'),
          method('stashDiff', '@Remote stashDiff(request: StashDiffRequest): Promise<StashDiffResult>', 'The patch a stash holds, optionally narrowed to one path.'),
        ],
        types: [
          {
            name: 'StatusCode',
            declaration: "export type StatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!' | ' ';",
          },
          {
            name: 'FileChange',
            declaration:
              'export interface FileChange {\n    path: string;\n    origPath?: string;\n    index: StatusCode;\n    worktree: StatusCode;\n    staged: boolean;\n    conflicted: boolean;\n    untracked: boolean;\n}',
          },
          {
            name: 'Upstream',
            declaration: 'export interface Upstream {\n    name: string;\n    ahead: number;\n    behind: number;\n}',
          },
          {
            name: 'Commit',
            declaration:
              'export interface Commit {\n    sha: string;\n    subject: string;\n    author: string;\n    date: number;\n}',
          },
          {
            name: 'CommitFile',
            declaration:
              'export interface CommitFile {\n    path: string;\n    origPath?: string;\n    status: StatusCode;\n}',
          },
          {
            name: 'Branch',
            declaration:
              'export interface Branch {\n    name: string;\n    current: boolean;\n    remote: boolean;\n    upstream?: string;\n    ahead?: number;\n    behind?: number;\n    subject?: string;\n}',
          },
          {
            name: 'Stash',
            declaration:
              'export interface Stash {\n    index: number;\n    message: string;\n    branch?: string;\n    date?: number;\n    sha?: string;\n}',
          },
          {
            name: 'StashFile',
            declaration:
              'export interface StashFile {\n    path: string;\n    origPath?: string;\n    status: StatusCode;\n    untracked?: boolean;\n}',
          },
          {
            name: 'StashFilesResult',
            declaration: 'export interface StashFilesResult {\n    files: StashFile[];\n}',
          },
          {
            name: 'StashDiffResult',
            declaration: 'export interface StashDiffResult {\n    patch: string;\n    binary: boolean;\n}',
          },
          {
            name: 'Worktree',
            declaration:
              'export interface Worktree {\n    path: string;\n    branch?: string;\n    head?: string;\n    main: boolean;\n    prunable: boolean;\n    locked: boolean;\n    current: boolean;\n}',
          },
          {
            name: 'RefsResult',
            declaration:
              'export type RefsResult = { ok: true; branches: Branch[]; stashes: Stash[]; worktrees: Worktree[] } | { ok: false; error: string };',
          },
          {
            name: 'GitStatus',
            declaration:
              'export type GitStatus = { repo: false; root: string } | { repo: true; root: string; branch?: string; head?: string; unborn: boolean; upstream?: Upstream; hasRemote: boolean; files: FileChange[]; recent: Commit[]; merging?: boolean; mergeHead?: string; stashCount?: number };',
          },
          {
            name: 'CommandResult',
            declaration:
              'export interface CommandResult {\n    ok: boolean;\n    output: string;\n    status: GitStatus;\n}',
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
