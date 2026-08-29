/**
 * Vocabulary for dsh-memory.
 *
 * This plugin does not invent a memory store. dsh already loads
 * `AGENTS.md` / `CLAUDE.md` through `@deepseek-ai/dsh-agent-instructions` —
 * user-global, then every directory from the project root down to the session
 * cwd, plus `.local` overlays, deduplicated per directory and cut to a byte
 * budget. What was missing was a way to **write** a fact into that hierarchy
 * and a way to **see** what the loader actually did with it.
 *
 * @module @dennisrongo/dsh-memory/types
 */

/** Where a remembered fact is written. */
export type MemoryScope =
  /** `<projectRoot>/AGENTS.md` — travels with the repository. */
  | 'project'
  /** `<projectRoot>/AGENTS.local.md` — this checkout only, usually gitignored. */
  | 'local'
  /** `$DSH_HOME/AGENTS.md` — every project on this machine. */
  | 'user'

/** Every scope, in the order a chooser should present them. */
export const MEMORY_SCOPES: readonly MemoryScope[] = ['project', 'local', 'user']

/**
 * The heading a remembered fact is filed under.
 *
 * Facts go under one predictable heading rather than being appended to the end
 * of the file, so a hand-written `AGENTS.md` keeps its shape: the section is
 * created once and grown, and everything a human wrote stays above it.
 */
export const MEMORY_HEADING = '## Memories'

/**
 * Largest single remembered fact, in characters.
 *
 * A memory is a line, not a document. Something longer is a paste, and pasting
 * it into `AGENTS.md` silently spends the instruction byte budget that every
 * other file in the hierarchy is competing for.
 */
export const MAX_FACT_CHARS = 2000

/**
 * The user-global instruction file name under `$DSH_HOME`.
 *
 * `@deepseek-ai/dsh-agent-instructions` exports this as `USER_GLOBAL_FILE` from
 * its `render` module, but the package root re-exports only a subset, so the
 * value is restated here. If the loader ever changes it, the inspector will
 * show the user-global row vanish — which is the visible symptom to look for.
 */
export const USER_GLOBAL_FILE = 'AGENTS.md'

/** One instruction file, as the inspector reports it. */
export interface InstructionRow {
  /** Model-facing path: `user-global/AGENTS.md` or a project-relative path. */
  displayPath: string
  /** Absolute path on disk. */
  absolutePath: string
  /** File size in bytes, or 0 when it could not be read. */
  bytes: number
  /**
   * Whether the loader's byte budget kept this file.
   *
   * This is the number people actually need and cannot otherwise get: a file
   * that exists, is discovered, and is silently dropped for budget looks
   * exactly like a file the agent is ignoring for no reason.
   */
  included: boolean
  /** Bytes that survived, when the file was included but cut short. */
  truncatedTo?: number
}

/** What the inspector reports for one workspace. */
export interface InstructionReport {
  /** Directory the walk started from. */
  cwd: string
  /** Harness home holding the user-global file. */
  dshHome: string
  /** Byte budget the report was computed against. */
  maxBytes: number
  /** Total bytes of every discovered file. */
  discoveredBytes: number
  /** Files in model precedence order, broadest first. */
  files: InstructionRow[]
}

/**
 * Format one fact as the line appended to an instruction file.
 *
 * A leading `- ` makes it a list item under the memories heading, so the file
 * stays valid markdown whether or not anything else is there.
 * @param fact - the fact text, already validated.
 * @returns the line to append, without a trailing newline.
 */
export function formatFact(fact: string): string {
  return `- ${fact.trim().replace(/\s*\n\s*/g, ' ')}`
}

/**
 * Validate a candidate fact.
 * @param fact - untrusted text from a command or the wire.
 * @returns the trimmed fact, or a reason it was refused.
 */
export function validateFact(fact: unknown): { ok: true; fact: string } | { ok: false; reason: string } {
  if (typeof fact !== 'string') return { ok: false, reason: 'a memory must be text' }
  const trimmed = fact.trim()
  if (trimmed === '') return { ok: false, reason: 'nothing to remember' }
  if (trimmed.length > MAX_FACT_CHARS) {
    return { ok: false, reason: `a memory must be under ${MAX_FACT_CHARS} characters (got ${trimmed.length})` }
  }
  return { ok: true, fact: trimmed }
}

/**
 * Read a scope out of the leading flag on a `/remember` line.
 *
 * `--user`, `--local` and `--project` are accepted; anything else is part of
 * the fact. Returning the remainder lets the caller keep the user's exact text.
 * @param raw - everything after the command name.
 * @returns the selected scope and the remaining text.
 */
export function parseScope(raw: string): { scope: MemoryScope; rest: string } {
  const match = /^\s*--(user|local|project)\b\s*/.exec(raw)
  if (match === null) return { scope: 'project', rest: raw.trim() }
  return { scope: match[1] as MemoryScope, rest: raw.slice(match[0].length).trim() }
}
