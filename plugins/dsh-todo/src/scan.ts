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
  'target', 'vendor', 'vendored', 'third_party', 'thirdparty',
  'generated', '__generated__',
  'Pods', 'Carthage', 'DerivedData',
])

/*
 * NOT on that list, deliberately: `gen` and `external`.
 *
 * Every other cap in this module drops evidence and DISCLOSES it. An ignored
 * directory is the one exclusion with no disclosure at all — it is not counted,
 * not headed, and not flagged, so a wrongly-ignored tree is indistinguishable
 * from one that does not exist. That asymmetry is why the bar for adding a name
 * here is "nobody hand-writes this", which `node_modules` and `__pycache__`
 * clear and these two do not: `gen/` is an ordinary module name and `external/`
 * an ordinary adapter layer. Erasing a user's own code is the one failure this
 * list must not have.
 */

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
const MANIFEST_BYTES = 2_000
const MAX_DEPTH = 8

/**
 * How far a section keeps COUNTING after it has stopped keeping.
 *
 * Counting past the keep-cap is what lets a section report a true total instead
 * of asserting that the 80 entries it kept were all there were. Counting past
 * it FOREVER is what made the worst case universal: with no ceiling the scan
 * reads every source file in the repository on every click, measured at 3.4s
 * for 1200 files and ~19s at 4000 — a cost paid by every scan, not just the
 * pathological one, since the early exit that used to spare the typical repo
 * was exactly what had to go to make the total honest.
 *
 * A ceiling buys back the early exit without returning to the silent drop.
 * Past it the total is reported as a LOWER BOUND (`800+ found, showing 80`),
 * which is a weaker claim than the exact count but still a true one — and the
 * distinction that matters is disclosed-vs-silent, not exact-vs-bounded. Below
 * the ceiling nothing changes and the exact total is still reported.
 *
 * 10x the keep-cap is chosen so the disclosed bound is informative rather than
 * a bare "more than we showed": at 800 a reader learns the backlog is at least
 * an order of magnitude past what fits, which is the decision the number feeds.
 */
const SCAN_CEILING_FACTOR = 10

/**
 * How many files the comment scan will OPEN before it stops.
 *
 * A ceiling on comments FOUND does not bound the work, and measuring is what
 * showed it: a repository with one TODO per file must read 800 files to count
 * 800 comments, so the fixture that motivated this fix (1200 files x 180 KB)
 * still took 3.15s against 3.43s unbounded — a 9% saving on a cost that needed
 * to fall by an order of magnitude. The expensive part is the read and the line
 * split, which happen per FILE and are paid in full whether or not the file
 * turns out to contain anything.
 *
 * So the real bound is on files opened, and the comment ceiling stays as the
 * second of the two: whichever binds first stops the scan, and either one makes
 * the reported total a lower bound. 400 files is roughly 5x the keep-cap in the
 * worst realistic density (one comment per file) and keeps the same fixture
 * inside a click budget.
 *
 * Deliberately NOT a time budget. A deadline makes the digest depend on machine
 * speed and disk cache, so the same workspace yields different evidence on two
 * runs and a test can only assert it flakily. A file count is deterministic:
 * the same repository always produces the same digest.
 */
const MAX_FILES_READ = 400

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

/**
 * True when this path is skipped by the size guard rather than read.
 *
 * A separate probe because `readText` returning `''` is AMBIGUOUS — it is also
 * how a binary, missing or unreadable file reports itself, and only the size
 * case is a dropped-evidence claim worth disclosing. Counting them together
 * would report a size problem on any binary fixture, which is a false claim in
 * the opposite direction and is pinned by its own test.
 */
