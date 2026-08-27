# AGENTS.md — dsh-plugins

Five plugins for DeepSeek Harness (dsh), one pnpm workspace. Each package under `plugins/`
is self-contained: its own `package.json`, exports map, build and tests. Per-package
`AGENTS.md` files cover endpoints and verification; this file covers the repo.

Two supported surfaces, and a change to dependency resolution must be checked on both: the
`dsh` CLI, and [DSH Desktop](https://dshdesktop.com/) — a community desktop wrapper (Windows
and macOS) that bundles its own harness copy and keeps its own `DSH_HOME`.

Read `README.md` for what each plugin does and how to install it. Read the package's own
`AGENTS.md` before changing that package.

## Layout

```
plugins/dsh-todo         host + client — Todo tab, service key dshTodo
plugins/dsh-git          host + client — Changes tab, service key dshGit
plugins/dsh-weather      client only   — shell.overlay weather bar
plugins/dsh-headless-plus CLI app      — --model/--resume/--continue (UNSCOPED name)
plugins/dsh-superpowers  host          — system-prompt section (UNSCOPED name)
fixtures/                seed content for tests; NOT workspace packages
scripts/                 dev-link.ps1 (Windows), link-superpowers-skills.mjs (portable)
```

Workspace globs are `plugins/*`, so anything added under `plugins/` becomes a package and
anything under `fixtures/` does not.

## Commands

```bash
pnpm install                    # at the ROOT, always
pnpm run build                  # pnpm -r --if-present run build
pnpm run test                   # pnpm -r --if-present run test
pnpm --filter @dennisrongo/dsh-todo run build     # one package
```

`dsh-git` does not commit its `lib/`, and every package's tests assert against **built**
output. Build before testing or installing, or you are testing a stale bundle.

## Rules that are not obvious

- **Build permissions live in `pnpm-workspace.yaml` under `allowBuilds` (a map).** pnpm 11
  ignores `pnpm` blocks in `package.json`, and the older `onlyBuiltDependencies` list is no
  longer read. Without `allowBuilds: {esbuild: true}` the install fails
  `ERR_PNPM_IGNORED_BUILDS` and esbuild never fetches its binary.
- **`autoInstallPeers` is off, deliberately.** The `@deepseek-ai/*` peers are dev-preview and
  partly unpublished; auto-install resolves them against the registry and 404s the install.
  They are supplied at runtime by `scripts/dev-link.ps1`, never by this workspace.
- **Declare what you import.** A junctioned plugin resolves through its REAL path, so the
  profile's hoisted tree is off the resolution path entirely. An undeclared runtime import
  works locally by accident and dies on a fresh install — this has already happened twice
  here (`commander` declared as a devDependency; `@deepseek-ai/schemastery` not declared at
  all). Declare `@deepseek-ai/*` as peers and everything else as dependencies, then re-run
  `dev-link.ps1`, which derives what to anchor from the manifest and the tsconfig.
- **`tsconfig.json` `paths` point at `./node_modules/@deepseek-ai/...`**, not at an absolute
  path. Those entries only exist after `dev-link.ps1` runs; typecheck failing with
  `TS2307: Cannot find module '@deepseek-ai/...'` means run the script, not add a stub.
- **Insert rows need both `id:` and `name:`.** A bare `id:` is an id-targeted override of an
  existing row and silently no-ops — the plugin appears installed and never loads.
- **A host service publishes its endpoints through a `./typert` subpath export.** Without it
  the loader skips the package *silently*: the service constructs, the tab renders, and
  every `/api` call 404s. The loader caches its verdict per process, so adding one requires a
  full profile restart.
- **Line endings are pinned to LF** by the root `.gitattributes` (`.ps1` excepted).
  `lib/client.js` is served byte-for-byte to the browser and asserted on by the smoke tests,
  so letting git rewrite them per-platform would change what ships.

## Dev loop

Profiles materialise `file:` dependencies as copies frozen at install time, so a rebuild
here does not reach a profile. `scripts/dev-link.ps1` replaces those copies with junctions
and anchors each package's `@deepseek-ai/*` at the dsh CLI install:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-link.ps1 -Profiles web -DesktopProfiles web
```

Then client-half edits deploy on a **browser refresh** and host-half edits on a **profile
restart**. **Re-run the script after ANY `pnpm install`** — pnpm replaces junctions with
copies. DSH Desktop additionally runs a profile-repair install on startup that prunes this
repo's per-package `node_modules`, taking `zod` with it; the harness then refuses to boot
with `Cannot find package 'zod'`. Recovery is `pnpm install` at the root, then the script.

## Verifying a change

Do not trust a green `pnpm test` as evidence the harness works — it only proves this repo's
`lib/` is self-consistent. For anything touching a host half:

1. **Resolution** — from the package folder, confirm `@deepseek-ai/*` resolves to the dsh
   CLI install and never a `.pnpm` store path:
   ```bash
   node -e "const{createRequire}=require('module'),{resolve}=require('path');console.log(createRequire(resolve('lib/index.js')).resolve('@deepseek-ai/cordis'))"
   ```
2. **Boot** — run a scratch server with captured output:
   `dsh --profile web --port 38111 --no-open`. An `ERR_MODULE_NOT_FOUND` here is a broken
   junction that a *running* server would swallow.
3. **Wire** — POST the plugin's endpoint (shape in its `AGENTS.md`). `200` = mounted;
   `404` = the `./typert` export is not registered.
4. **UI** — open the web UI and confirm the tab renders and its `/api` calls return `200`.
   `Promise.allSettled` in the client swallows failures, so a tab can render while every
   call fails.

Both surfaces need checking when resolution changes: the CLI, and DSH Desktop with its own
`DSH_HOME`.

## Conventions

Commits use `feat:` / `fix:` / `docs:` / `chore:` prefixes. JSDoc on exported functions,
explaining *why* where the reason is not obvious from the signature. Client CSS classes are
namespaced per plugin (`dshtd-`, `dshgit-`, `dshwx-`). Clickable controls are real
`<button>`s. Keep accessibility affordances that are already there — they are deliberate.
