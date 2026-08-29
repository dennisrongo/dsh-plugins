/**
 * Hand-written Typert Remote contribution for the host's `dshHooks` service.
 *
 * Written by hand for the same reason `dsh-todo`'s is: a third-party plugin has
 * no Typert generator step, but both ends of the bridge still enforce the
 * generated contract. The client's `$mount` runs `requireStrictDescriptor` and
 * rejects any codec whose `mode` is not `'strict'`, so a `src-json` fallback
 * would make the mount throw and the service silently never appear.
 *
 * The schemas are also a real boundary check. `HookRun.stdout` is whatever a
 * user's shell command printed, so it crosses the wire as validated data, not
 * as trust.
 *
 * @module @dennisrongo/dsh-hooks/remote
 */
import { z } from 'zod'
import { HOOK_EVENTS } from './types.ts'

/** What a hook may print on stdout, as it crosses the wire. */
const hookOutputSchema = z.object({
  continue: z.boolean().optional(),
  stopReason: z.string().optional(),
  suppressOutput: z.boolean().optional(),
  systemMessage: z.string().optional(),
  decision: z.enum(['block', 'approve']).optional(),
  reason: z.string().optional(),
  hookSpecificOutput: z
    .object({
      hookEventName: z.string().optional(),
      permissionDecision: z.enum(['allow', 'deny', 'ask']).optional(),
      permissionDecisionReason: z.string().optional(),
      additionalContext: z.string().optional(),
    })
    .optional(),
})

/**
 * One settled run.
 *
 * `updatedInput` is deliberately absent: it is parsed host-side only to warn
 * that dsh cannot honour it, and carrying it to a UI would suggest otherwise.
 */
const hookRunSchema = z.object({
  event: z.enum(HOOK_EVENTS),
  command: z.string(),
  source: z.enum(['user', 'project']),
  sessionId: z.string(),
  toolName: z.string().optional(),
  startedAt: z.number(),
  durationMs: z.number(),
  exitCode: z.union([z.number(), z.literal(null)]),
  signal: z.union([z.string(), z.literal(null)]),
  timedOut: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  output: hookOutputSchema.optional(),
  error: z.string().optional(),
})

const describeRequestSchema = z.object({ workspaceId: z.string().optional() })

const describeResultSchema = z.object({
  enabled: z.boolean(),
  shell: z.array(z.string()),
  userOrigin: z.string().optional(),
  projectOrigin: z.string().optional(),
  hooks: z.array(
    z.object({
      event: z.enum(HOOK_EVENTS),
      matcher: z.string().optional(),
      command: z.string(),
      timeout: z.number(),
      failClosed: z.boolean(),
      source: z.enum(['user', 'project']),
    }),
  ),
})

const recentRequestSchema = z.object({ limit: z.number().optional() })
const recentResultSchema = z.object({ runs: z.array(hookRunSchema) })

const PACKAGE = '@dennisrongo/dsh-hooks'

/**
 * Build one direct, single-`request`-parameter descriptor.
 * @param method - host method name, which is also the wire method.
 * @param request - schema validating the outgoing request object.
 * @param result - schema validating the host's reply.
 * @returns the strict invocation descriptor.
 */
function descriptor(method: string, request: z.ZodType, result: z.ZodType) {
  return {
    id: `${PACKAGE}#dshHooks/${method}`,
    service: 'dshHooks',
    namespace: 'dshHooks',
    method,
    invocation: { kind: 'direct' as const },
    parameters: [
      {
        name: 'request',
        // Must equal the host method's PARAMETER NAME: the gateway resolves the
        // endpoint through SRC discovery, reading names off the function source.
        // This is also why the host bundle is never minified.
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

/** The contract a client half mounts via `ctx.remote.$mount(...)`. */
export const HOOKS_REMOTE = {
  package: PACKAGE,
  descriptors: [
    descriptor('describe', describeRequestSchema, describeResultSchema),
    descriptor('recent', recentRequestSchema, recentResultSchema),
  ],
}

export default HOOKS_REMOTE
