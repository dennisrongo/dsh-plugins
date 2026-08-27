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
          method('stage', '@Remote stage(request: StageRequest): Promise<CommandResult>', 'Stage, unstage or discard paths.'),
          method('commit', '@Remote commit(request: CommitRequest): Promise<CommandResult>', 'Commit the staged tree.'),
          method('init', '@Remote init(request: InitRequest): Promise<CommandResult>', 'Initialize a repository in the workspace.'),
          method('sync', '@Remote sync(request: SyncRequest): Promise<CommandResult>', 'Pull, push, fetch, sync or publish.'),
          method('suggestMessage', '@Remote suggestMessage(request: SuggestRequest): Promise<SuggestResult>', 'Draft a commit message from the diff via the LLM.'),
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
            name: 'GitStatus',
            declaration:
              'export type GitStatus = { repo: false; root: string } | { repo: true; root: string; branch?: string; head?: string; unborn: boolean; upstream?: Upstream; hasRemote: boolean; files: FileChange[]; recent: Commit[] };',
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
