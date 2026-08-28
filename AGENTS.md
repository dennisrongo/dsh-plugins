# AGENTS.md — dsh-plugins

Seven plugins for DeepSeek Harness (dsh), one pnpm workspace. Each package under `plugins/`
is self-contained: its own `package.json`, exports map, build and tests. Per-package
`AGENTS.md` files cover endpoints and verification; this file covers the repo.

Two supported surfaces, and a change to dependency resolution must be checked on both: the
`dsh` CLI, and [DSH Desktop](https://dshdesktop.com/) — a community desktop wrapper (Windows
and macOS) that bundles its own harness copy and keeps its own `DSH_HOME`.

Read `README.md` for what each plugin does and how to install it. Read the package's own
`AGENTS.md` before changing that package. `TROUBLESHOOTING.md` covers harness-level failures
that are not this repo's code — corrupt session logs, hidden history, registry edits that
revert — and they are silent, so recognising them matters more than debugging them.

## Layout

```
plugins/dsh-todo         host + client — Todo tab, service key dshTodo
                         + CLI     — bin dsh-todo, same list from a terminal
plugins/dsh-git          host + client — Changes tab, service key dshGit
                         live-updating: fs.watch + a changeToken poll
plugins/dsh-weather      client only   — shell.overlay weather bar
plugins/dsh-mission-control client only — shell.overlay fleet dashboard
plugins/dsh-headless-plus CLI app      — --model/--resume/--continue
plugins/dsh-superpowers  host          — system-prompt section
plugins/dsh-skills       host          — skill provider over @dennisrongo/skills
scripts/                 verify.mjs, anchor.mjs, link-superpowers-skills.mjs (portable)
                         dev-link.ps1 (Windows: anchors + junctions into profiles)
```

Workspace globs are `plugins/*`, so anything added under `plugins/` becomes a package.

All seven are scoped `@dennisrongo/` and published. The folder name is not the package name: a
`cordis.patch.yml` row takes the **package** name (`@dennisrongo/dsh-superpowers`), while the
folder stays `plugins/dsh-superpowers`. Keep the scope: the bare `dsh-superpowers` on npm is
an unrelated plugin by another author, and unscoped generic names in this space get taken.

## Commands

```bash
pnpm install                    # at the ROOT, always
pnpm run build                  # pnpm -r --if-present run build
pnpm run test                   # pnpm -r --if-present run test
pnpm --filter @dennisrongo/dsh-todo run build     # one package
```

Every package commits its built `lib/` — that is what makes a GitHub subdirectory install
work, since a git install runs no build step. Rebuild and commit `lib/` whenever you change
`src/`. Tests also assert against **built** output, so build before testing or you are
testing a stale bundle.

## Rules that are not obvious

- **Never point `DSH_HOME` at a home another harness is already using.** Sessions live at
  `$DSH_HOME/sessions/`, a sibling of `profiles/`, so a different `--profile` isolates
  nothing. Two harnesses on one home allocate session `seq` numbers independently and corrupt
  whatever sessions the other has open — silently, across workspaces, surfacing only at a
  later restart. It is a race, so getting away with it once proves nothing. To read from a
  running harness, POST its own `/api/<method>`; to run your own, use a throwaway `DSH_HOME`.
  Nothing upstream prevents this. See
  [TROUBLESHOOTING.md](TROUBLESHOOTING.md#never-run-two-harnesses-against-one-home).
- **Build permissions live in `pnpm-workspace.yaml` under `allowBuilds` (a map).** pnpm 11
  ignores `pnpm` blocks in `package.json`, and the older `onlyBuiltDependencies` list is no
  longer read. Without `allowBuilds: {esbuild: true}` the install fails
  `ERR_PNPM_IGNORED_BUILDS` and esbuild never fetches its binary.
- **`autoInstallPeers` is off, deliberately.** The `@deepseek-ai/*` peers are dev-preview and
  partly unpublished; auto-install resolves them against the registry and 404s the install.
  They are supplied by `scripts/anchor.mjs` (portable) — or `dev-link.ps1`, which delegates to
  it — never by this workspace.
- **Declare what you import.** A junctioned plugin resolves through its REAL path, so the
  profile's hoisted tree is off the resolution path entirely. An undeclared runtime import
  works locally by accident and dies on a fresh install — this has already happened twice
  here (`commander` declared as a devDependency; `@deepseek-ai/schemastery` not declared at
  all). Declare `@deepseek-ai/*` as peers and everything else as dependencies, then re-run
  `scripts/anchor.mjs`, which derives what to anchor from the manifest and the tsconfig.
- **`tsconfig.json` `paths` point at `./node_modules/@deepseek-ai/...`**, not at an absolute
  path. Those entries only exist after `scripts/anchor.mjs` runs; typecheck failing with
  `TS2307: Cannot find module '@deepseek-ai/...'` means run it, not add a stub.
- **Every package is a BUNDLE and self-mounts.** `dsh.bundle.patch` points at the package's own
  `cordis.patch.yml`, and `dsh plugin add` appends the package to the profile's
  `dsh.profile.bundles`. Never also put an `insert:` row in a profile for one of these — a second
  row with the same id is fatal: `duplicate loader entry id: <id>`. Ship `cordis.patch.yml` in
  `files` or the bundle resolves to nothing.
- **Insert rows need both `id:` and `name:`.** A bare `id:` is an id-targeted override of an
  existing row — which is how you *configure* a bundle's row from a profile, and also why a
  typo'd `name:` silently no-ops instead of failing.
- **A host service publishes its endpoints through a `./typert` subpath export.** Without it
  the loader skips the package *silently*: the service constructs, the tab renders, and
  every `/api` call 404s. The loader caches its verdict per process, so adding one requires a
  full profile restart.
- **A polled endpoint must not trigger the work it is polling for.** `dsh-git`'s
  `changeToken` lets the Changes tab stay live without re-running git every second; the
  moment it shells out it costs what `status` costs (141 ms vs 52 ms measured) and the
  design is pointless. The subtler trap is a filter that lets the *reader's own* side
  effects through — merely reading a repo touches `.git/objects`, so a denylist made the
  tab wake itself forever on an idle repository. Allowlist what matters instead.
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
`lib/` is self-consistent. `scripts/verify.mjs` automates the ladder below and is the first
thing to run after a dsh upgrade:

```bash
node scripts/verify.mjs                  # static: versions, resolution, deps, entry points
node scripts/verify.mjs --port=38111     # adds live /api probes against a running profile
```

It exits non-zero on failure, and it deliberately does NOT import a client half — those are
browser bundles wrapped in `window.__ModuleLoader__.load`, so importing one under Node fails
by design; it validates the wrapper and the loader id instead. Done by hand, the ladder is:

1. **Resolution** — from the package folder, confirm `@deepseek-ai/*` resolves to the dsh
   CLI install and never a `.pnpm` store path:
   ```bash
   node -e "const{createRequire}=require('module'),{resolve}=require('path');console.log(createRequire(resolve('lib/index.js')).resolve('@deepseek-ai/cordis'))"
   ```
2. **Boot** — run a scratch server with captured output:
   `dsh --profile web --port 38111 --no-open`. An `ERR_MODULE_NOT_FOUND` here is a broken
   junction that a *running* server would swallow. Leave `DSH_HOME` alone: a scratch server
   on the Desktop's home corrupts the sessions the Desktop has open.
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
