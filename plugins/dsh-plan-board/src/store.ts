/**
 * On-disk plan storage: one markdown file per plan under
 * `<workspace>/.dsh/plans/`.
 *
 * Markdown files rather than a database, because a plan is a document. You want
 * to open it in an editor, diff it, commit it, or send it to someone who is not
 * running the harness — none of which a SQLite row gives you. `dsh-todo` keeps
 * a database because a task list is rows; this is the other case.
 *
 * ## The frontmatter is JSON-per-line, on purpose
 *
 * Every metadata value is `JSON.stringify`d:
 *
 * ```
 * ---
 * id: "20260829T121500123-add-hook-lifecycle"
 * title: "Add a hook lifecycle"
 * feedback: "line one\nline two"
 * ---
 * # Add a hook lifecycle
 * ```
 *
 * It reads like YAML, but the writer cannot produce something the reader
 * mis-parses. A plan title is model-written text and the reviewer's feedback is
 * free-form human text with newlines and quotes in it; a hand-rolled YAML
 * subset would eventually meet one it escapes wrongly, and a real YAML
 * dependency is a lot of weight for six scalar fields.
 *
 * @module @dennisrongo/dsh-plan-board/store
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DOT_DSH,
  MAX_PLANS,
  MAX_PLAN_BYTES,
  PLANS_DIR,
  firstHeading,
  slugify,
  stamp,
  type PlanMeta,
  type PlanRecord,
  type PlanStatus,
} from './types.ts'

/** Fence separating the metadata block from the markdown body. */
const FENCE = '---'

/** Metadata keys written to and read from the frontmatter, in write order. */
const KEYS = ['id', 'title', 'sessionId', 'createdAt', 'status', 'decidedAt', 'feedback'] as const

/**
 * Serialize one record to its file contents.
 * @param record - the plan and its metadata.
 * @returns the complete file text.
 */
export function serialize(record: PlanRecord): string {
  const lines = [FENCE]
  for (const key of KEYS) {
    const value = record[key as keyof PlanRecord]
    if (value === undefined) continue
    lines.push(`${key}: ${JSON.stringify(value)}`)
  }
  lines.push(FENCE, '', record.body)
  return lines.join('\n')
}

/**
 * Parse one file's contents back into a record.
 *
 * A file whose frontmatter is damaged is not discarded: the body is still a
 * plan a human wrote or read, so it comes back with defaults and the caller
 * decides. Losing a plan to a bad metadata line would be the worst possible
 * trade for a feature whose entire job is not losing plans.
 * @param id - the filename stem, used when the frontmatter has no id.
 * @param text - the complete file text.
 * @returns the parsed record.
 */
export function parse(id: string, text: string): PlanRecord {
  const normalized = text.replace(/\r\n/g, '\n')
  const meta: Record<string, unknown> = {}
  let body = normalized

  if (normalized.startsWith(`${FENCE}\n`)) {
    const end = normalized.indexOf(`\n${FENCE}`, FENCE.length)
    if (end !== -1) {
      for (const line of normalized.slice(FENCE.length + 1, end).split('\n')) {
        const at = line.indexOf(':')
        if (at <= 0) continue
        const key = line.slice(0, at).trim()
        try {
          meta[key] = JSON.parse(line.slice(at + 1).trim())
        } catch {
          // One unreadable line must not cost the other five, or the plan.
        }
      }
      body = normalized.slice(end + FENCE.length + 1).replace(/^\n+/, '')
    }
  }

  const status = meta.status
  return {
    id: typeof meta.id === 'string' ? meta.id : id,
    title: typeof meta.title === 'string' ? meta.title : (firstHeading(body) ?? 'Untitled plan'),
    sessionId: typeof meta.sessionId === 'string' ? meta.sessionId : '',
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : 0,
    status: status === 'approved' || status === 'rejected' ? status : 'pending',
    ...(typeof meta.decidedAt === 'number' ? { decidedAt: meta.decidedAt } : {}),
    ...(typeof meta.feedback === 'string' ? { feedback: meta.feedback } : {}),
    bytes: Buffer.byteLength(body, 'utf8'),
    body,
  }
}