function skippedForSize(path: string): boolean {
  try {
    return statSync(path).size > MAX_READ_BYTES
  } catch {
    return false
  }
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
  /**
   * True when counting stopped at the ceiling, making `total` a LOWER BOUND.
   *
   * The header renders `800+ found` rather than `800 found` on this flag. It is
   * a distinct fact from `kept < total`: a section can be capped with an exact
   * total (the ordinary case) or capped with a bounded one, and printing the
   * bound as exact would be the same overclaim the disclosure exists to remove.
   */
  bounded: boolean
  /** Files the size guard refused to open, so their evidence was never seen. */
  skippedForSize: number
}

/**
 * Unresolved-work comments, as `path:line  TAG rest`.
 *
 * Counting continues past MAX_COMMENTS so the caller can disclose the true
 * total, and stops at `MAX_COMMENTS * SCAN_CEILING_FACTOR` so that honesty does
 * not cost an unbounded read of the whole repository on every click. Past the
 * ceiling the total is reported as a lower bound. Only the kept slice is
 * retained either way, so the memory cost stays capped.
 *
 * Files refused by the size guard are counted separately rather than ignored:
 * they appear under `### Files`, so a digest that neither read them nor said so
 * asserts a completeness it does not have — the same defect this module's cap
 * disclosures exist to remove, and one that was reintroduced by the size guard
 * itself.
 */
