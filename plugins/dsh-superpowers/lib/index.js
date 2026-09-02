import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { parse } from "yaml";
import z from "@deepseek-ai/schemastery";

/**
 * dsh-superpowers: inject the Superpowers (obra/superpowers) methodology
 * bootstrap into every agent's system prompt.
 *
 * Upstream delivers this via a SessionStart hook (startup|clear|compact) that
 * dumps skills/using-superpowers/SKILL.md into context. dsh has no hook shell,
 * but its system prompt is a layered, ordered section registry that is
 * REASSEMBLED after compaction — so one registered section covers all three
 * upstream trigger points for the life of the session. That is strictly
 * stronger than the hook: there is no gap between session start and the first
 * compaction where the bootstrap can fall out.
 *
 * Nothing from upstream is vendored here. The section body is read from your
 * clone at startup, so `git pull` + restart the profile is the whole update
 * path. The clone's skills/ folder is separate: link it into the agents skills
 * directory with scripts/link-superpowers-skills.mjs so a pull updates those
 * too.
 *
 * @module dsh-superpowers
 */

/** Stable Cordis plugin name. */
const name = "superpowers";

const inject = ["systemPrompt"];

/**
 * Provider identity. Every candidate must echo this in `provider` or the
 * registry throws and skips this provider entirely.
 */
const PROVIDER = "superpowers";

/** Directory, relative to the root, holding <name>/SKILL.md bundles. */
const CATALOG = "skills";

/**
 * Precedence rank. Ties break only WITHIN one layer; a nearer layer wins
 * outright, so a project's .dsh/skills still shadows these. Deliberately below
 * dsh-skills' 600: where both ship a skill of the same name, the curated
 * library wins.
 */
const RANK = 550;

/** Path, relative to the repo root, that identifies a real superpowers clone. */
const MARKER = join("skills", "using-superpowers", "SKILL.md");

/**
 * Directories to probe for a superpowers clone, in order, when the profile
 * does not set `superpowersRoot`.
 *
 * All are derived from `homedir()`, so this works on Windows, macOS and Linux
 * alike — but they are still guesses about where you keep clones. Set
 * `superpowersRoot` in the profile (or the SUPERPOWERS_ROOT environment
 * variable) and none of this runs.
 * @returns candidate absolute paths.
 */
function candidateRoots() {
  const home = homedir();
  return [
    join(home, "superpowers"),
    join(home, "src", "superpowers"),
    join(home, "code", "superpowers"),
    join(home, "dev", "superpowers"),
    join(home, "git", "superpowers"),
    join(home, "repos", "superpowers"),
    join(home, "Projects", "superpowers"),
    join(home, "Documents", "superpowers"),
    join(home, "Documents", "GitHub", "superpowers"),
    join(home, "Documents", "Experimental Projects", "superpowers"),
  ];
}

/**
 * The snapshot of the upstream catalog that ships inside this package.
 *
 * It exists because there is nothing to depend on: `@obra/superpowers` is
 * unpublished and the bare `superpowers` name on npm belongs to someone else,
 * so a machine with no clone would otherwise get an empty catalog — silently,
 * because a missing skills root is discovered as an empty list rather than an
 * error. See vendor/PROVENANCE for the pinned commit and licence.
 */
const VENDOR_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor");

/**
 * Resolve the clone location: explicit config, then environment, then a probe
 * of common clone locations, then the vendored snapshot.
 *
 * The snapshot is LAST on purpose, which is the mirror image of dsh-skills
 * (where the bundled dependency is tried BEFORE the probe). There the
 * dependency is the intended path; here a real clone is, and the snapshot is
 * only the floor that makes a fresh install work. A live clone therefore keeps
 * winning, so `git pull` behaves exactly as it always has.
 *
 * @param configured - `superpowersRoot` from the profile, if set.
 * @returns the resolved root, or null when nothing looks like a clone.
 */
