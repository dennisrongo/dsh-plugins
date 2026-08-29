/**
 * Host-face Typert manifest for the `dshHooks` service.
 *
 * `@deepseek-ai/dsh-typert-loader` publishes a host service's `@Remote` methods
 * by resolving the owning package's `package.json`, looking for a `"./typert"`
 * subpath export, importing it, and registering the `TYPERT` manifest it finds.
 * A package without that export is **skipped silently**: the service still
 * constructs, every listener still fires, and only the `/api` calls 404. The
 * loader caches its verdict per process, so adding this file needs a full
 * profile restart, not a refresh.
 *
 * The invocation descriptors are the same objects the browser mounts, so the
 * two faces of the bridge cannot drift.
 *
 * @module @dennisrongo/dsh-hooks/typert
 */
import { HOOKS_REMOTE } from './remote.ts'

const PACKAGE = '@dennisrongo/dsh-hooks'

/**
 * The host manifest, shaped for `validateTypertManifest`:
 * `package` must equal the exporting package, `face` must be `'host'`,
 * `schemas` must be an array, `model` must carry `services`/`events`/`objects`
 * arrays, and each service needs `tags`, `key`, `exportName`, `members` and
 * `types`. `key` must match the cordis service key, which `HooksService` sets
 * by passing `'dshHooks'` to `super()`.
 */
export const TYPERT = {
  package: PACKAGE,
  face: 'host' as const,
  schemas: [],
  invocations: HOOKS_REMOTE.descriptors,
  model: {
    services: [
      {
        tags: [],
        summary: 'Claude Code-compatible hook lifecycle for dsh.',
        description:
          'Runs configured shell commands at dsh lifecycle points (tools/pre-execute, tools/post-execute, agent/pre-step, agent/session-start, agent/turn-stopping, agent/disposed, subagent/end, approval/request), merging a dsh-hooks settings namespace with <workspace>/.dsh/hooks.json.',
        key: 'dshHooks',
        exportName: 'HooksService',
        members: [
          {
            kind: 'method' as const,
            name: 'describe',
            signature: '@Remote describe(request: HooksDescribeRequest): Promise<HooksDescribeResult>',
            summary: 'Describe the hooks in force across both configuration layers.',
          },
          {
            kind: 'method' as const,
            name: 'recent',
            signature: '@Remote recent(request: HooksRecentRequest): Promise<HooksRecentResult>',
            summary: 'The most recent settled hook runs, newest first.',
          },
        ],
        types: [
          {
            name: 'HooksDescribeRequest',
            declaration: 'export interface HooksDescribeRequest {\n    workspaceId?: string;\n}',
          },
          {
            name: 'HooksDescribeResult',
            declaration:
              "export interface HooksDescribeResult {\n    enabled: boolean;\n    shell: string[];\n    userOrigin?: string;\n    projectOrigin?: string;\n    hooks: Array<{ event: string; matcher?: string; command: string; timeout: number; failClosed: boolean; source: 'user' | 'project' }>;\n}",
          },
          {
            name: 'HooksRecentRequest',
            declaration: 'export interface HooksRecentRequest {\n    limit?: number;\n}',
          },
          {
            name: 'HooksRecentResult',
            declaration: 'export interface HooksRecentResult {\n    runs: HookRun[];\n}',
          },
          {
            name: 'HookRun',
            declaration:
              "export interface HookRun {\n    event: string;\n    command: string;\n    source: 'user' | 'project';\n    sessionId: string;\n    toolName?: string;\n    startedAt: number;\n    durationMs: number;\n    exitCode: number | null;\n    signal: string | null;\n    timedOut: boolean;\n    stdout: string;\n    stderr: string;\n    output?: HookOutput;\n    error?: string;\n}",
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
