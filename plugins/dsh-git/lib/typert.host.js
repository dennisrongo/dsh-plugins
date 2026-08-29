var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/remote.ts
import { z } from "zod";
var statusCodeSchema = z.enum(["M", "A", "D", "R", "C", "U", "?", "!", " "]);
var fileChangeSchema = z.object({
  path: z.string(),
  // Optional across the wire: only renames and copies carry an original path.
  origPath: z.string().optional(),
  index: statusCodeSchema,
  worktree: statusCodeSchema,
  staged: z.boolean(),
  conflicted: z.boolean(),
  untracked: z.boolean()
});
var upstreamSchema = z.object({
  name: z.string(),
  ahead: z.number(),
  behind: z.number()
});
var commitSchema = z.object({
  sha: z.string(),
  subject: z.string(),
  author: z.string(),
  date: z.number()
});
var statusSchema = z.union([
  z.object({
    repo: z.literal(false),
    root: z.string()
  }),
  z.object({
    repo: z.literal(true),
    root: z.string(),
    branch: z.string().optional(),
    head: z.string().optional(),
    unborn: z.boolean(),
    upstream: upstreamSchema.optional(),
    hasRemote: z.boolean(),
    files: z.array(fileChangeSchema),
    recent: z.array(commitSchema),
    // Optional so a host booted BEFORE these fields existed still decodes: the
    // browser's codec is strict, and a missing field would otherwise turn a
    // working tab into a decode error during the window where the client half
    // has refreshed but the host half has not restarted.
    merging: z.boolean().optional(),
    mergeHead: z.string().optional(),
    stashCount: z.number().optional()
  })
]);
var commandResultSchema = z.object({
  ok: z.boolean(),
  output: z.string(),
  status: statusSchema
});
var statusRequestSchema = z.object({ workspaceId: z.string() });
var statusResultSchema = z.object({ status: statusSchema });
var diffRequestSchema = z.object({
  workspaceId: z.string(),
  path: z.string().optional(),
  staged: z.boolean().optional()
});
var diffResultSchema = z.object({ patch: z.string(), binary: z.boolean() });
var shaSchema = z.string().regex(/^[0-9a-fA-F]{4,40}$/);
var commitFileSchema = z.object({
  path: z.string(),
  origPath: z.string().optional(),
  status: statusCodeSchema
});
var commitFilesRequestSchema = z.object({
  workspaceId: z.string(),
  sha: shaSchema
});
var commitFilesResultSchema = z.object({ files: z.array(commitFileSchema) });
var commitDiffRequestSchema = z.object({
  workspaceId: z.string(),
  sha: shaSchema,
  path: z.string().optional()
});
var commitDiffResultSchema = z.object({ patch: z.string(), binary: z.boolean() });
var stageRequestSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(["stage", "unstage", "discard"]),
  paths: z.array(z.string())
});
var commitRequestSchema = z.object({
  workspaceId: z.string(),
  message: z.string(),
  all: z.boolean().optional()
});
var suggestRequestSchema = z.object({
  workspaceId: z.string(),
  staged: z.boolean().optional()
});
var suggestResultSchema = z.object({
  message: z.string(),
  scope: z.enum(["staged", "all"]).optional()
});
var syncRequestSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(["pull", "push", "fetch", "sync", "publish"])
});
var changeTokenRequestSchema = z.object({ workspaceId: z.string() });
var changeTokenResultSchema = z.object({ token: z.number() });
var initRequestSchema = z.object({
  workspaceId: z.string(),
  branch: z.string().optional()
});
var refSchema = z.string().min(1).max(255).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine(
  (s) => !s.includes("..") && !s.includes("//") && !s.endsWith("/") && !s.endsWith(".") && !s.endsWith(".lock"),
  { message: "invalid branch name" }
);
var branchSchema = z.object({
  name: z.string(),
  current: z.boolean(),
  remote: z.boolean(),
  upstream: z.string().optional(),
  // Absent rather than zero without an upstream: "in sync" and "no upstream"
  // are different facts and the menu renders them differently.
  ahead: z.number().optional(),
  behind: z.number().optional(),
  subject: z.string().optional()
});
var stashSchema = z.object({
  index: z.number(),
  message: z.string(),
  branch: z.string().optional(),
  date: z.number().optional()
});
var worktreeSchema = z.object({
  path: z.string(),
  branch: z.string().optional(),
  head: z.string().optional(),
  main: z.boolean(),
  prunable: z.boolean(),
  locked: z.boolean(),
  current: z.boolean()
});
var refsRequestSchema = z.object({ workspaceId: z.string() });
var refsResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    branches: z.array(branchSchema),
    stashes: z.array(stashSchema),
    worktrees: z.array(worktreeSchema)
  }),
  z.object({
    ok: z.literal(false),
    error: z.string()
  })
]);
var branchRequestSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(["create", "switch", "createSwitch", "delete", "rename", "stashSwitch"]),
  name: refSchema.optional(),
  startPoint: refSchema.optional(),
  force: z.boolean().optional()
});
var mergeRequestSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(["merge", "abort", "continue"]),
  from: refSchema.optional(),
  noFF: z.boolean().optional()
});
var stashRequestSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(["push", "pop", "apply", "drop", "clear"]),
  // Interpolated into `stash@{N}` on the host, so it must be a plain integer.
  index: z.number().int().min(0).optional(),
  message: z.string().optional(),
  includeUntracked: z.boolean().optional()
});
var worktreeRequestSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(["add", "remove", "prune"]),
  // NOT constrained like a repo-relative path: a worktree lives outside the
  // repository by definition. The host's resolveWorktreePath is the boundary.
  path: z.string().optional(),
  branch: refSchema.optional(),
  newBranch: refSchema.optional(),
  force: z.boolean().optional(),
  register: z.boolean().optional()
});
var suggestBranchRequestSchema = z.object({
  workspaceId: z.string(),
  hint: z.string().optional()
});
var suggestBranchResultSchema = z.object({ name: refSchema });
var PACKAGE = "@dennisrongo/dsh-git";
function descriptor(method2, request, result) {
  return {
    id: `${PACKAGE}#dshGit/${method2}`,
    service: "dshGit",
    namespace: "dshGit",
    method: method2,
    invocation: { kind: "direct" },
    parameters: [
      {
        name: "request",
        // Must equal the host method's PARAMETER NAME: the host resolves this
        // endpoint through SRC discovery, which reads parameter names off the
        // function source.
        wire: "request",
        source: "json",
        codec: {
          mode: "strict",
          typeSymbol: `${PACKAGE}/types#${method2}Request`,
          schema: request
        }
      }
    ],
    result: {
      mode: "strict",
      typeSymbol: `${PACKAGE}/types#${method2}Result`,
      schema: result
    }
  };
}
__name(descriptor, "descriptor");
var GIT_REMOTE = {
  package: PACKAGE,
  descriptors: [
    descriptor("status", statusRequestSchema, statusResultSchema),
    descriptor("diff", diffRequestSchema, diffResultSchema),
    descriptor("commitFiles", commitFilesRequestSchema, commitFilesResultSchema),
    descriptor("commitDiff", commitDiffRequestSchema, commitDiffResultSchema),
    descriptor("stage", stageRequestSchema, commandResultSchema),
    descriptor("commit", commitRequestSchema, commandResultSchema),
    descriptor("init", initRequestSchema, commandResultSchema),
    descriptor("sync", syncRequestSchema, commandResultSchema),
    descriptor("suggestMessage", suggestRequestSchema, suggestResultSchema),
    descriptor("changeToken", changeTokenRequestSchema, changeTokenResultSchema),
    descriptor("refs", refsRequestSchema, refsResultSchema),
    descriptor("branch", branchRequestSchema, commandResultSchema),
    descriptor("merge", mergeRequestSchema, commandResultSchema),
    descriptor("stash", stashRequestSchema, commandResultSchema),
    descriptor("worktree", worktreeRequestSchema, commandResultSchema),
    descriptor("suggestBranch", suggestBranchRequestSchema, suggestBranchResultSchema)
  ]
};

