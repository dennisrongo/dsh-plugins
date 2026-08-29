/**
 * `dsh-todo` — a command-line face for the per-workspace task list.
 *
 * Built so an AI agent can manage the same list you see in the Todo tab: it
 * shells out, gets JSON, and writes back. Everything is scoped to a workspace
 * DIRECTORY (default: cwd), so no harness profile, session or running server is
 * required — the CLI works offline and in CI.
 *
 * ## Why it talks to SQLite directly
 *
 * SQLite is a multi-process database and its file lock is the real guard: a
 * writer arriving inside the harness's transaction is refused rather than
 * allowed to interleave, and `./db.ts` sets a `busy_timeout` so that write
 * WAITS for the commit instead of failing. Going through HTTP would add a
 * running-server dependency without buying more safety.
 *
 * The one visible effect of an out-of-band edit is the `revision` token: a
 * browser tab holding the previous value gets a `revision-conflict` on its next
 * write and adopts the authoritative list. That is the designed reconciliation,
 * not data loss.
 *
 * Every mutation goes through {@link mutate}, which re-reads inside the same
 * handle and bumps the revision, so concurrent CLI invocations cannot lose an
 * update to a stale read.
 *
 * @module @dennisrongo/dsh-todo/cli
 */
import { resolve } from 'node:path'
import { openDb, readList, writeList } from './db.ts'
import {
  MAX_DESC,
  MAX_TEXT,
  PRIORITIES,
  STATUSES,
  normalizeDueDate,
  normalizeVersionLabel,
  type LabelField,
  toPriority,
  toStatus,
  type TodoItem,
  type TodoPriority,
  type TodoStatus,
} from './types.ts'

/** Exit codes. Distinct so a script can branch on WHY a command failed. */
export const EXIT = {
  ok: 0,
  /** Bad flags, unknown command, malformed value. */
  usage: 2,
  /** A well-formed request that matched nothing (e.g. unknown task id). */
  notFound: 3,
} as const

/** One parsed invocation. */
export interface ParsedArgs {
  command: string
  /** Positional arguments after the command. */
  positional: string[]
  /** `--key value` and `--flag` pairs; a bare flag is `true`. */
  options: Record<string, string | true>
}

/**
 * Parse argv into a command, positionals and options.
 *
 * Hand-rolled rather than pulling in commander: the surface is small, and a
 * dependency here would have to be declared and anchored for every consumer
 * (the repo has already been bitten by an undeclared runtime import).
 *
 * Supports `--key=value`, `--key value`, and bare `--flag`. A value that itself
 * begins with `--` is treated as the next flag, so `--description --json` does
 * not silently swallow the following option.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv
  const positional: string[] = []
  const options: Record<string, string | true> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const body = token.slice(2)
    const eq = body.indexOf('=')
    if (eq >= 0) {
      options[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    const next = rest[i + 1]
    if (next === undefined || next.startsWith('--')) {
      options[body] = true
    } else {
      options[body] = next
      i += 1
    }
  }
  return { command, positional, options }
}

/** A command failed in a way the user can fix; carries the process exit code. */
export class CliError extends Error {
  /**
   * @param message - human-readable reason.
   * @param code - process exit code, from {@link EXIT}.
   * @param details - extra machine-readable fields merged into the `--json`
   * error payload, so an agent can correct itself without parsing the sentence.
   */
  constructor(
    message: string,
    readonly code: number = EXIT.usage,
    readonly details: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'CliError'
  }
}

/** Read a string option, rejecting a bare flag that carries no value. */
function str(options: ParsedArgs['options'], key: string): string | undefined {
  const value = options[key]
  if (value === undefined) return undefined
  if (value === true) throw new CliError(`--${key} needs a value`)
  return value
}