function collectComments(root: string, files: readonly string[]): Capped {
  const ceiling = MAX_COMMENTS * SCAN_CEILING_FACTOR
  const kept: string[] = []
  let total = 0
  let read = 0
  let skipped = 0
  let bounded = false
  for (const rel of files) {
    const dot = rel.lastIndexOf('.')
    if (dot < 0 || !SOURCE_EXT.has(rel.slice(dot))) continue
    // Both ceilings are checked BEFORE the read, which is the whole point: the
    // bounded cost is the file open and the line split, not the counter. The
    // file bound is the one that actually holds on a repository whose comments
    // are spread thinly, and the comment bound the one that holds where they
    // are dense; neither alone covers both.
    if (total >= ceiling || read >= MAX_FILES_READ) {
      bounded = true
      break
    }
    const full = join(root, rel)
    if (skippedForSize(full)) {
      skipped += 1
      continue
    }
    // Counted here, not at the top of the loop: a file refused by the size
    // guard was never opened, so charging it against the read budget would let
    // a directory of large artefacts exhaust the scan without reading anything.
    read += 1
    const text = readText(full)
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
  return { kept, total, bounded, skippedForSize: skipped }
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

  // Bounded on the same rule as collectComments, though NOT for the same
  // reason, and the difference is worth stating so nobody "optimises" the wrong
  // one. This loop opens no files: it is pure string work over `files`, which
  // the walk already capped at MAX_FILES_WALKED, so its worst case is bounded
  // by construction and was never the 19s problem. The ceiling is here so that
  // both sections obey ONE disclosure rule — a reader who learns what `800+`
  // means in one header should not find it meaning something else in the next.
  const ceiling = MAX_UNTESTED * SCAN_CEILING_FACTOR
  const kept: string[] = []
  let total = 0
  let bounded = false
  for (const rel of files) {
    const dot = rel.lastIndexOf('.')
    if (dot < 0 || !SOURCE_EXT.has(rel.slice(dot))) continue
    if (/(^|[./_-])(test|spec)([./_-]|$)/i.test(rel)) continue
    const stem = rel.slice(rel.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
    if (/^(index|main|types|constants)$/i.test(stem)) continue
    if (hasTest(stem, testNames)) continue
    if (total >= ceiling) {
      bounded = true
      break
    }
    total += 1
    if (kept.length < MAX_UNTESTED) kept.push(rel)
  }
  return { kept, total, bounded, skippedForSize: 0 }
}

/**
 * Head a section, disclosing every cap that bound.
 *
 * Every capped section MUST route through this. A header that reports only the
 * kept count reads as a complete list, which is the silent-truncation failure
 * the digest exists to avoid.
 *
 * Three independent facts can appear, because three independent things can drop
 * evidence and a reader needs to tell them apart:
 *
 * - `total` — how much existed. `+` marks it as a LOWER BOUND, i.e. counting
 *   stopped at the ceiling and the real figure is at least this.
 * - `showing` — how much survived the keep-cap.
 * - the size note — files never opened at all, so their contents were never
 *   even eligible to be counted above.
 */
function sectionHeader(
  title: string,
  total: number,
  kept: number,
  options: { bounded?: boolean; skippedForSize?: number } = {},
): string {
  const bound = options.bounded === true ? '+' : ''
  const skipped = options.skippedForSize ?? 0
  const note = skipped > 0 ? ` (${skipped} file(s) too large to read)` : ''
  const counts = kept < total || options.bounded === true
    ? `(${total}${bound} found, showing ${kept})`
    : `(${total})`
  return `### ${title} ${counts}${note}`
}

/**
 * Head a whole-file section, disclosing a clip when the slice actually bound.
 *
 * A bare `### README.md` claims the file is present, so clipping it to a
 * leading slice and saying nothing is a silent truncation of exactly the kind
 * the section headers above exist to remove — it was simply cheaper to miss,
 * because these sections have no counts to look wrong.
 *
 * The suffix appears only when the text was REALLY clipped: labelling a short
 * file as clipped is its own false claim, and `text.length === limit` is the
 * exact condition, since `readText` slices to `limit` and nothing else can
 * land a trimmed body on that boundary from above.
 */
function fileHeader(name: string, text: string, limit: number): string {
  if (text.length < limit) return `### ${name}`
  return `### ${name} (clipped to first ${Math.round(limit / 1000)} KB)`
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

  // The clip is measured on the RAW slice, before trimming. `trim()` can pull
  // the body back under the limit — a file whose 4000th byte lands in trailing
  // whitespace — and testing the trimmed length would call that unclipped.
  const readmeName = files.find((f) => /^readme(\.md|\.txt)?$/i.test(f))
  if (readmeName !== undefined) {
    const raw = readText(join(root, readmeName), README_BYTES)
    const text = raw.trim()
    if (text !== '') {
      if (raw.length >= README_BYTES) sectionTruncated = true
      sections.push(`${fileHeader(readmeName, raw, README_BYTES)}\n${text}`)
    }
  }

  const manifest = files.find((f) => f === 'package.json')
  if (manifest !== undefined) {
    const raw = readText(join(root, manifest), MANIFEST_BYTES)
    const text = raw.trim()
    if (text !== '') {
      if (raw.length >= MANIFEST_BYTES) sectionTruncated = true
      sections.push(`${fileHeader('package.json', raw, MANIFEST_BYTES)}\n${text}`)
    }
  }

  const comments = collectComments(root, files)
  if (comments.kept.length > 0 || comments.skippedForSize > 0) {
    // A file skipped for size is dropped evidence exactly as a capped list is:
    // it is named under `### Files`, so the digest already claims it is part of
    // this workspace. Both it and a bounded count set the flag.
    if (
      comments.kept.length < comments.total
      || comments.bounded
      || comments.skippedForSize > 0
    ) sectionTruncated = true
    sections.push(
      sectionHeader(
        'Unresolved comments (TODO/FIXME/HACK)',
        comments.total,
        comments.kept.length,
        { bounded: comments.bounded, skippedForSize: comments.skippedForSize },
      ) + (comments.kept.length > 0 ? '\n' + comments.kept.join('\n') : ''),
    )
  }

  const untested = collectUntested(files)
  if (untested.kept.length > 0) {
    if (untested.kept.length < untested.total || untested.bounded) sectionTruncated = true
    sections.push(
      sectionHeader(
        'Untested modules (name-based hint, not a coverage run)',
        untested.total,
        untested.kept.length,
        { bounded: untested.bounded },
      ) + '\n' + untested.kept.join('\n'),
    )
  }

  return assemble(sections, truncated || sectionTruncated)
}
