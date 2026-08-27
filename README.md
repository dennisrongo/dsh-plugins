# dsh-plugins

Dennis Rongo's plugin collection for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) — an MIT agent harness where every capability is a plugin.

Everything here is built on the harness's public seams: service keys, the Typert bridge, `shell.*` slots, `ctx.cmdlineArgs`. No forks, no patched launcher, no vendored harness code.

**Both surfaces are supported.** Every plugin runs unchanged under the `dsh` CLI *and* the **DSH Desktop** app. The desktop keeps its own `DSH_HOME` (`%APPDATA%\dsh-desktop\harness`) with its own profiles, so a plugin is installed once per profile on whichever surface you use — see [Install on a new machine](#install-on-a-new-machine).

> **Status:** developed against dsh `0.1.1-rc.2`. dsh is a fast-moving `0.1.x` dev preview that promises breaking changes — re-verify against your installed version.
>
> **Platforms:** the plugins are plain Node and platform-agnostic. Of the tooling,
> `scripts/link-superpowers-skills.mjs` is cross-platform (junctions on Windows, symlinks
> elsewhere); `scripts/dev-link.ps1` is **Windows-only** — it creates junctions and knows
> Windows profile locations. Everything here has been exercised on Windows; macOS and Linux
> are untested.

## Plugins

| Package | What it adds | Surface |
|---|---|---|
| [`dsh-todo`](plugins/dsh-todo) | Per-workspace todo list — a Todo tab backed by a host service | host + client |
| [`dsh-git`](plugins/dsh-git) | Source-control "Changes" tab — stage, diff, AI-commit, sync | host + client |
| [`dsh-weather`](plugins/dsh-weather) | Weather bar pinned in `shell.overlay` | client only |
| [`dsh-headless-plus`](plugins/dsh-headless-plus) | `--model`, `--resume`, `--continue`, `--session-info` for the headless app | CLI app |
| [`dsh-superpowers`](plugins/dsh-superpowers) | Injects the Superpowers methodology into every agent's system prompt | host |

### `dsh-todo`

Host service `dshTodo` owns one SQLite database per project at `<workspace>/.dsh/todo.db`, resolved through `workspaceRegistry`. The Todo tab reaches it over the Typert bridge. Endpoints: `dshTodo/list`, `dshTodo/replace`.

### `dsh-git`

Host service `dshGit` runs git in the workspace directory, serialises writes per repo root, and drafts commit messages through `llm`. Endpoints: `dshGit/status`, `diff`, `stage`, `commit`, `init`, `sync`, `suggestMessage`.

### `dsh-weather`

Pure consumer: fetches Open-Meteo straight from the browser and renders into the additive `shell.overlay` slot. No host service, no endpoints, no API key.

### `dsh-headless-plus`

Replaces the stock one-shot headless app:

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
```

### `dsh-superpowers`

Registers the [Superpowers](https://github.com/obra/superpowers) methodology bootstrap as a persistent system-prompt section — compaction-safe, replacing the upstream SessionStart hook that dsh has no shell for. Nothing is vendored: it reads `skills/using-superpowers/SKILL.md` from your own clone, located via `superpowersRoot`, then `SUPERPOWERS_ROOT`, then a probe of common clone paths under `$HOME`.

To have the clone's skills catalog update on a plain `git pull` rather than drifting as copies:

```bash
node scripts/link-superpowers-skills.mjs     # --dry-run to preview, --restore to undo
```

Each of `dsh-todo`, `dsh-git` and `dsh-weather` carries an `AGENTS.md` with its endpoints, mount row, dev loop and a verification recipe.

## Install on a new machine

### 1. Prerequisites

```bash
node --version     # 22+
pnpm --version     # 11+
npm i -g @deepseek-ai/dsh
dsh --version
```

The plugins declare their `@deepseek-ai/*` dependencies as **peers** and deliberately do not install their own copies — they resolve to the copies inside your global `dsh` install. That keeps one physical copy of `cordis` and `dsh-typert-protocol` in play, which is what step 4 wires up.

### 2. Clone and build

```bash
git clone https://github.com/dennisrongo/dsh-plugins.git
cd dsh-plugins
pnpm install
pnpm run build
pnpm run test
```

### 3. Install the plugins you want into a profile

A dsh profile is a folder with a `package.json` and a `cordis.patch.yml`. Install each plugin into the profile as a `file:` dependency, using a **native absolute Windows path with forward slashes** — the MSYS `/c/...` form fails with `LINKED_PKG_DIR_NOT_FOUND`:

```bash
# dsh CLI profile
cd ~/.dsh/profiles/web
pnpm add "file:C:/path/to/dsh-plugins/plugins/dsh-todo" \
         "file:C:/path/to/dsh-plugins/plugins/dsh-git" \
         "file:C:/path/to/dsh-plugins/plugins/dsh-weather"
```

For **DSH Desktop**, the same applies under its own home — `%APPDATA%\dsh-desktop\harness\profiles\<name>`. If that profile's `node_modules` was created by a different pnpm major, `pnpm add` refuses with `ERR_PNPM_UNEXPECTED_STORE`; edit the profile's `package.json` by hand instead and let step 4 supply the live module.

Then mount each one in the profile's `cordis.patch.yml`. **Every insert row needs both `id:` and `name:`** — a bare `id:` is an id-targeted override and silently does nothing:

```yaml
- insert:
    - id: dsh-weather
      name: '@dennisrongo/dsh-weather'
    - id: dsh-todo
      name: '@dennisrongo/dsh-todo'
    - id: dsh-git
      name: '@dennisrongo/dsh-git'
```

Restart the profile. One row mounts both halves of a plugin — the host service and the browser tab.

### 4. Wire up the dev loop

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-link.ps1 -Profiles web -DesktopProfiles web
```

This does two things, and **both are undone by any `pnpm install`**, so re-run it afterwards:

- Junctions each profile's `node_modules\@dennisrongo\<plugin>` at this repo, so a rebuild self-deploys. pnpm otherwise materialises `file:` deps as copies frozen at install time.
- Junctions each package's `node_modules\@deepseek-ai\*` at your global `dsh` install. A junctioned plugin resolves through its **real** path, so Node looks for dependencies here rather than in the profile — without this the harness dies at boot with `ERR_MODULE_NOT_FOUND`, and `pnpm typecheck` cannot resolve its types either.

The script only touches plugins a profile actually declares, and prints what it skipped. `-IdentityOnly` skips the profile junctions.

### 5. Verify

```bash
dsh --profile web --port 38111 --no-open        # capture the output; ERR_MODULE_NOT_FOUND here is a broken junction
curl -s -X POST http://127.0.0.1:38111/api/dshTodo/list -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"t1","method":"dshTodo/list","payload":{"args":{"request":{"workspaceId":"<id>"}}}}'
```

`200` with `"ok":true` means mounted. `404` means the package's `./typert` export was not registered — see the plugin's `AGENTS.md`. Workspace ids live in `~/.dsh/storages/workspace.json`.

## Development

One pnpm workspace:

```bash
pnpm install          # all packages
pnpm run build        # pnpm -r --if-present run build
pnpm run test         # pnpm -r --if-present run test
```

Client-half edits deploy on a **browser refresh**; host-half edits need a **profile restart**.

Workspace configuration lives in `pnpm-workspace.yaml` — pnpm 11 ignores `pnpm` blocks in `package.json`. Build permissions are `allowBuilds` (a map); the older `onlyBuiltDependencies` list is no longer read. `autoInstallPeers` is off because the `@deepseek-ai/*` peers are dev-preview and partly unpublished, so auto-install 404s against the registry.

One trap worth knowing: DSH Desktop runs a **profile-repair install** on startup that prunes this repo's per-package `node_modules` — which takes `zod` with it and makes the harness refuse to boot (`Cannot find package 'zod'`). Recovery is `pnpm install` at the root, then `scripts\dev-link.ps1`.

## Repository layout

```
plugins/     one self-contained package each (pnpm workspace members)
fixtures/    seed content for tests; not workspace packages
scripts/     dev-link.ps1                  — link the plugins into your profiles (Windows)
             link-superpowers-skills.mjs   — link an upstream superpowers clone's skills
```

`dsh-todo`, `dsh-git` and `dsh-weather` were consolidated here from standalone repos via subtree merge, so their original commits remain ancestors of `main`.

## License

MIT
