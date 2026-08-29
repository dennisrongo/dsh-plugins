/**
 * Hand-written Typert Remote contribution for the host's `dshMemory` service.
 *
 * Written by hand for the same reason `dsh-todo`'s is: a third-party plugin has
 * no Typert generator step, and the client's `$mount` runs
 * `requireStrictDescriptor`, which rejects any codec whose `mode` is not
 * `'strict'`. A `src-json` fallback makes the mount throw and the service
 * silently never appears.
 *
 * @module @dennisrongo/dsh-memory/remote
 */
import { z } from 'zod'

/** One discovered instruction file. */
const rowSchema = z.object({
  displayPath: z.string(),
  absolutePath: z.string(),
  bytes: z.number(),
  included: z.boolean(),
  truncatedTo: z.number().optional(),
})

/** The whole report for one workspace. */
const reportSchema = z.object({
  cwd: z.string(),
  dshHome: z.string(),
  maxBytes: z.number(),
  discoveredBytes: z.number(),
  files: z.array(rowSchema),
})

const inspectRequestSchema = z.object({ workspaceId: z.string() })
const inspectResultSchema = z.object({ report: reportSchema })

const rememberRequestSchema = z.object({
  workspaceId: z.string(),
  fact: z.string(),
  scope: z.enum(['project', 'local', 'user']),
})

const rememberResultSchema = z.union([
  z.object({ ok: z.literal(true), path: z.string(), line: z.string() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
])

const readRequestSchema = z.object({ workspaceId: z.string(), absolutePath: z.string() })
const readResultSchema = z.object({ text: z.string().optional() })

const PACKAGE = '@dennisrongo/dsh-memory'

/**
 * Build one direct, single-`request`-parameter descriptor.
 * @param method - host method name, which is also the wire method.
 * @param request - schema validating the outgoing request object.
 * @param result - schema validating the host's reply.
 * @returns the strict invocation descriptor.
 */
function descriptor(method: string, request: z.ZodType, result: z.ZodType) {
  return {
    id: `${PACKAGE}#dshMemory/${method}`,
    service: 'dshMemory',
    namespace: 'dshMemory',
    method,
    invocation: { kind: 'direct' as const },
    parameters: [
      {
        name: 'request',
        // Must equal the host method's PARAMETER NAME: the gateway resolves the
        // endpoint through SRC discovery, reading names off the function
        // source. This is also why the host bundle is never minified.
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
export const MEMORY_REMOTE = {
  package: PACKAGE,
  descriptors: [
    descriptor('inspect', inspectRequestSchema, inspectResultSchema),
    descriptor('remember', rememberRequestSchema, rememberResultSchema),
    descriptor('read', readRequestSchema, readResultSchema),
  ],
}

export default MEMORY_REMOTE