/** Validate an option against a fixed set, so a typo fails loudly. */
function oneOf<T extends string>(
  options: ParsedArgs['options'],
  key: string,
  allowed: readonly T[],
): T | undefined {
  const raw = str(options, key)
  if (raw === undefined) return undefined
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new CliError(`--${key} must be one of: ${allowed.join(', ')} (got "${raw}")`)
  }
  return raw as T
}

/**
 * Refuse a release/sprint value that is not a numeric label for that field.
 *
 * The two rules differ — a release carries a patch segment (`0.5.1`), a sprint
 * is a single decimal — so the message names the shape the field actually
 * accepts rather than a generic "invalid". An empty string is left alone: it
 * is how a field is CLEARED from a shell.
 */
function assertLabel(field: LabelField, raw: string | undefined): void {
  if (raw === undefined || raw === '') return
  if (normalizeVersionLabel(raw, field) !== undefined) return
  const shape = field === 'release'
    ? 'a version number like 1.5 or 0.5.1 (up to three numbers)'
    : 'a decimal number like 1.5 (one dot at most)'
  throw new CliError(
    `--${field} must be ${shape} (got "${raw}") — nothing was saved`,
    EXIT.usage,
    { field, expected: shape, got: raw },
  )
}

/**
 * Resolve the workspace directory for this invocation.
 *
 * `--workspace` wins, else the cwd. The directory is used as given rather than
 * searched upward: an agent running in a subdirectory should target the project
 * it was pointed at, not whichever ancestor happens to hold a `.dsh`.
 */
export function resolveWorkspace(options: ParsedArgs['options'], cwd: string): string {
  return resolve(str(options, 'workspace') ?? cwd)
}

/** Generate an id in the same shape the browser half uses. */
function makeId(now: number, rand: () => number): string {
  return `t${now.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`
}

/** True when the item counts as finished. */
function isDone(item: TodoItem): boolean {
  return item.status === 'done'
}

/** True when the item has been archived out of the active list. */
function isArchived(item: TodoItem): boolean {
  return typeof item.archivedAt === 'number'
}

/**
 * Find one task by id, accepting an unambiguous PREFIX.
 *
 * Ids are opaque and awkward to retype, so `update t1a2` works when only one id
 * starts that way. An ambiguous prefix is an error rather than a guess.
 */
export function findItem(items: TodoItem[], ref: string): TodoItem {
  const exact = items.find((i) => i.id === ref)
  if (exact) return exact
  const matches = items.filter((i) => i.id.startsWith(ref))
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) throw new CliError(`no task matching "${ref}"`, EXIT.notFound)
  throw new CliError(
    `"${ref}" matches ${matches.length} tasks: ${matches.map((i) => i.id).join(', ')}`,
  )
}

/**
 * Apply a pure transform and commit it in one open handle.
 *
 * Read and write share the handle so the revision the write stamps is derived
 * from the state this call actually observed.
 * @returns whatever the transform reports, plus the committed list.
 */
export function mutate(
  dir: string,
  fn: (items: TodoItem[]) => TodoItem[],
): { items: TodoItem[]; revision: number } {
  const db = openDb(dir)
  try {
    const current = readList(db)
    const next = fn(current.items)
    const revision = current.revision + 1
    writeList(db, next, revision)
    return { items: next, revision }
  } finally {
    // Windows keeps the file locked against deletion while a handle is open.
    db.close()
  }
}

/** Read the list without holding the handle open. */
export function read(dir: string): { items: TodoItem[]; revision: number } {
  const db = openDb(dir)
  try {
    const list = readList(db)
    return { items: list.items, revision: list.revision }
  } finally {
    db.close()
  }
}

/** Filters accepted by `list`, applied in combination. */
export interface ListFilter {
  status?: TodoStatus
  priority?: TodoPriority
  release?: string
  sprint?: string
  /** Everything unfinished, whatever stage it is at. */
  open?: boolean
  /** Include archived tasks, which are hidden by default. */
  archived?: boolean
}

/**
 * Apply the list filters.
 *
 * Archived tasks are excluded unless asked for, matching the UI: the archive is
 * a log, and an agent listing "the work" should not be handed finished history.
 */
