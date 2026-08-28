var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/remote.ts
import { z } from "zod";
var PACKAGE = "@dennisrongo/dsh-mission-control";
var SERVICE = "dshMissionControl";
var loadRequestSchema = z.object({});
var loadResultSchema = z.object({ state: z.union([z.string(), z.null()]) });
var saveRequestSchema = z.object({ state: z.string() });
var saveResultSchema = z.object({ ok: z.literal(true) });
function descriptor(method, request, result) {
  return {
    id: `${PACKAGE}#${SERVICE}/${method}`,
    service: SERVICE,
    namespace: SERVICE,
    method,
    invocation: { kind: "direct" },
    parameters: [
      {
        name: "request",
        // Must equal the host method's PARAMETER NAME: the gateway resolves
        // the endpoint through SRC discovery, which reads parameter names off
        // the function source (why the host build keeps minify off).
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
var MC_REMOTE = {
  package: PACKAGE,
  descriptors: [
    descriptor("load", loadRequestSchema, loadResultSchema),
    descriptor("save", saveRequestSchema, saveResultSchema)
  ]
};

// src/typert.host.ts
var PACKAGE2 = "@dennisrongo/dsh-mission-control";
var TYPERT = {
  package: PACKAGE2,
  face: "host",
  schemas: [],
  invocations: MC_REMOTE.descriptors,
  model: {
    services: [
      {
        tags: [],
        summary: "Origin-independent persisted state cell for the Mission Control panel.",
        description: "One JSON cell per harness home at <DSH_HOME>/storages/dsh-mission-control.json. Exists because DSH Desktop serves the UI from an ephemeral port per launch and localStorage is origin-scoped, so browser storage cannot survive a restart.",
        key: "dshMissionControl",
        exportName: "MissionControlService",
        members: [
          {
            kind: "method",
            name: "load",
            signature: "@Remote load(request: {}): Promise<McLoadResult>",
            summary: "Read the state cell, or null when nothing was saved yet."
          },
          {
            kind: "method",
            name: "save",
            signature: "@Remote save(request: { state: string }): Promise<{ ok: true }>",
            summary: "Atomically replace the state cell."
          }
        ],
        types: [
          {
            name: "McLoadResult",
            declaration: "export interface McLoadResult {\n    state: string | null;\n}"
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