function resolveRoot(configured) {
  if (typeof configured === "string" && configured.length > 0) return configured;
  const fromEnv = process.env.SUPERPOWERS_ROOT;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  for (const candidate of candidateRoots()) {
    if (existsSync(join(candidate, MARKER))) return candidate;
  }
  if (existsSync(join(VENDOR_ROOT, MARKER))) return VENDOR_ROOT;
  return null;
}

/**
 * Ask the model to offer decisions as controls rather than as prose.
 *
 * The harness can already render a picker: `ask_user_question` takes
 * `options[]` with a label and a one-line description, plus `multi_select`, and
 * the shipped question UI renders a radiogroup or a checkbox group from it.
 * What it cannot do is turn prose into controls — a structured surface exists
 * only for a real tool call, so a turn that ends "A or B?" in markdown is
 * markdown forever, and the user pays for it with a typed reply.
 *
 * The last paragraph is not optional politeness. dsh's own plan-mode section
 * states that its rules "override any later tool description or guidance", and
 * it explicitly forbids asking "should I proceed?" through prose OR
 * `ask_user_question`, because `exit_plan_mode` is meant to be the single
 * interaction there. A nudge that did not stand down in plan mode would be
 * telling the model to break a rule it has already been given.
 */
const ASK_WITH_OPTIONS_SECTION = `## Offer choices as choices

When you would end a turn by asking the user to pick between alternatives —
"A or B?", "should I also do X?", "proceed as planned?" — call
\`ask_user_question\` instead of writing the question as prose. Give each
alternative an option with a one-line description of its tradeoff, put the one
you recommend first, and set \`multi_select: true\` when more than one can
apply. A question the user can click is faster to answer and unambiguous to
read back; the same question in prose costs them a typed reply and costs you a
guess at what they meant.

Two limits. Ask only about things the user owns — preferences, priorities,
scope, anything you cannot settle by reading the repository; resolve
discoverable facts by inspection instead. And this does not apply in plan mode,
whose own rules take precedence: there, present the plan with
\`exit_plan_mode\` and let the review carry the decision.`;

const Config = z.object({
  /**
   * Directory containing skills/using-superpowers/SKILL.md (the clone root).
   * Empty means "resolve it": SUPERPOWERS_ROOT, then a probe of common clone
   * locations under the home directory.
   */
  superpowersRoot: z.string().default(""),
  /** Section order; persona is 0, harness identity is -100. We sit just before persona. */
  order: z.number().default(-50),
  /** Master switch, e.g. for a scratch profile that wants a clean baseline. */
  enabled: z.boolean().default(true),
  /**
   * Register the "offer choices as choices" section. Independent of the clone:
   * it is hand-written here, not read from upstream.
   */
  askWithOptions: z.boolean().default(true),
  /** Order for that section — just after the bootstrap, still before persona. */
  askWithOptionsOrder: z.number().default(-45),
  /**
   * Serve the resolved root's skills/ as a skill provider. Turn this off when
   * the same skills already reach the catalog another way — notably the
   * junctions made by scripts/link-superpowers-skills.mjs — to avoid listing
   * every skill twice.
   */
  skillProvider: z.boolean().default(true)
});

function readBootstrap(superpowersRoot) {
  const path = join(superpowersRoot, MARKER);
  try {
    const raw = readFileSync(path, "utf8");
    // Strip YAML frontmatter: the model doesn't need the trigger metadata,
    // only the behavioral mandate.
    const stripped = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
    if (!stripped) throw new Error("empty after frontmatter strip");
    return stripped;
  } catch (error) {
    // Fail visible but non-fatal: dsh boots, the skills still work as
    // catalog entries, only the mandatory-first bootstrap is missing.
    console.warn(`[dsh-superpowers] cannot read ${path}: ${error.message}`);
    return null;
  }
}

