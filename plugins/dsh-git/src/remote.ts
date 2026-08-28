/**
 * Hand-written Typert Remote contribution for the host's `dshGit` service.
 *
 * Shipped dsh packages get this file from the Typert generator; a third-party
 * plugin has no generator step, so it is written by hand — but it must still
 * satisfy the same contract, because the two ends differ:
 *
 *   * The HOST gateway can fall back to `src-json` codecs, deriving wire fields
 *     from the method's parameter names.
 *   * The CLIENT `$mount` cannot. `requireStrictDescriptor` rejects any codec
 *     whose `mode` is not `'strict'`, so a `src-json` contribution makes
 *     `$mount` throw, the `remote.dshGit` service never appears, and the tab
 *     silently never registers.
 *
 * Hence real zod schemas below. They are also a genuine boundary check on
 * everything the host sends back.
 *
 * @module @dennisrongo/dsh-git/remote
 */
import { z } from 'zod'

/** Porcelain status letters, kept as a closed set so a typo cannot pass. */
const statusCodeSchema = z.enum(['M', 'A', 'D', 'R', 'C', 'U', '?', '!', ' '])

const fileChangeSchema = z.object({
  path: z.string(),
  // Optional across the wire: only renames and copies carry an original path.
  origPath: z.string().optional(),
  index: statusCodeSchema,
  worktree: statusCodeSchema,
  staged: z.boolean(),
  conflicted: z.boolean(),
  untracked: z.boolean(),
})

const upstreamSchema = z.object({
  name: z.string(),
  ahead: z.number(),
  behind: z.number(),
})

const commitSchema = z.object({
  sha: z.string(),
  subject: z.string(),
  author: z.string(),
  date: z.number(),
})

/**
 * The snapshot union. `repo: false` is a first-class member rather than an
 * error shape, so an un-initialized directory round-trips as data.
 */
const statusSchema = z.union([
  z.object({
    repo: z.literal(false),
    root: z.string(),
  }),
  z.object({
    repo: z.literal(true),
    root: z.string(),
    branch: z.string().optional(),
    head: z.string().optional(),
    unborn: z.boolean(),
    upstream: upstreamSchema.optional(),
    hasRemote: z.boolean(),
    files: z.array(fileChangeSchema),
    recent: z.array(commitSchema),
  }),
])

/** Every mutating command replies in this one shape. */
const commandResultSchema = z.object({
  ok: z.boolean(),
  output: z.string(),
  status: statusSchema,
})

const statusRequestSchema = z.object({ workspaceId: z.string() })
const statusResultSchema = z.object({ status: statusSchema })

const diffRequestSchema = z.object({
  workspaceId: z.string(),
  path: z.string().optional(),
  staged: z.boolean().optional(),
})
const diffResultSchema = z.object({ patch: z.string(), binary: z.boolean() })

/**
 * A commit identifier as it crosses the wire.
 *
 * Constrained here as well as on the host: this schema is what the client's
 * strict codec validates against, so a malformed sha is refused before it costs
 * a round trip. The host's own `assertSafeSha` remains the real boundary —
 * nothing trusts the browser to have checked.
 */
const shaSchema = z.string().regex(/^[0-9a-fA-F]{4,40}$/)

const commitFileSchema = z.object({
  path: z.string(),
  origPath: z.string().optional(),
  status: statusCodeSchema,
})

const commitFilesRequestSchema = z.object({
  workspaceId: z.string(),
  sha: shaSchema,
})
const commitFilesResultSchema = z.object({ files: z.array(commitFileSchema) })

const commitDiffRequestSchema = z.object({
  workspaceId: z.string(),
  sha: shaSchema,
  path: z.string().optional(),
})
const commitDiffResultSchema = z.object({ patch: z.string(), binary: z.boolean() })

const stageRequestSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(['stage', 'unstage', 'discard']),
  paths: z.array(z.string()),
})

const commitRequestSchema = z.object({
  workspaceId: z.string(),
  message: z.string(),
  all: z.boolean().optional(),
})

const suggestRequestSchema = z.object({
  workspaceId: z.string(),
  staged: z.boolean().optional(),
})
const suggestResultSchema = z.object({ message: z.string() })

const syncRequestSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(['pull', 'push', 'fetch', 'sync', 'publish']),
})

const changeTokenRequestSchema = z.object({ workspaceId: z.string() })
const changeTokenResultSchema = z.object({ token: z.number() })

const initRequestSchema = z.object({
  workspaceId: z.string(),
  branch: z.string().optional(),
})

const PACKAGE = '@dennisrongo/dsh-git'

/**
 * Build one direct, single-`request`-parameter descriptor.
 * @param method - host method name, which is also the wire method.
 * @param request - schema validating the outgoing request object.
 * @param result - schema validating the host's reply.
 * @returns the strict invocation descriptor.
 */
function descriptor(method: string, request: z.ZodType, result: z.ZodType) {
  return {
    id: `${PACKAGE}#dshGit/${method}`,
    service: 'dshGit',
    namespace: 'dshGit',
    method,
    invocation: { kind: 'direct' as const },
    parameters: [
      {
        name: 'request',
        // Must equal the host method's PARAMETER NAME: the host resolves this
        // endpoint through SRC discovery, which reads parameter names off the
        // function source.
        wire: 'request',
        source: 'json' as const,
        codec: {
          mode: 'strict' as const,
          typeSymbol: `${PACKAGE}/types#${method}Request`,
          schema: request,
        },
      },
    ],
    result: {
      mode: 'strict' as const,
      typeSymbol: `${PACKAGE}/types#${method}Result`,
      schema: result,
    },
  }
}

/** The contract the client half mounts via `ctx.remote.$mount(...)`. */
export const GIT_REMOTE = {
  package: PACKAGE,
  descriptors: [
    descriptor('status', statusRequestSchema, statusResultSchema),
    descriptor('diff', diffRequestSchema, diffResultSchema),
    descriptor('commitFiles', commitFilesRequestSchema, commitFilesResultSchema),
    descriptor('commitDiff', commitDiffRequestSchema, commitDiffResultSchema),
    descriptor('stage', stageRequestSchema, commandResultSchema),
    descriptor('commit', commitRequestSchema, commandResultSchema),
    descriptor('init', initRequestSchema, commandResultSchema),
    descriptor('sync', syncRequestSchema, commandResultSchema),
    descriptor('suggestMessage', suggestRequestSchema, suggestResultSchema),
    descriptor('changeToken', changeTokenRequestSchema, changeTokenResultSchema),
  ],
}

export default GIT_REMOTE
