# dsh-superpowers

[![npm](https://img.shields.io/npm/v/@dennisrongo/dsh-superpowers)](https://www.npmjs.com/package/@dennisrongo/dsh-superpowers)

**npm:** [`@dennisrongo/dsh-superpowers`](https://www.npmjs.com/package/@dennisrongo/dsh-superpowers) ·
**source:** [dennisrongo/dsh-plugins](https://github.com/dennisrongo/dsh-plugins/tree/main/plugins/dsh-superpowers)

> Mind the scope. The **unscoped** `dsh-superpowers` on npm is an unrelated plugin by another
> author, so `add dsh-superpowers` fetches theirs, not this one.

Injects the [Superpowers](https://github.com/obra/superpowers) methodology bootstrap
(`skills/using-superpowers/SKILL.md`) into every dsh agent's system prompt as an ordered,
persistent section — **and serves the 14 Superpowers skills to dsh's skill catalog**, so
they work on a machine that has never cloned anything.

Upstream harnesses deliver the bootstrap via a SessionStart hook that must re-fire on
`startup|clear|compact`. dsh has no hook shell, but its system prompt is a layered, ordered
section registry that is **reassembled after compaction** — so a single registered section
covers all three upstream trigger points for the life of the session, with no gap between
session start and the first compaction.

Both halves are independent: neither a missing clone nor a profile without a skills service
can take the other down, and neither stops dsh booting.

### Where the skills come from

The plugin serves whichever it finds first — your clone if you have one, otherwise a pinned
snapshot bundled with the package:

```
superpowersRoot config → SUPERPOWERS_ROOT → probe of ~/… → bundled vendor/ snapshot
```

**A real clone always wins**, so `git pull` keeps working exactly as before. The snapshot is
only the floor that makes a fresh install work — without it, a machine with no clone gets a
silently empty catalog, since dsh reports a missing skills root as an empty list rather than
an error.

The bootstrap prose is vendored only in that snapshot
(`obra/superpowers@b36e082`, MIT © 2025 Jesse Vincent — see `vendor/PROVENANCE`). When the
plugin resolves your clone instead, nothing from upstream is vendored at all.

> **Already using `link-superpowers-skills.mjs`?** Set `skillProvider: false`, or the same 14
> skills are listed twice — once by the junctions, once by this provider.

## Updating the plugin

```bash
dsh plugin --profile <name> outdated
dsh plugin --profile <name> update @dennisrongo/dsh-superpowers
```

`dsh plugin` forwards to pnpm. This plugin is host-only, so a **profile restart** is required
— the section is read in `apply()`, and a browser refresh will not pick it up.

That updates the *adapter*. The methodology itself lives in your Superpowers clone and
updates separately:

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
4. the **bundled `vendor/` snapshot**, which is always present

Because step 4 always succeeds, you get the bootstrap *and* the skills with no
configuration at all. Set `superpowersRoot` when you want your own clone to be authoritative
— it takes precedence, and then `git pull` (plus a profile restart) is the whole update
path. The probe list is only a guess about where you keep clones.

The old "no superpowers clone found" warning is now reachable only when a root you
configured explicitly is wrong.

## Install (profile-level)

```yaml
# <profile>/cordis.patch.yml — add one row
- id: superpowers
  name: '@dennisrongo/dsh-superpowers'
  config:
    superpowersRoot: /absolute/path/to/superpowers
```

with `pnpm add "file:/absolute/path/to/dsh-plugins/plugins/dsh-superpowers"` in the profile,
or straight from GitHub:

```bash
dsh plugin --profile <name> add "github:dennisrongo/dsh-plugins#path:/plugins/dsh-superpowers"
```

The folder is `plugins/dsh-superpowers` but the package is `@dennisrongo/dsh-superpowers`, so
it installs under the scope. Mind the difference: the **unscoped** `dsh-superpowers` on npm is
an unrelated plugin by another author, so `add dsh-superpowers` fetches theirs, not this one.

## Config

| key | default | meaning |
|---|---|---|
| `superpowersRoot` | `""` → resolved (see above) | repo root containing `skills/using-superpowers/SKILL.md` |
| `order` | `-50` | prompt section order (persona is 0; we sit before it) |
| `enabled` | `true` | master switch; false silences every section and the skill provider |
| `askWithOptions` | `true` | register the "offer choices as choices" section (below) |
| `askWithOptionsOrder` | `-45` | order for that section |
| `skillProvider` | `true` | serve the skills to dsh's catalog; set `false` if you deliver them another way |

## Also: "offer choices as choices"

A second, independent prompt section — hand-written here, nothing to do with the
Superpowers clone, and registered whether or not that clone exists.

dsh can already render a real picker. `ask_user_question` accepts `options[]`
with a label and a one-line description, plus `multi_select`, and the shipped
question UI turns that into a radiogroup or a checkbox group. What it cannot do
is turn prose into controls: a structured surface exists only for an actual tool
call, and a tool call can only happen *during* a turn. So an answer that ends
"A or B?" in markdown stays markdown forever, and you pay for it by typing a
reply that the model then has to guess the meaning of.

This section asks the model to reach for the tool in exactly that moment — with
a recommended option first, and `multi_select` when more than one can apply. It
deliberately stands down in plan mode, where dsh's own rules make
`exit_plan_mode` the single interaction and say so in terms that override later
guidance.

Set `askWithOptions: false` to drop it without touching the bootstrap.

## Tests

```bash
pnpm test    # offline, no harness, no clone needed
```

Every failure mode in this plugin is **silent by design** — a missing clone, a bad root,
`enabled: false`, an absent skills service and a malformed skill bundle all register nothing
and let dsh boot normally. So a regression breaks nothing visibly; the bootstrap and the
catalog just stop reaching the model.

35 checks pin section identity and order, frontmatter stripping, the resolution precedence
(config > env > probe > vendored snapshot), the non-fatal warning path, the skill-provider
contract, and that registration goes through `ctx.effect`.

`test/sabotage.mjs` then breaks `lib/index.js` 16 different ways and requires the suite to go
red each time — a check that has never failed is decoration. Two checks escaped the first
run and were rewritten; see `AGENTS.md`.

## Notes

- The bootstrap body has its YAML frontmatter stripped — the model needs the behavioural
  mandate, not the trigger metadata. If upstream restructures `SKILL.md`, that regex in
  `lib/index.js` is the thing to check; failure is non-fatal and logs
  `[dsh-superpowers] cannot read …`, so watch profile stderr after a pull.
- `@deepseek-ai/schemastery` and `@deepseek-ai/cordis` are peers, supplied by your dsh
  install. When this package is junctioned into a profile it resolves them through its own
  `node_modules/@deepseek-ai/*` — run `scripts/dev-link.ps1` to create those, or the
  harness fails to load the plugin with `ERR_MODULE_NOT_FOUND`.
