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
| `enabled` | `true` | master switch; `false` silences BOTH sections |
| `askWithOptions` | `true` | register the "offer choices as choices" section |
| `askWithOptionsOrder` | `-45` | order for that section |

## The second section: "offer choices as choices"

This plugin registers a second, unrelated section, `superpowers:ask-with-options`.
It is hand-written here rather than read from the clone, and it exists because
the harness can already render a picker but only ever gets the chance to when
the model asks through a tool: `ask_user_question` takes `options[]` plus
`multi_select`, and the shipped question UI renders a radiogroup or a checkbox
group from it. A turn that ends `"A or B?"` in markdown is markdown forever —
structured controls exist only for a real `question/requested` frame, and a tool
call can only happen *during* a turn. So the fix has to be upstream of the
prose, in the prompt.

Two things to keep if you edit it:

- **It must name `ask_user_question` exactly.** A wrong tool name is a section
  that reads perfectly and can never be acted on.
- **It must stand down in plan mode.** dsh's own plan-mode section states that
  its rules "override any later tool description or guidance", and it
  explicitly forbids asking "should I proceed?" through prose *or*
  `ask_user_question`, because `exit_plan_mode` is meant to be the single
  interaction there. A nudge that did not defer would be instructing the model
  to break a rule it has already been given.

It is registered **before** the clone resolution and from its own `ctx.effect`,
deliberately. Everything after that point can return early — no clone found,
marker unreadable — and both are ordinary states on a machine that simply has
not cloned superpowers. Letting those returns swallow this section would make an
unrelated feature vanish for a reason nobody would think to look for. The smoke
test pins that independence in both directions.

Root resolution, first hit wins: explicit `superpowersRoot` → `SUPERPOWERS_ROOT` env → a
probe of ten common clone locations under `homedir()` (platform-neutral). If none contains
the marker file the plugin **warns naming both knobs and registers nothing** — dsh still
boots and the skills still work as catalog entries; only the mandatory-first bootstrap is
missing. Failure is always non-fatal by design; check profile stderr for
`[dsh-superpowers] cannot read …` or `no superpowers clone found`.

## Mounting

**Self-mounting** via `dsh.bundle.patch` → this package's own `cordis.patch.yml`, which inserts
`id: superpowers`. `dsh plugin add` registers it as a profile layer; nothing to add by hand.
Adding an `insert:` row for it in the profile too is fatal (`duplicate loader entry id:
superpowers`).

The bundle patch carries **no config on purpose** — the plugin resolves the clone itself. Pin it
with an id-targeted override in the *profile's* `cordis.patch.yml`, which is exactly what a bare
`id:` is for:

```yaml
- id: superpowers
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

## Tests

`pnpm test` → `test/smoke.mjs`, offline, no harness. It builds throwaway clones in
`tmpdir()` and drives `apply()` with a stub context.

**Why this package needs tests more than its ~130 lines suggest: every failure mode here
is SILENT.** A missing clone, a bad root and `enabled: false` all register nothing and let
dsh boot normally — so a regression crashes nothing, the bootstrap just quietly stops
reaching the model and the agent's behaviour drifts with no diagnostic. The suite covers
section identity and order, frontmatter stripping, `enabled: false`, a bad root (must warn,
never throw), a directory without the marker, the full resolution precedence
(config > env > probe, with `''` falling through), and that registration goes through
`ctx.effect` rather than calling `section()` directly — bypassing the effect leaks the
section across a plugin reload.

Every check was verified to FAIL against a matching sabotage before being trusted:
removing the frontmatter strip, changing the default order, ignoring `enabled: false`,
dropping config precedence, throwing instead of warning on a bad root, and bypassing
`ctx.effect`. All six were caught.

## Fresh-install E2E

Unlike dsh-git, this plugin injects only `systemPrompt`, which **`dsh-base` provides** — so
it activates in any profile, including an arbitrarily-named one that gets the bare
`dsh-base` scaffold. Verified on an isolated `DSH_HOME`:

```powershell
$env:DSH_HOME = "$env:TEMP\dsh-sp-home"
dsh plugin --profile web add "file:C:/path/to/dsh-plugins/plugins/dsh-superpowers"
dsh --profile web --port 38333 --no-open
```

With **no clone anywhere** the profile boots to a serving web UI (HTTP 200) and prints the
one-line warning naming both knobs — non-fatal, as designed. Setting `superpowersRoot`
through a bare `id: superpowers` row in the profile's `cordis.patch.yml` silences it.

To simulate a genuinely clone-free machine, override `USERPROFILE`/`HOME`: the probe list
is `homedir()`-relative, and a developer box very likely has a clone in one of the ten
candidate locations — testing without that override silently exercises the *found* path
and proves nothing. That mistake happened during this verification.

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
