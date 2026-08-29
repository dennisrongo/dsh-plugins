# AGENTS.md — dsh-plugins

Eleven plugins for DeepSeek Harness (dsh), one pnpm workspace. Each package under `plugins/`
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
plugins/dsh-mission-control host + client — fleet dashboard overlay, service key dshMissionControl
plugins/dsh-headless-plus CLI app      — --model/--resume/--continue
plugins/dsh-superpowers  host          — system-prompt section
plugins/dsh-skills       host          — skill provider over @dennisrongo/skills
plugins/dsh-theme        client + host — Themes settings page; four ctx.theme override
                         layers (palette/accent/font/scale) + an inlined first-paint
                         script. Bundles two OFL fonts as data URLs.
plugins/dsh-hooks        host          — Claude Code-compatible hook lifecycle, service
                         key dshHooks. Eight listeners over tools/*, agent/*,
                         subagent/end and approval/request; runs shell commands
                         through ctx.subprocess with an owned deadline.
plugins/dsh-plan-board   host + client — durable plans, service key dshPlans. Wraps the
                         exit_plan_mode dispatch; markdown files under
                         <workspace>/.dsh/plans + a shell.overlay review window
                         and a Plans history tab.
plugins/dsh-memory       host + client — /remember + instruction inspector, service key
                         dshMemory. Writes into the AGENTS.md hierarchy and
                         reports what dsh-agent-instructions' byte budget kept.
scripts/                 verify.mjs, anchor.mjs, check-type-scale.mjs, check-tokens.mjs,
                         link-superpowers-skills.mjs (all portable)
                         dev-link.ps1 (Windows: anchors + junctions into profiles)
```

Workspace globs are `plugins/*`, so anything added under `plugins/` becomes a package.

All are scoped `@dennisrongo/`; the first eight are published, and `dsh-hooks`,
`dsh-plan-board` and `dsh-memory` are not yet. The folder name is not the package name: a
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
- **A browser preference that must survive a DSH Desktop restart cannot live in
  `localStorage`.** The Desktop serves the UI from a new ephemeral port every launch, and an
  origin includes the port, so localStorage is empty on each start — this is what gave
  `dsh-mission-control` its host half. A host-owned cell is one answer; a **cookie** is the
  cheaper one, because cookies are not isolated by port (RFC 6265 §8.5) and need no host half
  at all. `dsh-theme` uses a cookie, with localStorage as a fallback. Anything inlined into
  the index for pre-paint work has to read the same store, or it will work on the CLI and
  fail on the Desktop.
- **A browser preference belongs in the browser, not the settings document.**
  `ctx.settingsScope.bind()` constructs its controller with
  `connection.isLoopback ? 'host' : 'memory'`, and a memory-mode scope's writes silently
  no-op — so a remote browser loses the preference with no error anywhere. The same gate
  inverts a related trap: `ui-theme`'s `ThemeRuntime.adopt()` resets the theme preference to
  the durable value on any settings-scope change, and the scope's mirror re-reads on ANY
  `settings/document-updated`, so a non-built-in `setTheme(id)` gets snapped back — but only
  on loopback, meaning it tests clean remotely and fails on localhost. `dsh-theme` avoids
  both by using token override layers and `localStorage`; see its `AGENTS.md`.
- **In `run_code`, only what you `return` or `console.log` reaches you.** A bare
  `await tools.skill({ name })` loads the skill and discards it — the result is
  `(run_code completed with no output)` and the content never enters context. Return or
  print the value. And never probe the filesystem for skill files (`~/.claude/skills`,
  `~/.agents/skills`) instead of calling the `skill` tool: the provider root is the
  authoritative location, and a guessed path is a prior, not a fact. (Grok 4.6 hit both in
  one turn: fire-and-forget skill loads, then a glob of the wrong hardcoded path.)

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
namespaced per plugin (`dshtd-`, `dshgit-`, `dshwx-`, `dshmc-`, `dshth-`). Clickable controls
are real `<button>`s. Keep accessibility affordances that are already there — they are
deliberate.

**Every `var(--dsw-*)` must name a token the harness actually defines.** A misspelt one
never errors: CSS falls back to the second argument, so it renders a plausible colour forever
and silently stops following the theme. Ten such references were shipped across three plugins
before this was checked — `state-warning-primary` (real: `state-warn-primary`),
`state-info-primary` (`state-business-primary`), `label-on-accent`
(`label-primary-foreground`), `bg-l1` (`bg-layer-1`), `font-mono`/`font-family-mono`
(`--ds-font-family-code`, so git diffs and mission-control's tool output never followed the
code font), and `border-focus`, which does not exist at all.
`node scripts/check-tokens.mjs` enforces it against the installed harness's own stylesheet,
and skips when no dsh is installed. Define your own custom properties with a plugin prefix
(`--td-`, `--mc-`, `--dshth-`) — those are ignored by the check.

**Never gate a plugin's palette on `prefers-color-scheme`.** That follows the OS, not the
app, so a light theme on a dark-mode machine renders dark. `ui-layout`'s ThemePresenter sets
`documentElement.style.colorScheme` from the resolved theme and toggles
`body[data-ds-dark-theme]` — key off those. `dsh-todo` carried the OS query for both its
select popups and its option rows, with a comment asserting the shell "never sets a
color-scheme to inherit from", which was simply untrue.

**One type scale across every plugin: 11 / 12 / 13 / 14 / 16 / 20 / 24 px.** Those are the
sizes the harness's own typography tokens define, so a plugin on this ladder matches the
shell it renders inside. `node scripts/check-type-scale.mjs` enforces it over every
`plugins/*/src` file; it runs from the root `test` script and the pre-commit hook.

Use literal px, not `font: var(--dsw-font-*)`. Counter-intuitive, but measured: the harness
sets `font-size` literally in **305** places and through a token in **44**, so the tokens are
not what dsh's own UI follows — matching the values is what buys visual consistency, and
`dsh-todo`'s size probe greps for literals. Line-height is deliberately NOT checked; it stays
tuned per layout, and is the lever for density.

State a derived step as its own custom property; never `calc()` one off another. Arithmetic on
a scale step lands between rungs by construction (`11px - 1px` = 10px), and the checker rejects
`font-size: calc(...)` for that reason. It also resolves one level of `var()`, because the
first version of this rule only read the literal at the `font-size:` declaration and missed
four sizes parked in custom properties. Nothing stops a plugin drifting on its own, which is exactly what happened:
`dsh-mission-control` had grown to 9–15px with half-pixel steps (10.5, 11.5, 12.5) and read
as a different application beside dsh's chrome.
