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
    // Optional so a host booted BEFORE these fields existed still decodes: the
    // browser's codec is strict, and a missing field would otherwise turn a
    // working tab into a decode error during the window where the client half
    // has refreshed but the host half has not restarted.
    merging: z.boolean().optional(),
    mergeHead: z.string().optional(),
    stashCount: z.number().optional(),
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
// `scope` is optional so a host booted before it existed still validates —
// the browser's codec is strict, and a missing field would otherwise turn a
// working suggestion into a decode error.
const suggestResultSchema = z.object({
  message: z.string(),
  scope: z.enum(['staged', 'all']).optional(),
})

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


/**
 * A branch name as it crosses the wire.
 *
 * Mirrors `assertSafeRef` on the host, for the same reason `shaSchema` mirrors
 * `assertSafeSha`: the browser's codec is strict, so a malformed ref is refused
 * before it costs a round trip. The HOST check remains the real boundary —
 * nothing trusts the browser to have validated anything.
 *
 * The character class is deliberately conservative but covers the ordinary
 * shapes (`feature/x`, `origin/feature/x`, `release-1.2`); it excludes a
 * leading `-` (which git reads as a FLAG) along with every character its
 * revision grammar gives a meaning to.
 */
const refSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine(
    (s) =>
      !s.includes('..') &&
      !s.includes('//') &&
      !s.endsWith('/') &&
      !s.endsWith('.') &&
      !s.endsWith('.lock'),
    { message: 'invalid branch name' },
  )

const branchSchema = z.object({
  name: z.string(),
  current: z.boolean(),
  remote: z.boolean(),
  upstream: z.string().optional(),
  // Absent rather than zero without an upstream: "in sync" and "no upstream"
  // are different facts and the menu renders them differently.
  ahead: z.number().optional(),
  behind: z.number().optional(),
  subject: z.string().optional(),
})

const stashSchema = z.object({
  index: z.number(),
  message: z.string(),
  branch: z.string().optional(),
  date: z.number().optional(),
})

const worktreeSchema = z.object({
  path: z.string(),
  branch: z.string().optional(),
  head: z.string().optional(),
  main: z.boolean(),
  prunable: z.boolean(),
  locked: z.boolean(),
  current: z.boolean(),
})

const refsRequestSchema = z.object({ workspaceId: z.string() })

/**
 * The `refs` reply is a DISCRIMINATED union, not three bare arrays.
 *
 * A client bundle newer than the host half 404s this method. Collapsing that
 * into empty arrays would render as "this repository has no branches" rather
 * than "restart the profile" — the same trap `commitFiles` was reshaped to
 * avoid, and the same one that once made a stale host look like a dead UI.
 */
const refsResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    branches: z.array(branchSchema),
    stashes: z.array(stashSchema),
    worktrees: z.array(worktreeSchema),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
  }),
])

const branchRequestSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(['create', 'switch', 'createSwitch', 'delete', 'rename', 'stashSwitch']),
  name: refSchema.optional(),
  startPoint: refSchema.optional(),
  force: z.boolean().optional(),
})

const mergeRequestSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(['merge', 'abort', 'continue']),
  from: refSchema.optional(),
  noFF: z.boolean().optional(),
})

const stashRequestSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(['push', 'pop', 'apply', 'drop', 'clear']),
  // Interpolated into `stash@{N}` on the host, so it must be a plain integer.
  index: z.number().int().min(0).optional(),
  message: z.string().optional(),
  includeUntracked: z.boolean().optional(),
})

const worktreeRequestSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(['add', 'remove', 'prune']),
  // NOT constrained like a repo-relative path: a worktree lives outside the
  // repository by definition. The host's resolveWorktreePath is the boundary.
  path: z.string().optional(),
  branch: refSchema.optional(),
  newBranch: refSchema.optional(),
  startPoint: refSchema.optional(),
  force: z.boolean().optional(),
  register: z.boolean().optional(),
})

const suggestBranchRequestSchema = z.object({
  workspaceId: z.string(),
  hint: z.string().optional(),
})
// Validated with the SAME ref rules as every other branch field. The host
// sanitizes the model's answer, but the browser must still refuse a bad one
// rather than drop it into a field the user will then try to create.
const suggestBranchResultSchema = z.object({ name: refSchema })

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
    descriptor('refs', refsRequestSchema, refsResultSchema),
    descriptor('branch', branchRequestSchema, commandResultSchema),
    descriptor('merge', mergeRequestSchema, commandResultSchema),
    descriptor('stash', stashRequestSchema, commandResultSchema),
    descriptor('worktree', worktreeRequestSchema, commandResultSchema),
    descriptor('suggestBranch', suggestBranchRequestSchema, suggestBranchResultSchema),
  ],
}

export default GIT_REMOTE