export function filterList(items: TodoItem[], filter: ListFilter): TodoItem[] {
  return items.filter((item) => {
    if (!filter.archived && isArchived(item)) return false
    if (filter.archived && !isArchived(item)) return false
    if (filter.open && isDone(item)) return false
    if (filter.status && item.status !== filter.status) return false
    if (filter.priority && item.priority !== filter.priority) return false
    if (filter.release && item.release !== filter.release) return false
    if (filter.sprint && item.sprint !== filter.sprint) return false
    return true
  })
}

/** Render one task as a single scannable line. */
export function formatItem(item: TodoItem): string {
  const box = isDone(item) ? '[x]' : '[ ]'
  const bits = [box, item.id.padEnd(12), item.status.padEnd(11), item.priority, item.title]
  const meta: string[] = []
  if (item.release) meta.push(`release=${item.release}`)
  if (item.sprint) meta.push(`sprint=${item.sprint}`)
  if (item.dueDate) meta.push(`due=${item.dueDate}`)
  if (isArchived(item)) meta.push('archived')
  return bits.join(' ') + (meta.length ? `  (${meta.join(' ')})` : '')
}

/** The text the `help` command prints. */
export const HELP = `dsh-todo — manage a workspace's task list

Usage
  dsh-todo <command> [options]

Commands
  list                       Show tasks (active only by default)
  add <title>                Create a task
  update <id>                Change fields on a task
  done <id>                  Mark a task done
  reopen <id>                Return a finished task to todo
  rm <id>                    Delete a task outright
  archive [<id>]             Archive one task, or every completed task
  show <id>                  Print one task in full
  help                       This text

Options
  --workspace <dir>          Workspace directory (default: cwd)
  --json                     Machine-readable output (use this from a script)

  --status <s>               ${STATUSES.join('|')}
  --priority <p>             ${PRIORITIES.join('|')}
  --release <n[.n[.n]]>      e.g. 1.5 or 0.5.1   (empty string clears)
  --sprint <n[.n]>           e.g. 24             (empty string clears)
  --due <YYYY-MM-DD>         Calendar day       (empty string clears)
  --description <text>       Body text          (empty string clears)
  --title <text>             Rename (update only)

  list filters: --status --priority --release --sprint --open --archived

Ids may be given as any unambiguous prefix.

Examples
  dsh-todo list --open --json
  dsh-todo add "Fix token refresh" --priority p0 --release 1.5 --due 2026-03-14
  dsh-todo update t1a2 --status in-progress --sprint 24
  dsh-todo done t1a2
`

/** What a command returns to {@link run}: text for humans, data for --json. */
interface Outcome {
  text: string
  json: unknown
}

/**
 * Execute one parsed invocation.
 *
 * Pure with respect to process state — it takes cwd and clock as parameters and
 * returns output rather than printing — so the smoke test can drive every
 * command without spawning a shell.
 * @returns the rendered output for both modes.
 */
