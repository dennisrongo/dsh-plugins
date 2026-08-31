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
scripts/                 verify.mjs, anchor.mjs, host-deps.mjs, check-type-scale.mjs,
                         check-tokens.mjs, check-context.mjs, check-progress.mjs,
                         link-superpowers-skills.mjs (all portable)
                         dev-link.mjs (entry point; the root postinstall runs it)
                         -> dev-link.ps1 (Windows) / dev-link.sh (macOS/Linux):
                            anchors + junctions into profiles
```

Workspace globs are `plugins/*`, so anything added under `plugins/` becomes a package.

All eleven are scoped `@dennisrongo/` and published. The folder name is not the package name: a
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

**A cordis context is a Proxy, and reading an undeclared service THROWS.** Inside a
plugin fiber, `ctx.sessions` for a service not in that plugin's `inject` array raises
`cannot get property "sessions" without inject` — it does not return `undefined`. Every
client half's smoke test renders against plain **stub objects**, and a stub answers a
missing key with `undefined`, so this entire class of bug is invisible to them.
`dsh-todo` shipped it: an unguarded optional read threw inside the `conversation.view`
slot's `inject` callback, no store reached the view, and every task vanished from a tab
that still drew its own header — with four green suites and two green browser probes.
Guard an optional read with try/catch (`ctx.get(name)` is the safe probe and yields
`undefined`), or declare the service. **A service whose name contains a dot is reachable
ONLY as `ctx['remote.foo']` — it is never a key on the parent, so `ctx.remote.foo` is
permanently `undefined` however the deployment is composed.** That one cost a second
shipped bug: `dsh-todo`'s launch button gated on `ctx.remote?.agentPresets` and stayed
invisible on a harness that had the service loaded the whole time. Reading it that way
fails CLOSED and silently. An earlier version of this very paragraph asserted the
opposite, and the test pinning it only exercised the ABSENT case, so it passed while
encoding the wrong rule — a test must exercise the shape that actually exists.

**And `ctx.remote` is itself a Proxy, so `ctx.remote?.foo` is NOT a safe optional read —
it THROWS.** Optional chaining guards against a nullish `remote`, never against a proxy
trap on the property. That emptied the Todo tab a SECOND time, from a
`?? ctx.remote?.agentPresets` fallback that existed only as belt-and-braces behind an
already-correct guarded read. **Stub every service object as a throwing Proxy, not a plain
object** — letting symbols through, since cordis probes its own tracker symbols — because a
plain-object stub answers `undefined` and cannot fail. And a check must NOT provide an
optional service whose absence it exists to test: `check-context.mjs` supplied
`remote.agentPresets` unconditionally and so could never see the throw.
**And a service that RESOLVES is not one you can CALL** — a third, distinct failure.
`modelDirectories.directoryFor()` runs `this.ctx.remote.session` inside
`dsh-client-ui-model-selection`, under a proxy bound to the CALLING fiber, so a plugin
that never declared `remote.session` gets a service that probes present from every guard
(`ctx.get`, the namespaced read, a stored handle) and throws on the first method call —
naming a service its own source never mentions. Guarding the READ cannot catch it: the
throw happens inside the callee. `dsh-todo` shipped it as outage number three. Wrap a
borrowed handle ONCE at the boundary so it degrades to `undefined`
(`safeModelDirectories`), rather than guarding each call site — the raw handle travelled
to two of them, and `dsh-mission-control` survived only because it had already wrapped
both of its own `directoryFor` calls in `try`/`catch`.

`node scripts/check-context.mjs` mounts every built client bundle on a REAL `Context`
with only its declared services and calls each registered slot's `inject` callback — the
deferred path where the failure actually lands. It then CALLS the borrowed handles that
callback returns, since returning one proves only that it exists, and it provides the
optional root services (`sessions`, `modelDirectories`, `uiWorkspace`) a plugin reads
without declaring — a matrix where those are all absent structurally cannot reach a
present-but-uncallable method. It runs LAST in `pnpm test` because it
reads built `lib/`, and it fails a plugin that registers zero slots, because a check that
exercised nothing must not report a pass.

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

**One loading rule across every plugin, and it is a RULE, not a style.** `dsh-git` does not
have a single loading treatment — it picks one by surface size, and the others copy that
decision rather than the pixels:

| Surface | Treatment |
|---|---|
| Large content pane | a skeleton shaped like the real content |
| List row, menu, small pane | a dim caption row — 12px on a 20px line, tertiary tone |
| Inside a button | a spinner **beside** the retained label |

Reaching for the wrong rung is the common mistake in both directions. A centred spinner
blanks a large pane, which is why `dsh-git`'s diff pane grew `DiffSkeleton`; and a skeleton
in `dsh-weather`'s ~200px pill would be heavier than the seven words it replaced, so that one
stays text. A spinner never *replaces* a label — swapping `Send` for `…` loses the verb and
resizes the button mid-flight.

Three invariants make a skeleton correct rather than merely present, and
`node scripts/check-progress.mjs` enforces all three from the root `test` script and the
pre-commit hook:

- **Geometry is copied from the real content**, never a round number — the row's own padding,
  line box and gaps — so the swap to real content does not lurch.
- **The sweep animates `background-position` over an oversized gradient**, never `transform`,
  `width`, `height` or `opacity`. Those either reflow or move the bar relative to the text it
  stands in for, which is the lurch the skeleton exists to prevent. Bar heights are box
  dimensions stated directly, so they are exempt from the type scale — but never `calc()` one
  off a font size, for the same between-the-rungs reason as above.
- **`prefers-reduced-motion` flattens the bars to a flat tone.** The skeleton still says
  "loading" by being there; the sweep is the optional part.

Accessibility rides along and is checked too: the skeleton root is a `role="status"`
live region announced once, and every decorative bar is `aria-hidden` — otherwise a screen
reader narrates a dozen empty rows instead of one status line.

**Loading must be its OWN flag, never inferred from an empty collection.** `dsh-plan-board`
rendered "No plans yet" during every read, because `plans.length === 0` means both "this
workspace has none" and "we have not looked". That is a false claim about the user's
workspace, and it sent them looking for a plan the tab had simply not fetched yet. Arm the
flag where the fetch happens, not at the top of the component: started `true`, it strands the
tab on a skeleton forever in the deployments where the fetch early-returns — no host half, or
no workspace open — which are exactly the cases the empty states exist to explain.

The checker was verified by **sabotage before it was trusted** — drifting the shimmer timing,
animating a transform, deleting the reduced-motion branch, dropping `role="status"`,
un-hiding the decorative rows, and knocking the caption row off its rung each fail it. A
check that has never failed is decoration.