/**
 * Per-workspace plan files, plus the monotonic token the UI polls.
 *
 * The token is an in-memory counter rather than an `fs.watch`: this process is
 * the only writer, so a counter bumped at every write is exact and costs
 * nothing. `dsh-git` needs a watcher because git is edited from outside the
 * harness; plans are not.
 */
export class PlanStore {
  /** Change token per canonical workspace directory. */
  private readonly tokens = new Map<string, number>()

  /** Serialized write chain per workspace directory. */
  private readonly tails = new Map<string, Promise<unknown>>()

  /**
   * The plans directory for one workspace, created on demand.
   * @param workspaceDir - absolute workspace directory.
   * @returns the absolute plans directory.
   */
  dirFor(workspaceDir: string): string {
    return join(resolve(workspaceDir), DOT_DSH, PLANS_DIR)
  }

  /**
   * The current change token for a workspace.
   * @param workspaceDir - absolute workspace directory.
   * @returns a counter that only increases.
   */
  token(workspaceDir: string): number {
    return this.tokens.get(resolve(workspaceDir)) ?? 0
  }

  /** Bump one workspace's token. */
  private bump(workspaceDir: string): void {
    const key = resolve(workspaceDir)
    this.tokens.set(key, (this.tokens.get(key) ?? 0) + 1)
  }