/** Skill names are kebab-case; the registry rejects anything else outright. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Split YAML frontmatter from a SKILL.md body.
 *
 * dsh-skill-filesystem parses the same shape but exports no parser, so this is
 * duplicated here and in dsh-skills. If the harness changes its shape, this is
 * the one function to check.
 * @returns parsed frontmatter and body, or null when malformed.
 */
function parseFrontmatter(raw) {
  const firstLineEnd = raw.indexOf("\n");
  if (firstLineEnd < 0) return null;
  if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") return null;
  const start = firstLineEnd + 1;
  const closing = raw.indexOf("\n---", start);
  if (closing < 0) return null;
  const bodyStart = raw.indexOf("\n", closing + 1);
  const data = parse(raw.slice(start, closing + 1)) ?? {};
  return {
    data: typeof data === "object" && data !== null ? data : {},
    body: bodyStart < 0 ? "" : raw.slice(bodyStart + 1)
  };
}

function stringField(data, key) {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Read and validate one skill bundle.
 * @returns the parsed skill, or null when it is not a usable skill.
 */
async function readSkill(catalog, dirName, logger) {
  const path = join(catalog, dirName, "SKILL.md");
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null; // No SKILL.md: not a skill bundle, not an error.
  }
  let parsed;
  try {
    parsed = parseFrontmatter(raw);
  } catch (error) {
    logger?.warn(`[dsh-superpowers] ${path} ignored: invalid YAML frontmatter: ${error.message}`);
    return null;
  }
  if (parsed === null) {
    logger?.warn(`[dsh-superpowers] ${path} ignored: missing YAML frontmatter`);
    return null;
  }
  const skillName = stringField(parsed.data, "name") ?? dirName;
  const description = stringField(parsed.data, "description");
  if (description === undefined) {
    logger?.warn(`[dsh-superpowers] ${path} ignored: frontmatter requires a description`);
    return null;
  }
  if (!SKILL_NAME.test(skillName)) {
    logger?.warn(`[dsh-superpowers] ${path} ignored: invalid skill name "${skillName}"`);
    return null;
  }
  return {
    name: skillName,
    description,
    whenToUse: stringField(parsed.data, "whenToUse"),
    directory: join(catalog, dirName),
    path,
    content: parsed.body.trim()
  };
}

/**
 * Build the candidate the registry validates. `provider` MUST equal the
 * provider's own name, and `invocation` must carry two booleans, or
 * validateCandidate throws — and a throwing provider is skipped WHOLESALE, so
 * one wrong field costs the entire catalog rather than one skill.
 */
function toCandidate(skill) {
  return {
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {},
    invocation: { modelInvocable: true, userInvocable: true },
    source: "custom",
    provider: PROVIDER,
    rank: RANK,
    // The DIRECTORY, never the SKILL.md. These skills carry .sh/.js/.ts/.cjs
    // helpers next to the markdown, and pointing at the file silently breaks
    // every reference to them.
    resourceBase: { kind: "directory", path: skill.directory },
    path: skill.path,
    locator: { path: skill.path, directory: skill.directory }
  };
}

/** Provider serving every SKILL.md bundle under the resolved superpowers root. */
class SuperpowersSkillProvider {
  constructor(root, logger) {
    this.name = PROVIDER;
    this.catalog = join(root, CATALOG);
    this.logger = logger;
    /**
     * Directory reader, overridable so tests can inject an order the real
     * filesystem will not produce. NTFS returns readdir entries already
     * sorted, so on Windows the sort below is unobservable through a fixture
     * and a check that relies on one silently proves nothing — while ext4 and
     * APFS make no such guarantee, so the sort is genuinely load-bearing.
     */
    this.readdir = readdir;
  }

