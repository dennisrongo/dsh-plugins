# dsh-plugins

Dennis Rongo's plugin collection for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) — an MIT agent harness where every capability is a plugin.

Everything here is built on the harness's public seams: cordis service keys, the Typert host/client bridge, `shell.*` slots, the system-prompt section registry, and `ctx.cmdlineArgs`. No forks, no patched launcher, no vendored harness code.

**Both surfaces are supported.** Every plugin runs unchanged under the `dsh` CLI *and* under **[DSH Desktop](https://dshdesktop.com/)** — a community desktop wrapper that ships the harness pre-packaged with multi-provider model support ("Any model, zero setup"), for Windows and macOS. It is an independent project, not affiliated with DeepSeek.

The desktop keeps its own `DSH_HOME` (`%APPDATA%\dsh-desktop\harness` on Windows) with its own profiles, so you install a plugin once per profile on whichever surface you use. Nothing here is CLI-specific: the same package, the same `cordis.patch.yml` row, and the same `/api` endpoints serve both.

> **Status:** developed against dsh `0.1.1-rc.2`. dsh is a fast-moving `0.1.x` dev preview that promises breaking changes — re-verify against your installed version.
>
> **Platforms:** the plugins are plain Node and platform-agnostic, and DSH Desktop ships for Windows and macOS, so they should run on either. Of the tooling, `scripts/link-superpowers-skills.mjs` is cross-platform (junctions on Windows, symlinks elsewhere); `scripts/dev-link.ps1` is **Windows-only**. Everything here has been exercised on Windows against both the CLI and DSH Desktop; macOS and Linux are untested.

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

**Requires.** `workspaceRegistry` and `llm` (both composed by `dsh-base`) and `agentDefaultModel` for message drafting. Its `lib/` is **not committed** — build before installing.

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

**How it works.** Two rows replace the two stock ones: a startup row that owns the flag family via `ctx.cmdlineArgs` (each app owns its own flags, so this doesn't collide with the launcher), and a runner row that receives the parsed task by injection. Resuming goes through the public `ctx.agents.resume()` with `ResumeAgentOptions`; `--resume latest` maps the workspace to its session directory using the same slug rule as `dsh-session-persistence-jsonl`. Model overrides go through `ctx.agentDefaultModel`. Note this package is **unscoped** — it installs to `node_modules/dsh-headless-plus`.

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

## Installing

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
pnpm run build      # required: dsh-git does not commit its lib/
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

You'll see one warning per plugin:

```
dsh: warning: @dennisrongo/dsh-todo declares no dsh.bundle — installed as a
plain dependency, not a profile layer
```

That's expected. These are mounted by the rows in step 4, not as bundle layers.

> **DSH Desktop:** same command with the desktop's profile. If that profile's `node_modules` was created by a different pnpm major you'll get `ERR_PNPM_UNEXPECTED_STORE`; edit the profile's `package.json` by hand instead and let step 5 supply the live module.

### 4. Mount them in `cordis.patch.yml`

**Every insert row needs both `id:` and `name:`.** A bare `id:` is an id-targeted override of an existing row and silently does nothing.

```yaml
# web/headless UI plugins — one row mounts both halves of a plugin
- insert:
    - id: dsh-weather
      name: '@dennisrongo/dsh-weather'
    - id: dsh-todo
      name: '@dennisrongo/dsh-todo'
    - id: dsh-git
      name: '@dennisrongo/dsh-git'
```

```yaml
# dsh-superpowers — any profile with a system prompt
- insert:
    - id: superpowers
      name: dsh-superpowers
      config:
        superpowersRoot: /absolute/path/to/superpowers   # optional; see the plugin README
```

This one needs a clone of [obra/superpowers](https://github.com/obra/superpowers) on disk. To
have its skills catalog stay current on a `git pull` rather than drifting as copies, also run
`node scripts/link-superpowers-skills.mjs` (cross-platform).

```yaml
# dsh-headless-plus — replaces the two stock headless rows
- id: headless-startup
  disabled: true
- id: headless-runner
  disabled: true
- insert:
    - id: headless-plus-startup
      name: 'dsh-headless-plus/startup'
    - id: headless-plus-runner
      name: 'dsh-headless-plus'
      inject: [headlessPlusStartup]
      config:
        task: !!js ctx.headlessPlusStartup.task
```

Then restart the profile.

### 5. Optional: link for live editing (Windows)

**Installing is done — the plugins work at this point.** A plain install resolves the harness
packages through the profile, so you can skip straight to step 6. This step is for editing
*this repo* and seeing the change without reinstalling, plus it's what makes this repo's own
`pnpm run test` and `pnpm run typecheck` resolve.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-link.ps1 -Profiles web -DesktopProfiles web
```

Two jobs, and **both are undone by any `pnpm install`**, so re-run it afterwards:

- **Profile junctions.** Points each profile's installed plugin at this repo so a rebuild
  self-deploys; pnpm otherwise materialises `file:` deps as copies frozen at install time.
- **Dependency anchoring.** Points each package's `node_modules\@deepseek-ai\*` at your
  global `dsh` install. Once a plugin is junctioned it resolves through its **real** path, so
  Node looks for dependencies here rather than in the profile — without anchoring a
  *junctioned* plugin dies at boot with `ERR_MODULE_NOT_FOUND`. `-IdentityOnly` does this
  half alone.

It only touches plugins a profile actually declares, follows the package name (so unscoped
packages work), and prints what it skipped.

> **macOS / Linux:** this script is Windows-only. Install and run (steps 1–4, 6) work fine —
> verified that a plain install boots and serves `/api` with no linking at all. What you lose
> is the live-edit loop (re-run step 3 after a build, or symlink by hand) and this repo's
> `pnpm run test` / `typecheck` for `dsh-todo`, which need the anchoring.

### 6. Verify

```bash
dsh --profile web --port 38111 --no-open        # capture output; ERR_MODULE_NOT_FOUND here is a broken junction
curl -s -X POST http://127.0.0.1:38111/api/dshTodo/list -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"t1","method":"dshTodo/list","payload":{"args":{"request":{"workspaceId":"<id>"}}}}'
```

`200` with `"ok":true` means mounted. `404` means the package's `./typert` export wasn't registered — see the plugin's `AGENTS.md`. Workspace ids live in `~/.dsh/storages/workspace.json` under `tables.workspaces`. Then open the UI and confirm the tabs render.

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
scripts/     dev-link.ps1                  — link the plugins into your profiles (Windows)
             link-superpowers-skills.mjs   — link an upstream superpowers clone's skills
```

`dsh-todo`, `dsh-git` and `dsh-weather` were consolidated here from standalone repos.

## License

MIT