  /**
   * Every plan's metadata, newest first.
   *
   * Reads every file, because the metadata lives in the file — but the bodies
   * are dropped before returning, so a workspace with 200 plans does not send
   * a megabyte of markdown to render a list.
   * @param workspaceDir - absolute workspace directory.
   * @returns plan metadata, newest first.
   */
  list(workspaceDir: string): PlanMeta[] {
    const dir = this.dirFor(workspaceDir)
    if (!existsSync(dir)) return []
    const out: PlanMeta[] = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue
      const record = this.readFile(dir, name.slice(0, -3))
      if (record === undefined) continue
      const { body: _body, ...meta } = record
      out.push(meta)
    }
    // The filename prefix is a sortable timestamp, so this is chronological for
    // every file this plugin wrote; createdAt breaks ties and covers renames.
    return out.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
  }

  /**
   * One plan, with its markdown.
   * @param workspaceDir - absolute workspace directory.
   * @param id - the plan id.
   * @returns the record, or undefined when it is not there.
   */
  get(workspaceDir: string, id: string): PlanRecord | undefined {
    if (!isSafeId(id)) return undefined
    return this.readFile(this.dirFor(workspaceDir), id)
  }

  /** Read and parse one file, tolerating a concurrent delete. */
  private readFile(dir: string, id: string): PlanRecord | undefined {
    const path = join(dir, `${id}.md`)
    try {
      if (!statSync(path).isFile()) return undefined
      return parse(id, readFileSync(path, 'utf8'))
    } catch {
      return undefined
    }
  }

  /**
   * Write a newly presented plan as `pending`.
   * @param workspaceDir - absolute workspace directory.
   * @param plan - the markdown body.
   * @param sessionId - the presenting session.
   * @param at - epoch millis, injected so tests are deterministic.
   * @returns the stored record, or undefined when the body was refused.
   */
  create(workspaceDir: string, plan: string, sessionId: string, at = Date.now()): PlanRecord | undefined {
    if (typeof plan !== 'string' || plan.trim() === '') return undefined
    if (Buffer.byteLength(plan, 'utf8') > MAX_PLAN_BYTES) return undefined
    const title = firstHeading(plan) ?? 'Untitled plan'
    const id = `${stamp(at)}-${slugify(title)}`
    const record: PlanRecord = {
      id,
      title,
      sessionId,
      createdAt: at,
      status: 'pending',
      bytes: Buffer.byteLength(plan, 'utf8'),
      body: plan,
    }
    const dir = this.dirFor(workspaceDir)
    mkdirSync(dir, { recursive: true })
    writeAtomic(join(dir, `${id}.md`), serialize(record))
    this.bump(workspaceDir)
    this.prune(workspaceDir)
    return record
  }

  /**
   * Record how a pending plan's review settled.
   *
   * A plan whose file vanished between presentation and decision is not
   * recreated: the user deleted it, and resurrecting it on approval would be a
   * surprise.
   * @param workspaceDir - absolute workspace directory.
   * @param id - the plan id.
   * @param status - the settled status.
   * @param feedback - the reviewer's words, when they kept planning.
   * @param at - epoch millis, injected so tests are deterministic.
   * @returns the updated record, or undefined when it is gone.
   */
  settle(
    workspaceDir: string,
    id: string,
    status: PlanStatus,
    feedback?: string,
    at = Date.now(),
  ): PlanRecord | undefined {
    const existing = this.get(workspaceDir, id)
    if (existing === undefined) return undefined
    const next: PlanRecord = {
      ...existing,
      status,
      decidedAt: at,
      ...(feedback !== undefined && feedback !== '' ? { feedback } : {}),
    }
    writeAtomic(join(this.dirFor(workspaceDir), `${id}.md`), serialize(next))
    this.bump(workspaceDir)
    return next
  }

  /**
   * Delete one plan file.
   * @param workspaceDir - absolute workspace directory.
   * @param id - the plan id.
   * @returns whether a file was removed.
   */
  remove(workspaceDir: string, id: string): boolean {
    if (!isSafeId(id)) return false
    const path = join(this.dirFor(workspaceDir), `${id}.md`)
    if (!existsSync(path)) return false
    rmSync(path)
    this.bump(workspaceDir)
    return true
  }

  /**
   * Keep the newest {@link MAX_PLANS} plans, plus every pending one.
   *
   * The retention window is measured over ALL plans, not over the settled ones
   * alone. Counting only settled plans makes the cap drift: pruning runs inside
   * `create`, when the plan being written is still pending and therefore
   * invisible to a settled-only count, so each round of create-then-settle
   * leaves one extra plan behind forever.
   *
   * A pending plan that falls outside the window is skipped rather than
   * deleted, whatever its age. A pending plan is one nobody has answered yet,
   * and deleting it is deleting live work — so the total can exceed the cap,
   * bounded by however many reviews are genuinely outstanding.
   * @param workspaceDir - absolute workspace directory.
   */
  private prune(workspaceDir: string): void {
    const all = this.list(workspaceDir)
    if (all.length <= MAX_PLANS) return
    // `list` is newest-first, so everything past the window is the oldest.
    for (const plan of all.slice(MAX_PLANS)) {
      if (plan.status === 'pending') continue
      try {
        rmSync(join(this.dirFor(workspaceDir), `${plan.id}.md`))
      } catch {
        // A pruning failure is not worth failing the write that triggered it.
      }
    }
  }

  /**
   * Queue one whole read/modify/write behind this workspace's prior write.
   * @param workspaceDir - absolute workspace directory.
   * @param run - the work to serialize.
   * @returns whatever `run` returns.
   */
  async enqueue<T>(workspaceDir: string, run: () => T | Promise<T>): Promise<T> {
    const key = resolve(workspaceDir)
    const prior = this.tails.get(key) ?? Promise.resolve()
    const next = prior.then(run, run)
    // Store the NEUTRALIZED tail: later writes wait for this one but must not
    // inherit its rejection.
    const tail = next.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(key, tail)
    try {
      return await next
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}

/**
 * Whether an id is safe to turn into a filename.
 *
 * Ids come off the wire, so this is a real boundary: `..`, separators and drive
 * letters must never reach `join`.
 * @param id - candidate plan id.
 * @returns true when the id is a plain slug.
 */
export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[A-Za-z0-9._-]+$/.test(id) && !id.includes('..')
}

/**
 * Write via a temporary file and rename.
 *
 * `rename` is atomic within a filesystem, so a crash mid-write leaves the
 * previous plan intact rather than a truncated one. A plan the user is about
 * to approve is exactly the file that must not be half-written.
 * @param path - destination file.
 * @param text - complete contents.
 */
function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}
