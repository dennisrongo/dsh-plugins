/**
 * Host-face Typert manifest for the `dshMemory` service.
 *
 * `@deepseek-ai/dsh-typert-loader` publishes a host service's `@Remote` methods
 * by resolving the owning package's `package.json`, looking for a `"./typert"`
 * subpath export, importing it, and registering the `TYPERT` manifest it finds.
 * A package without that export is **skipped silently**: the service still
 * constructs, `/remember` still works, and only the `/api` calls 404 — so the
 * Memory tab renders empty while the command succeeds, which is a confusing
 * pair of symptoms. The loader caches its verdict per process, so adding this
 * file needs a full profile restart.
 *
 * @module @dennisrongo/dsh-memory/typert
 */
import { MEMORY_REMOTE } from './remote.ts'

const PACKAGE = '@dennisrongo/dsh-memory'

/**
 * The host manifest, shaped for `validateTypertManifest`: `package` must equal
 * the exporting package, `face` must be `'host'`, `schemas` must be an array,
 * and `model` must carry `services`/`events`/`objects` arrays with each service
 * declaring `tags`, `key`, `exportName`, `members` and `types`. `key` must match
 * the cordis service key, which `MemoryService` sets by passing `'dshMemory'`
 * to `super()`.
 */
export const TYPERT = {
  package: PACKAGE,
  face: 'host' as const,
  schemas: [],
  invocations: MEMORY_REMOTE.descriptors,
  model: {
    services: [
      {
        tags: [],
        summary: 'Write and inspect AGENTS.md/CLAUDE.md workspace instructions.',
        description:
          "Appends facts to the right instruction file in dsh-agent-instructions' hierarchy (project AGENTS.md, the AGENTS.local.md overlay, or the user-global $DSH_HOME/AGENTS.md) and reports which discovered files the loader's byte budget actually kept, using the loader's own discovery and rendering functions rather than a reimplementation.",
        key: 'dshMemory',
        exportName: 'MemoryService',
        members: [
          {
            kind: 'method' as const,
            name: 'inspect',
            signature: '@Remote inspect(request: MemoryInspectRequest): Promise<MemoryInspectResult>',
            summary: 'Every discovered instruction file and whether the byte budget kept it.',
          },
          {
            kind: 'method' as const,
            name: 'remember',
            signature: '@Remote remember(request: MemoryRememberRequest): Promise<MemoryRememberResult>',
            summary: 'Append one fact to the instruction file for the chosen scope.',
          },
          {
            kind: 'method' as const,
            name: 'read',
            signature: '@Remote read(request: MemoryReadRequest): Promise<MemoryReadResult>',
            summary: 'Read one discovered instruction file.',
          },
        ],
        types: [
          {
            name: 'InstructionRow',
            declaration:
              'export interface InstructionRow {\n    displayPath: string;\n    absolutePath: string;\n    bytes: number;\n    included: boolean;\n    truncatedTo?: number;\n}',
          },
          {
            name: 'InstructionReport',
            declaration:
              'export interface InstructionReport {\n    cwd: string;\n    dshHome: string;\n    maxBytes: number;\n    discoveredBytes: number;\n    files: InstructionRow[];\n}',
          },
          {
            name: 'MemoryInspectRequest',
            declaration: 'export interface MemoryInspectRequest {\n    workspaceId: string;\n}',
          },
          {
            name: 'MemoryInspectResult',
            declaration: 'export interface MemoryInspectResult {\n    report: InstructionReport;\n}',
          },
          {
            name: 'MemoryRememberRequest',
            declaration:
              "export interface MemoryRememberRequest {\n    workspaceId: string;\n    fact: string;\n    scope: 'project' | 'local' | 'user';\n}",
          },
          {
            name: 'MemoryRememberResult',
            declaration:
              'export type MemoryRememberResult = { ok: true; path: string; line: string } | { ok: false; reason: string };',
          },
          {
            name: 'MemoryReadRequest',
            declaration:
              'export interface MemoryReadRequest {\n    workspaceId: string;\n    absolutePath: string;\n}',
          },
          {
            name: 'MemoryReadResult',
            declaration: 'export interface MemoryReadResult {\n    text?: string;\n}',
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
