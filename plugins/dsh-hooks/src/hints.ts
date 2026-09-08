/**
 * The skill-hint engine: turn what is happening in a session into at most a
 * handful of chips naming skills the user could type next.
 *
 * ## Why this file imports nothing from cordis
 *
 * Everything here is a pure function of a {@link SessionSituation} and a skill
 * catalog. `HooksService` owns the signal capture and the async catalog read;
 * this module owns the judgement. That split is what lets the smoke test drive
 * the rules directly against built `lib/`, with no harness, no fibers and no
 * fake agent — the rules are the part a reader has to trust, and they are all
 * observable from a plain function call.
 *
 * ## Why every rule matches against the real catalog
 *
 * A hint that names a skill this deployment does not have is worse than no
 * hint: the user types `/dotnet-onion-api`, gets "unknown skill", and stops
 * trusting the strip. So a rule never carries a skill NAME — it carries a
 * pattern, and the pattern is resolved against `ctx.skills.list()`'s own
 * output. No installed match means no hint, silently.
 *
 * ## Why the heuristics are deliberately cheap
 *
 * Regexes on the prompt and quoted trigger phrases lifted out of each skill's
 * own description. Not a classifier, and not an LLM call. The cost of a false
 * positive here is one ignorable chip beside the composer, so paying model
 * latency (and tokens) to sharpen it would be the wrong trade — and a rule a
 * reader can predict is a rule a reader can turn off.
 *
 * @module @dennisrongo/dsh-hooks/hints
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The catalog shape this engine needs, structurally satisfied by
 * `SkillSummary` from `@deepseek-ai/dsh-skill`.
 *
 * Declared locally rather than imported so this module — and therefore the
 * whole rule set — stays free of harness types. `@deepseek-ai/dsh-skill` is
 * read through `ctx.get('skills')` in `index.ts` and is not a declared peer,
 * so importing its types here would add a tsconfig path and a peer for a
 * five-field interface.
 */
export interface CatalogSkill {
  /** Kebab-case name the user types after the slash. */
  readonly name: string
  /** Short routing description; also the main source of trigger phrases. */
  readonly description: string
  /** Extra routing guidance, when the provider supplied any. */
  readonly whenToUse?: string
  /** Resolved invocation controls; only `userInvocable` matters here. */
  readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean }
}

/** A workspace shape a project rule can key off. */
export type ProjectType = 'dotnet' | 'nextjs' | 'tauri' | 'remotion' | 'shadcn'

/** Everything the engine knows about one session, as of now. */
export interface SessionSituation {
  /** The session's working directory. */
  cwd: string
  /** What {@link fingerprint} found on disk. */
  projectTypes: ReadonlySet<ProjectType>
  /** Skills already used this session, by name — never suggested again. */
  skillsUsed: ReadonlySet<string>
  /** Every path written or edited this session. */
  editedPaths: ReadonlySet<string>
  /** What the most recently finished turn did. */
  lastTurn: TurnFacts
  /** Text of the newest user prompt. */
  lastPrompt: string
  /** How many user prompts this session has claimed. */
  prompts: number
  /** `running` between a claimed user prompt and the turn stopping. */
  status: 'idle' | 'running'
  /** Hint ids the user dismissed in this session. */
  dismissed: ReadonlySet<string>
}

/** What one finished turn did, folded from its `tools/post-execute` events. */
export interface TurnFacts {
  /** How many edit/write/str_replace_editor calls the turn made. */
  edits: number
  /** True when a shell call in the turn looked like a test run. */
  ranTests: boolean
  /** True when a shell call in the turn staged or made a commit. */
  committed: boolean
  /** How many tool calls came back as errors. */
  toolErrors: number
  /**
   * Whether the LAST tool call of the turn came back as an error.
   *
   * This, not `toolErrors`, is what "landed cleanly" reads. A real turn
   * routinely fails a probe early — `dotnet --version` on a box without the
   * SDK, a web search with no key — and then writes the whole feature and
   * builds it green. Counting those probes as failures kept the review hint
   * off a session that had just produced a working MCP server (observed live,
   * 2026-09-07). A final call that failed is the case worth blocking on.
   */
  lastToolErrored: boolean
  /** True when the turn itself loaded a skill — the user is already on a path. */
  usedSkill: boolean
}

