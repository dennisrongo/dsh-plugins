/**
 * Hand-written Typert Remote contribution for the host's `dshTodo` service.
 *
 * Shipped dsh packages get this file from the Typert generator. A third-party
 * plugin has no generator step, so it is written by hand — but it must still
 * satisfy the same contract the generator emits, because the two ends of the
 * bridge have DIFFERENT requirements:
 *
 *   * The HOST gateway can fall back to `src-json` codecs, deriving wire fields
 *     from the method's parameter names.
 *   * The CLIENT `$mount` cannot. `requireStrictDescriptor` rejects any codec
 *     whose `mode` is not `'strict'`, so a `src-json` contribution makes
 *     `$mount` throw, the `remote.dshTodo` service never appears, and any UI
 *     waiting on it silently never registers.
 *
 * Hence real zod schemas below. They are also a genuine boundary check on
 * everything the host sends back.
 *
 * The shape must match what the host actually exports: namespace `dshTodo`,
 * methods `list`, `replace`, `scanDigest` and `readSuggestions`, each taking
 * one JSON `request` parameter.
 *
 * @module @dennisrongo/dsh-todo/remote
 */
import { z } from 'zod'

/**
 * One stored task, as it crosses the wire.
 *
 * EVERY field must be named here. These are strict codecs, so a field the
 * schema does not carry is stripped off the wire — which fails silently: the
 * UI would show a release or a status that simply never reaches the host.
 */
const todoItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(['backlog', 'todo', 'in-progress', 'blocked', 'done']),
  priority: z.enum(['p0', 'p1', 'p2', 'p3']),
  release: z.string().optional(),
  sprint: z.string().optional(),
  dueDate: z.string().optional(),
  sessionId: z.string().optional(),
  createdAt: z.number(),
  completedAt: z.number().optional(),
  archivedAt: z.number().optional(),
})

/** One workspace's whole durable record. */
const todoListSchema = z.object({
  items: z.array(todoItemSchema),
  revision: z.number(),
  updatedAt: z.number(),
})

const listRequestSchema = z.object({ workspaceId: z.string() })
const listResultSchema = z.object({ list: todoListSchema })

const replaceRequestSchema = z.object({
  workspaceId: z.string(),
  items: z.array(todoItemSchema),
  ifRevision: z.union([z.number(), z.literal(null)]),
})

const replaceResultSchema = z.union([
  z.object({ ok: z.literal(true), list: todoListSchema }),
  z.object({
    ok: z.literal(false),
    code: z.literal('revision-conflict'),
    list: todoListSchema,
  }),
])

/** Both scan endpoints take the same request: one workspace, nothing else. */
const scanRequestSchema = z.object({ workspaceId: z.string() })

const scanDigestResultSchema = z.object({
  digest: z.string(),
  truncated: z.boolean(),
})

/**
 * One proposed task, as it crosses the wire.
 *
 * EVERY field must be named: a strict codec strips what it does not carry, and
 * it does so silently — a suggestion field missing here simply never arrives.
 * `evidence` is optional because a missing feature has no line number, exactly
 * as `Suggestion` declares it.
 */
const suggestionSchema = z.object({
  title: z.string(),
  rationale: z.string(),
  priority: z.enum(['p0', 'p1', 'p2', 'p3']),
  evidence: z.string().optional(),
})

const readSuggestionsResultSchema = z.object({
  status: z.enum(['pending', 'ready', 'error']),
  suggestions: z.array(suggestionSchema).optional(),
  error: z.string().optional(),
})

const PACKAGE = '@dennisrongo/dsh-todo'

/**
 * Build one direct, single-`request`-parameter descriptor.
 * @param method - host method name, which is also the wire method.
 * @param request - schema validating the outgoing request object.
 * @param result - schema validating the host's reply.
 * @returns the strict invocation descriptor.
 */
function descriptor(method: string, request: z.ZodType, result: z.ZodType) {
  return {
    id: `${PACKAGE}#dshTodo/${method}`,
    service: 'dshTodo',
    namespace: 'dshTodo',
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
export const TODO_REMOTE = {
  package: PACKAGE,
  descriptors: [
    descriptor('list', listRequestSchema, listResultSchema),
    descriptor('replace', replaceRequestSchema, replaceResultSchema),
    descriptor('scanDigest', scanRequestSchema, scanDigestResultSchema),
    descriptor('readSuggestions', scanRequestSchema, readSuggestionsResultSchema),
  ],
}

export default TODO_REMOTE
