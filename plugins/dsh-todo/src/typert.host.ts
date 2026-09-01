/**
 * Host-face Typert manifest for the `dshTodo` service.
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
 * The service still constructs (so side effects like opening SQLite still run),
 * which makes the failure look like a working plugin whose methods 404:
 *
 *     client api: dshTodo/list failed: ... HTTP 404
 *
 * Shipped dsh packages get this file from `dsh-typert-generator`. A third-party
 * plugin has no generator step, so — exactly like `src/remote.ts` on the client
 * side — it is written by hand and must satisfy the same validator.
 *
 * The invocation descriptors here are intentionally derived from the SAME
 * `TODO_REMOTE` contribution the browser mounts. The two faces cannot drift:
 * one edit to `src/remote.ts` moves both ends of the bridge.
 *
 * Registration requires a full harness RESTART, not a refresh: the loader
 * caches its per-package verdict for the process lifetime, so a package that
 * had no `./typert` export when the process booted stays skipped.
 *
 * @module @dennisrongo/dsh-todo/typert
 */
import { TODO_REMOTE } from './remote.ts'

const PACKAGE = '@dennisrongo/dsh-todo'

/**
 * The host manifest. Shape and every required field are enforced by
 * `validateTypertManifest` in dsh-typert-loader; the notes below record what
 * that validator demands, so a future edit does not have to re-derive it.
 *
 * - `package` MUST equal the package that exports this module.
 * - `face` MUST be the literal `'host'`.
 * - `schemas` MUST be an array; each entry needs a non-empty `name` and a
 *   real zod v4 instance (checked via `'_zod' in schema`). Empty is legal.
 * - `model` MUST be an object with `services`, `events` and `objects` arrays.
 *   Each service needs `tags` (array), `key`, `exportName`, `members` and
 *   `types`; each member needs `name`, `signature` and a `kind` drawn from
 *   property|method|getter|setter|call|construct|index.
 * - `invocations` reuses the client descriptors unchanged.
 *
 * `model` is the model-visible projection (documentation), NOT the wire
 * contract — the gateway dispatches from `invocations`. `key` must match the
 * cordis service key the host registers, which `TodoService` sets by passing
 * `'dshTodo'` to `super()`.
 */
export const TYPERT = {
  package: PACKAGE,
  face: 'host' as const,
  schemas: [],
  invocations: TODO_REMOTE.descriptors,
  model: {
    services: [
      {
        tags: [],
        summary: 'Per-workspace todo list owned by the host.',
        description:
          'Durable owner of every workspace\'s todo list, stored as one SQLite database per project at <workspace>/.dsh/todo.db and resolved through workspaceRegistry.',
        key: 'dshTodo',
        exportName: 'TodoService',
        members: [
          {
            kind: 'method' as const,
            name: 'list',
            signature: '@Remote list(request: TodoListRequest): Promise<TodoListResult>',
            summary: "Read one workspace's list.",
          },
          {
            kind: 'method' as const,
            name: 'replace',
            signature: '@Remote replace(request: TodoReplaceRequest): Promise<TodoReplaceResult>',
            summary: "Replace one workspace's list, guarded by the observed revision.",
          },
          {
            kind: 'method' as const,
            name: 'scanDigest',
            signature: '@Remote scanDigest(request: SuggestScanRequest): Promise<ScanDigestResult>',
            summary: 'Build the bounded workspace evidence a scan session reasons over.',
          },
          {
            kind: 'method' as const,
            name: 'readSuggestions',
            signature: '@Remote readSuggestions(request: ReadSuggestionsRequest): Promise<ReadSuggestionsResult>',
            summary: "Read and consume whatever a scan session has written so far.",
          },
        ],
        types: [
          {
            name: 'TodoItem',
            declaration:
              'export interface TodoItem {\n    id: string;\n    text: string;\n    done: boolean;\n    createdAt: number;\n    completedAt?: number;\n    archivedAt?: number;\n}',
          },
          {
            name: 'TodoList',
            declaration:
              'export interface TodoList {\n    items: TodoItem[];\n    revision: number;\n    updatedAt: number;\n}',
          },
          {
            name: 'TodoListRequest',
            declaration: 'export interface TodoListRequest {\n    workspaceId: string;\n}',
          },
          {
            name: 'TodoListResult',
            declaration: 'export interface TodoListResult {\n    list: TodoList;\n}',
          },
          {
            name: 'TodoReplaceRequest',
            declaration:
              'export interface TodoReplaceRequest {\n    workspaceId: string;\n    items: TodoItem[];\n    ifRevision: number | null;\n}',
          },
          {
            name: 'TodoReplaceResult',
            declaration:
              "export type TodoReplaceResult = { ok: true; list: TodoList } | { ok: false; code: 'revision-conflict'; list: TodoList };",
          },
          {
            name: 'SuggestScanRequest',
            declaration: 'export interface SuggestScanRequest {\n    workspaceId: string;\n}',
          },
          {
            // `runId` is REQUIRED. A per-run result path is what stops a scan
            // that timed out — archived, but never actually cancelled — writing
            // its answer where the NEXT run reads it as fresh.
            name: 'ReadSuggestionsRequest',
            declaration:
              'export interface ReadSuggestionsRequest {\n    workspaceId: string;\n    runId: string;\n}',
          },
          {
            name: 'ScanDigestResult',
            declaration: 'export interface ScanDigestResult {\n    digest: string;\n    truncated: boolean;\n}',
          },
          {
            name: 'Suggestion',
            declaration:
              'export interface Suggestion {\n    title: string;\n    rationale: string;\n    priority: TodoPriority;\n    evidence?: string;\n}',
          },
          {
            name: 'ReadSuggestionsResult',
            declaration:
              "export interface ReadSuggestionsResult {\n    status: 'pending' | 'ready' | 'error';\n    suggestions?: Suggestion[];\n    error?: string;\n}",
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
