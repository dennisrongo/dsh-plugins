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
    recent: z.array(commitSchema)
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
    descriptor("changeToken", changeTokenRequestSchema, changeTokenResultSchema)
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
          method("suggestMessage", "@Remote suggestMessage(request: SuggestRequest): Promise<SuggestResult>", "Draft a commit message from the diff via the LLM.")
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
            name: "GitStatus",
            declaration: "export type GitStatus = { repo: false; root: string } | { repo: true; root: string; branch?: string; head?: string; unborn: boolean; upstream?: Upstream; hasRemote: boolean; files: FileChange[]; recent: Commit[] };"
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
