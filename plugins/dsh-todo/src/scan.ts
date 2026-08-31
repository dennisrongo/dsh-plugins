/**
 * dsh-todo — building the evidence a scan reasons over.
 *
 * This module decides what a scan COSTS. Every source below is capped before
 * it is sent, because the button that triggers it spends tokens on one click
 * and a large repository would otherwise produce an unbounded prompt.
 *
 * It ships a DIGEST, never the repository: file contents appear only as
 * single-line comment matches and a leading slice of the README.
 *
 * Dependency-free apart from node builtins, so the test can import the built
 * module under plain Node with no harness packages on the import path.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Hard ceiling on the whole digest. Overflow truncates and says so. */
export const DIGEST_BYTE_CAP = 24_000

/** Directories never worth walking: vendored, generated, or version control. */
const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'lib', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.venv', 'venv', '__pycache__', 'target', 'vendor',
])

/** Extensions worth scanning for comments and counting as source. */
const SOURCE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs',
  '.java', '.rb', '.php', '.cs', '.swift', '.kt', '.scala', '.sh',
])

const MAX_FILES_WALKED = 4_000
const MAX_TREE_ENTRIES = 300
const MAX_COMMENTS = 80
const MAX_UNTESTED = 40
const MAX_COMMENT_LINE = 160
const README_BYTES = 4_000
const MAX_DEPTH = 8

interface Walked {
  /** Workspace-relative paths, forward-slashed. */
  files: string[]
  truncated: boolean
}

/** Normalise to forward slashes so the digest reads the same on every platform. */
function posix(path: string): string {
  return path.split(sep).join('/')
}

/**
 * Collect workspace-relative file paths, skipping vendored and generated trees.
 *
 * Depth- and count-capped: a deep monorepo must not turn one click into a
 * multi-second walk, and the caps are what keep the digest bounded before any
 * formatting happens.
 */
function walk(root: string): Walked {
  const files: string[] = []
  let truncated = false

  const visit = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES_WALKED) {
      truncated = true
      return
    }
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      // Unreadable directory: skip it. A permission error must not fail a scan.
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES_WALKED) {
        truncated = true
        return
      }
      // Skip dotfiles wholesale except the ones worth reading, plus every
      // ignored build/vendor directory.
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        visit(join(dir, entry.name), depth + 1)
      } else if (entry.isFile()) {
        files.push(posix(relative(root, join(dir, entry.name))))
      }
    }
  }

  try {
    if (!statSync(root).isDirectory()) return { files: [], truncated: false }
  } catch {
    // A workspace that does not exist yields an empty digest, not a throw.
    return { files: [], truncated: false }
  }
  visit(root, 0)
  return { files, truncated }
}

/** Read a file as text, yielding '' for anything unreadable or binary. */
function readText(path: string, limit = Number.MAX_SAFE_INTEGER): string {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return ''
  }
  // A NUL byte means this is not text; utf8-decoding a PNG produces garbage
  // that would waste digest budget and can carry control characters.
  if (raw.includes('\u0000')) return ''
  return raw.length > limit ? raw.slice(0, limit) : raw
}

const COMMENT_RE = /(?:^|\s)(?:\/\/|#|\/\*|\*)\s*(TODO|FIXME|HACK)\b[:\s]?(.*)$/

/** Unresolved-work comments, as `path:line  TAG rest`. */
function collectComments(root: string, files: readonly string[]): string[] {
  const out: string[] = []
  for (const rel of files) {
    if (out.length >= MAX_COMMENTS) break
    const dot = rel.lastIndexOf('.')
    if (dot < 0 || !SOURCE_EXT.has(rel.slice(dot))) continue
    const text = readText(join(root, rel))
    if (text === '') continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      if (out.length >= MAX_COMMENTS) break
      const match = COMMENT_RE.exec(lines[i])
      if (match === null) continue
      const body = match[2].trim().slice(0, MAX_COMMENT_LINE)
      out.push(`${rel}:${i + 1}  ${match[1]} ${body}`.trimEnd())
    }
  }
  return out
}

/** True when some file's name suggests it tests `base`. */
function hasTest(base: string, testNames: ReadonlySet<string>): boolean {
  return (
    testNames.has(`${base}.test`) ||
    testNames.has(`${base}.spec`) ||
    testNames.has(`test_${base}`) ||
    testNames.has(`${base}_test`) ||
    testNames.has(base)
  )
}

/**
 * Source modules with no apparent test.
 *
 * Name-based, deliberately: a real coverage run needs the project's own
 * toolchain, which a scan cannot assume exists. This is a HINT for the model
 * to weigh, which is why the digest labels it as such.
 */
function collectUntested(files: readonly string[]): string[] {
  const testNames = new Set<string>()
  for (const rel of files) {
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    const stem = name.replace(/\.[^.]+$/, '')
    if (/(^|[./_-])(test|spec)([./_-]|$)/i.test(rel)) {
      testNames.add(stem)
      testNames.add(stem.replace(/\.(test|spec)$/i, ''))
    }
  }

  const out: string[] = []
  for (const rel of files) {
    if (out.length >= MAX_UNTESTED) break
    const dot = rel.lastIndexOf('.')
    if (dot < 0 || !SOURCE_EXT.has(rel.slice(dot))) continue
    if (/(^|[./_-])(test|spec)([./_-]|$)/i.test(rel)) continue
    const stem = rel.slice(rel.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
    if (/^(index|main|types|constants)$/i.test(stem)) continue
    if (!hasTest(stem, testNames)) out.push(rel)
  }
  return out
}

/** Join sections, then enforce the byte ceiling with a visible marker. */
function assemble(sections: string[], walkTruncated: boolean): { digest: string; truncated: boolean } {
  const joined = sections.join('\n\n')
  if (joined.length <= DIGEST_BYTE_CAP) {
    return { digest: joined, truncated: walkTruncated }
  }
  // Truncation is MARKED, never silent: a model given a clipped digest must be
  // told, or it will reason confidently about a codebase it only half saw.
  const marker = '\n\n[digest truncated — the workspace is larger than one scan can carry]'
  return { digest: joined.slice(0, DIGEST_BYTE_CAP - marker.length) + marker, truncated: true }
}

/**
 * Build the bounded evidence a scan session reasons over.
 *
 * @param root - absolute path to the workspace directory.
 * @returns the digest text, and whether anything was left out.
 */
export function buildDigest(root: string): { digest: string; truncated: boolean } {
  const { files, truncated } = walk(root)
  const sections: string[] = []

  const tree = files.slice(0, MAX_TREE_ENTRIES)
  if (tree.length > 0) {
    sections.push(`### Files (${files.length} found, showing ${tree.length})\n${tree.join('\n')}`)
  }

  const readmeName = files.find((f) => /^readme(\.md|\.txt)?$/i.test(f))
  if (readmeName !== undefined) {
    const text = readText(join(root, readmeName), README_BYTES).trim()
    if (text !== '') sections.push(`### ${readmeName}\n${text}`)
  }

  const manifest = files.find((f) => f === 'package.json')
  if (manifest !== undefined) {
    const text = readText(join(root, manifest), 2_000).trim()
    if (text !== '') sections.push(`### package.json\n${text}`)
  }

  const comments = collectComments(root, files)
  if (comments.length > 0) {
    sections.push(`### Unresolved comments (TODO/FIXME/HACK)\n${comments.join('\n')}`)
  }

  const untested = collectUntested(files)
  if (untested.length > 0) {
    sections.push(
      '### Untested modules (name-based hint, not a coverage run)\n' + untested.join('\n'),
    )
  }

  return assemble(sections, truncated)
}
