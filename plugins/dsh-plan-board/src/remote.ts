/**
 * Hand-written Typert Remote contribution for the host's `dshPlans` service.
 *
 * Written by hand for the same reason `dsh-todo`'s is: a third-party plugin has
 * no Typert generator step, and the client's `$mount` runs
 * `requireStrictDescriptor`, which rejects any codec whose `mode` is not
 * `'strict'`. A `src-json` fallback would make the mount throw, the
 * `remote.dshPlans` service would never appear, and the UI waiting on it would
 * silently never register.
 *
 * Every field a plan carries must be named here. These are strict codecs, so a
 * field the schema omits is stripped off the wire — which fails silently, and
 * for this plugin would mean a plan body that never reaches the window.
 *
 * @module @dennisrongo/dsh-plan-board/remote
 */
import { z } from 'zod'

const statusSchema = z.enum(['pending', 'approved', 'rejected'])

/** One plan's metadata, without its markdown. */
const planMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  sessionId: z.string(),
  createdAt: z.number(),
  status: statusSchema,
  decidedAt: z.number().optional(),
  feedback: z.string().optional(),
  bytes: z.number(),
})

/** One plan with its markdown. */
const planRecordSchema = planMetaSchema.extend({ body: z.string() })

const listRequestSchema = z.object({ workspaceId: z.string() })
const listResultSchema = z.object({ plans: z.array(planMetaSchema), token: z.number() })

const getRequestSchema = z.object({ workspaceId: z.string(), id: z.string() })
const getResultSchema = z.object({ plan: planRecordSchema.optional() })

const tokenResultSchema = z.object({ token: z.number(), pendingId: z.string().optional() })
const removeResultSchema = z.object({ ok: z.boolean(), token: z.number() })

const PACKAGE = '@dennisrongo/dsh-plan-board'

/**
 * Build one direct, single-`request`-parameter descriptor.
 * @param method - host method name, which is also the wire method.
 * @param request - schema validating the outgoing request object.
 * @param result - schema validating the host's reply.
 * @returns the strict invocation descriptor.
 */
function descriptor(method: string, request: z.ZodType, result: z.ZodType) {
  return {
    id: `${PACKAGE}#dshPlans/${method}`,
    service: 'dshPlans',
    namespace: 'dshPlans',
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
export const PLANS_REMOTE = {
  package: PACKAGE,
  descriptors: [
    descriptor('list', listRequestSchema, listResultSchema),
    descriptor('get', getRequestSchema, getResultSchema),
    descriptor('changeToken', listRequestSchema, tokenResultSchema),
    descriptor('discard', getRequestSchema, removeResultSchema),
  ],
}

export default PLANS_REMOTE
