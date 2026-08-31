/**
 * Hand-written Typert Remote contribution for the host's `dshMissionControl`
 * service — the same generator-by-hand contract dsh-todo documents: the
 * client's `$mount` rejects non-strict codecs, so these are real zod schemas.
 *
 * The payload is deliberately an OPAQUE STRING, not a typed schema. This
 * endpoint is a dumb origin-independent key-value cell for the panel's own
 * persisted state (pomodoro first, settings later); the client owns the
 * envelope shape and its defensive parsing, so the wire contract never has
 * to change when the panel's state grows a field.
 *
 * @module @dennisrongo/dsh-mission-control/remote
 */
import { z } from 'zod'

const PACKAGE = '@dennisrongo/dsh-mission-control'
const SERVICE = 'dshMissionControl'

/** load takes no input; the host has exactly one state cell per profile. */
const loadRequestSchema = z.object({})
const loadResultSchema = z.object({ state: z.union([z.string(), z.null()]) })

/** save carries the whole serialized cell; the host never parses it. */
const saveRequestSchema = z.object({ state: z.string() })
const saveResultSchema = z.object({ ok: z.literal(true) })

/** openTerminal carries a workspace directory the host spawns a terminal at. */
const openTerminalRequestSchema = z.object({ path: z.string() })
const openTerminalResultSchema = z.object({ ok: z.literal(true) })

/**
 * Build one direct, single-`request`-parameter descriptor.
 * @param method - host method name, which is also the wire method.
 * @param request - schema validating the outgoing request object.
 * @param result - schema validating the host's reply.
 * @returns the strict invocation descriptor.
 */
function descriptor(method: string, request: z.ZodType, result: z.ZodType) {
  return {
    id: `${PACKAGE}#${SERVICE}/${method}`,
    service: SERVICE,
    namespace: SERVICE,
    method,
    invocation: { kind: 'direct' as const },
    parameters: [
      {
        name: 'request',
        // Must equal the host method's PARAMETER NAME: the gateway resolves
        // the endpoint through SRC discovery, which reads parameter names off
        // the function source (why the host build keeps minify off).
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
export const MC_REMOTE = {
  package: PACKAGE,
  descriptors: [
    descriptor('load', loadRequestSchema, loadResultSchema),
    descriptor('save', saveRequestSchema, saveResultSchema),
    descriptor('openTerminal', openTerminalRequestSchema, openTerminalResultSchema),
  ],
}

export default MC_REMOTE
