import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
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
 * Resolve the clone location: explicit config, then environment, then probe.
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
  return null;
}

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
  enabled: z.boolean().default(true)
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

function apply(ctx, config) {
  if (config.enabled === false) return;

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

  const text = readBootstrap(root);
  if (text === null) return;
  ctx.effect(() => ctx.systemPrompt.section({
    name: "superpowers:using-superpowers",
    order: config.order,
    text
  }), "superpowers.section()");
}

export { Config, apply, inject, name };
