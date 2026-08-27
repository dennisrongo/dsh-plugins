import { readFileSync } from "node:fs";
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
 * The section body is read lazily from the cloned superpowers repo at
 * startup (not bundled), so `git pull` upstream + restart is the whole
 * update path.
 *
 * @module dsh-superpowers
 */

/** Stable Cordis plugin name. */
const name = "superpowers";

const inject = ["systemPrompt"];

const Config = z.object({
  /** Directory containing skills/using-superpowers/SKILL.md (the repo root). */
  superpowersRoot: z.string().default(
    join(homedir(), "Documents", "Experimental Projects", "superpowers")
  ),
  /** Section order; persona is 0, harness identity is -100. We sit just before persona. */
  order: z.number().default(-50),
  /** Master switch, e.g. for a scratch profile that wants a clean baseline. */
  enabled: z.boolean().default(true)
});

function readBootstrap(superpowersRoot) {
  const path = join(superpowersRoot, "skills", "using-superpowers", "SKILL.md");
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
  const text = readBootstrap(config.superpowersRoot);
  if (text === null) return;
  ctx.effect(() => ctx.systemPrompt.section({
    name: "superpowers:using-superpowers",
    order: config.order,
    text
  }), "superpowers.section()");
}

export { Config, apply, inject, name };