/** One chip beside the composer. */
export interface SkillHint {
  /**
   * `${rule}:${skill}`.
   *
   * Stable by construction, which is what makes dismiss survive a recompute:
   * the same situation produces the same id, so a dismissed chip does not come
   * straight back on the next tool call.
   */
  id: string
  /** Exact catalog name; the chip inserts `/${skill} ` into the composer. */
  skill: string
  /** Short label, e.g. `.NET project`. */
  title: string
  /** One sentence saying why, capped at {@link MAX_REASON} characters. */
  reason: string
  /** Lower sorts first. */
  priority: number
  /** Which rule produced this, so a user can silence it by id. */
  rule: string
}

/** Default cap on chips shown at once. Three fits one row beside the composer. */
export const DEFAULT_MAX_HINTS = 3

/** Hard bound on {@link HintOptions.maxHints}, so a settings typo cannot fill the screen. */
export const MAX_MAX_HINTS = 6

/** Chip reasons are truncated to this, because the strip must stay one row. */
export const MAX_REASON = 120

/** Prompts in one session before the handoff hint appears. */
const LONG_SESSION_PROMPTS = 25

/** Edits in one turn before the turn rules read it as a unit of work. */
const FEATURE_EDITS = 3

/** How the engine is configured from the `dsh-hooks.hints` settings block. */
export interface HintOptions {
  /** Chips to show at once, clamped to 1..{@link MAX_MAX_HINTS}. */
  maxHints?: number
  /** Rule ids to silence entirely, e.g. `['session:long']`. */
  disableRules?: readonly string[]
}

// ── project fingerprinting ─────────────────────────────────────────────────

/** Directories never descended into; every one of them is noise or huge. */
const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj', 'dist', 'build', 'out', 'target', 'vendor', '.git'])

/** Upper bound on directory entries examined for one fingerprint. */
const MAX_ENTRIES = 400

/** How long a fingerprint is trusted before the directory is re-read. */
const FINGERPRINT_TTL_MS = 30_000

/** One cached fingerprint. */
interface FingerprintEntry {
  types: Set<ProjectType>
  /** `mtimeMs` of the top-level directory when this was computed. */
  mtimeMs: number
  at: number
}

const fingerprintCache = new Map<string, FingerprintEntry>()

/** Drop every cached fingerprint. Exported for the tests and for reconfiguration. */
export function resetFingerprintCache(): void {
  fingerprintCache.clear()
}

/**
 * Read a `package.json` dependency map, both prod and dev.
 * @param path - absolute path of the manifest.
 * @returns the union of dependency names, or an empty set when unreadable.
 */
function dependencyNames(path: string): Set<string> {
  const names = new Set<string>()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const block = parsed[field]
      if (block === null || typeof block !== 'object') continue
      for (const key of Object.keys(block as Record<string, unknown>)) names.add(key)
    }
  } catch {
    // A manifest that will not parse tells us nothing about the project, and a
    // hint engine that throws on a malformed file it merely peeked at would
    // take a session-start listener down with it.
  }
  return names
}

/**
 * Classify a workspace by what is on disk, one level deep.
 *
 * Synchronous fs is deliberate: this runs once per session start and once per
 * 30-second window after that, never on a tool call. The depth-1 sweep exists
 * because a `.csproj` in a monorepo lives at `src/Web/Web.csproj`, not at the
 * root — a top-level-only scan finds nothing in exactly the repositories where
 * a project hint would be most useful.
 *
 * Never throws. A directory the harness cannot read is reported as "no project
 * types", which degrades to no project hints rather than to a broken listener.
 * @param cwd - absolute workspace directory.
 * @param force - bypass the cache. The turn-end path passes true when the turn
 *   wrote files: a project scaffolded INSIDE a session (`dotnet new` into an
 *   empty folder, observed live 2026-09-07) lands in a subdirectory, which
 *   changes neither the parent's mtime nor anything the TTL would notice in
 *   time for the chip to appear when the turn ends.
 * @returns the project shapes detected.
 */
