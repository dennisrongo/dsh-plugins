# AGENTS.md — dsh-superpowers

Registers the [Superpowers](https://github.com/obra/superpowers) methodology bootstrap as a
persistent system-prompt section, **and serves that clone's `skills/` as a skill provider**.
**No `/api` endpoints and no client half** — one host plugin, ~430 lines, `lib/index.js`,
hand-written (there is no `src/` and no build step).

Two independent halves, and keeping them independent is the whole design:

| half | needs | fails to |
|---|---|---|
| system-prompt section | `systemPrompt` (always present via `dsh-base`) | a warning, dsh boots |
| skill provider | `skills`, read **optionally** via `ctx.get` | nothing registered, dsh boots |

Neither can take the other down. That is load-bearing — see *The catalog half* below.

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

## The catalog half

`ctx.skills.registerProvider`, provider name `superpowers`, serving every
`<root>/skills/<name>/SKILL.md` as a candidate at `RANK 550` — deliberately below
`dsh-skills`' 600, so where both ship a skill of the same name the curated library wins.

**Why this exists.** The prompt section tells the model "invoke skills before ANY response";
the catalog is what makes those skills nameable. They failed independently, and a machine
with the section but no catalog is the worst of the three states: the model is told to use
skills, has no list of what exists, guesses a name, and reports that skills are missing.
Loading by exact name works the whole time, which is what makes it so convincing.

`skills` is read with `ctx.get`, **not** declared in `inject`. Declaring it would park the
whole plugin in "waiting" on any profile lacking the service and take the prompt half —
which only needs `systemPrompt` — down with it. A cordis context is a Proxy and an
undeclared read **throws** rather than returning `undefined`, so the read is wrapped in
`try`/`catch`; the smoke test's stub throws for the same reason, because a plain-object stub
answers `undefined` and cannot fail.

Registration happens **before** `readBootstrap()`, for the same reason ask-with-options does:
an unreadable marker returns early, and letting that swallow the entire skill catalog would
be a spectacularly indirect failure.

### The vendored snapshot — and what it costs

`vendor/` holds a pinned snapshot of the upstream catalog (14 skills, ~0.35 MB,
`obra/superpowers@b36e082`, MIT © 2025 Jesse Vincent). **This breaks the property this
plugin was originally built around.** Earlier versions of this file said "nothing from
upstream is vendored", and that is no longer true of the catalog half.

It was accepted because there is nothing to depend on: `@obra/superpowers` is unpublished,
and the bare `superpowers` on npm (0.0.2) is an unrelated package — the same scope trap
recorded twice in this repo. Without a snapshot, a fresh machine gets a silently empty
catalog, because a missing skills root surfaces as an **empty list, not an error**
(`dsh-skill-filesystem/lib/index.js:648`). That is exactly the reasoning that made
`dsh-skills` a provider rather than a link script; this is the same conclusion applied here.

The cost is real: **upstream changes now need a deliberate re-vendor**, not just a `git pull`.

```bash
node scripts/vendor-superpowers.mjs            # from the repo root
node scripts/vendor-superpowers.mjs --dry-run
```

It refuses a dirty working tree — vendoring uncommitted edits would ship them as though they
were upstream and make `vendor/PROVENANCE` a lie. `--allow-dirty` records the state honestly
instead. **`vendor` must stay in `package.json` `files`**, or the snapshot resolves locally
and vanishes on a published install, reintroducing the exact bug it fixes.

Resolution tries the snapshot **LAST**:

```
superpowersRoot -> SUPERPOWERS_ROOT -> homedir probe -> vendor/
```

That is the mirror image of `dsh-skills`, which tries its bundled dependency *before* its
probe. There the dependency is the intended path; here a real clone is, and the snapshot is
only the floor that makes a fresh install work. A live clone always wins, so `git pull`
behaves as it always has. Do not "fix" this to match `dsh-skills`.

## Config

| key | default | meaning |
|---|---|---|
| `superpowersRoot` | `""` → resolved | clone root containing `skills/using-superpowers/SKILL.md` |
| `order` | `-50` | section order |
| `enabled` | `true` | master switch; silences **every** section and the provider |
| `askWithOptions` | `true` | register the "offer choices as choices" section |
| `askWithOptionsOrder` | `-45` | order for that section |
| `skillProvider` | `true` | serve `skills/` as a provider; `false` when the same skills already reach the catalog another way |

**Set `skillProvider: false` if you also run `link-superpowers-skills.mjs`.** Those junctions
put the same 14 skills into `<agentsHome>/skills`, and both paths at once lists every skill
twice. Pick one: the provider (nothing to run, works on a fresh machine) or the junctions
(a `git pull` updates them in place).

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
probe of ten common clone locations under `homedir()` (platform-neutral) → the bundled
`vendor/` snapshot. Because the snapshot is always present, the "nothing found" warning is
now reachable only when a configured root is wrong — a fresh machine resolves the snapshot
and stays silent. Failure is still non-fatal by design; check profile stderr for
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

Everything is read in `apply()` or at catalog-collection time, so an update needs a
**profile restart** — never just a refresh.

What a pull reaches depends on which delivery path you use:

| path | a `git pull` updates it? |
|---|---|
| built-in provider, `superpowersRoot`/env/probe resolves your clone | yes, on restart |
| built-in provider falling back to `vendor/` | **no** — re-run `scripts/vendor-superpowers.mjs` |
| `link-superpowers-skills.mjs` junctions under `<agentsHome>/skills` | yes, if they are links and not copies |

The junction path below predates the provider and is now optional. Keep it only if you
prefer `<agentsHome>/skills` to be the delivery mechanism — and if you do, set
`skillProvider: false` so the same skills are not listed twice.

```bash
node scripts/link-superpowers-skills.mjs            # from the repo root
node scripts/link-superpowers-skills.mjs --dry-run  # preview
node scripts/link-superpowers-skills.mjs --restore  # undo, restoring saved copies
```

Junctions on Windows, directory symlinks elsewhere. Real directories are moved to
`<agentsHome>/skills-backup-superpowers` before being replaced. Idempotent — re-run it after
a pull that adds a **new** upstream skill.

## Diagnosing "the skills stopped working"

Read this before touching resolution. The most convincing failure this plugin has been
blamed for was **not** in this plugin.

**Signature: `<available_skills>` never appears in the prompt, but loading a skill by exact
name works perfectly.** That asymmetry is the tell. Resolution is fine — the catalog is
being *deleted after injection*.

The cause was a profile `cordis.patch.yml` re-enabling the host-plane `tool-skill` row that
`dsh-web-app` deliberately disables, giving two instances of the same plugin. The preset's
instance built and injected the catalog; the host instance then ran its own hook, checked
whether the agent's `skill` tool was its own registration, found the preset's instead (a
scoped tool shadows a global one), concluded "zero skills", and stripped the catalog message
on every step.

It compounded with a second, harmless thing into something that looked fatal. The bootstrap
text says `superpowers:brainstorming` — correct for Claude Code, where superpowers installs
as a marketplace plugin. In dsh the skills are flat, so the real name is bare
`brainstorming`. **That mismatch is not fatal on its own**: a visible catalog corrects it.
It only bites when the catalog has been stripped, leaving the model with one lead, no list,
and an `invalid skill name` error — from which "the skills aren't installed" is a reasonable
but wrong conclusion.

The prefix is deliberately left as upstream wrote it. Rewriting upstream prose is a
maintenance burden that buys nothing once the catalog loads.

Before blaming resolution, check in this order:

1. Is the bootstrap section in the prompt? If yes, **resolution already succeeded** — the
   clone was found and read. Do not go looking for it.
2. Is `<available_skills>` present? If no but exact-name loading works, look for a duplicated
   `tool-skill` row, not a missing clone.
3. Only if both are absent is this a resolution problem.

## Tests

`pnpm test` → `test/smoke.mjs` then `test/sabotage.mjs`, offline, no harness. The suite
builds throwaway clones and catalogs in `tmpdir()` and drives `apply()` with a stub context.

**Why this package needs tests more than its line count suggests: every failure mode here
is SILENT.** A missing clone, a bad root, `enabled: false`, an absent `skills` service and a
malformed bundle all register nothing and let dsh boot normally — so a regression crashes
nothing, the bootstrap and the catalog just quietly stop reaching the model.

35 checks. The prompt half covers section identity and order, frontmatter stripping,
`enabled: false`, a bad root (must warn, never throw), a directory without the marker, the
resolution precedence, and registration through `ctx.effect`. The catalog half covers the
candidate contract field by field (including `provider` having to equal the provider's own
name, and `resourceBase` being the **directory** — these skills ship `.sh`/`.js`/`.ts`
helpers beside the markdown), `get()` re-reading from disk, an unreadable catalog reporting
`complete: false` rather than a complete-and-empty list, one malformed bundle not sinking the
others (including the real upstream `": "` YAML defect), `_`/`.` exclusion, sorting,
`skillProvider: false`, an absent `skills` service, and that `inject` stays minimal.

`test/sabotage.mjs` applies **16 mutations** to `lib/index.js` one at a time and asserts the
suite goes red for each. All 16 are caught. It refuses to count a mutation whose anchor did
not match, because the easiest way to fake this exercise is a regex that quietly matched
nothing.

**Two checks escaped on the first run and are worth knowing about:**

- **The vendored-fallback check passed `superpowersRoot: VENDOR_ROOT`** — which proves the
  directory has files in it, not that *resolution* falls back to it. Deleting the fallback
  branch entirely left it green. It now redirects `HOME`/`USERPROFILE` at an empty directory
  and passes no root at all. This is the same trap already recorded below under
  *Fresh-install E2E*, made twice.
- **The sort check could not fail on Windows**, because NTFS returns `readdir` entries
  already sorted — so no fixture can produce disorder. ext4 and APFS make no such guarantee,
  so the sort is load-bearing and must be pinned somewhere. The provider therefore exposes
  `this.readdir` as an overridable seam and the test injects the disorder directly.

## Fresh-install E2E

Unlike dsh-git, this plugin injects only `systemPrompt`, which **`dsh-base` provides** — so
it activates in any profile, including an arbitrarily-named one that gets the bare
`dsh-base` scaffold. Verified on an isolated `DSH_HOME`:

```powershell
$env:DSH_HOME = "$env:TEMP\dsh-sp-home"
dsh plugin --profile web add "file:C:/path/to/dsh-plugins/plugins/dsh-superpowers"
dsh --profile web --port 38333 --no-open
```

**This changed with the vendored snapshot.** With no clone anywhere, a fresh machine used to
boot to a serving web UI, print the one-line warning naming both knobs, and register the
bootstrap but **no skills** — the silent gap this plugin was fixed for. It now resolves
`vendor/`, serves all 14 skills, registers the bootstrap, and warns about nothing.

To simulate a genuinely clone-free machine, override `USERPROFILE`/`HOME`: the probe list
is `homedir()`-relative, and a developer box very likely has a clone in one of the ten
candidate locations — testing without that override silently exercises the *found* path
and proves nothing. That mistake has now been made twice here: once in the original
verification, and again in the first version of the vendored-fallback test (see *Tests*).

### Verified against a real model, not a stub

The check that actually settles this is **one headless turn on a scratch
`DSH_HOME`**, with `USERPROFILE`/`HOME` redirected so no clone is reachable.
Everything else — stub contexts, hand-built `Context` objects, HTTP 200 from a
booted profile — can pass while the catalog never reaches the model.

```powershell
$env:DSH_HOME = "$env:TEMP\dsh-e2e"; $env:USERPROFILE = "$env:TEMP\nohome"
# profile bundles: dsh-base + dsh-headless + @dennisrongo/dsh-superpowers
dsh --profile sphead "List the exact names of every skill in your
  available_skills catalog, comma-separated. If you have no catalog, reply: NO CATALOG"
```

Result on a machine with **no clone anywhere**:

```
brainstorming, dispatching-parallel-agents, executing-plans,
finishing-a-development-branch, receiving-code-review, requesting-code-review,
subagent-driven-development, systematic-debugging, test-driven-development,
using-git-worktrees, using-superpowers, verification-before-completion,
writing-plans, writing-skills
```

Loading one through the `skill` tool returned 8654 chars, and the bootstrap
section was confirmed present in the same session. **Control:** the same
question under `skillProvider: false` answers `NO CATALOG` — so the catalog
exists *because of* this provider, which is causation rather than coincidence.

**Do not try to verify this by hand-building a `Context` in bare node.** Two
long attempts produced results that contradicted each other run to run — the
same script shape reporting 14 skills once and 0 the next time — and every
"root cause" identified along the way (a `console.warn` swap, `mkdtempSync` vs a
literal home, monkey-patching `registerProvider`, two mounts per process) was
disproved by the following run. The instrumentation was the unreliable part, and
the failures were never reproduced against a real profile. A headless turn is
cheaper, and it tests the thing that actually matters.

An earlier stub-level check is still useful as a fast signal, but it is not
evidence about the model's prompt:

```
homedir now: …\Temp\dsh-sp-freshhome
warnings: (none)
sections: superpowers:ask-with-options, superpowers:using-superpowers
skills served: 14
```

## Editing notes

- The frontmatter strip is a regex (`/^---\r?\n[\s\S]*?\r?\n---\r?\n/`). If upstream
  restructures `SKILL.md`, that is the one line to check.
- `@deepseek-ai/schemastery` and `@deepseek-ai/cordis` are **peers** supplied by your dsh
  install. schemastery was once imported without being declared, which meant the package
  could not resolve it from its own real path — it worked only because the profile held a
  frozen copy inside the profile tree, and junctioning it (the normal dev loop) broke it with
  `ERR_MODULE_NOT_FOUND`. Declare what you import.
- Keep the probe list `homedir()`-relative. Absolute paths here are both a portability bug
  and a privacy leak in a public repo. Two copies exist — `lib/index.js` and
  `scripts/vendor-superpowers.mjs` — plus a third in `scripts/link-superpowers-skills.mjs`.
  They are intentionally duplicated rather than shared, because the scripts must run with no
  dependency on the built plugin; change one and check the others.
- **`yaml` is a real dependency, not a peer.** `scripts/anchor.mjs` only anchors
  `@deepseek-ai/*`, so a peer `yaml` resolves to nothing from the package's own real path and
  dies `ERR_MODULE_NOT_FOUND`. That already happened once in `dsh-skills`.
- `parseFrontmatter` duplicates `dsh-skill-filesystem`'s, which exports none — the same
  unavoidable duplication `dsh-skills` carries. If the harness changes its shape, that
  function and the section's regex are the two places to check.
- **The provider must never throw out of `list()`.** `validateCandidate` throws on a
  malformed candidate and the registry then skips the *whole* provider, so one bad field
  costs the entire catalog rather than one skill.

## Verification

```bash
# resolution — must print the dsh CLI install, never a .pnpm store path
node -e "const{createRequire}=require('module'),{resolve}=require('path');console.log(createRequire(resolve('lib/index.js')).resolve('@deepseek-ai/schemastery'))"

# both halves, with a stub context — no harness needed.
# NOTE the `get`: without it this silently exercises the absent-service path
# and reports "no provider" on a perfectly healthy plugin.
node --input-type=module -e "
const m = await import('./lib/index.js')
let section = null, provider = null
const ctx = {
  effect: (fn) => fn(),
  logger: console,
  systemPrompt: { section: (s) => { if (s.name.endsWith('using-superpowers')) section = s } },
  get: (n) => n === 'skills' ? { registerProvider: (f) => { provider = f({}) } } : undefined,
}
m.apply(ctx, new m.Config({}))
console.log(section ? 'section ' + section.name + ' order=' + section.order + ' ' + section.text.length + ' chars' : 'NO section')
if (provider) {
  const l = await provider.list({})
  const c = Array.isArray(l) ? l : l.candidates
  console.log('provider ' + provider.name + ': ' + c.length + ' skills')
} else console.log('NO provider')
"
```

`enabled: false` and a bad root must both yield `NO section` without throwing. On a machine
with no clone the vendored snapshot answers, so expect `14 skills` rather than none.

In a live profile, confirm the catalog reaches the model — not just that the plugin
registered. The command palette should list the upstream skills (`systematic-debugging`,
`writing-plans`, …), and `<available_skills>` should be present in the prompt. If the palette
lists them but the prompt has no catalog, read *Diagnosing "the skills stopped working"*
above before touching anything here.
