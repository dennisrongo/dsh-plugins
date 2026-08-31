/**
 * Host-face Typert manifest for the `dshMissionControl` service.
 *
 * `@deepseek-ai/dsh-typert-loader` publishes a host service's @Remote methods
 * by resolving the package's `./typert` subpath export — a package without one
 * is SKIPPED SILENTLY and every call 404s. Registration is cached per process,
 * so adding this file requires a full profile restart, not a refresh.
 * Descriptors are shared with the client via ./remote.ts so the two ends of
 * the bridge cannot drift.
 *
 * @module @dennisrongo/dsh-mission-control/typert
 */
import { MC_REMOTE } from './remote.ts'

const PACKAGE = '@dennisrongo/dsh-mission-control'

/** The host manifest; shape enforced by `validateTypertManifest`. */
export const TYPERT = {
  package: PACKAGE,
  face: 'host' as const,
  schemas: [],
  invocations: MC_REMOTE.descriptors,
  model: {
    services: [
      {
        tags: [],
        summary: 'Origin-independent persisted state cell for the Mission Control panel.',
        description:
          'One JSON cell per harness home at <DSH_HOME>/storages/dsh-mission-control.json. ' +
          'Exists because DSH Desktop serves the UI from an ephemeral port per launch and ' +
          'localStorage is origin-scoped, so browser storage cannot survive a restart.',
        key: 'dshMissionControl',
        exportName: 'MissionControlService',
        members: [
          {
            kind: 'method' as const,
            name: 'load',
            signature: '@Remote load(request: {}): Promise<McLoadResult>',
            summary: 'Read the state cell, or null when nothing was saved yet.',
          },
          {
            kind: 'method' as const,
            name: 'save',
            signature: '@Remote save(request: { state: string }): Promise<{ ok: true }>',
            summary: 'Atomically replace the state cell.',
          },
          {
            kind: 'method' as const,
            name: 'openTerminal',
            signature: '@Remote openTerminal(request: { path: string }): Promise<{ ok: true }>',
            summary:
              'Open the OS default terminal at a workspace directory (Windows Terminal or cmd on win32, Terminal.app on macOS).',
          },
        ],
        types: [
          {
            name: 'McLoadResult',
            declaration: 'export interface McLoadResult {\n    state: string | null;\n}',
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
