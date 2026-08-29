var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/remote.ts
import { z } from "zod";
var statusSchema = z.enum(["pending", "approved", "rejected"]);
var planMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  sessionId: z.string(),
  createdAt: z.number(),
  status: statusSchema,
  decidedAt: z.number().optional(),
  feedback: z.string().optional(),
  bytes: z.number()
});
var planRecordSchema = planMetaSchema.extend({ body: z.string() });
var listRequestSchema = z.object({ workspaceId: z.string() });
var listResultSchema = z.object({ plans: z.array(planMetaSchema), token: z.number() });
var getRequestSchema = z.object({ workspaceId: z.string(), id: z.string() });
var getResultSchema = z.object({ plan: planRecordSchema.optional() });
var tokenResultSchema = z.object({ token: z.number(), pendingId: z.string().optional() });
var removeResultSchema = z.object({ ok: z.boolean(), token: z.number() });
var PACKAGE = "@dennisrongo/dsh-plan-board";
function descriptor(method, request, result) {
  return {
    id: `${PACKAGE}#dshPlans/${method}`,
    service: "dshPlans",
    namespace: "dshPlans",
    method,
    invocation: { kind: "direct" },
    parameters: [
      {
        name: "request",
        // Must equal the host method's PARAMETER NAME: the gateway resolves the
        // endpoint through SRC discovery, reading names off the function
        // source. This is also why the host bundle is never minified.
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
var PLANS_REMOTE = {
  package: PACKAGE,
  descriptors: [
    descriptor("list", listRequestSchema, listResultSchema),
    descriptor("get", getRequestSchema, getResultSchema),
    descriptor("changeToken", listRequestSchema, tokenResultSchema),
    descriptor("discard", getRequestSchema, removeResultSchema)
  ]
};

// src/typert.host.ts
var PACKAGE2 = "@dennisrongo/dsh-plan-board";
var TYPERT = {
  package: PACKAGE2,
  face: "host",
  schemas: [],
  invocations: PLANS_REMOTE.descriptors,
  model: {
    services: [
      {
        tags: [],
        summary: "Durable per-workspace plans captured from exit_plan_mode.",
        description: "Wraps the exit_plan_mode dispatch to write each presented plan to <workspace>/.dsh/plans/<id>.md as markdown with JSON frontmatter, then settles it to approved or rejected from the review outcome, keeping the reviewer feedback that otherwise exists only as a thrown error message.",
        key: "dshPlans",
        exportName: "PlanService",
        members: [
          {
            kind: "method",
            name: "list",
            signature: "@Remote list(request: PlanListRequest): Promise<PlanListResult>",
            summary: "Every plan's metadata for one workspace, newest first."
          },
          {
            kind: "method",
            name: "get",
            signature: "@Remote get(request: PlanGetRequest): Promise<PlanGetResult>",
            summary: "One plan with its markdown body."
          },
          {
            kind: "method",
            name: "changeToken",
            signature: "@Remote changeToken(request: PlanListRequest): Promise<PlanTokenResult>",
            summary: "Monotonic change token plus the newest pending plan id."
          },
          {
            kind: "method",
            name: "discard",
            signature: "@Remote discard(request: PlanGetRequest): Promise<PlanRemoveResult>",
            summary: "Delete one plan file."
          }
        ],
        types: [
          {
            name: "PlanMeta",
            declaration: "export interface PlanMeta {\n    id: string;\n    title: string;\n    sessionId: string;\n    createdAt: number;\n    status: 'pending' | 'approved' | 'rejected';\n    decidedAt?: number;\n    feedback?: string;\n    bytes: number;\n}"
          },
          {
            name: "PlanRecord",
            declaration: "export interface PlanRecord extends PlanMeta {\n    body: string;\n}"
          },
          {
            name: "PlanListRequest",
            declaration: "export interface PlanListRequest {\n    workspaceId: string;\n}"
          },
          {
            name: "PlanListResult",
            declaration: "export interface PlanListResult {\n    plans: PlanMeta[];\n    token: number;\n}"
          },
          {
            name: "PlanGetRequest",
            declaration: "export interface PlanGetRequest {\n    workspaceId: string;\n    id: string;\n}"
          },
          {
            name: "PlanGetResult",
            declaration: "export interface PlanGetResult {\n    plan?: PlanRecord;\n}"
          },
          {
            name: "PlanTokenResult",
            declaration: "export interface PlanTokenResult {\n    token: number;\n    pendingId?: string;\n}"
          },
          {
            name: "PlanRemoveResult",
            declaration: "export interface PlanRemoveResult {\n    ok: boolean;\n    token: number;\n}"
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