// src/typert.host.ts
var PACKAGE2 = "@dennisrongo/dsh-git";
var method = /* @__PURE__ */ __name((name, signature, summary) => ({
  kind: "method",
  name,
  signature,
  summary
}), "method");
var TYPERT = {
  package: PACKAGE2,
  face: "host",
  schemas: [],
  invocations: GIT_REMOTE.descriptors,
  model: {
    services: [
      {
        tags: [],
        summary: "Per-workspace source control for the workspace's git repository.",
        description: "Runs git in the workspace directory resolved through workspaceRegistry, and writes commit messages through llm.",
        key: "dshGit",
        exportName: "GitService",
        members: [
          method("status", "@Remote status(request: StatusRequest): Promise<StatusResult>", "Read one workspace's repository snapshot."),
          method("diff", "@Remote diff(request: DiffRequest): Promise<DiffResult>", "Read a unified patch for the workspace or one path."),
          method("commitFiles", "@Remote commitFiles(request: CommitFilesRequest): Promise<CommitFilesResult>", "List the paths one commit touched."),
          method("commitDiff", "@Remote commitDiff(request: CommitDiffRequest): Promise<CommitDiffResult>", "Read the patch one commit introduced."),
          method("stage", "@Remote stage(request: StageRequest): Promise<CommandResult>", "Stage, unstage or discard paths."),
          method("commit", "@Remote commit(request: CommitRequest): Promise<CommandResult>", "Commit the staged tree."),
          method("init", "@Remote init(request: InitRequest): Promise<CommandResult>", "Initialize a repository in the workspace."),
          method("sync", "@Remote sync(request: SyncRequest): Promise<CommandResult>", "Pull, push, fetch, sync or publish."),
          method("suggestMessage", "@Remote suggestMessage(request: SuggestRequest): Promise<SuggestResult>", "Draft a commit message from the diff via the LLM."),
          method("refs", "@Remote refs(request: RefsRequest): Promise<RefsResult>", "List branches, stashes and worktrees together."),
          method("branch", "@Remote branch(request: BranchRequest): Promise<CommandResult>", "Create, switch, delete or rename a branch."),
          method("merge", "@Remote merge(request: MergeRequest): Promise<CommandResult>", "Merge a branch, or abort/continue a merge in progress."),
          method("stash", "@Remote stash(request: StashRequest): Promise<CommandResult>", "Push, pop, apply, drop or clear stash entries."),
          method("worktree", "@Remote worktree(request: WorktreeRequest): Promise<CommandResult>", "Add, remove or prune a worktree."),
          method("suggestBranch", "@Remote suggestBranch(request: SuggestBranchRequest): Promise<SuggestBranchResult>", "Draft a branch name from a short description via the LLM.")
        ],
        types: [
          {
            name: "StatusCode",
            declaration: "export type StatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!' | ' ';"
          },
          {
            name: "FileChange",
            declaration: "export interface FileChange {\n    path: string;\n    origPath?: string;\n    index: StatusCode;\n    worktree: StatusCode;\n    staged: boolean;\n    conflicted: boolean;\n    untracked: boolean;\n}"
          },
          {
            name: "Upstream",
            declaration: "export interface Upstream {\n    name: string;\n    ahead: number;\n    behind: number;\n}"
          },
          {
            name: "Commit",
            declaration: "export interface Commit {\n    sha: string;\n    subject: string;\n    author: string;\n    date: number;\n}"
          },
          {
            name: "CommitFile",
            declaration: "export interface CommitFile {\n    path: string;\n    origPath?: string;\n    status: StatusCode;\n}"
          },
          {
            name: "Branch",
            declaration: "export interface Branch {\n    name: string;\n    current: boolean;\n    remote: boolean;\n    upstream?: string;\n    ahead?: number;\n    behind?: number;\n    subject?: string;\n}"
          },
          {
            name: "Stash",
            declaration: "export interface Stash {\n    index: number;\n    message: string;\n    branch?: string;\n    date?: number;\n}"
          },
          {
            name: "Worktree",
            declaration: "export interface Worktree {\n    path: string;\n    branch?: string;\n    head?: string;\n    main: boolean;\n    prunable: boolean;\n    locked: boolean;\n    current: boolean;\n}"
          },
          {
            name: "RefsResult",
            declaration: "export type RefsResult = { ok: true; branches: Branch[]; stashes: Stash[]; worktrees: Worktree[] } | { ok: false; error: string };"
          },
          {
            name: "GitStatus",
            declaration: "export type GitStatus = { repo: false; root: string } | { repo: true; root: string; branch?: string; head?: string; unborn: boolean; upstream?: Upstream; hasRemote: boolean; files: FileChange[]; recent: Commit[]; merging?: boolean; mergeHead?: string; stashCount?: number };"
          },
          {
            name: "CommandResult",
            declaration: "export interface CommandResult {\n    ok: boolean;\n    output: string;\n    status: GitStatus;\n}"
          }
        ]
      }
    ],
    events: [],
    objects: []
  }
};
export {
  TYPERT
};