export function fingerprint(cwd: string, force = false): ReadonlySet<ProjectType> {
  const now = Date.now()
  let topMtime = 0
  try {
    topMtime = statSync(cwd).mtimeMs
  } catch {
    return new Set()
  }
  const cached = fingerprintCache.get(cwd)
  // Both guards are needed: mtime catches a file appearing at the top level,
  // and the TTL catches one appearing in a SUBdirectory, which does not touch
  // the parent's mtime at all.
  if (!force && cached !== undefined && cached.mtimeMs === topMtime && now - cached.at < FINGERPRINT_TTL_MS) {
    return cached.types
  }

  const types = new Set<ProjectType>()
  let budget = MAX_ENTRIES
  /** Files seen at the top level or one level down, as `dir/name` pairs. */
  const seen: Array<{ dir: string; name: string }> = []
  try {
    const top = readdirSync(cwd, { withFileTypes: true })
    const subdirs: string[] = []
    for (const entry of top) {
      if (budget-- <= 0) break
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
        subdirs.push(entry.name)
        continue
      }
      seen.push({ dir: cwd, name: entry.name })
    }
    for (const sub of subdirs) {
      if (budget <= 0) break
      const dir = join(cwd, sub)
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (budget-- <= 0) break
          if (!entry.isDirectory()) seen.push({ dir, name: entry.name })
          // `src-tauri` is a directory whose PRESENCE is the signal, so the
          // config inside it is picked up by this same sweep.
        }
      } catch {
        // An unreadable subdirectory is skipped, not fatal.
      }
    }
  } catch {
    return new Set()
  }

  for (const { dir, name } of seen) {
    if (/\.(csproj|sln|slnx)$/i.test(name) || name === 'global.json') types.add('dotnet')
    if (name === 'tauri.conf.json') types.add('tauri')
    if (name === 'components.json') {
      try {
        const raw = readFileSync(join(dir, name), 'utf8')
        // Any `components.json` would be a false positive — the name is generic.
        // shadcn's own file carries a $schema pointing at ui.shadcn.com.
        if (/"\$schema"\s*:\s*"[^"]*shadcn/i.test(raw)) types.add('shadcn')
      } catch {
        // Unreadable: not a shadcn project as far as this engine is concerned.
      }
    }
    if (name === 'package.json') {
      const deps = dependencyNames(join(dir, name))
      if (deps.has('next')) types.add('nextjs')
      if (deps.has('remotion') || deps.has('@remotion/cli')) types.add('remotion')
      if (deps.has('@tauri-apps/api') || deps.has('@tauri-apps/cli')) types.add('tauri')
    }
  }

  fingerprintCache.set(cwd, { types, mtimeMs: topMtime, at: now })
  return types
}

// ── trigger phrases ────────────────────────────────────────────────────────

/**
 * Cached phrase extraction, keyed on the skill object itself.
 *
 * A catalog read hands back fresh objects, so the WeakMap simply lets a cached
 * catalog reuse its phrases and lets a replaced one be collected — no manual
 * invalidation, and no cache keyed on a name that could collide across layers.
 */
const phraseCache = new WeakMap<CatalogSkill, readonly string[]>()

/** Shortest quoted span treated as a trigger phrase. */
const MIN_PHRASE = 6

/**
 * The quoted trigger phrases a skill advertises about itself.
 *
 * Skills in this ecosystem overwhelmingly write their descriptions as "use
 * this skill whenever the user says \"review my code\", \"debug this\", …", so
 * the quoted spans ARE the author's own trigger list. Reading them is how one
 * generic rule covers every skill in the catalog, including ones written after
 * this file.
 *
 * Spans shorter than {@link MIN_PHRASE} are dropped: a two-character quote
 * matches almost any prompt and would make the strip fire constantly.
 * @param skill - one catalog entry.
 * @returns lowercased phrases, deduplicated.
 */
export function phrasesOf(skill: CatalogSkill): readonly string[] {
  const hit = phraseCache.get(skill)
  if (hit !== undefined) return hit
  const out = new Set<string>()
  const source = `${skill.description} ${skill.whenToUse ?? ''}`
  // Straight and typographic quotes both appear in real skill frontmatter.
  for (const match of source.matchAll(/["“”']([^"“”']{6,80})["“”']/g)) {
    const phrase = match[1]?.trim().toLowerCase()
    if (phrase !== undefined && phrase.length >= MIN_PHRASE) out.add(phrase)
  }
  const phrases = [...out]
  phraseCache.set(skill, phrases)
  return phrases
}

