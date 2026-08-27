# AGENTS.md — @dennisrongo/dsh-git

Source-control ("Changes") tab for DeepSeek Harness. Two halves in one package:

- **Host** (`src/index.ts` → `lib/index.js`) — `GitService extends TypertRemoteService`, cordis service key `dshGit`. Runs git in the workspace directory resolved through `workspaceRegistry`, serialises writes per repo root, and drafts commit messages through `llm`. A directory that is not a repository reports `repo: false`, never an error.
- **Client** (`src/client.tsx` → `lib/client.js`) — the Changes tab, CSS prefix `dshgit-`, calling the host over the Typert bridge as `ctx.remote.dshGit.*`.

## Endpoints

`POST /api/dshGit/<method>`, each taking one parameter named `request`:

- `status` — `{ workspaceId }` → branch, head, unborn, upstream, hasRemote, files, recent
- `diff` — `{ workspaceId, path?, staged? }` → `{ patch, binary }`; untracked files are synthesized into a `/dev/null` patch so a new file never renders a blank pane
- `stage` — `{ workspaceId, paths, ... }`, `commit` — `{ workspaceId, message, all? }`, `init` / `sync` — `{ workspaceId, ... }`, all → `{ ok, output }`
- `suggestMessage` — AI-drafted commit message

`wire: 'request'` in `src/remote.ts` must match the host parameter name — the gateway resolves endpoints by reading parameter names off the function source.

`lib/typert.host.js`, exported as the `./typert` subpath, is what publishes these to the API gateway. **Without it the package is skipped silently**: the service constructs, the tab renders, every call 404s. The loader caches its per-package verdict for the process lifetime, so registration needs a full profile restart.

## Mounting

**Self-mounting.** `package.json` declares `dsh.bundle.patch` pointing at this package's own
`cordis.patch.yml`, which carries the insert row:

```yaml
- insert:
    - id: dsh-git
      name: '@dennisrongo/dsh-git'
```

`dsh plugin add` appends the package to the profile's `dsh.profile.bundles` and that row composes
automatically. **Do not also add an `insert:` row to the profile's `cordis.patch.yml`** — a second
row with the same id is fatal: `duplicate loader entry id: dsh-git`. A bare `id:` entry there is
still the right way to *configure* the row.

Works on both surfaces: the dsh CLI (`~/.dsh/profiles/<name>`) and DSH Desktop (`%APPDATA%\dsh-desktop\harness\profiles\<name>` — the desktop keeps its own DSH_HOME). Install per profile with `pnpm add "file:<repo>/plugins/dsh-git"`, using a native forward-slash absolute Windows path; the MSYS `/c/...` form fails `LINKED_PKG_DIR_NOT_FOUND`.

## Dev loop

`pnpm install` at the monorepo root, then `pnpm run build` here (emits `lib/index.js`, `lib/client.js`, `lib/typert.host.js`, plus the gitignored `client.body.cjs` and `client.test.mjs`). The three real artifacts are **committed** so a GitHub subdirectory install works — rebuild and commit them when you change `src/`. `pnpm test` runs build + `smoke.mjs` + `host-ops.mjs`.

Profiles materialise `file:` deps as copies **frozen at install time**, so a rebuild does not reach them. `scripts/dev-link.ps1` at the repo root replaces those copies with junctions: client-half edits then deploy on **browser refresh**, host-half edits need a **profile restart**.

**Re-run `scripts/dev-link.ps1` after any `pnpm install`.** It restores both the profile junctions and this package's `node_modules\@deepseek-ai\*` junctions to the CLI host copies. DSH Desktop's profile-repair install additionally empties this package's `node_modules`, taking `zod` with it, after which the harness refuses to boot with `Cannot find package 'zod' imported from ...\lib\index.js`. Fix: `pnpm install` at the monorepo root, then the script.

`pnpm run test:commit` drives headless Chrome against a live harness, clicks the **first session row**, stages and commits, then asserts the repository on disk actually advanced. It provisions its own scratch tree at `%TEMP%\dsh-git-tree`, seeded from `fixtures/dsh-git-tree` (override with `DSH_REPO`). That path is stable rather than per-run because dsh-git acts on the workspace of the clicked session — add it as a workspace in dsh once, and make sure its session is the first row.

## Verification

```bash
# 1. identity — must print the %APPDATA%\npm host path, never a .pnpm store path
# run from this package folder
node -e "const{createRequire}=require('module'),{resolve}=require('path');console.log(createRequire(resolve('lib/index.js')).resolve('@deepseek-ai/dsh-typert-protocol'))"

# 2. wire probe — 200 = mounted; 404 = the ./typert export is not registered
curl -s -X POST http://127.0.0.1:38111/api/dshGit/status -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"t1","method":"dshGit/status","payload":{"args":{"request":{"workspaceId":"<real-id>"}}}}'
```

Real workspace ids live in `~/.dsh/storages/workspace.json` under `tables.workspaces`. A healthy reply is `{"type":"server-response","result":{"ok":true,"value":{"status":{"repo":true,...}}}}`. Boot a scratch server with captured output (`dsh --profile web --port 38111 --no-open`) — an `ERR_MODULE_NOT_FOUND` there is a broken junction that a running server would swallow.
