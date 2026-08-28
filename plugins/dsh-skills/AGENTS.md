# AGENTS.md — dsh-skills

Serves the [`@dennisrongo/skills`](https://www.npmjs.com/package/@dennisrongo/skills) library
to dsh as a **skill provider**. **No `/api` endpoints and no client half** — one host plugin,
~300 lines, `lib/index.js`, hand-written (there is no `src/` and no build step).

Published name is `@dennisrongo/dsh-skills`, so it installs to
`node_modules/@dennisrongo/dsh-skills` while the folder here stays `plugins/dsh-skills`.
The scope matters: the bare `dsh-skills` on npm belongs to an unrelated plugin
(`CocoSgt/dsh-skills`, a copy-based skill hub), so an unscoped install fetches someone else's
package. Same trap as `dsh-superpowers`.

## What it does

`inject: ["skills"]`, plugin name `skills`, provider name `dennisrongo-skills`. On apply it
resolves the library root and calls `ctx.skills.registerProvider`, serving every
`<root>/skills/<name>/SKILL.md` bundle as a candidate.

Why a provider and not a link script: **a script cannot do a fresh install.** The
superpowers-style approach junctions each skill into `<agentsHome>/skills`, which presumes
that directory exists — and nothing in the harness creates it. A missing root is discovered
as an empty list (`dsh-skill-filesystem/lib/index.js:648`), not an error, so a fresh machine
gets a silently empty catalog. Making the library an npm **dependency of the plugin** means
`dsh plugin add` installs plugin and catalog together.

Registration files into the calling context's layer. At profile level that is the **global**
layer, which every agent preset's scope chain includes (`dsh-skill/lib/index.js:299`) — so one
row reaches every agent without touching the presets' own `skill-filesystem` rows. Those rows
are disabled at profile level by `dsh-web-app`, which is why patching their `customSkillDirs`
from a profile does nothing; a second provider sidesteps that entirely.

**Nothing is vendored.** Bodies are read at catalog-collection time, so `skillsRoot` pointed
at a working clone picks up edits with no reinstall.

## Config

| key | default | meaning |
|---|---|---|
| `skillsRoot` | `""` → resolved | root containing `skills/<name>/SKILL.md` |
| `enabled` | `true` | `false` for a clean-baseline profile |

Root resolution, first hit wins: explicit `skillsRoot` → `DSH_SKILLS_ROOT` env → this
package's own `@dennisrongo/skills` dependency via `createRequire` → a probe of common clone
locations under `homedir()`. The dependency is tried before the probe because it is the
intended path and a global npm prefix is not guessable. If nothing resolves the plugin
**warns naming every knob and registers nothing** — non-fatal by design.

## The provider contract

`registerProvider` takes a factory returning `{ name, list(), get() }`. `validateCandidate`
(`dsh-skill/lib/index.js:452-464`) **throws** on a malformed candidate, and a throwing
provider is caught and skipped with a warning (`:354`) — so a contract bug degrades to a
silently missing catalog, not a boot failure. Every candidate needs:

| field | rule |
|---|---|
| `name` | `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` |
| `description` | non-empty string |
| `invocation` | `{modelInvocable, userInvocable}`, both booleans |
| `source` | any string |
| `rank` | finite number |
| `provider` | **must equal the provider's own `name`** (`:462`) |
| `resourceBase` | `{kind:"directory", path}` so `references/` resolves |
| `locator` | opaque; handed back to `get()` |

`rank` breaks ties only **within one layer**; a nearer layer wins outright, so a project's
`.dsh/skills` still shadows these. `list()` returns an array, or
`{candidates, complete:false}` to report an incomplete observation — used for an unreadable
catalog, because the registry caches complete results and would otherwise pin emptiness.

## Known upstream defect

**5 of 31 skills in `@dennisrongo/skills@0.16.0` fail to parse** — `code-review`,
`e2e-verify`, `maestro-mobile-test`, `nextjs-app-router`, `task-executor`. Their
frontmatter inlines a description containing a literal `": "`, which YAML reads as a nested
mapping:

```
Nested mappings are not allowed in compact mappings at line 2, column 14
```

This is **not a bug in this plugin** — the harness's own parser fails identically (same
`yaml` `parse`, `dsh-skill-filesystem/lib/index.js:779`), so those five are equally invisible
to `skill-filesystem`. Present in 0.14.0, 0.15.0 and 0.16.0; the `~/.claude/skills` copies
are **not** affected because they use folded scalars (`description: >-`). The publish
pipeline flattens them.

Fix upstream in `dennisrongo/claude-skills` by quoting or folding the description; the
plugin needs no change and picks the skills up on the next `update`. Verify with:

```bash
node -e "const{parse}=require('yaml');parse('description: a lens council: parallel')"
```

## Mounting

**Self-mounting** via `dsh.bundle.patch` → this package's own `cordis.patch.yml`, inserting
`id: skills`. `dsh plugin add` registers it as a profile layer. Adding an `insert:` row for
it in the profile too is fatal (`duplicate loader entry id: skills`); a bare `id:` row
CONFIGURES it.

```bash
dsh plugin --profile <name> add @dennisrongo/dsh-skills
dsh plugin --profile <name> update @dennisrongo/dsh-skills   # newer library
```

`dsh plugin` is a **thin pnpm forwarder** (`dsh/lib/plugin-*.js:8-10`), so any pnpm
subcommand works — `update`, `outdated`, `remove`. Bundles reconcile by **installed state**,
not dependency diff, so a version that newly gains `dsh.bundle` activates automatically.

Expect this warning on install; it is orientation, not a fault:

> `warning: @dennisrongo/skills declares no dsh.bundle — installed as a plain dependency`

The library is a plain library. Only the plugin is a bundle.

## Editing notes

- `yaml` is a real **dependency**, not a peer: `scripts/anchor.mjs` only anchors
  `@deepseek-ai/*` (line 70), so a peer `yaml` resolves to nothing from the package's own
  real path and dies `ERR_MODULE_NOT_FOUND`. This already happened once here.
- The frontmatter parser duplicates `dsh-skill-filesystem`'s, which exports none. If the
  harness changes its shape, `parseFrontmatter` is the one function to check.
- `get()` re-reads from disk rather than serving `list()`'s cached body, so a clone edit
  under `skillsRoot` lands without a restart.
- Keep the probe list `homedir()`-relative — absolute paths are a portability bug and a
  privacy leak in a public repo.

## Verification

```bash
# resolution — must print the dsh CLI install, never a .pnpm store path
node -e "const{createRequire}=require('module'),{resolve}=require('path');console.log(createRequire(resolve('lib/index.js')).resolve('@deepseek-ai/schemastery'))"

# the provider lists and loads, with a stub context — no harness needed
node --input-type=module -e "
const m = await import('./lib/index.js')
let p = null
const ctx = { logger: console, effect: (f) => f(), skills: { registerProvider: (c) => { p = c({}) } } }
m.apply(ctx, new m.Config({}))
const list = await p.list({})
const cands = Array.isArray(list) ? list : list.candidates
console.log(cands.length + ' skills; first=' + cands[0].name)
console.log((await p.get(cands[0], {})).content.length + ' chars')
"
```

`enabled: false` and a bad root must both register nothing without throwing. In a live
profile, the command palette should list these skills with their upstream descriptions.
