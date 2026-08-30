/**
 * Host-face Typert manifest for the `dshPlans` service.
 *
 * `@deepseek-ai/dsh-typert-loader` publishes a host service's `@Remote` methods
 * by resolving the owning package's `package.json`, looking for a `"./typert"`
 * subpath export, importing it, and registering the `TYPERT` manifest it finds.
 * A package without that export is **skipped silently**: the service still
 * constructs, plans are still captured to disk, and only the `/api` calls 404 —
 * so the tab renders empty and looks like a storage bug. The loader caches its
 * verdict per process, so adding this file needs a full profile restart.
 *
 * The invocation descriptors are the same objects the browser mounts, so the
 * two faces of the bridge cannot drift.
 *
 * @module @dennisrongo/dsh-plan-board/typert
 */
import { PLANS_REMOTE } from './remote.ts'

const PACKAGE = '@dennisrongo/dsh-plan-board'

/**
 * The host manifest, shaped for `validateTypertManifest`: `package` must equal
 * the exporting package, `face` must be `'host'`, `schemas` must be an array,
 * and `model` must carry `services`/`events`/`objects` arrays with each service
 * declaring `tags`, `key`, `exportName`, `members` and `types`. `key` must match
 * the cordis service key, which `PlanService` sets by passing `'dshPlans'` to
 * `super()`.
 */
export const TYPERT = {
  package: PACKAGE,
  face: 'host' as const,
  schemas: [],
  invocations: PLANS_REMOTE.descriptors,
  model: {
    services: [
      {
        tags: [],
        summary: 'Durable per-workspace plans captured from exit_plan_mode.',
        description:
          'Wraps the exit_plan_mode dispatch to write each presented plan to <workspace>/.dsh/plans/<id>.md as markdown with JSON frontmatter, then settles it to approved or rejected from the review outcome, keeping the reviewer feedback that otherwise exists only as a thrown error message.',
        key: 'dshPlans',
        exportName: 'PlanService',
        members: [
          {
            kind: 'method' as const,
            name: 'list',
            signature: '@Remote list(request: PlanListRequest): Promise<PlanListResult>',
            summary: "Every plan's metadata for one workspace, newest first.",
          },
          {
            kind: 'method' as const,
            name: 'get',
            signature: '@Remote get(request: PlanGetRequest): Promise<PlanGetResult>',
            summary: 'One plan with its markdown body.',
          },
          {
            kind: 'method' as const,
            name: 'changeToken',
            signature: '@Remote changeToken(request: PlanListRequest): Promise<PlanTokenResult>',
            summary: 'Monotonic change token plus the newest pending plan id.',
          },
          {
            kind: 'method' as const,
            name: 'pin',
            signature: '@Remote pin(request: PlanPinRequest): Promise<PlanPinResult>',
            summary: 'Pin one assistant message into the plan store by hand.',
          },
          {
            kind: 'method' as const,
            name: 'discard',
            signature: '@Remote discard(request: PlanGetRequest): Promise<PlanRemoveResult>',
            summary: 'Delete one plan file.',
          },
        ],
        types: [
          {
            name: 'PlanMeta',
            declaration:
              "export interface PlanMeta {\n    id: string;\n    title: string;\n    sessionId: string;\n    createdAt: number;\n    status: 'pending' | 'approved' | 'rejected' | 'proposed';\n    decidedAt?: number;\n    feedback?: string;\n    bytes: number;\n}",
          },
          {
            name: 'PlanRecord',
            declaration: 'export interface PlanRecord extends PlanMeta {\n    body: string;\n}',
          },
          {
            name: 'PlanListRequest',
            declaration: 'export interface PlanListRequest {\n    workspaceId: string;\n}',
          },
          {
            name: 'PlanListResult',
            declaration: 'export interface PlanListResult {\n    plans: PlanMeta[];\n    token: number;\n}',
          },
          {
            name: 'PlanGetRequest',
            declaration: 'export interface PlanGetRequest {\n    workspaceId: string;\n    id: string;\n}',
          },
          {
            name: 'PlanGetResult',
            declaration: 'export interface PlanGetResult {\n    plan?: PlanRecord;\n}',
          },
          {
            name: 'PlanTokenResult',
            declaration: 'export interface PlanTokenResult {\n    token: number;\n    openPlanId?: string;\n}',
          },
          {
            name: 'PlanPinRequest',
            declaration: 'export interface PlanPinRequest {\n    workspaceId: string;\n    messageId: string;\n}',
          },
          {
            name: 'PlanPinResult',
            declaration:
              'export type PlanPinResult = { ok: true; id: string; token: number } | { ok: false; reason: string };',
          },
          {
            name: 'PlanRemoveResult',
            declaration: 'export interface PlanRemoveResult {\n    ok: boolean;\n    token: number;\n}',
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
