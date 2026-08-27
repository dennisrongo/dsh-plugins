# AGENTS.md — dsh-superpowers

Registers the [Superpowers](https://github.com/obra/superpowers) methodology bootstrap as a
persistent system-prompt section. **No `/api` endpoints and no client half** — one host
plugin, ~130 lines, `lib/index.js`, hand-written (there is no `src/` and no build step).

Published name is `@dennisrongo/dsh-superpowers`, so it installs to
`node_modules/@dennisrongo/dsh-superpowers` while the folder here stays
`plugins/dsh-superpowers`. The scope matters: the bare `dsh-superpowers` name on npm belongs
to an unrelated plugin (`codeAnqiang-ma/dsh-superpowers`), so an unscoped install would
fetch someone else's package.

## What it does

`inject: ["systemPrompt"]`, plugin name `superpowers`. On apply it reads
`<root>/skills/using-superpowers/SKILL.md`, strips the YAML frontmatter, and registers the
body as `ctx.systemPrompt.section({ name: "superpowers:using-superpowers", order })`.

Why a section and not a hook: upstream fires a SessionStart hook on `startup|clear|compact`.
dsh has no hook shell, but its system prompt is a layered, ordered section registry that is
**reassembled after compaction** — so one registered section covers all three upstream
trigger points for the life of the session, with no post-compaction gap. `order` defaults to
`-50`, immediately before persona (0); harness identity is `-100`.

**Nothing from upstream is vendored.** This is an adapter over your own clone, so upstream
changes never need reconciling against this repo.

## Config

| key | default | meaning |
|---|---|---|
| `superpowersRoot` | `""` → resolved | clone root containing `skills/using-superpowers/SKILL.md` |
| `order` | `-50` | section order |
| `enabled` | `true` | `false` for a clean-baseline profile |

Root resolution, first hit wins: explicit `superpowersRoot` → `SUPERPOWERS_ROOT` env → a
probe of ten common clone locations under `homedir()` (platform-neutral). If none contains
the marker file the plugin **warns naming both knobs and registers nothing** — dsh still
boots and the skills still work as catalog entries; only the mandatory-first bootstrap is
missing. Failure is always non-fatal by design; check profile stderr for
`[dsh-superpowers] cannot read …` or `no superpowers clone found`.

## Mounting

Both `id:` and `name:` are required — a bare `id:` is an id-targeted override and no-ops:

```yaml
- insert:
    - id: superpowers
      name: '@dennisrongo/dsh-superpowers'
      config:
        superpowersRoot: /absolute/path/to/superpowers
```

Any profile with a system prompt works. Install with
`dsh plugin --profile <name> add "file:<repo>/plugins/dsh-superpowers"` using a native
forward-slash absolute Windows path.

## Updating from upstream

```bash
cd <clone> && git pull
```

Two halves update differently. The **bootstrap section** is read in `apply()`, so it needs a
**profile restart** — not a refresh. The **skills catalog** is discovered by dsh from
`<agentsHome>/skills`, which is separate: a pull only updates it if those entries are links
rather than copies.

```bash
node scripts/link-superpowers-skills.mjs            # from the repo root
node scripts/link-superpowers-skills.mjs --dry-run  # preview
node scripts/link-superpowers-skills.mjs --restore  # undo, restoring saved copies
```

Junctions on Windows, directory symlinks elsewhere. Real directories are moved to
`<agentsHome>/skills-backup-superpowers` before being replaced. Idempotent — re-run it after
a pull that adds a **new** upstream skill.

## Editing notes

- The frontmatter strip is a regex (`/^---\r?\n[\s\S]*?\r?\n---\r?\n/`). If upstream
  restructures `SKILL.md`, that is the one line to check.
- `@deepseek-ai/schemastery` and `@deepseek-ai/cordis` are **peers** supplied by your dsh
  install. schemastery was once imported without being declared, which meant the package
  could not resolve it from its own real path — it worked only because the profile held a
  frozen copy inside the profile tree, and junctioning it (the normal dev loop) broke it with
  `ERR_MODULE_NOT_FOUND`. Declare what you import.
- Keep the probe list `homedir()`-relative. Absolute paths here are both a portability bug
  and a privacy leak in a public repo.

## Verification

```bash
# resolution — must print the dsh CLI install, never a .pnpm store path
node -e "const{createRequire}=require('module'),{resolve}=require('path');console.log(createRequire(resolve('lib/index.js')).resolve('@deepseek-ai/schemastery'))"

# the plugin registers a section, with a stub context — no harness needed
node --input-type=module -e "
const m = await import('./lib/index.js')
let section = null
const ctx = { effect: (fn) => fn(), systemPrompt: { section: (s) => { section = s } } }
m.apply(ctx, new m.Config({}))
console.log(section ? 'section ' + section.name + ' order=' + section.order + ' ' + section.text.length + ' chars' : 'NO section')
"
```

`enabled: false` and a bad root must both yield `NO section` without throwing. In a live
profile, confirm the skills catalog too: the command palette should list the upstream skills
(`systematic-debugging`, `writing-plans`, …) with their upstream descriptions.
