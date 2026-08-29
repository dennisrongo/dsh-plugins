/**
 * Writing a fact into the instruction hierarchy, and reporting what the loader
 * did with it.
 *
 * Discovery is **not reimplemented here**. It is
 * `discoverBaselineInstructionFiles` and `loadBaselineInstructions` from
 * `@deepseek-ai/dsh-agent-instructions` — the same functions the harness calls
 * to build the model's context. An inspector that reimplemented the walk would
 * eventually disagree with the loader, and an inspector you cannot trust when
 * it disagrees is worse than none: the whole point is to answer "is the agent
 * reading this file?" authoritatively.
 *
 * @module @dennisrongo/dsh-memory/files
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import {
  discoverBaselineInstructionFiles,
  loadBaselineInstructions,
} from '@deepseek-ai/dsh-agent-instructions'
import {
  MEMORY_HEADING,
  USER_GLOBAL_FILE,
  formatFact,
  type InstructionReport,
  type InstructionRow,
  type MemoryScope,
} from './types.ts'

/**
 * The harness home holding the user-global instruction file.
 *
 * Same resolution order the loader's own config documents: `$DSH_HOME`, then
 * `~/.dsh`. Getting this wrong would point `--user` at a file nothing reads.
 * @returns the absolute harness home.
 */
export function dshHome(): string {
  const fromEnv = process.env.DSH_HOME
  return fromEnv !== undefined && fromEnv !== '' ? resolve(fromEnv) : join(homedir(), '.dsh')
}

/**
 * Walk upward for the project root, the way the loader does.
 *
 * `.git` is the loader's default marker. This is a local re-derivation rather
 * than a call into the package because the exported discovery returns files,
 * not the root it chose — but it is only used to pick a WRITE target, never to
 * decide what is loaded, so a disagreement here cannot make the report lie.
 * @param cwd - session working directory.
 * @returns the project root, or `cwd` when no marker is found.
 */
export function findProjectRoot(cwd: string): string {
  let dir = resolve(cwd)
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return resolve(cwd)
    dir = parent
  }
}

/**
 * The absolute file one scope writes to.
 * @param scope - the chosen scope.
 * @param cwd - session working directory.
 * @returns the absolute target path.
 */
export function targetFor(scope: MemoryScope, cwd: string): string {
  if (scope === 'user') return join(dshHome(), USER_GLOBAL_FILE)
  const root = findProjectRoot(cwd)
  return join(root, scope === 'local' ? 'AGENTS.local.md' : 'AGENTS.md')
}

/**
 * Append one fact under the memories heading, creating what is missing.
 *
 * The heading is found rather than assumed, and the fact is inserted at the END
 * of that section rather than at the end of the file. Appending blindly would
 * bury the memories under whatever section happens to be last, and after a few
 * facts the file reads as though someone scattered notes through it.
 *
 * A file that does not exist is created with the heading; a file that exists
 * without the heading gets it appended. Nothing a human wrote is ever moved.
 * @param path - absolute target file.
 * @param fact - the validated fact.
 * @returns the line that was written.
 */
export function appendFact(path: string, fact: string): string {
  const line = formatFact(fact)
  mkdirSync(dirname(path), { recursive: true })

  if (!existsSync(path)) {
    writeFileSync(path, `${MEMORY_HEADING}\n\n${line}\n`, 'utf8')
    return line
  }

  const original = readFileSync(path, 'utf8')
  const normalized = original.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const headingAt = lines.findIndex((entry) => entry.trim() === MEMORY_HEADING)

  if (headingAt === -1) {
    // No section yet. Append one, guarding the blank line so the heading cannot
    // end up glued to the last line of prose.
    const gap = normalized.endsWith('\n\n') ? '' : normalized.endsWith('\n') ? '\n' : '\n\n'
    appendFileSync(path, `${gap}${MEMORY_HEADING}\n\n${line}\n`, 'utf8')
    return line
  }

  // Find where this section ends: the next heading of any level, or EOF.
  let end = lines.length
  for (let i = headingAt + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) {
      end = i
      break
    }
  }
  // Step back over trailing blank lines so the new item joins the list rather
  // than starting a second one after a gap.
  let at = end
  while (at > headingAt + 1 && lines[at - 1].trim() === '') at -= 1

  lines.splice(at, 0, line)
  writeFileSync(path, lines.join('\n'), 'utf8')
  return line
}

/**
 * Report every instruction file discovered for one directory, and whether the
 * loader's byte budget kept it.
 *
 * Both halves come from the loader's own exports: `discoverBaselineInstructionFiles`
 * for the candidate list in model precedence order, and `loadBaselineInstructions`
 * for the `omitted` and `truncated` accounting the budget produced.
 * @param cwd - session working directory.
 * @param maxBytes - the budget to report against; use the profile's configured value.
 * @returns the report.
 */
export async function inspect(cwd: string, maxBytes: number): Promise<InstructionReport> {
  const home = dshHome()
  const discovered = await discoverBaselineInstructionFiles({ cwd, dshHome: home })
  const rendered = await loadBaselineInstructions({ cwd, dshHome: home, maxBytes })

  const omitted = new Set((rendered?.omitted ?? []).map((file) => file.absolutePath))
  const truncated = new Map((rendered?.truncated ?? []).map((entry) => [entry.displayPath, entry.includedBytes]))

  const files: InstructionRow[] = discovered.map((file) => {
    let bytes = 0
    try {
      bytes = statSync(file.absolutePath).size
    } catch {
      // A file that vanished between discovery and stat reports as 0 rather
      // than failing the whole report.
    }
    const cut = truncated.get(file.displayPath)
    return {
      displayPath: file.displayPath,
      absolutePath: file.absolutePath,
      bytes,
      included: !omitted.has(file.absolutePath),
      ...(cut !== undefined ? { truncatedTo: cut } : {}),
    }
  })

  return {
    cwd: resolve(cwd),
    dshHome: home,
    maxBytes,
    discoveredBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  }
}

/**
 * Read one discovered instruction file.
 *
 * Callers name a file by its ABSOLUTE path, and the path is accepted only when
 * it is one the loader actually discovered for this directory. That check is
 * the boundary: without it the endpoint reads any file on the host.
 * @param cwd - session working directory.
 * @param absolutePath - the file to read.
 * @returns the contents, or undefined when the path is not a discovered file.
 */
export async function readInstruction(cwd: string, absolutePath: unknown): Promise<string | undefined> {
  if (typeof absolutePath !== 'string' || absolutePath === '') return undefined
  const discovered = await discoverBaselineInstructionFiles({ cwd, dshHome: dshHome() })
  const wanted = resolve(absolutePath)
  if (!discovered.some((file) => resolve(file.absolutePath) === wanted)) return undefined
  try {
    return readFileSync(wanted, 'utf8')
  } catch {
    return undefined
  }
}
