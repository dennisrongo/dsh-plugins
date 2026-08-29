var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/remote.ts
import { z } from "zod";

// src/types.ts
var HOOK_EVENTS = [
  /** `tools/pre-execute` — allow / deny / ask before a tool dispatches. */
  "PreToolUse",
  /** `tools/post-execute` — accept / block a settled tool result, or add context. */
  "PostToolUse",
  /** `agent/pre-step`, gated to steps that claimed a user-sourced message. */
  "UserPromptSubmit",
  /** `agent/session-start` — fires for startup, resume, clear AND compact. */
  "SessionStart",
  /** `agent/disposed` — observe only; teardown is never delayed on a decision. */
  "SessionEnd",
  /** `agent/turn-stopping` — may steer the agent back into another step. */
  "Stop",
  /** `subagent/end` — observe only. */
  "SubagentStop",
  /** `approval/request` — observe only; the approval waterfall decides. */
  "Notification"
];
var HOOK_EVENT_SET = new Set(HOOK_EVENTS);
var MAX_OUTPUT_BYTES = 256 * 1024;

// src/remote.ts
var hookOutputSchema = z.object({
  continue: z.boolean().optional(),
  stopReason: z.string().optional(),
  suppressOutput: z.boolean().optional(),
  systemMessage: z.string().optional(),
  decision: z.enum(["block", "approve"]).optional(),
  reason: z.string().optional(),
  hookSpecificOutput: z.object({
    hookEventName: z.string().optional(),
    permissionDecision: z.enum(["allow", "deny", "ask"]).optional(),
    permissionDecisionReason: z.string().optional(),
    additionalContext: z.string().optional()
  }).optional()
});
var hookRunSchema = z.object({
  event: z.enum(HOOK_EVENTS),
  command: z.string(),
  source: z.enum(["user", "project"]),
  sessionId: z.string(),
  toolName: z.string().optional(),
  startedAt: z.number(),
  durationMs: z.number(),
  exitCode: z.union([z.number(), z.literal(null)]),
  signal: z.union([z.string(), z.literal(null)]),
  timedOut: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  output: hookOutputSchema.optional(),
  error: z.string().optional()
});
var describeRequestSchema = z.object({ workspaceId: z.string().optional() });
var describeResultSchema = z.object({
  enabled: z.boolean(),
  shell: z.array(z.string()),
  userOrigin: z.string().optional(),
  projectOrigin: z.string().optional(),
  hooks: z.array(
    z.object({
      event: z.enum(HOOK_EVENTS),
      matcher: z.string().optional(),
      command: z.string(),
      timeout: z.number(),
      failClosed: z.boolean(),
      source: z.enum(["user", "project"])
    })
  )
});
var recentRequestSchema = z.object({ limit: z.number().optional() });
var recentResultSchema = z.object({ runs: z.array(hookRunSchema) });
var PACKAGE = "@dennisrongo/dsh-hooks";
function descriptor(method, request, result) {
  return {
    id: `${PACKAGE}#dshHooks/${method}`,
    service: "dshHooks",
    namespace: "dshHooks",
    method,
    invocation: { kind: "direct" },
    parameters: [
      {
        name: "request",
        // Must equal the host method's PARAMETER NAME: the gateway resolves the
        // endpoint through SRC discovery, reading names off the function source.
        // This is also why the host bundle is never minified.
        wire: "request",
        source: "json",
        codec: {
          mode: "strict",
          typeSymbol: `${PACKAGE}/types#${method}Request`,
          schema: request
        }
      }
    ],
    result: {
      mode: "strict",
      typeSymbol: `${PACKAGE}/types#${method}Result`,
      schema: result
    }
  };
}
__name(descriptor, "descriptor");
var HOOKS_REMOTE = {
  package: PACKAGE,
  descriptors: [
    descriptor("describe", describeRequestSchema, describeResultSchema),
    descriptor("recent", recentRequestSchema, recentResultSchema)
  ]
};

// src/typert.host.ts
var PACKAGE2 = "@dennisrongo/dsh-hooks";
var TYPERT = {
  package: PACKAGE2,
  face: "host",
  schemas: [],
  invocations: HOOKS_REMOTE.descriptors,
  model: {
    services: [
      {
        tags: [],
        summary: "Claude Code-compatible hook lifecycle for dsh.",
        description: "Runs configured shell commands at dsh lifecycle points (tools/pre-execute, tools/post-execute, agent/pre-step, agent/session-start, agent/turn-stopping, agent/disposed, subagent/end, approval/request), merging a dsh-hooks settings namespace with <workspace>/.dsh/hooks.json.",
        key: "dshHooks",
        exportName: "HooksService",
        members: [
          {
            kind: "method",
            name: "describe",
            signature: "@Remote describe(request: HooksDescribeRequest): Promise<HooksDescribeResult>",
            summary: "Describe the hooks in force across both configuration layers."
          },
          {
            kind: "method",
            name: "recent",
            signature: "@Remote recent(request: HooksRecentRequest): Promise<HooksRecentResult>",
            summary: "The most recent settled hook runs, newest first."
          }
        ],
        types: [
          {
            name: "HooksDescribeRequest",
            declaration: "export interface HooksDescribeRequest {\n    workspaceId?: string;\n}"
          },
          {
            name: "HooksDescribeResult",
            declaration: "export interface HooksDescribeResult {\n    enabled: boolean;\n    shell: string[];\n    userOrigin?: string;\n    projectOrigin?: string;\n    hooks: Array<{ event: string; matcher?: string; command: string; timeout: number; failClosed: boolean; source: 'user' | 'project' }>;\n}"
          },
          {
            name: "HooksRecentRequest",
            declaration: "export interface HooksRecentRequest {\n    limit?: number;\n}"
          },
          {
            name: "HooksRecentResult",
            declaration: "export interface HooksRecentResult {\n    runs: HookRun[];\n}"
          },
          {
            name: "HookRun",
            declaration: "export interface HookRun {\n    event: string;\n    command: string;\n    source: 'user' | 'project';\n    sessionId: string;\n    toolName?: string;\n    startedAt: number;\n    durationMs: number;\n    exitCode: number | null;\n    signal: string | null;\n    timedOut: boolean;\n    stdout: string;\n    stderr: string;\n    output?: HookOutput;\n    error?: string;\n}"
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
