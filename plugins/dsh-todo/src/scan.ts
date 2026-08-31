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

/**
 * Directories never worth walking: vendored, generated, or version control.
 *
 * `.gitignore` is deliberately NOT consulted — a scan must behave the same in a
 * checkout with no VCS, and parsing ignore semantics correctly is its own
 * project. That makes this static list the ONLY defence against a vendored tree
 * spending the digest budget on code the user did not write, so it errs toward
 * covering the common ecosystem conventions rather than the minimum.
 */
const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn',
  'node_modules', 'bower_components', 'jspm_packages',
  'lib', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.output', '.parcel-cache', '.turbo',
  '.cache', '.venv', 'venv', '__pycache__', '.tox', '.mypy_cache', '.pytest_cache',
  'target', 'vendor', 'vendored', 'third_party', 'thirdparty', 'external',
  'generated', 'gen', '__generated__',
  'Pods', 'Carthage', 'DerivedData',
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

/**
 * Largest file this scan will open at all, in bytes.
 *
 * The walk must bound its own WORK, not merely its output. `readFileSync`
 * materialises the whole file before any `limit` can apply, and `split` then
 * puts a line array on top of it — so a checked-in bundle, minified vendor
 * blob, or dataset that happens to carry a source extension turns one button
 * click into a multi-megabyte allocation, twice over.
 *
 * 2 MiB is far above any hand-written source file (this repo's largest is under
 * 400 KB, and that is a generated bundle) and far below the artefacts worth
 * refusing. A file over it is skipped entirely rather than partially read: a
 * leading slice of a minified bundle is one enormous line with no useful
 * comment in it, so reading part of it would spend the budget for nothing.
 */
const MAX_READ_BYTES = 2 * 1024 * 1024

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
      //
      // WHY THIS WALK CANNOT LOOP: `readdirSync(withFileTypes)` uses lstat
      // semantics, so a symlink or Windows junction is classified
      // `isSymbolicLink()` — NOT `isDirectory()` and not `isFile()` — and falls
      // through both branches below without being followed. A link pointing at
      // its own ancestor is therefore inert, and MAX_DEPTH is a budget rather
      // than the loop guard.
      //
      // This is load-bearing, not incidental: reclassifying entries with
      // `statSync` (which resolves the link) would make an ancestor link an
      // infinite walk, bounded only by MAX_DEPTH/MAX_FILES_WALKED and reported
      // as a truncated scan rather than as the bug it is. `test/scan.test.mjs`
      // pins termination with a real self-referential link.
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

/**
 * Read a file as text, yielding '' for anything unreadable, oversized or binary.
 *
 * The size check happens BEFORE the read and is not merely an optimisation:
 * `limit` can only clip a string that has already been allocated in full, so
 * without this an implausibly large file is paid for whether or not its content
 * is wanted. See MAX_READ_BYTES.
 */