/**
 * Whether a prompt contains one of a skill's own trigger phrases.
 * @param prompt - the user's prompt text.
 * @param skill - one catalog entry.
 * @returns the phrase that hit, or undefined.
 */
export function matchesPrompt(prompt: string, skill: CatalogSkill): string | undefined {
  if (prompt === '') return undefined
  const haystack = prompt.toLowerCase()
  for (const phrase of phrasesOf(skill)) {
    if (haystack.includes(phrase)) return phrase
  }
  return undefined
}

// ── the rules ──────────────────────────────────────────────────────────────

/** One built-in rule. `patterns` yields at most one hint each, in order. */
interface Rule {
  /** Stable id, also the `disableRules` key and the first half of a hint id. */
  id: string
  /** Lower sorts first. */
  priority: number
  /** Chip label. */
  title: string
  /** Chip tooltip / caption. */
  reason: string
  /**
   * Name patterns, most-preferred first. Each contributes at most one hint —
   * the first catalog skill whose name matches — so a rule offering two lines
   * ("review it, then test it") produces two chips at most, never twenty.
   */
  patterns: readonly RegExp[]
  /**
   * Whether this rule applies right now.
   * @param s - the session situation.
   * @param phraseHit - true when `prompt:phrase` already claimed this prompt.
   * @returns whether to resolve {@link patterns} against the catalog.
   */
  fires: (s: SessionSituation, phraseHit: boolean) => boolean
}

/** File extensions that make an edit look like source rather than prose. */
const SOURCE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|cs|fs|vb|py|rb|go|rs|java|kt|swift|php|c|h|cc|cpp|hpp|m|mm|sql|sh|ps1|vue|svelte|razor|cshtml)$/i

/** A path that already looks like a test, so "you have no tests" would be wrong. */
const TEST_PATH = /(^|[\\/])(tests?|__tests__|spec)([\\/]|$)|\.(test|spec)\.[a-z]+$/i

/**
 * Whether the session has edited anything that looks like code.
 *
 * The turn rules exist to say "you changed behaviour, now review/test it". A
 * turn that rewrote three markdown files changed no behaviour, and a chip
 * suggesting a code review there is pure noise.
 * @param paths - every path edited this session.
 * @returns whether at least one non-test source file was touched.
 */
function hasSourceEdits(paths: ReadonlySet<string>): boolean {
  for (const path of paths) {
    if (SOURCE_EXT.test(path) && !TEST_PATH.test(path)) return true
  }
  return false
}

/** Prompt shapes that read as "something is broken". */
const BUG_WORDS = /\b(bug|broken|failing|fails|crash(es|ed|ing)?|error|regression|flaky|stack ?trace)\b/i

/** Prompt shapes that read as "let us decide what to build". */
const PLAN_WORDS = /\b(plan|design|architect(ure)?|spec)\b/i

