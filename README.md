# dsh-plugins

Dennis Rongo's plugin collection for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) — an MIT agent harness where every capability is a plugin.

Everything here is built on the harness's public seams: cordis service keys, the Typert host/client bridge, `shell.*` slots, the system-prompt section registry, and `ctx.cmdlineArgs`. No forks, no patched launcher, no vendored harness code.

**Both surfaces are supported.** Every plugin runs unchanged under the `dsh` CLI *and* under **[DSH Desktop](https://dshdesktop.com/)** — a community desktop wrapper that ships the harness pre-packaged with multi-provider model support ("Any model, zero setup"), for Windows and macOS. It is an independent project, not affiliated with DeepSeek.

The desktop keeps its own `DSH_HOME` (`%APPDATA%\dsh-desktop\harness` on Windows) with its own profiles, so you install a plugin once per profile on whichever surface you use. Nothing here is CLI-specific: the same package, the same `cordis.patch.yml` row, and the same `/api` endpoints serve both.

> **Status:** developed against dsh `0.1.1-rc.2`. dsh is a fast-moving `0.1.x` dev preview that promises breaking changes — re-verify against your installed version.
>
> **Platforms:** the plugins are plain Node and platform-agnostic, and DSH Desktop ships for Windows and macOS, so they should run on either. Most tooling is portable Node — `verify.mjs`, `anchor.mjs`, `link-superpowers-skills.mjs`. Only `dev-link.ps1`'s profile-junction half is **Windows-only**. Everything here has been exercised on Windows against both the CLI and DSH Desktop; macOS and Linux are untested.

## Plugins

| Package | Adds | Halves | Endpoints |
|---|---|---|---|
| [`dsh-todo`](plugins/dsh-todo) | per-workspace todo list | host + client | `dshTodo/list`, `replace` |
| [`dsh-git`](plugins/dsh-git) | source-control "Changes" tab | host + client | `dshGit/status`, `diff`, `stage`, `commit`, `init`, `sync`, `suggestMessage` |
| [`dsh-weather`](plugins/dsh-weather) | weather bar in the shell overlay | client only | — |
| [`dsh-headless-plus`](plugins/dsh-headless-plus) | `--model` / `--resume` / `--continue` for the headless app | CLI app | — |
| [`dsh-superpowers`](plugins/dsh-superpowers) | Superpowers methodology as a system-prompt section | host | — |

---

### `dsh-todo`

A Todo tab scoped to the workspace you're working in, so each project keeps its own list instead of one global pile.

**What you get.** A tab beside Chat and Trajectory with add/complete/reorder, `All` / `Open` / `Done` / `Archive` filters, an `n/m done` progress readout, and per-row archive. Completed work is **archived, not deleted** — an item carries an optional `archivedAt` stamp whose *presence* is the archived state, so there's one source of truth and no way to store an archived item without a date. Restoring clears the stamp.

**How it works.** `TodoService extends TypertRemoteService` registers under the cordis key `dshTodo` and owns one SQLite database per project at `<workspace>/.dsh/todo.db`, resolved through `workspaceRegistry`. Writes use optimistic concurrency: every `replace` states the `revision` it observed, and the host rejects a stale write with `ok:false, code:'revision-conflict'` and the current list, rather than silently clobbering. A legacy central `~/.dsh/storages/dsh_todo.json` is migrated on first read.

**Endpoints.** `POST /api/dshTodo/list` → `{ list: { items, revision, updatedAt } }`; `POST /api/dshTodo/replace` → the new list or a revision conflict. Both take a single parameter named `request`.

**Requires.** The storage rows (`storage`, `storage-json`, `storage-domain`) — `@deepseek-ai/dsh-web-app` composes these by default — plus `workspaceRegistry` from `dsh-base`.

---

### `dsh-git`

Source control for the workspace, without leaving the harness.

**What you get.** A Changes tab showing branch, upstream ahead/behind, and a file list split into staged and unstaged, with per-row stage/unstage/discard and a diff pane. An **✦AI message** button drafts a commit message from the staged diff through the harness's own `llm` service, then `Commit all` commits. Recent history is listed underneath. A directory that isn't a repository reports `repo: false` and offers `Initialize repository` rather than erroring.

**How it works.** `GitService extends TypertRemoteService` under the cordis key `dshGit`, shelling out to `git` in the workspace directory. Writes are **serialised per repository root** through an internal queue, so two tabs can't interleave a stage and a commit. Paths from the client go through `assertSafePath`, which refuses absolute paths and `..` escapes. Untracked files have no diff for git to produce, so their contents are synthesized into a `/dev/null` patch — otherwise clicking a new file would show a blank pane and look broken. `push` without a remote fails as data (`{ ok: false, output }`), not an exception.

**Endpoints.** `status`, `diff`, `stage`, `commit`, `init`, `sync`, `suggestMessage` under `POST /api/dshGit/<method>`, each taking one parameter named `request`.

**Requires.** `workspaceRegistry` and `llm` (both composed by `dsh-base`) and `agentDefaultModel` for message drafting.

---

### `dsh-weather`

Current conditions pinned to the bottom of the web UI: temperature, condition, location, a short hourly outlook, humidity and wind.

**How it works.** A pure-consumer client plugin registering into the additive `shell.overlay` slot — no host service, no endpoints, no API key. It fetches [Open-Meteo](https://open-meteo.com/) directly from the browser (CORS-enabled). Readings are always fetched in **Celsius** and converted at render time, so the °F/°C toggle needs no refetch; the choice persists in `localStorage["dsh-weather:unit"]` and defaults to °F. Location resolves from `localStorage["dsh-weather:location"]`, then a geo-provider chain, then a hard fallback to New York; every network path degrades to a visible error state rather than throwing into the shell.

**Accessibility is deliberate:** the unit toggle is a real `<button>` with an `aria-label`, the bar is `aria-live="polite"`, focus is styled via `:focus-visible`, and `prefers-reduced-motion` disables the refresh spinner.

---

### `dsh-headless-plus`

The stock headless app answers one task and exits, with no way to choose a model or continue a conversation. This replaces it.

| Stock headless | `headless-plus` |
|---|---|
| `dsh --profile headless "task"` | unchanged |
| — | `--model provider/model` — per-invocation model override |
| — | `--resume <session-id>` — continue a persisted session |
| — | `--resume latest` / `--continue` / `-c` — continue this workspace's most recent session |
| — | `--session-info` — print the new session id on stderr at exit |

```bash
dsh --profile headless-plus --model anthropic/claude-sonnet-4-6 "refactor the auth module"
dsh --profile headless-plus --continue "now add tests"
dsh --profile headless-plus --resume session-6f2ca6dc-… "pick up where we left off"
```

**How it works.** Two rows replace the two stock ones: a startup row that owns the flag family via `ctx.cmdlineArgs` (each app owns its own flags, so this doesn't collide with the launcher), and a runner row that receives the parsed task by injection. Resuming goes through the public `ctx.agents.resume()` with `ResumeAgentOptions`; `--resume latest` maps the workspace to its session directory using the same slug rule as `dsh-session-persistence-jsonl`. Model overrides go through `ctx.agentDefaultModel`. Note the folder is `plugins/dsh-headless-plus` but the package is `@dennisrongo/dsh-headless-plus`, and a mount row takes the package name.

---

### `dsh-superpowers`

Makes the [Superpowers](https://github.com/obra/superpowers) methodology mandatory-first for every agent in a profile, rather than a skill the model may or may not reach for.

**How it works.** Upstream delivers its bootstrap through a SessionStart hook that must re-fire on `startup|clear|compact`. dsh has no hook shell, but its system prompt is a layered, ordered section registry that is **reassembled after compaction** — so one registered section covers all three upstream trigger points for the life of the session, with no gap where the bootstrap can fall out. It sits at order `-50`, just before persona.

**Nothing is vendored.** The section body is read from your own clone of the upstream repo at profile start, located via `superpowersRoot`, then `SUPERPOWERS_ROOT`, then a probe of common clone paths under `$HOME`. So `git pull` + a profile restart is the entire update path. To have the clone's *skills catalog* follow a pull too, instead of drifting as copies:

```bash
node scripts/link-superpowers-skills.mjs     # --dry-run to preview, --restore to undo
```

---

`dsh-todo`, `dsh-git` and `dsh-weather` each carry an `AGENTS.md` with endpoints, mount row, dev loop and a verification recipe. See [AGENTS.md](AGENTS.md) for the repo as a whole.

## Install a plugin

All five are on npm, and each declares `dsh.bundle` — so one command installs **and** mounts
it. `dsh plugin` forwards to pnpm inside the profile directory:

```bash
# web/desktop UI plugins
dsh plugin --profile web add @dennisrongo/dsh-todo
dsh plugin --profile web add @dennisrongo/dsh-git
dsh plugin --profile web add @dennisrongo/dsh-weather

# CLI-app and prompt plugins, in a headless-style profile
dsh plugin --profile headless add @dennisrongo/dsh-headless-plus
dsh plugin --profile headless add @dennisrongo/dsh-superpowers
```

Several at once is fine. Restart the profile and it's live — there is no
`cordis.patch.yml` row to write; see [step 4](#4-nothing-to-mount--but-read-this-if-youre-upgrading)
if you're upgrading from a version that needed one.

Prefer the git source — to track `main`, or to pick up a change before it's released?

```bash
dsh plugin --profile web add "github:dennisrongo/dsh-plugins#path:/plugins/dsh-todo"
dsh plugin --profile web add "github:dennisrongo/dsh-plugins#main&path:/plugins/dsh-todo"   # pin a ref
```

Quote the argument — `#` and `&` are shell metacharacters. All five ship their built `lib/`,
so a git install works even though it runs no build step.

## Installing from a clone

Clone if you want to edit the plugins or run the tests.

### Prerequisites

```bash
node --version     # 22+
pnpm --version     # 11+
npm i -g @deepseek-ai/dsh
dsh --version
```

These plugins declare their `@deepseek-ai/*` packages as **peers** and deliberately don't install their own copies — they resolve to the ones inside your global `dsh` install. Step 5 is what wires that up.

> **Using DSH Desktop only?** You don't need the CLI to install or run the plugins — steps 3, 4 and 6 work against the desktop's own profiles. You only need a copy of the harness packages for this repo's tooling (tests, typecheck, live editing), and you can point at the ones the desktop already bundles instead of installing the CLI:
>
> ```powershell
> $env:DSH_HOST_DEPS = "$env:LOCALAPPDATA\Programs\DSH Desktop\resources\app\node_modules\@deepseek-ai"
> ```
>
> Verified working: anchoring resolves to the desktop bundle rather than the npm host. Keep it consistent — don't anchor against the bundle while a CLI profile serves the same plugin, or the two surfaces load different physical copies of the harness packages.

You also need the harness itself configured with a model provider before any of this is
useful — that's dsh's own setup (`~/.dsh/settings.yaml` and credentials), not something these
plugins touch.

### 1. Clone and build

```bash
git clone https://github.com/dennisrongo/dsh-plugins.git
cd dsh-plugins
pnpm install
pnpm run build      # rebuild lib/ from src/
```

`pnpm run test` and `pnpm run typecheck` need step 5's anchoring first — `dsh-todo`'s smoke
test imports `@deepseek-ai/cordis` directly, and on a bare clone that fails with
`ERR_MODULE_NOT_FOUND`. Build works without it (the harness packages are marked external).
If you want the tests before touching a profile, run just the anchoring half now:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-link.ps1 -IdentityOnly
pnpm run test
```

### 2. Pick or create a profile

A profile is a directory under `$DSH_HOME/profiles/<name>` holding a `package.json` and a `cordis.patch.yml`. The CLI uses `~/.dsh`; DSH Desktop keeps its own `DSH_HOME` — on Windows that's `%APPDATA%\dsh-desktop\harness`, and the desktop logs the path it booted with at startup if you need to confirm it.

`web` and `headless` have built-in templates, so installing into them creates the directory, its manifest, an empty `cordis.patch.yml`, and the pnpm settings below. **Any other name you must scaffold yourself** — two files:

```json
// <profile>/package.json
{
  "name": "dsh-profile-my-web",
  "private": true,
  "dsh": {
    "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] }
  }
}
```

```yaml
# <profile>/pnpm-workspace.yaml — do not skip this
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
```

That second file is what dsh writes for its own template profiles, and `autoInstallPeers: false` matters: these plugins declare the harness packages as peers, and with auto-install on, pnpm fetches its own copies from npm — at versions that don't even match the declared ranges, since the published `@deepseek-ai/*` releases lag the version bundled with `dsh`. You end up with duplicate harness packages in the profile and a latent module-identity problem.

Use `@deepseek-ai/dsh-headless` instead of `dsh-web-app` for a headless profile. Don't edit `cordis.yml` — it's generated; `cordis.patch.yml` is your layer.

### 3. Install the plugins

`dsh plugin` forwards to pnpm inside the profile directory:

```bash
dsh plugin --profile web add \
  "file:C:/absolute/path/to/dsh-plugins/plugins/dsh-todo" \
  "file:C:/absolute/path/to/dsh-plugins/plugins/dsh-git" \
  "file:C:/absolute/path/to/dsh-plugins/plugins/dsh-weather"
```

On Windows use a **native absolute path with forward slashes** — the MSYS `/c/...` form fails with `LINKED_PKG_DIR_NOT_FOUND`.

Each package declares `dsh.bundle`, so `dsh plugin` registers it as a profile layer and prints
the package it added. (If you see `declares no dsh.bundle — installed as a plain dependency`,
you're on an older version of that plugin and will need a manual row.)

> **DSH Desktop:** same command with the desktop's profile. If that profile's `node_modules` was created by a different pnpm major you'll get `ERR_PNPM_UNEXPECTED_STORE`; edit the profile's `package.json` by hand instead and let step 5 supply the live module.

### 4. Nothing to mount — but read this if you're upgrading

Each package declares `dsh.bundle`, so `dsh plugin add` appends it to the profile's
`dsh.profile.bundles` and it **self-mounts**. One entry brings up both halves of a plugin: the
host service and the browser tab. Restart the profile and it's live.

> **Breaking change from earlier versions of these plugins.** They used to require a hand-written
> `insert:` row in your profile's `cordis.patch.yml`. That row is now a **duplicate** of the one
> the bundle provides, and the harness treats that as fatal:
>
> ```
> Error: dsh: plugin tree failed to load: failed to apply loader entry include
> (cordis:include): duplicate loader entry id: dsh-weather
> ```
>
> If you have rows for `dsh-weather`, `dsh-todo`, `dsh-git`, `superpowers`,
> `headless-plus-startup` or `headless-plus-runner` — or the `headless-startup` /
> `headless-runner` disables, which `dsh-headless-plus` now carries itself — **delete them**.
> Check with `dsh --profile <name> --dump-config`, which labels each row with the layer it came
> from; you want exactly one per plugin.

You still edit `cordis.patch.yml` to **configure** a row, which is what a bare `id:` is for:

```yaml
# pin the superpowers clone instead of letting the plugin probe for it
- id: superpowers
  config:
    superpowersRoot: /absolute/path/to/superpowers
```

`dsh-superpowers` needs a clone of [obra/superpowers](https://github.com/obra/superpowers) on
disk. To keep its skills catalog current on a `git pull` rather than drifting as copies, also run
`node scripts/link-superpowers-skills.mjs` (cross-platform).

`dsh-headless-plus` replaces the stock headless app, so its bundle disables the two stock rows
for you — it needs a profile built on `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`.

### 5. Optional: link for live editing (Windows)

**Installing is done — the plugins work at this point.** A plain install resolves the harness
packages through the profile, so you can skip straight to step 6. This step is for editing
*this repo* and seeing the change without reinstalling, plus it's what makes this repo's own
`pnpm run test` and `pnpm run typecheck` resolve.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-link.ps1 -Profiles web -DesktopProfiles web
node scripts/anchor.mjs        # the portable half on its own, any platform
```

Two jobs, and **both are undone by any `pnpm install`**, so re-run afterwards:

- **Profile junctions.** Points each profile's installed plugin at this repo so a rebuild
  self-deploys; pnpm otherwise materialises `file:` deps as copies frozen at install time.
- **Dependency anchoring.** Points each package's `node_modules\@deepseek-ai\*` at your
  global `dsh` install. Once a plugin is junctioned it resolves through its **real** path, so
  Node looks for dependencies here rather than in the profile — without anchoring a
  *junctioned* plugin dies at boot with `ERR_MODULE_NOT_FOUND`. `-IdentityOnly` does this
  half alone.

It only touches plugins a profile actually declares, follows the package name (so unscoped
packages work), and prints what it skipped.

> **macOS / Linux:** only the profile-junction half is Windows-only. The anchoring half is
> portable — run `node scripts/anchor.mjs`, which is what makes `pnpm run test` and
> `typecheck` resolve. Install and run (steps 1–4, 6) work fine anywhere; verified that a
> plain install boots and serves `/api` with no linking at all. What you lose is the
> live-edit loop (re-run step 3 after a build, or symlink by hand).

### 6. Verify

```bash
node scripts/verify.mjs                     # static checks, no server needed
dsh --profile web --port 38111 --no-open    # then, in another shell:
node scripts/verify.mjs --port=38111        # adds the live /api probes
```

Cross-platform, exits non-zero on failure. It reports the dsh version on each surface, then for every package resolves each `@deepseek-ai` specifier its **built** output imports and asserts it lands in the dsh CLI's own copy (never a `.pnpm` store path), checks the other runtime dependencies resolve, imports each host entry point, and confirms each client bundle still carries its `window.__ModuleLoader__.load` wrapper. With `--port` it POSTs each host endpoint and requires `200` with `"ok":true`.

`404` on a probe means the package's `./typert` export wasn't registered — see the plugin's `AGENTS.md`. Then open the UI and confirm the tabs render; `Promise.allSettled` in the client swallows failures, so a tab can render while every call fails.

**Run this after upgrading dsh.** A harness upgrade doesn't break `pnpm test` — that only proves this repo is self-consistent. What it breaks is resolution and the wire contract, which is what this checks.

## Publishing

`.github/workflows/publish.yml` publishes every package that isn't already on npm at its
current version, so a re-run after a partial failure is safe. It installs the harness and runs
`scripts/anchor.mjs` first (the tests can't resolve the peers otherwise), then build, test and
`verify.mjs`, and publishes with npm provenance.

Trigger it by publishing a GitHub release — the tag must match the package versions — or
manually via `workflow_dispatch`, which also takes a dist-tag and a dry-run toggle.

It needs an `NPM_TOKEN` secret **on this repository**: Actions secrets are write-only and
cannot be shared between user-account repos, so a token set elsewhere isn't visible here.

## Development

```bash
pnpm install          # all packages
pnpm run build        # pnpm -r --if-present run build
pnpm run test         # pnpm -r --if-present run test
```

Client-half edits deploy on a **browser refresh**; host-half edits need a **profile restart**. Registering a *new* `./typert` export needs a full restart either way — the loader caches its per-package verdict for the process lifetime.

Workspace configuration lives in `pnpm-workspace.yaml`: pnpm 11 ignores `pnpm` blocks in `package.json`, build permissions are `allowBuilds` (a map, not the older `onlyBuiltDependencies` list), and `autoInstallPeers` is off because the `@deepseek-ai/*` peers are dev-preview and partly unpublished.

One trap worth knowing: DSH Desktop runs a **profile-repair install** on startup that prunes this repo's per-package `node_modules` — which takes `zod` with it and makes the harness refuse to boot (`Cannot find package 'zod'`). Recovery is `pnpm install` at the root, then `scripts\dev-link.ps1`.

## Repository layout

```
plugins/     one self-contained package each (pnpm workspace members)
fixtures/    seed content for tests; not workspace packages
scripts/     verify.mjs                    — check the plugins against your installed dsh
             anchor.mjs                    — point each package's @deepseek-ai at that dsh
             dev-link.ps1                  — anchor + junction into profiles (Windows)
             link-superpowers-skills.mjs   — link an upstream superpowers clone's skills
```

`dsh-todo`, `dsh-git` and `dsh-weather` were consolidated here from standalone repos.

## License

MIT
