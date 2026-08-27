# dsh-superpowers

Injects the [Superpowers](https://github.com/obra/superpowers) methodology bootstrap
(`skills/using-superpowers/SKILL.md`) into every dsh agent's system prompt as an ordered,
persistent section.

Upstream harnesses deliver this via a SessionStart hook that must re-fire on
`startup|clear|compact`. dsh has no hook shell, but its system prompt is a layered, ordered
section registry that is **reassembled after compaction** — so a single registered section
covers all three upstream trigger points for the life of the session, with no gap between
session start and the first compaction.

**Nothing from upstream is vendored here.** This package is a thin adapter; the section body
is read from your own clone at startup.

## Updating from upstream

```bash
cd <your superpowers clone> && git pull
```

Two halves, and they are updated differently:

| Half | How it is consumed | After a pull |
|---|---|---|
| The bootstrap prompt section | read from `<root>/skills/using-superpowers/SKILL.md` at profile start | **restart the profile** (read happens in `apply()`, not per session) |
| The skills catalog | discovered by dsh from `<agentsHome>/skills` | nothing, *if* those entries are links — see below |

Link the clone's skills in once, and a pull updates them in place:

```bash
node scripts/link-superpowers-skills.mjs            # from the repo root
node scripts/link-superpowers-skills.mjs --dry-run  # preview
node scripts/link-superpowers-skills.mjs --restore  # undo, restoring saved copies
```

Junctions on Windows, directory symlinks on macOS/Linux. Real directories already in place
are moved to `<agentsHome>/skills-backup-superpowers` before being replaced, so it is
reversible. Re-run it after a pull that adds a **new** upstream skill.

## Locating the clone

Resolution order, first hit wins:

1. `superpowersRoot` in the profile's `cordis.patch.yml`
2. the `SUPERPOWERS_ROOT` environment variable
3. a probe of common clone locations under your home directory — `~/superpowers`,
   `~/src`, `~/code`, `~/dev`, `~/git`, `~/repos`, `~/Projects`, `~/Documents`,
   `~/Documents/GitHub`, all derived from `homedir()` so they work on any platform

If none contains `skills/using-superpowers/SKILL.md`, the plugin warns and registers
nothing — dsh still boots and the skills still work as catalog entries; only the
mandatory-first bootstrap is missing. Setting `superpowersRoot` explicitly is the reliable
option; the probe list is a guess about where you keep clones.

## Install (profile-level)

```yaml
# <profile>/cordis.patch.yml — add one row
- id: superpowers
  name: dsh-superpowers
  config:
    superpowersRoot: /absolute/path/to/superpowers
```

with `pnpm add "file:/absolute/path/to/dsh-plugins/plugins/dsh-superpowers"` in the profile.
Note this package is **unscoped**, so it installs to `node_modules/dsh-superpowers` rather
than under `@dennisrongo/`.

## Config

| key | default | meaning |
|---|---|---|
| `superpowersRoot` | `""` → resolved (see above) | repo root containing `skills/using-superpowers/SKILL.md` |
| `order` | `-50` | prompt section order (persona is 0; we sit before it) |
| `enabled` | `true` | set false for a clean-baseline profile |

## Notes

- The bootstrap body has its YAML frontmatter stripped — the model needs the behavioural
  mandate, not the trigger metadata. If upstream restructures `SKILL.md`, that regex in
  `lib/index.js` is the thing to check; failure is non-fatal and logs
  `[dsh-superpowers] cannot read …`, so watch profile stderr after a pull.
- `@deepseek-ai/schemastery` and `@deepseek-ai/cordis` are peers, supplied by your dsh
  install. When this package is junctioned into a profile it resolves them through its own
  `node_modules/@deepseek-ai/*` — run `scripts/dev-link.ps1` to create those, or the
  harness fails to load the plugin with `ERR_MODULE_NOT_FOUND`.
