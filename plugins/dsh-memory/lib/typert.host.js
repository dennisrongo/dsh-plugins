var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/remote.ts
import { z } from "zod";
var rowSchema = z.object({
  displayPath: z.string(),
  absolutePath: z.string(),
  bytes: z.number(),
  included: z.boolean(),
  truncatedTo: z.number().optional()
});
var reportSchema = z.object({
  cwd: z.string(),
  dshHome: z.string(),
  maxBytes: z.number(),
  discoveredBytes: z.number(),
  files: z.array(rowSchema)
});
var inspectRequestSchema = z.object({ workspaceId: z.string() });
var inspectResultSchema = z.object({ report: reportSchema });
var rememberRequestSchema = z.object({
  workspaceId: z.string(),
  fact: z.string(),
  scope: z.enum(["project", "local", "user"])
});
var rememberResultSchema = z.union([
  z.object({ ok: z.literal(true), path: z.string(), line: z.string() }),
  z.object({ ok: z.literal(false), reason: z.string() })
]);
var readRequestSchema = z.object({ workspaceId: z.string(), absolutePath: z.string() });
var readResultSchema = z.object({ text: z.string().optional() });
var PACKAGE = "@dennisrongo/dsh-memory";
function descriptor(method, request, result) {
  return {
    id: `${PACKAGE}#dshMemory/${method}`,
    service: "dshMemory",
    namespace: "dshMemory",
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
var MEMORY_REMOTE = {
  package: PACKAGE,
  descriptors: [
    descriptor("inspect", inspectRequestSchema, inspectResultSchema),
    descriptor("remember", rememberRequestSchema, rememberResultSchema),
    descriptor("read", readRequestSchema, readResultSchema)
  ]
};

// src/typert.host.ts
var PACKAGE2 = "@dennisrongo/dsh-memory";
var TYPERT = {
  package: PACKAGE2,
  face: "host",
  schemas: [],
  invocations: MEMORY_REMOTE.descriptors,
  model: {
    services: [
      {
        tags: [],
        summary: "Write and inspect AGENTS.md/CLAUDE.md workspace instructions.",
        description: "Appends facts to the right instruction file in dsh-agent-instructions' hierarchy (project AGENTS.md, the AGENTS.local.md overlay, or the user-global $DSH_HOME/AGENTS.md) and reports which discovered files the loader's byte budget actually kept, using the loader's own discovery and rendering functions rather than a reimplementation.",
        key: "dshMemory",
        exportName: "MemoryService",
        members: [
          {
            kind: "method",
            name: "inspect",
            signature: "@Remote inspect(request: MemoryInspectRequest): Promise<MemoryInspectResult>",
            summary: "Every discovered instruction file and whether the byte budget kept it."
          },
          {
            kind: "method",
            name: "remember",
            signature: "@Remote remember(request: MemoryRememberRequest): Promise<MemoryRememberResult>",
            summary: "Append one fact to the instruction file for the chosen scope."
          },
          {
            kind: "method",
            name: "read",
            signature: "@Remote read(request: MemoryReadRequest): Promise<MemoryReadResult>",
            summary: "Read one discovered instruction file."
          }
        ],
        types: [
          {
            name: "InstructionRow",
            declaration: "export interface InstructionRow {\n    displayPath: string;\n    absolutePath: string;\n    bytes: number;\n    included: boolean;\n    truncatedTo?: number;\n}"
          },
          {
            name: "InstructionReport",
            declaration: "export interface InstructionReport {\n    cwd: string;\n    dshHome: string;\n    maxBytes: number;\n    discoveredBytes: number;\n    files: InstructionRow[];\n}"
          },
          {
            name: "MemoryInspectRequest",
            declaration: "export interface MemoryInspectRequest {\n    workspaceId: string;\n}"
          },
          {
            name: "MemoryInspectResult",
            declaration: "export interface MemoryInspectResult {\n    report: InstructionReport;\n}"
          },
          {
            name: "MemoryRememberRequest",
            declaration: "export interface MemoryRememberRequest {\n    workspaceId: string;\n    fact: string;\n    scope: 'project' | 'local' | 'user';\n}"
          },
          {
            name: "MemoryRememberResult",
            declaration: "export type MemoryRememberResult = { ok: true; path: string; line: string } | { ok: false; reason: string };"
          },
          {
            name: "MemoryReadRequest",
            declaration: "export interface MemoryReadRequest {\n    workspaceId: string;\n    absolutePath: string;\n}"
          },
          {
            name: "MemoryReadResult",
            declaration: "export interface MemoryReadResult {\n    text?: string;\n}"
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
