var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/remote.ts
import { z } from "zod";
var todoItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(["backlog", "todo", "in-progress", "blocked", "done"]),
  priority: z.enum(["p0", "p1", "p2", "p3"]),
  release: z.string().optional(),
  sprint: z.string().optional(),
  dueDate: z.string().optional(),
  sessionId: z.string().optional(),
  createdAt: z.number(),
  completedAt: z.number().optional(),
  archivedAt: z.number().optional()
});
var todoListSchema = z.object({
  items: z.array(todoItemSchema),
  revision: z.number(),
  updatedAt: z.number()
});
var listRequestSchema = z.object({ workspaceId: z.string() });
var listResultSchema = z.object({ list: todoListSchema });
var replaceRequestSchema = z.object({
  workspaceId: z.string(),
  items: z.array(todoItemSchema),
  ifRevision: z.union([z.number(), z.literal(null)])
});
var replaceResultSchema = z.union([
  z.object({ ok: z.literal(true), list: todoListSchema }),
  z.object({
    ok: z.literal(false),
    code: z.literal("revision-conflict"),
    list: todoListSchema
  })
]);
var PACKAGE = "@dennisrongo/dsh-todo";
function descriptor(method, request, result) {
  return {
    id: `${PACKAGE}#dshTodo/${method}`,
    service: "dshTodo",
    namespace: "dshTodo",
    method,
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
var TODO_REMOTE = {
  package: PACKAGE,
  descriptors: [
    descriptor("list", listRequestSchema, listResultSchema),
    descriptor("replace", replaceRequestSchema, replaceResultSchema)
  ]
};

// src/typert.host.ts
var PACKAGE2 = "@dennisrongo/dsh-todo";
var TYPERT = {
  package: PACKAGE2,
  face: "host",
  schemas: [],
  invocations: TODO_REMOTE.descriptors,
  model: {
    services: [
      {
        tags: [],
        summary: "Per-workspace todo list owned by the host.",
        description: "Durable owner of every workspace's todo list, stored as one SQLite database per project at <workspace>/.dsh/todo.db and resolved through workspaceRegistry.",
        key: "dshTodo",
        exportName: "TodoService",
        members: [
          {
            kind: "method",
            name: "list",
            signature: "@Remote list(request: TodoListRequest): Promise<TodoListResult>",
            summary: "Read one workspace's list."
          },
          {
            kind: "method",
            name: "replace",
            signature: "@Remote replace(request: TodoReplaceRequest): Promise<TodoReplaceResult>",
            summary: "Replace one workspace's list, guarded by the observed revision."
          }
        ],
        types: [
          {
            name: "TodoItem",
            declaration: "export interface TodoItem {\n    id: string;\n    text: string;\n    done: boolean;\n    createdAt: number;\n    completedAt?: number;\n    archivedAt?: number;\n}"
          },
          {
            name: "TodoList",
            declaration: "export interface TodoList {\n    items: TodoItem[];\n    revision: number;\n    updatedAt: number;\n}"
          },
          {
            name: "TodoListRequest",
            declaration: "export interface TodoListRequest {\n    workspaceId: string;\n}"
          },
          {
            name: "TodoListResult",
            declaration: "export interface TodoListResult {\n    list: TodoList;\n}"
          },
          {
            name: "TodoReplaceRequest",
            declaration: "export interface TodoReplaceRequest {\n    workspaceId: string;\n    items: TodoItem[];\n    ifRevision: number | null;\n}"
          },
          {
            name: "TodoReplaceResult",
            declaration: "export type TodoReplaceResult = { ok: true; list: TodoList } | { ok: false; code: 'revision-conflict'; list: TodoList };"
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