  /**
   * Discover every skill bundle in the catalog.
   *
   * An unreadable catalog returns an INCOMPLETE observation rather than an
   * empty one: the registry caches complete results, so reporting a transient
   * read error as "no skills" would pin emptiness until invalidation.
   */
  async list() {
    let entries;
    try {
      entries = await this.readdir(this.catalog, { withFileTypes: true });
    } catch (error) {
      this.logger?.warn(`[dsh-superpowers] cannot read ${this.catalog}: ${error.message}`);
      return { candidates: [], complete: false };
    }
    const names = [];
    for (const entry of entries) {
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) { names.push(entry.name); continue; }
      // Follow links: the documented dev loop junctions skills into a clone.
      if (!entry.isSymbolicLink()) continue;
      try {
        if ((await stat(join(this.catalog, entry.name))).isDirectory()) names.push(entry.name);
      } catch {
        // Broken link: skip it rather than failing the whole catalog.
      }
    }
    names.sort();
    const skills = await Promise.all(names.map((n) => readSkill(this.catalog, n, this.logger)));
    return skills.filter((s) => s !== null).map(toCandidate);
  }

  /**
   * Load one skill body, re-reading from disk so a clone edit is picked up
   * without a restart.
   * @returns the full definition, or undefined when the file disappeared.
   */
  async get(candidate) {
    const { path, directory } = candidate.locator;
    let raw;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return undefined;
    }
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch {
      return undefined;
    }
    if (parsed === null) return undefined;
    return {
      name: candidate.name,
      description: candidate.description,
      ...candidate.whenToUse !== undefined ? { whenToUse: candidate.whenToUse } : {},
      invocation: candidate.invocation,
      source: candidate.source,
      provider: PROVIDER,
      resourceBase: { kind: "directory", path: directory },
      path,
      content: parsed.body.trim()
    };
  }
}

function apply(ctx, config) {
  if (config.enabled === false) return;

  // Registered FIRST, and from its own effect. Everything below this point can
  // return early — no clone found, marker unreadable — and both of those are
  // ordinary states for a machine that simply has not cloned superpowers. This
  // section is hand-written and has nothing to do with the clone, so letting
  // those returns swallow it would make an unrelated feature disappear for a
  // reason nobody would think to look for.
  if (config.askWithOptions !== false) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: "superpowers:ask-with-options",
      order: config.askWithOptionsOrder,
      text: ASK_WITH_OPTIONS_SECTION
    }), "superpowers.askWithOptions()");
  }

  const root = resolveRoot(config.superpowersRoot);
  if (root === null) {
    // Name both knobs: an unset root is a configuration gap, not a bug, and
    // the probe list is deliberately a guess about where clones live.
    console.warn(
      "[dsh-superpowers] no superpowers clone found. Set `superpowersRoot` in " +
        "this profile's cordis.patch.yml, or the SUPERPOWERS_ROOT environment " +
        "variable, to the repo root containing " + MARKER
    );
    return;
  }

  // The catalog half. Registered BEFORE the bootstrap read, for the same
  // reason ask-with-options is: readBootstrap() can return null on an
  // unreadable marker, and letting that swallow the whole skill catalog would
  // be a spectacularly indirect failure.
  //
  // `skills` is read optionally rather than declared in `inject`. Declaring it
  // would park the entire plugin in "waiting" on any profile that lacks the
  // service, taking the prompt section — which only needs `systemPrompt`, and
  // dsh-base always provides that — down with it.
  if (config.skillProvider !== false) {
    let skills;
    try {
      skills = ctx.get("skills");
    } catch {
      // A cordis context is a Proxy and an undeclared read can THROW rather
      // than yield undefined. Absent is an ordinary state here.
      skills = undefined;
    }
    if (skills !== undefined) {
      ctx.effect(
        () => skills.registerProvider(() => new SuperpowersSkillProvider(root, ctx.logger)),
        "superpowers.registerProvider()"
      );
    }
  }

  const text = readBootstrap(root);
  if (text === null) return;
  ctx.effect(() => ctx.systemPrompt.section({
    name: "superpowers:using-superpowers",
    order: config.order,
    text
  }), "superpowers.section()");
}

export { Config, SuperpowersSkillProvider, VENDOR_ROOT, apply, inject, name };