export function run(
  parsed: ParsedArgs,
  cwd: string,
  now: () => number = Date.now,
  rand: () => number = Math.random,
): Outcome {
  const { command, positional, options } = parsed
  const dir = resolveWorkspace(options, cwd)

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      return { text: HELP, json: { help: HELP } }

    case 'list': {
      const { items } = read(dir)
      const filtered = filterList(items, {
        status: oneOf(options, 'status', STATUSES),
        priority: oneOf(options, 'priority', PRIORITIES),
        release: str(options, 'release'),
        sprint: str(options, 'sprint'),
        open: options.open === true,
        archived: options.archived === true,
      })
      const text =
        filtered.length === 0
          ? 'No matching tasks.'
          : filtered.map(formatItem).join('\n')
      return { text, json: { count: filtered.length, items: filtered } }
    }

    case 'show': {
      const ref = positional[0]
      if (!ref) throw new CliError('show needs a task id')
      const { items } = read(dir)
      const item = findItem(items, ref)
      const lines = [
        `id          ${item.id}`,
        `title       ${item.title}`,
        `status      ${item.status}`,
        `priority    ${item.priority}`,
        `release     ${item.release ?? '-'}`,
        `sprint      ${item.sprint ?? '-'}`,
        `due         ${item.dueDate ?? '-'}`,
        `created     ${new Date(item.createdAt).toISOString()}`,
        ...(item.completedAt ? [`completed   ${new Date(item.completedAt).toISOString()}`] : []),
        ...(item.archivedAt ? [`archived    ${new Date(item.archivedAt).toISOString()}`] : []),
        ...(item.description ? ['', item.description] : []),
      ]
      return { text: lines.join('\n'), json: item }
    }

    case 'add': {
      const title = positional.join(' ').trim()
      if (!title) throw new CliError('add needs a title')
      const description = str(options, 'description')
      const releaseRaw = str(options, 'release')
      const sprintRaw = str(options, 'sprint')
      // A label that fails validation must not be dropped silently — the agent
      // asked for a release/sprint and would otherwise never learn it was
      // refused. Same contract as --due below.
      assertLabel('release', releaseRaw)
      assertLabel('sprint', sprintRaw)
      const release = normalizeVersionLabel(releaseRaw, 'release')
      const sprint = normalizeVersionLabel(sprintRaw, 'sprint')
      const dueRaw = str(options, 'due')
      // A due date that fails validation must not be dropped silently — the
      // agent asked for a date and would otherwise never learn it was refused.
      if (dueRaw !== undefined && dueRaw !== '' && normalizeDueDate(dueRaw) === undefined) {
        throw new CliError(`--due must be a real calendar date as YYYY-MM-DD (got "${dueRaw}")`)
      }
      const item: TodoItem = {
        id: makeId(now(), rand),
        title: title.slice(0, MAX_TEXT),
        status: oneOf(options, 'status', STATUSES) ?? 'todo',
        priority: oneOf(options, 'priority', PRIORITIES) ?? 'p2',
        ...(description ? { description: description.slice(0, MAX_DESC) } : {}),
        ...(release !== undefined ? { release } : {}),
        ...(sprint !== undefined ? { sprint } : {}),
        ...(dueRaw ? { dueDate: normalizeDueDate(dueRaw) as string } : {}),
        createdAt: now(),
      }
      const { revision } = mutate(dir, (items) => [...items, item])
      return { text: `added ${item.id}  ${item.title}`, json: { item, revision } }
    }

    case 'update': {
      const ref = positional[0]
      if (!ref) throw new CliError('update needs a task id')
      const status = oneOf(options, 'status', STATUSES)
      const priority = oneOf(options, 'priority', PRIORITIES)
      const title = str(options, 'title')
      const description = str(options, 'description')
      const release = str(options, 'release')
      const sprint = str(options, 'sprint')
      const due = str(options, 'due')
      if (due !== undefined && due !== '' && normalizeDueDate(due) === undefined) {
        throw new CliError(`--due must be a real calendar date as YYYY-MM-DD (got "${due}")`)
      }
      assertLabel('release', release)
      assertLabel('sprint', sprint)
      if (
        status === undefined && priority === undefined && title === undefined &&
        description === undefined && release === undefined && sprint === undefined &&
        due === undefined
      ) {
        throw new CliError('update needs at least one field to change')
      }

      let updated: TodoItem | undefined
      const { revision } = mutate(dir, (items) => {
        const target = findItem(items, ref)
        return items.map((item) => {
          if (item.id !== target.id) return item
          const next: TodoItem = { ...item }
          if (title !== undefined) next.title = title.slice(0, MAX_TEXT)
          if (priority !== undefined) next.priority = toPriority(priority)
          if (status !== undefined) {
            next.status = toStatus(status)
            // Stamp/clear alongside the status so the two cannot disagree.
            if (next.status === 'done') next.completedAt = now()
            else delete next.completedAt
          }
          // An empty string CLEARS an optional field; that is the only way to
          // unset one from a shell, where "absent" and "empty" look alike.
          if (description !== undefined) {
            if (description) next.description = description.slice(0, MAX_DESC)
            else delete next.description
          }
          for (const [key, raw] of [['release', release], ['sprint', sprint]] as const) {
            if (raw === undefined) continue
            const label = normalizeVersionLabel(raw, key)
            if (label !== undefined) next[key] = label
            else delete next[key]
          }
          if (due !== undefined) {
            const value = normalizeDueDate(due)
            if (value !== undefined) next.dueDate = value
            else delete next.dueDate
          }
          updated = next
          return next
        })
      })
      return { text: `updated ${updated?.id}`, json: { item: updated, revision } }
    }

    case 'done':
    case 'reopen': {
      const ref = positional[0]
      if (!ref) throw new CliError(`${command} needs a task id`)
      const target: TodoStatus = command === 'done' ? 'done' : 'todo'
      let updated: TodoItem | undefined
      const { revision } = mutate(dir, (items) => {
        const found = findItem(items, ref)
        return items.map((item) => {
          if (item.id !== found.id) return item
          const next: TodoItem = { ...item, status: target }
          if (target === 'done') next.completedAt = now()
          else delete next.completedAt
          updated = next
          return next
        })
      })
      return { text: `${command} ${updated?.id}  ${updated?.title}`, json: { item: updated, revision } }
    }

    case 'rm': {
      const ref = positional[0]
      if (!ref) throw new CliError('rm needs a task id')
      let removed: TodoItem | undefined
      const { revision } = mutate(dir, (items) => {
        removed = findItem(items, ref)
        return items.filter((item) => item.id !== removed?.id)
      })
      return { text: `removed ${removed?.id}  ${removed?.title}`, json: { item: removed, revision } }
    }

    case 'archive': {
      const ref = positional[0]
      const stamp = now()
      let count = 0
      const { revision } = mutate(dir, (items) => {
        if (ref) {
          const found = findItem(items, ref)
          return items.map((item) => {
            if (item.id !== found.id || isArchived(item)) return item
            count += 1
            return { ...item, archivedAt: stamp }
          })
        }
        // No id: archive every completed task, matching the tab's bulk action.
        return items.map((item) => {
          if (!isDone(item) || isArchived(item)) return item
          count += 1
          return { ...item, archivedAt: stamp }
        })
      })
      return { text: `archived ${count} task(s)`, json: { archived: count, revision } }
    }

    default:
      throw new CliError(`unknown command "${command}" — try: dsh-todo help`)
  }
}

/**
 * Process entry point: parse, run, print, and pick an exit code.
 *
 * `--json` prints JSON on BOTH paths, including errors, so a caller that asked
 * for machine output never has to parse a human sentence to find out what went
 * wrong.
 * @returns the exit code the process should use.
 */
export function main(argv: string[], cwd: string = process.cwd()): number {
  const parsed = parseArgs(argv)
  const wantsJson = parsed.options.json === true
  try {
    const outcome = run(parsed, cwd)
    // `ok` leads on BOTH paths: a payload that only ever appears on success
    // still forces an agent to infer the verdict from its shape, and a caller
    // that guesses wrong reports a write that never happened.
    const json = outcome.json !== null && typeof outcome.json === 'object' && !Array.isArray(outcome.json)
      ? { ok: true, ...(outcome.json as Record<string, unknown>) }
      : { ok: true, result: outcome.json }
    console.log(wantsJson ? JSON.stringify(json, null, 2) : outcome.text)
    return EXIT.ok
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof CliError ? error.code : 1
    const details = error instanceof CliError ? error.details : {}
    if (wantsJson) console.log(JSON.stringify({ ok: false, error: message, code, ...details }, null, 2))
    else console.error(`dsh-todo: ${message}`)
    return code
  }
}