function readText(path: string, limit = Number.MAX_SAFE_INTEGER): string {
  let raw: string
  try {
    if (statSync(path).size > MAX_READ_BYTES) return ''
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

/**
 * A section's kept entries plus how many actually existed.
 *
 * `total` is what makes a capped section honest. Reporting only what survived
 * lets a digest assert nothing was lost while most of the evidence was dropped
 * before assembly ever ran.
 */
interface Capped {
  kept: string[]
  total: number
}

/**
 * Unresolved-work comments, as `path:line  TAG rest`.
 *
 * Counting continues past MAX_COMMENTS so the caller can disclose the true
 * total; only the kept slice is retained, so the memory cost stays capped.
 */
function collectComments(root: string, files: readonly string[]): Capped {
  const kept: string[] = []
  let total = 0
  for (const rel of files) {
    const dot = rel.lastIndexOf('.')
    if (dot < 0 || !SOURCE_EXT.has(rel.slice(dot))) continue
    const text = readText(join(root, rel))
    if (text === '') continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const match = COMMENT_RE.exec(lines[i])
      if (match === null) continue
      total += 1
      if (kept.length >= MAX_COMMENTS) continue
      const body = match[2].trim().slice(0, MAX_COMMENT_LINE)
      kept.push(`${rel}:${i + 1}  ${match[1]} ${body}`.trimEnd())
    }
  }
  return { kept, total }
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
 *
 * The match is on a GLOBAL BARE STEM — `testNames` is one flat namespace of
 * file stems with no path attached — so the imprecision runs in two concrete
 * directions, and a reader should expect both:
 *
 * 1. **Over-suppression across directories.** A single `test/utils.test.mjs`
 *    suppresses `src/billing/utils.ts` AND `src/auth/utils.ts`, because only the
 *    stem `utils` is compared. Every same-named module in the repo is covered by
 *    one test of that name.
 * 2. **Over-suppression from directory names.** The `test`/`spec` detection at
 *    `hasTest`'s loosest arm matches anywhere in the path, so a module under a
 *    directory like `src/test-utils/` registers its own stem as a test name and
 *    suppresses itself.
 *
 * Both directions produce FALSE NEGATIVES — a real gap goes unreported — which
 * is the safe failure for this feature: it under-suggests rather than asserting
 * a module is untested when it is not. Making this path-aware is a deliberately
 * rejected change, larger than the feature warrants; do not "fix" it casually.
 */
function collectUntested(files: readonly string[]): Capped {
  const testNames = new Set<string>()
  for (const rel of files) {
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    const stem = name.replace(/\.[^.]+$/, '')
    if (/(^|[./_-])(test|spec)([./_-]|$)/i.test(rel)) {
      testNames.add(stem)
      testNames.add(stem.replace(/\.(test|spec)$/i, ''))
    }
  }

  const kept: string[] = []
  let total = 0
  for (const rel of files) {
    const dot = rel.lastIndexOf('.')
    if (dot < 0 || !SOURCE_EXT.has(rel.slice(dot))) continue
    if (/(^|[./_-])(test|spec)([./_-]|$)/i.test(rel)) continue
    const stem = rel.slice(rel.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
    if (/^(index|main|types|constants)$/i.test(stem)) continue
    if (hasTest(stem, testNames)) continue
    total += 1
    if (kept.length < MAX_UNTESTED) kept.push(rel)
  }
  return { kept, total }
}

/**
 * Head a section, disclosing the cap whenever one bound.
 *
 * Every capped section MUST route through this. A header that reports only the
 * kept count reads as a complete list, which is the silent-truncation failure
 * the digest exists to avoid.
 */
function sectionHeader(title: string, total: number, kept: number): string {
  return kept < total
    ? `### ${title} (${total} found, showing ${kept})`
    : `### ${title} (${total})`
}

/**
 * Join sections, then enforce the byte ceiling with a visible marker.
 *
 * `walkTruncated` earns its own marker rather than riding out on the returned
 * flag alone. The digest has to be SELF-DESCRIBING: it is handed to a model as
 * text, and a caller that forgets to read the flag turns a bounded walk back
 * into a confident claim about a codebase only half seen.
 */
function assemble(sections: string[], walkTruncated: boolean): { digest: string; truncated: boolean } {
  const parts = walkTruncated
    ? sections.concat(
        '[walk truncated — this workspace is deeper or larger than one scan walks;'
          + ' files below the depth or count limit were never examined]',
      )
    : sections
  const joined = parts.join('\n\n')
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
  // Any section that dropped evidence counts as truncation, exactly as the walk
  // caps do. Previously only the assembled byte ceiling set this, so the two
  // largest evidence sources could be more than halved with the digest
  // reporting `truncated: false`.
  let sectionTruncated = false

  const tree = files.slice(0, MAX_TREE_ENTRIES)
  if (tree.length > 0) {
    if (tree.length < files.length) sectionTruncated = true
    sections.push(`${sectionHeader('Files', files.length, tree.length)}\n${tree.join('\n')}`)
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
  if (comments.kept.length > 0) {
    if (comments.kept.length < comments.total) sectionTruncated = true
    sections.push(
      sectionHeader('Unresolved comments (TODO/FIXME/HACK)', comments.total, comments.kept.length)
        + '\n' + comments.kept.join('\n'),
    )
  }

  const untested = collectUntested(files)
  if (untested.kept.length > 0) {
    if (untested.kept.length < untested.total) sectionTruncated = true
    sections.push(
      sectionHeader(
        'Untested modules (name-based hint, not a coverage run)',
        untested.total,
        untested.kept.length,
      ) + '\n' + untested.kept.join('\n'),
    )
  }

  return assemble(sections, truncated || sectionTruncated)
}