/** The v1 built-in rule set, in no particular order — `priority` decides. */
const RULES: readonly Rule[] = [
  {
    id: 'project:dotnet',
    priority: 20,
    title: '.NET project',
    reason: 'A .csproj/.sln is in this workspace.',
    patterns: [/dotnet/i],
    fires: (s) => s.projectTypes.has('dotnet'),
  },
  {
    id: 'project:nextjs',
    priority: 20,
    title: 'Next.js project',
    reason: 'package.json depends on next.',
    patterns: [/nextjs|next-js/i],
    fires: (s) => s.projectTypes.has('nextjs'),
  },
  {
    id: 'project:tauri',
    priority: 20,
    title: 'Tauri project',
    reason: 'A Tauri config is in this workspace.',
    patterns: [/tauri/i],
    fires: (s) => s.projectTypes.has('tauri'),
  },
  {
    id: 'project:remotion',
    priority: 20,
    title: 'Remotion project',
    reason: 'package.json depends on remotion.',
    patterns: [/remotion-best-practices|^remotion/i],
    fires: (s) => s.projectTypes.has('remotion'),
  },
  {
    id: 'project:shadcn',
    priority: 25,
    title: 'shadcn/ui project',
    reason: 'components.json names the shadcn schema.',
    patterns: [/shadcn/i],
    fires: (s) => s.projectTypes.has('shadcn'),
  },
  {
    id: 'prompt:bug',
    priority: 12,
    title: 'Sounds like a bug',
    reason: 'Your prompt describes something failing.',
    patterns: [/^diagnose$|systematic-debugging|:debug$|^debug$/i],
    // Only when the generic phrase rule found nothing: a skill that advertised
    // "debug this" already produced a sharper hint, and two chips for the same
    // intent is one chip too many.
    fires: (s, phraseHit) => !phraseHit && BUG_WORDS.test(s.lastPrompt),
  },
  {
    id: 'prompt:plan',
    priority: 12,
    title: 'Worth planning first',
    reason: 'Your prompt is about design rather than a change.',
    patterns: [/plan-and-build|writing-plans|brainstorming/i],
    fires: (s, phraseHit) => !phraseHit && PLAN_WORDS.test(s.lastPrompt),
  },
  {
    id: 'turn:feature-done',
    priority: 5,
    title: 'Work landed cleanly',
    reason: 'The turn made several edits and its last tool call succeeded.',
    patterns: [/^code-review$|:code-review$|verification-before-completion/i, /write-tests|test-driven-development/i],
    fires: (s) =>
      s.status === 'idle' &&
      s.lastTurn.edits >= FEATURE_EDITS &&
      !s.lastTurn.lastToolErrored &&
      !s.lastTurn.usedSkill &&
      hasSourceEdits(s.editedPaths),
  },
  {
    id: 'turn:tests-missing',
    priority: 8,
    title: 'No tests ran',
    reason: 'Several files changed and nothing ran a test command.',
    patterns: [/write-tests|test-driven-development/i],
    fires: (s) =>
      s.status === 'idle' &&
      s.lastTurn.edits >= FEATURE_EDITS &&
      !s.lastTurn.ranTests &&
      hasSourceEdits(s.editedPaths),
  },
  {
    id: 'turn:ready-to-ship',
    priority: 6,
    title: 'Ready to ship',
    reason: 'This turn touched git, or the work has already been reviewed.',
    patterns: [/conventional-commits/i, /create-pr|finishing-a-development-branch|ship-it/i],
    fires: (s) =>
      s.status === 'idle' &&
      (s.lastTurn.committed ||
        (s.lastTurn.edits >= FEATURE_EDITS && [...s.skillsUsed].some((name) => /code-review/i.test(name)))),
  },
  {
    id: 'session:long',
    priority: 30,
    title: 'Long session',
    reason: 'Capture the state before context runs short.',
    patterns: [/^handoff$|:handoff$/i],
    fires: (s) => s.prompts >= LONG_SESSION_PROMPTS,
  },
]

/** Every built-in rule id, so a settings surface can list what is silenceable. */
export const RULE_IDS: readonly string[] = RULES.map((rule) => rule.id)

/** The generic prompt-phrase rule's id and priority, which no table row owns. */
const PHRASE_RULE = { id: 'prompt:phrase', priority: 10 }

/**
 * Clamp text to {@link MAX_REASON}, so one long phrase cannot stretch the strip.
 * @param text - the candidate reason.
 * @returns the reason, truncated with an ellipsis when it was too long.
 */
function clampReason(text: string): string {
  return text.length <= MAX_REASON ? text : `${text.slice(0, MAX_REASON - 1)}…`
}

/**
 * Turn a session's situation into chips.
 *
 * Deterministic and side-effect free apart from the phrase cache: the same
 * situation and catalog always produce the same list in the same order, which
 * is what lets `HooksService` bump its change token by comparing hint ids
 * rather than by guessing whether a signal mattered.
 */
export class HintEngine {
  private maxHints: number
  private disabled: ReadonlySet<string>

  /**
   * @param options - initial configuration, normally from settings.
   */
  constructor(options: HintOptions = {}) {
    this.maxHints = DEFAULT_MAX_HINTS
    this.disabled = new Set()
    this.configure(options)
  }

