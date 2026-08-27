# AGENTS.md — @dennisrongo/dsh-todo

Per-workspace todo list for DeepSeek Harness. Two halves in one package:

- **Host** (`src/index.ts` → `lib/index.js`) — `TodoService extends TypertRemoteService`, cordis service key `dshTodo` (`super(ctx, 'dshTodo')`). Owns the durable list as one SQLite database per project at `<workspace>/.dsh/todo.db`, resolved through `workspaceRegistry`; migrates the legacy central `~/.dsh/storages/dsh_todo.json` on first read.
- **Client** (`src/client.tsx` → `lib/client.js`) — the Todo tab, calling the host over the Typert bridge as `ctx.remote.dshTodo.list(...)` / `.replace(...)`.

## Endpoints

- `POST /api/dshTodo/list` — `{ workspaceId }` → `{ list: { items, revision, updatedAt } }`
- `POST /api/dshTodo/replace` — `{ workspaceId, items, ifRevision }` → `ok:true` with the new list, or `ok:false, code:'revision-conflict'` when `ifRevision` is stale

Each takes exactly one parameter named `request`, and `wire: 'request'` in `src/remote.ts` must match it — the gateway resolves endpoints by reading parameter names off the function source.

`lib/typert.host.js`, exported as the `./typert` subpath, is what publishes these to the API gateway. **A package without that export is skipped silently**: the service still constructs, the tab renders, and every call 404s. The loader caches its per-package verdict for the process lifetime, so registration needs a full profile restart, not a refresh.

## Mounting

In each profile's `cordis.patch.yml`. **Both `id:` and `name:` are required** — a bare `id:` is an id-targeted override and silently no-ops:

```yaml
- insert:
    - id: dsh-todo
      name: '@dennisrongo/dsh-todo'
```

Works on both surfaces: the dsh CLI (`~/.dsh/profiles/<name>`) and DSH Desktop (`%APPDATA%\dsh-desktop\harness\profiles\<name>` — the desktop keeps its own DSH_HOME). Install per profile with `pnpm add "file:<repo>/plugins/dsh-todo"`, using a native forward-slash absolute Windows path; the MSYS `/c/...` form fails `LINKED_PKG_DIR_NOT_FOUND`.

## Dev loop

`pnpm install` at the monorepo root, then `pnpm run build` here (emits `lib/index.js`, `lib/client.js`, `lib/typert.host.js`) and `pnpm test` (offline; asserts against the **built** `lib/`, so build first).

Profiles materialise `file:` deps as copies **frozen at install time**, so a rebuild does not reach them. `scripts/dev-link.ps1` at the repo root replaces those copies with junctions: client-half edits then deploy on **browser refresh**, host-half edits need a **profile restart**.

**Re-run `scripts/dev-link.ps1` after any `pnpm install`.** It restores both the profile junctions and this package's `node_modules\@deepseek-ai\*` junctions to the CLI host copies. DSH Desktop's profile-repair install additionally empties this package's `node_modules`, taking `zod` with it, after which the harness refuses to boot with `Cannot find package 'zod' imported from ...\lib\index.js`. Fix: `pnpm install` at the monorepo root, then the script.

## Verification

```bash
# 1. identity — must print the %APPDATA%\npm host path, never a .pnpm store path
# run from this package folder
node -e "const{createRequire}=require('module'),{resolve}=require('path');console.log(createRequire(resolve('lib/index.js')).resolve('@deepseek-ai/cordis'))"

# 2. wire probe — 200 = mounted; 404 = the ./typert export is not registered
curl -s -X POST http://127.0.0.1:38111/api/dshTodo/list -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"t1","method":"dshTodo/list","payload":{"args":{"request":{"workspaceId":"<real-id>"}}}}'
```

Real workspace ids live in `~/.dsh/storages/workspace.json` under `tables.workspaces`. A healthy reply is `{"type":"server-response","result":{"ok":true,"value":{"list":{...}}}}`. Boot a scratch server with captured output (`dsh --profile web --port 38111 --no-open`) — an `ERR_MODULE_NOT_FOUND` there is a broken junction that a running server would swallow.