  /**
   * Re-read configuration in place.
   *
   * The engine is held by the service for the process lifetime and settings
   * reload live, so replacing the instance on every settings commit would
   * throw away nothing useful but would make the ownership harder to follow.
   * @param options - the new configuration.
   */
  configure(options: HintOptions): void {
    const max = options.maxHints
    this.maxHints =
      typeof max === 'number' && Number.isFinite(max)
        ? Math.min(Math.max(1, Math.trunc(max)), MAX_MAX_HINTS)
        : DEFAULT_MAX_HINTS
    this.disabled = new Set(options.disableRules ?? [])
  }

  /**
   * Compute the chips for one session.
   * @param situation - what is happening in the session.
   * @param catalog - the skills actually installed and visible to this agent.
   * @returns at most `maxHints` hints, sorted by priority then id.
   */
  compute(situation: SessionSituation, catalog: readonly CatalogSkill[]): SkillHint[] {
    // Only user-invocable skills can be typed into the composer at all, so a
    // model-only skill in a chip would be a control that cannot work.
    const usable = catalog.filter(
      (skill) => skill.invocation.userInvocable && !situation.skillsUsed.has(skill.name),
    )
    if (usable.length === 0) return []

    /** Candidates keyed by skill name, keeping the lowest priority per skill. */
    const bySkill = new Map<string, SkillHint>()

    /**
     * Offer one hint, losing to any lower-priority hint for the same skill.
     * @param hint - the candidate.
     */
    const offer = (hint: SkillHint): void => {
      if (situation.dismissed.has(hint.id)) return
      const existing = bySkill.get(hint.skill)
      if (existing !== undefined) {
        // Same skill from two rules is one chip: the sharper (lower-priority)
        // rule wins, and a tie breaks on the id so the result is deterministic
        // regardless of the order the rules happen to be declared in.
        const better =
          hint.priority < existing.priority ||
          (hint.priority === existing.priority && hint.id < existing.id)
        if (!better) return
      }
      bySkill.set(hint.skill, hint)
    }

    // The generic rule first, because two table rows suppress themselves when
    // a skill's own advertised phrase already matched the prompt.
    let phraseHit = false
    if (this.enabled(PHRASE_RULE.id) && situation.lastPrompt !== '') {
      for (const skill of usable) {
        const phrase = matchesPrompt(situation.lastPrompt, skill)
        if (phrase === undefined) continue
        phraseHit = true
        offer({
          id: `${PHRASE_RULE.id}:${skill.name}`,
          skill: skill.name,
          title: 'Matches your prompt',
          reason: clampReason(`This skill lists “${phrase}” as a trigger.`),
          priority: PHRASE_RULE.priority,
          rule: PHRASE_RULE.id,
        })
      }
    }

    for (const rule of RULES) {
      if (!this.enabled(rule.id)) continue
      let applies: boolean
      try {
        applies = rule.fires(situation, phraseHit)
      } catch (err) {
        // A rule is data plus one predicate; a throw here is a bug in this
        // file, and the correct blast radius is that one rule.
        console.warn(`[dsh-hooks] hints: rule ${rule.id} threw:`, err)
        continue
      }
      if (!applies) continue
      for (const pattern of rule.patterns) {
        const skill = usable.find((candidate) => pattern.test(candidate.name))
        if (skill === undefined) continue
        offer({
          id: `${rule.id}:${skill.name}`,
          skill: skill.name,
          title: rule.title,
          reason: clampReason(rule.reason),
          priority: rule.priority,
          rule: rule.id,
        })
      }
    }

    return [...bySkill.values()]
      .sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.id < b.id ? -1 : 1))
      .slice(0, this.maxHints)
  }

  /** Whether a rule id survived `disableRules`. */
  private enabled(rule: string): boolean {
    return !this.disabled.has(rule)
  }
}

/** A fresh, empty turn record. */
export function emptyTurn(): TurnFacts {
  return { edits: 0, ranTests: false, committed: false, toolErrors: 0, lastToolErrored: false, usedSkill: false }
}

// ── signal classification (shared by the service and the tests) ────────────

/** Tools whose call means a file changed. */
const EDIT_TOOLS = new Set(['edit', 'write', 'str_replace_editor', 'create_file', 'multi_edit'])

/** Shell tools whose `command` argument is worth reading. */
const SHELL_TOOLS = new Set(['bash', 'pwsh', 'bash_persistent', 'pwsh_persistent'])

/**
 * A shell command line that runs a test suite.
 *
 * Deliberately a whitelist of runners rather than a search for the word
 * "test": `git commit -m "add test"` is not a test run, and `grep test` is
 * certainly not one.
 */
const TEST_COMMAND =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(vitest|jest|mocha|pytest|phpunit|rspec)\b|\bdotnet\s+test\b|\bcargo\s+test\b|\bgo\s+test\b|\bpytest\b|\bnode\s+--test\b/i

/** A shell command line that stages or records a commit. */
const COMMIT_COMMAND = /\bgit\s+(add|commit)\b/i

/**
 * The tool arguments as a record, whatever shape the harness handed over.
 *
 * `dsh-agent-loop` parses the model's JSON before dispatch on every version
 * seen so far, but the session log stores the same field as a JSON string and
 * a future host could pass it through unparsed. A string that parses to an
 * object is read; anything else reads as no arguments rather than as a throw.
 * @param args - the tool's arguments as received.
 * @returns a (possibly empty) record.
 */
function argumentRecord(args: unknown): Record<string, unknown> {
  if (args !== null && typeof args === 'object') return args as Record<string, unknown>
  if (typeof args === 'string') {
    try {
      const parsed: unknown = JSON.parse(args)
      if (parsed !== null && typeof parsed === 'object') return parsed as Record<string, unknown>
    } catch {
      // Not JSON: nothing to read.
    }
  }
  return {}
}

/**
 * Read one settled tool call as turn facts.
 *
 * Called from `tools/post-execute` only. `tools/pre-execute` is awaited before
 * every dispatch and nothing in this feature may touch it — the argument
 * inspection here is cheap, but "cheap" on the hot path is how a session
 * acquires a stall nobody can attribute.
 * @param name - the tool name.
 * @param args - the tool's parsed arguments.
 * @param isError - whether the call came back as an error.
 * @param turn - the turn record to fold into, mutated in place.
 * @returns the path the call edited, when it edited one.
 */
export function observeToolCall(
  name: string,
  args: unknown,
  isError: boolean,
  turn: TurnFacts,
): string | undefined {
  if (isError) turn.toolErrors += 1
  turn.lastToolErrored = isError
  const record = argumentRecord(args)

  if (name === 'skill') {
    turn.usedSkill = true
    return undefined
  }

  if (SHELL_TOOLS.has(name)) {
    const command = typeof record.command === 'string' ? record.command : ''
    if (TEST_COMMAND.test(command)) turn.ranTests = true
    if (COMMIT_COMMAND.test(command)) turn.committed = true
    return undefined
  }

  if (!EDIT_TOOLS.has(name)) return undefined
  // `str_replace_editor` also answers `command: 'view'`, which edits nothing.
  if (name === 'str_replace_editor' && record.command === 'view') return undefined
  if (isError) return undefined
  turn.edits += 1
  // Two argument names, both verified against the shipped tools:
  // `str_replace_editor` takes `path`, while dsh-tool-fs's read/write/edit take
  // `file_path`. Guessing one would silently stop counting edits on the other.
  for (const key of ['path', 'file_path', 'filePath']) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/**
 * The `/skill-name` gestures in a prompt.
 *
 * This is the same grammar `dsh-tool-skill` uses to detect a user-explicit
 * invocation (`/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g`). Matching it
 * here rather than watching for the injected `skill-invocation` message is a
 * deliberate choice: that message is appended by dsh-tool-skill's OWN
 * `agent/pre-step` listener after its `next()`, so whether this plugin's
 * listener ever sees it depends on registration order between two plugins.
 * @param prompt - the user's prompt text.
 * @returns the skill names the user typed.
 */
export function invokedSkillNames(prompt: string): string[] {
  const names: string[] = []
  for (const match of prompt.matchAll(/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g)) {
    const name = match[2]
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names
}
