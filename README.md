# dsh-plugins

Dennis Rongo's plugin collection for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) — an MIT agent harness where every capability is a plugin.

Everything here is built on the harness's public seams: cordis service keys, the Typert host/client bridge, `shell.*` slots, the system-prompt section registry, and `ctx.cmdlineArgs`. No forks, no patched launcher, no vendored harness code.

**Both surfaces are supported.** Every plugin runs unchanged under the `dsh` CLI *and* under **[DSH Desktop](https://dshdesktop.com/)** — a community desktop wrapper that ships the harness pre-packaged with multi-provider model support ("Any model, zero setup"), for Windows and macOS. It is an independent project, not affiliated with DeepSeek.

The desktop keeps its own `DSH_HOME` (`%APPDATA%\dsh-desktop\harness` on Windows) with its own profiles, so you install a plugin once per profile on whichever surface you use. Nothing here is CLI-specific: the same package, the same `cordis.patch.yml` row, and the same `/api` endpoints serve both.

> **Status:** developed against dsh `0.1.1-rc.2`. dsh is a fast-moving `0.1.x` dev preview that promises breaking changes — re-verify against your installed version.
>
> **Platforms:** the plugins are plain Node and platform-agnostic, and DSH Desktop ships for Windows and macOS, so they should run on either. The tooling is portable — `verify.mjs`, `anchor.mjs`, `link-superpowers-skills.mjs` are plain Node, and profile live-linking has a script per platform (`dev-link.ps1` on Windows, `dev-link.sh` on macOS/Linux) behind one `dev-link.mjs` entry point. Everything here has been exercised on Windows against both the CLI and DSH Desktop; macOS and Linux are untested.

## Plugins

| Package | npm | Adds | Halves | Endpoints |
|---|---|---|---|---|
| [`dsh-todo`](plugins/dsh-todo) | [npm](https://www.npmjs.com/package/@dennisrongo/dsh-todo) | per-workspace sprint/roadmap task list, plus a `dsh-todo` CLI | host + client + CLI | `dshTodo/list`, `replace` |
| [`dsh-git`](plugins/dsh-git) | [npm](https://www.npmjs.com/package/@dennisrongo/dsh-git) | source-control tab — changes, history, branches, stash, worktrees | host + client | `dshGit/status`, `diff`, `commitFiles`, `commitDiff`, `stage`, `commit`, `init`, `sync`, `suggestMessage`, `changeToken`, `refs`, `branch`, `merge`, `stash`, `worktree`, `suggestBranch` |
| [`dsh-weather`](plugins/dsh-weather) | [npm](https://www.npmjs.com/package/@dennisrongo/dsh-weather) | weather bar in the shell overlay | client only | — |
| [`dsh-headless-plus`](plugins/dsh-headless-plus) | [npm](https://www.npmjs.com/package/@dennisrongo/dsh-headless-plus) | `--model` / `--resume` / `--continue` for the headless app | CLI app | — |
| [`dsh-superpowers`](plugins/dsh-superpowers) | [npm](https://www.npmjs.com/package/@dennisrongo/dsh-superpowers) | Superpowers methodology as a system-prompt section | host | — |
| [`dsh-skills`](plugins/dsh-skills) | [npm](https://www.npmjs.com/package/@dennisrongo/dsh-skills) | the [`@dennisrongo/skills`](https://www.npmjs.com/package/@dennisrongo/skills) library as an installable skill catalog | host | — |
| [`dsh-mission-control`](plugins/dsh-mission-control) | [npm](https://www.npmjs.com/package/@dennisrongo/dsh-mission-control) | fleet dashboard overlay — sessions, swarm tree, token burn, permission inbox, pomodoro timer | host + client | `dshMissionControl/load`, `save` |
| [`dsh-theme`](plugins/dsh-theme) | [npm](https://www.npmjs.com/package/@dennisrongo/dsh-theme) | twelve themes, eight accents, contrast and scale sliders, and three fonts with two bundled, live preview | client + tiny host | — |
| [`dsh-hooks`](plugins/dsh-hooks) | [npm](https://www.npmjs.com/package/@dennisrongo/dsh-hooks) | Claude Code-compatible hook lifecycle — shell commands at eight lifecycle points | host | `dshHooks/describe`, `recent` |
| [`dsh-plan-board`](plugins/dsh-plan-board) | [npm](https://www.npmjs.com/package/@dennisrongo/dsh-plan-board) | durable plans — captures every `exit_plan_mode` plan to disk, opens a review window, keeps the history | host + client | `dshPlans/list`, `get`, `changeToken`, `remove` |
| [`dsh-memory`](plugins/dsh-memory) | [npm](https://www.npmjs.com/package/@dennisrongo/dsh-memory) | `/remember` into the AGENTS.md hierarchy, plus a tab showing which instruction files the loader kept | host + client | `dshMemory/inspect`, `remember`, `read` |

---

### `dsh-todo`

A task tab scoped to the workspace you're working in, so each project keeps its own backlog instead of one global pile. It is a **sprint/roadmap list, not a checklist**: each task carries a status, a priority, and optional release and sprint labels.

**What you get.** A tab beside Chat and Trajectory. Tasks move through real workflow states — `backlog · todo · in-progress · blocked · done` — changed from a pill on the row, because a boolean can't express the two things a standup actually asks: what is moving, and what is stuck. Priority is `P0`–`P3` as a chip, with only P0/P1 coloured so the list flags what's urgent instead of turning into a rainbow. **Release** (`1.5` or `0.5.1`, what ships together) and **sprint** (`24`, when it's worked) are deliberately separate numeric axes — a release takes up to three numbers so a patch gets its own label, a sprint is a single decimal, neither admits alpha, and they sort by version semantics (`1.10` above `1.9`) with no releases table to administer. **Group by** None · Status · Release · Sprint · Priority gives collapsible sections with their own progress bars; grouping by status is a kanban board without drag-and-drop. Clicking a title opens a **task detail modal** (description, status, priority, labels, due date) where **Done is the save** — the only control that refuses to proceed on an invalid label, while Esc, the backdrop and the X always let you out and discard it; the chevron still gives a cheap in-row peek, and double-click renames inline. Due dates are stored as **calendar days**, so "due the 14th" reads as the 14th in every timezone; overdue is flagged red, due-today amber. Completed work is **archived, not deleted** — an item carries an optional `archivedAt` stamp whose *presence* is the archived state, so there's one source of truth and no way to store an archived item without a date. Every irreversible action goes through a confirmation dialog that quotes the task by name.

**CLI.** The package ships a `dsh-todo` binary so an AI agent can shell out and manage the same list you see in the tab — no profile, no session, no running server:

```bash
npx dsh-todo list --open --json
npx dsh-todo add "Fix token refresh" --priority p0 --release 1.5 --due 2026-03-14
npx dsh-todo update t1a2 --status in-progress --sprint 24
npx dsh-todo done t1a2 && npx dsh-todo archive
```

It targets a workspace **directory** (`--workspace`, default cwd) and talks to the same SQLite file the host uses, which is safe by construction: SQLite's file lock refuses a writer that lands inside another process's transaction, and the CLI sets a `busy_timeout` so it waits for the harness to commit rather than failing. Verified live — the CLI wrote while a running server held its handle and the API returned the new task with no restart. Ids accept any unambiguous prefix, an empty value clears a field (`--release ""`), and invalid values are refused rather than dropped — nothing is written. Every `--json` payload leads with `ok`, so an agent never infers the verdict from the shape: success carries the stored task back for confirmation, and a refusal carries `field`, `expected` and `got` alongside the message. Exit codes are distinct: `0` ok, `2` usage, `3` not found.

**How it works.** `TodoService extends TypertRemoteService` registers under the cordis key `dshTodo` and owns one SQLite database per project at `<workspace>/.dsh/todo.db`, resolved through `workspaceRegistry`. Writes use optimistic concurrency: every `replace` states the `revision` it observed, and the host rejects a stale write with `ok:false, code:'revision-conflict'` and the current list, rather than silently clobbering. A legacy central `~/.dsh/storages/dsh_todo.json` is migrated on first read.

**Endpoints.** `POST /api/dshTodo/list` → `{ list: { items, revision, updatedAt } }`; `POST /api/dshTodo/replace` → the new list or a revision conflict. Both take a single parameter named `request`.

The task shape is `{ id, title, description?, status, priority, release?, sprint?, dueDate?, createdAt, completedAt?, archivedAt? }`. `status` is the source of truth — there is no separate `done` flag to fall out of sync — and only the status transition writes `completedAt`. Absent optional fields are absent *keys*, never `''`. Existing v1 databases are migrated **in place** on first open: `CREATE TABLE IF NOT EXISTS` doesn't add columns to a table that already exists, so each new column is added with `ALTER TABLE` after consulting `PRAGMA table_info`, then `title` is backfilled from the old `text` and `done = 1` becomes `status = 'done'`. The v1 columns are still written on every insert, so a downgrade still reads a sane list. `src/db.ts` is shared by the host and the CLI on purpose — a second copy of the migration is the one duplication that could genuinely corrupt a database.

**Requires.** `workspaceRegistry` from `dsh-base`, which `@deepseek-ai/dsh-web-app` composes by default. The CLI requires none of it.

---

### `dsh-git`

**npm:** [`@dennisrongo/dsh-git`](https://www.npmjs.com/package/@dennisrongo/dsh-git)

Source control for the workspace, without leaving the harness. Read what changed,
stage it, let the model write the commit message, and push — in the tab you are
already looking at, against the same repository your agent is editing.

**What you get.** A Changes tab showing branch, upstream ahead/behind, and a file list split into staged and unstaged, with per-row stage/unstage/discard and a diff pane. An **✦AI message** button drafts a commit message from the staged diff through the harness's own `llm` service, then `Commit all` commits. Recent history is listed underneath. A directory that isn't a repository reports `repo: false` and offers `Initialize repository` rather than erroring.

**Branches, merge, stash and worktrees.** The branch name in the header is a menu: switch branches, create one, merge another into it, or delete one. A third **Repo** tab lists your stashes (push / pop / apply / drop) and your worktrees (add / remove / prune). Every worktree row has an **Open** button that registers the directory as a workspace and switches to it — a worktree you can see but cannot get into is just a list.

**Worktrees go beside the project, named `<project>-<branch>`.** Type a branch and the path fills itself in: `feature/login` in `myproj` suggests `../myproj-feature-login`, which puts the worktree next to the project on disk *and* next to it in dsh's workspace list. Slashes are flattened, because `../myproj-feature/login` would quietly create a `myproj-feature` directory with the worktree buried inside it. The suggestion is editable and stops auto-filling as soon as you type your own path.

**The model names the branch, not the path.** Type a rough description in the branch box — "fix login retry" — hit ✦, and it becomes `fix/login-retry`, with the path following as `../myproj-fix-login-retry`. Naming is a judgement call worth a model; deriving a path from a branch is arithmetic with one right answer, so a regex does that. It fails soft in exactly the way you'd want: no provider configured, or any error, leaves your text untouched with the reason in the log strip — typing the name yourself is always the shortest path.

**A worktree can fork from a branch other than the one you're on.** The form carries a **from** select over the local branches, defaulting to the current one — git's own default, and the common case, but it means a worktree created while sitting on `feature-test` forks from `feature-test`, which is occasionally not what you wanted. The path is prefilled with a readable `adjective-noun` name (`../myproj-brave-otter`), so "just give me a worktree" needs no typing at all, and an empty branch box creates a new branch from that generated name — a worktree cannot check out a branch that is already checked out somewhere else, so reusing the current one is not an option git would allow. Rows for the **main** worktree and the one you are currently in carry no Remove button: git refuses both, and on Windows it refuses the second with a file-lock `Permission denied` that reads like a bug in the tab. Removing a worktree that dsh has registered as a workspace offers to remove that workspace too.

Paths resolve **like a terminal opened at the repository root** — `../worktree-test` creates `GitHub/worktree-test`, exactly where `git worktree add ../worktree-test` would put it. A path landing *inside* the repository is refused: a checkout doesn't belong in the project, and whether it would even be clean depends on that project's `.gitignore`. The form shows the resolved absolute path live as you type, so "where is this going to go?" is not a question you answer by trying it.

Two behaviours are deliberate. **A merge is allowed to conflict.** Rather than refusing anything non-fast-forward, the tab leaves the repository mid-merge and shows a banner with Abort and Continue; the conflicts appear in the Changes list you already use, and staging a file marks it resolved — git's own model. The banner keys off a `merging` flag rather than off "are there conflicts", because a merge whose conflicts are all resolved has none left and is still unfinished. And **nothing is ever auto-stashed.** Switching branches with uncommitted work lets git refuse, then offers a "Stash changes and switch" button; an auto-stash whose later pop conflicts strands work behind a state you never chose to enter.

None of this costs the polling loop anything. `status` gained `merging`, `mergeHead` and `stashCount` without gaining a single git process — the first two are filesystem checks on `MERGE_HEAD` and `MERGE_MSG`, the third counts the `refs/stash` reflog (git's stash *is* that reflog), and the three repository directories now come back from one `rev-parse` call instead of one each. The branch, stash and worktree lists are fetched lazily when you open the menu or the Repo tab, never polled.

**The layout is responsive to the tab, not the window.** The diff sits beside the file list when there's room and below it when there isn't, switched by a **container query** (`@container dshgit (min-width: 720px)`) — the tab is resized by the shell's own sidebar and panels independently of the viewport, so the width that matters is its own. Opening a diff never moves a row: the list's column width is reserved in both states, so the first click can't reflow and re-truncate every filename under the pointer. While a patch is in flight the pane shows a **skeleton shaped like a diff** — shimmering meta/hunk/add/del bands sized off the real 18px diff line — rather than a spinner, which would blank a large surface; the shimmer animates `background-position`, never a transform or a box dimension, so it can't shift layout, and `prefers-reduced-motion` flattens it. Clicking down a list starts overlapping requests, so each is stamped with a monotonic sequence and a stale reply is discarded rather than painted under the wrong filename. Icons are inline 16px SVGs on a matching `0 0 16 16` viewBox in 20px buttons, which keeps file rows at 32px.

**How it works.** `GitService extends TypertRemoteService` under the cordis key `dshGit`, shelling out to `git` in the workspace directory. Writes are **serialised per repository root** through an internal queue, so two tabs can't interleave a stage and a commit. Paths from the client go through `assertSafePath`, which refuses absolute paths and `..` escapes. Untracked files have no diff for git to produce, so their contents are synthesized into a `/dev/null` patch — otherwise clicking a new file would show a blank pane and look broken. `push` without a remote fails as data (`{ ok: false, output }`), not an exception.

**The list updates itself, without polling git.** An edit from your agent, your editor,
or a terminal `git checkout` appears in about a second with no refresh click. Doing that
the obvious way — re-reading `status` on a timer — would spawn four git processes per
second per open tab. Instead the host watches the repository with `fs.watch` and keeps a
monotonic **change token**; the tab polls a `changeToken` endpoint that answers from that
counter without running git, and re-reads the full status only when the token moves.
Measured against a live harness: **52 ms per poll vs 141 ms for `status`**, with no git
process spawned on the poll path. Hidden tabs don't poll at all, and a `focus` handler
re-checks the instant you look, so the idle cost is zero.

Three details are what make that safe rather than merely fast. The `.git` filter is an
**allowlist**, because merely *reading* a repository touches `.git/objects` — with a
denylist the tab's own status read bumps the token and the feature feeds itself forever
on an idle repo. High-churn directories (`node_modules`, `dist`, `.next`, …) are ignored,
so a dependency install doesn't spam the watcher. And the debounce has a **maximum wait**,
because a pure trailing-edge debounce is a starvation bug: a watch-mode build re-arms it
forever and the list would stay stale for exactly as long as work is happening.

**Endpoints.** `status`, `diff`, `commitFiles`, `commitDiff`, `stage`, `commit`, `init`, `sync`, `suggestMessage`, `changeToken`, `refs`, `branch`, `merge`, `stash`, `worktree`, `suggestBranch` under `POST /api/dshGit/<method>`, each taking one parameter named `request`.

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

### `dsh-skills`

Turns the [`@dennisrongo/skills`](https://www.npmjs.com/package/@dennisrongo/skills) library into an installable catalog, so a fresh machine gets every skill from one command:

```bash
dsh plugin --profile <name> add @dennisrongo/dsh-skills
```

**Why this is a plugin and not a link script.** Skills are normally dropped into `<agentsHome>/skills` and discovered from there — which is what `link-superpowers-skills.mjs` above does, and it is the right tool for keeping an *already installed* catalog fresh. But it is not an install path: it presumes `~/.agents/skills` exists, and **nothing in the harness creates it**. A missing root is discovered as an empty list rather than an error, so a fresh machine gets a silently empty catalog and no diagnostic. Making the library an npm dependency of a plugin hands that whole problem to pnpm, which already solves it — and `dsh plugin` is a thin pnpm forwarder, so `update`, `outdated` and `remove` all work.

**How it works.** `ctx.skills.registerProvider` publishes a second, independent skill provider serving every `skills/<name>/SKILL.md` in the resolved library. Registration files into the profile's **global** layer, which every agent preset's scope chain includes, so one row reaches every agent without touching the presets' own `skill-filesystem` rows. A nearer layer still wins outright, so a project's `.dsh/skills` shadows a library skill of the same name — the library is a baseline, not an override.

**Nothing is vendored.** Bodies are read when the catalog is collected, and resolution runs `skillsRoot` → `DSH_SKILLS_ROOT` → the packaged dependency → a probe of common clone paths under `$HOME`. Point `skillsRoot` at a working clone and edits land with no reinstall.

---

### `dsh-mission-control`

One glass panel over the whole agent fleet, floating above the stock web UI.

**What you get.** A `shell.overlay` dashboard, docked as a right rail, with a **Fleet** list of every session (root and subagents) grouped by workspace and showing running / waiting / done, a **swarm tree** of coordinator → worker lineages, a **stats strip** (session count, running, subagents, waiting-on-you), estimated **token burn** broken down by model, and a **permission inbox** surfacing sessions blocked on `approval` / `question` / `plan-review`.

**Stage** is a full-screen takeover — press it and the rail swaps for a live grid of tiles, one per session that is running, waiting on you, or was touched inside the activity window (`30m` / `2h` toggle), busiest first. A tile carries the session's live conversation and answers a pending permission **in place**, so you never lose the tab you came from; Esc or × returns to the panel. Because Stage covers the whole viewport it also spans DSH Desktop's 36px window-drag strip, which swallows clicks before hit-testing — its bar clears that band and every control opts out with `data-dsh-no-drag`.

A **settings drawer** persists to `localStorage` (bad shapes fall back to defaults, and a storage failure degrades to in-memory rather than throwing): sessions listed per workspace group, fleet sort order, and an optional **pomodoro timer** in the footer with configurable work / short-break / long-break lengths and a desktop notification on phase change. The timer itself is also mirrored to the host cell so it survives a Desktop restart; the drawer keys stay origin-local.

**How it works.** Fleet rendering is a pure consumer on public faces only — `ctx.sessions.list` and `ctx.workspaces.list` as ObservableSnapshots bridged into React, `sessionStats` projections (turns / steps / llmMs / decodeTokens), and `PendingInteraction` off the session summaries. No tools, no presets. One minimal host service, `dshMissionControl`, owns a single opaque JSON cell at `<DSH_HOME>/storages/dsh-mission-control.json` so the pomodoro survives a DSH Desktop restart: Desktop serves the UI from an ephemeral port per launch, and localStorage is origin-scoped, so without the host cell every restart was a fresh website. The client owns the envelope shape; the host never parses it. Without the host half (an older install) the panel degrades to localStorage. CSS is namespaced `dshmc-`, and control metrics are CSS custom properties so the 400px rail's compact sizing and Stage's full-screen sizing derive from one set of tokens rather than diverging.

**Endpoints.** `POST /api/dshMissionControl/load` → `{ state }` (a string or `null`); `POST /api/dshMissionControl/save` → `{ ok: true }`. Both take one parameter named `request`.

---

### `dsh-theme`

A **Themes** page in Settings: twelve curated palettes — Bumble Bee, Catppuccin, Citron, Claude, Everforest, Gruvbox, Nord, One, Rosé Pine, Sakura, Solarized, Tokyo Night — eight accent colours, a **contrast** slider and a **UI scale** slider, and a font axis whose two non-default entries — Geist Mono and JetBrains Mono — **ship inside the bundle** as data URLs, so they render identically everywhere with nothing to install. One choice sets both the interface and the code face. Hovering a theme swaps its one-line description for its full authored palette, so you can read the colours without applying it. Picking any of them previews across the whole app immediately; nothing is saved until you press Apply, and Revert or closing the modal puts back what was committed.

Every theme ships **both** palettes, so it layers over your existing Light/Dark/System choice rather than replacing it. Flip appearance in General and the theme swaps variant; leave it on System and it follows the OS.

**How it works.** Four independent `ctx.theme.overrideTokens` layers — palette (110 tokens), accent (17), font (2), scale (1). The runtime keeps one layer per source and replaces it wholesale when the same source overrides again, which is the entire preview mechanism: no stacking bookkeeping and no way to leak a half-applied palette. Because layers compose per token, theme × accent × font × scale costs the sum of those lists rather than their product. The accent drives the send button — the one control prominent enough to carry a theme's identity — and because that button hardcodes a white icon, each accent passes through a solver that finds the nearest shade clearing 3:1 both for the icon on the fill and for the fill against the page; an accent that already clears both is used unchanged. The font layer is two tokens because one choice drives both faces: all ~200 of the harness's composed typography tokens read `var(--dsw-font-family)`, and `--ds-font-family-code` covers code. Both non-default faces are bundled as data URLs, so they render identically everywhere with nothing to install. A **contrast** slider pushes surfaces and text apart while leaving the palette's accent and state colours untouched, and a **UI scale** slider zooms the whole interface.

Selection rides a **cookie**, deliberately. DSH Desktop serves the UI from a new ephemeral port every launch and `localStorage` is origin-scoped, so a localStorage-only plugin forgets your theme on every Desktop restart — the same trap that gave `dsh-mission-control` its host half. Cookies are not isolated by port, so the choice survives the relaunch; localStorage is kept as a fallback. The settings document was rejected because its writes silently no-op on a non-loopback connection. A first-paint bootstrap inlined by the tiny host half stops the shell flashing the stock palette on load — measured at roughly half a second without it, and it reads the cookie first so the fix holds on the Desktop too.

**Adding a theme is data.** One file of ~15 colours per variant in `src/themes/`, one line in the catalogue; the builder derives every custom property the harness reads, and the test suite enforces WCAG contrast floors on all of them and reports every failure at once. See the [package README](plugins/dsh-theme#adding-a-theme).

---

### `dsh-hooks`

**npm:** [`@dennisrongo/dsh-hooks`](https://www.npmjs.com/package/@dennisrongo/dsh-hooks)

Attach a shell command to a lifecycle point. Block a tool call, feed the model context, format a file after an edit, or get told when the agent stops — configured, not coded.

dsh already had the lifecycle. `tools/pre-execute` is a waterfall returning `allow | deny | ask`; `tools/post-execute` can block a settled result or attach model-facing context; `agent/pre-step` can reject or rewrite the messages entering a step; `agent/turn-stopping` can steer an agent back into work. What it had no way to do was attach a **command** to any of that from configuration. This plugin is that runner and nothing more — it owns no policy, and with an empty config it is inert.

**Eight events, Claude Code's names.** `PreToolUse` · `PostToolUse` · `UserPromptSubmit` · `SessionStart` · `SessionEnd` · `Stop` · `SubagentStop` · `Notification`. `UserPromptSubmit` is gated to steps that actually claimed a user-sourced message, because `agent/pre-step` fires on *every* step — without the gate a prompt hook would run once per tool round-trip.

**The protocol is Claude Code's, so your existing hook scripts run unchanged.** JSON payload on stdin, exit 0 allows, exit 2 blocks with stderr as the reason, structured `hookSpecificOutput` on stdout for `permissionDecision` and `additionalContext`. Hooks are handed `DSH_PROJECT_DIR`, `DSH_SESSION_ID` and `DSH_HOOK_EVENT` — plus `CLAUDE_PROJECT_DIR` as the same value, so a ported script finds its project without edits. Those names have to be passed explicitly: the subprocess seam scrubs *all* `DSH_*` and credential-shaped variables out of a child's ambient environment, and the spec's explicit `env` is the documented opt-in.

**Two configuration layers, and they are additive.** A `dsh-hooks` settings namespace (so `$DSH_HOME/settings.yaml`, schema-validated, live-reloading) plus `<workspace>/.dsh/hooks.json` that a repo can commit. Every matching hook from both runs — a checked-out repository cannot silently disable your global guard by declaring an empty list for the same event. The project document is read per dispatch and cached against `mtime+size`, so an edit takes effect with no restart and no watcher handle held open per workspace. `matcher` is a real regex over the tool name; an invalid one matches **nothing** and warns once, because one typo must not become a hook that fires on every call in the session.

**Failure is fail-open, deliberately.** `tools/pre-execute` is awaited before every dispatch, so a hanging hook would stall the session: the deadline is owned by the runner (never the hook), expiry escalates through the seam's tree-scoped `terminate`, and a crash or timeout is not a denial unless the entry sets `failClosed: true`. One broken hook bricking every tool call is the failure mode that makes people delete their hooks entirely — a security gate opts into `failClosed` and accepts that breaking it stops the work; a formatter does not. `Stop` gets a second guard: it passes `stop_hook_active` faithfully, and caps consecutive hook-driven continuations at five for the hook that ignores it.

**Two Claude Code capabilities dsh cannot express, both reported rather than dropped.** Tool arguments cannot be rewritten — `PreToolDecision` is `allow | deny | ask`, and the registry's own docs say input rewriting is excluded because arguments are already logged and presented; a hook returning `updatedInput` gets a warning naming the alternative. And `SessionEnd` cannot block teardown, because `agent/disposed` is emit-mode. A hook that believes it sanitized an argument it never changed is worse than one that cannot try.

**Endpoints.** `POST /api/dshHooks/describe` → every hook in force across both layers with the document each came from; `POST /api/dshHooks/recent` → the last 200 settled runs with exit codes, durations and output tails. Both take a single parameter named `request`.

**Requires.** `ctx.tools` and `ctx.subprocess`. `ctx.settings` and `ctx.workspaceRegistry` are used when present and deliberately not injected — this cordis has no optional-inject form, so listing them would make the plugin never mount in a deployment that composes neither.

---

### `dsh-plan-board`

**npm:** [`@dennisrongo/dsh-plan-board`](https://www.npmjs.com/package/@dennisrongo/dsh-plan-board)

Plans that outlive the scrollback. Every plan the agent presents through `exit_plan_mode` is written to `<workspace>/.dsh/plans/` as markdown, a window opens so you can read it at full size, and a **Plans** tab keeps the history with each plan's outcome.

dsh already has plan mode, and it is good: `dsh-plan-mode` logs a `plan/mode` event that survives resume and fork, registers `/plan`, and presents the complete markdown for Approve / Keep planning. What it does not do is **keep** the plan. The markdown exists only inside the tool-call event in the session log — scroll past it and it is gone, it is not a file you can diff or commit, and the reviewer's feedback exists only as the text of a thrown error. The most reviewed artefact in the session was the least durable one.

**Files, not rows.** `<workspace>/.dsh/plans/20260829T121500123-add-a-hook-lifecycle.md`, markdown with a small metadata block, so a plan can be opened in an editor, diffed, committed, or handed to someone who is not running the harness. `dsh-todo` keeps a database because a task list is rows; this is the other case. The metadata is JSON-per-line rather than YAML: it reads the same, but it has to survive a model-written title and free-form human feedback full of quotes and newlines, which is exactly where a hand-rolled YAML subset eventually breaks.

**The capture point is `tools/execute`, not `tools/pre-execute`.** `next()` runs the tool body — the call that blocks on the human — so wrapping it is what makes the *outcome* observable: the plan is written `pending` before, and settled to `approved` or `rejected` after, with the rejection feedback lifted out of the error the tool threw. `pre-execute` sees the plan but never the answer.

**The window is a `shell.overlay`, and that is not a style choice.** Views are rendered one-at-a-time by the session body (`only: <active id>`), so an inactive tab is not mounted and cannot open itself when a plan appears. An overlay is shell-scoped and always mounted, so "a window opens when a plan is created" is something the plugin can actually guarantee. The tab exists too — it is the history browser.

**It does not approve plans, and it says so.** `exit_plan_mode` presents through `ctx.userQuestions.ask()`, and that service documents **one active provider per context** — the shipped question UI already holds it. Putting Approve buttons in the window would mean hijacking every question in the harness, not just plan reviews. So the window is a reading surface with a line pointing at the real control. A reading window with no approve button reads like a broken approve button unless it explains itself.

Freshness rides a **change token** like `dsh-git`'s, but here it is a plain in-memory counter — this process is the only writer, so there is no `fs.watch` and no handle per workspace. Polling stops while the document is hidden. Plan bodies never ride the list: `list` returns metadata only, so 200 plans do not ship a megabyte of markdown to draw a sidebar. Markdown renders to **React elements**, never `dangerouslySetInnerHTML` — a plan is model-written text that may quote something off the internet — and links render as `label (url)` rather than as anchors, so a model-authored destination stays inspectable and inert. Writes go through a temp file and `rename`: the plan you are about to approve is exactly the file that must not be half-written.

---

### `dsh-memory`

**npm:** [`@dennisrongo/dsh-memory`](https://www.npmjs.com/package/@dennisrongo/dsh-memory)

A `/remember` command that writes a fact into the instruction hierarchy dsh already reads, and a **Memory** tab that shows which of those files the loader actually kept.

This one is deliberately small, because dsh already has the read half and it is more capable than it looks. `dsh-agent-instructions` loads the user-global `$DSH_HOME/AGENTS.md`, then every `AGENTS.md` and `CLAUDE.md` from the project root down to the session's directory, plus `.local` overlays, deduplicated per directory, budgeted by bytes, pulling in nested files as the agent touches them — and sessions are already bound to workspaces by canonical path.

**What was missing was writing and seeing.** There is no `#`-style capture, so a fact learned mid-session is one you retype by hand later. And the byte budget silently omits files: a file that exists, is discovered, and is dropped for budget looks exactly like a file the agent is ignoring for no reason — with the shipped `code` preset's 64 KiB budget, which a real monorepo reaches.

**Capture.** `/remember <fact>` files it under a `## Memories` heading in `<projectRoot>/AGENTS.md`; `--local` targets the gitignored `AGENTS.local.md` overlay and `--user` the machine-wide `$DSH_HOME/AGENTS.md`. The reply always names the exact path — "saved" would leave you guessing which of four candidate files it landed in. A second fact joins the existing list rather than starting a new one, and nothing a human wrote is ever moved: the new item goes at the end of *that section*, not after whatever heading happens to be last.

**Inspection.** The tab lists every discovered file in model precedence order with its size, `not loaded` when the budget dropped it, and `cut to 96 B` when it survived truncated. Both facts come from the loader's own `discoverBaselineInstructionFiles` and `loadBaselineInstructions` — nothing here reimplements the walk, because an inspector that drifts from the loader is worse than none: it is trusted precisely when it contradicts you.

**Not a second memory store.** A parallel fact database beside the instruction files would mean two things to keep in sync, two precedence orders, and a place for facts to hide from a loader that already works.

---

Every package carries an `AGENTS.md` with its endpoints, mount row, dev loop and a verification recipe. See [AGENTS.md](AGENTS.md) for the repo as a whole.

## Install a plugin

All eleven are on npm, and each declares `dsh.bundle` — so one command installs **and** mounts it. `dsh plugin` forwards to pnpm
inside the profile directory:

> **Profile names carry templates.** `dsh plugin --profile <name> add ...` scaffolds a new
> profile if `<name>` doesn't exist — but only `web` and `headless` get a full template.
> Any other name is scaffolded with `@deepseek-ai/dsh-base` **alone**, which does not
> provide `workspaceRegistry`, and a UI plugin that needs it then refuses to boot with
> `1 entry did not activate — pending (waiting for service: workspaceRegistry)`. Use `web`
> for UI profiles, or add `@deepseek-ai/dsh-web-app` to `dsh.profile.bundles` yourself.

```bash
# web/desktop UI plugins
dsh plugin --profile web add @dennisrongo/dsh-todo
dsh plugin --profile web add @dennisrongo/dsh-git
dsh plugin --profile web add @dennisrongo/dsh-weather
dsh plugin --profile web add @dennisrongo/dsh-mission-control
dsh plugin --profile web add @dennisrongo/dsh-theme
dsh plugin --profile web add @dennisrongo/dsh-skills

# CLI-app and prompt plugins, in a headless-style profile
dsh plugin --profile headless add @dennisrongo/dsh-headless-plus
dsh plugin --profile headless add @dennisrongo/dsh-superpowers
dsh plugin --profile headless add @dennisrongo/dsh-skills
```

Several at once is fine. Restart the profile and it's live — there is no
`cordis.patch.yml` row to write; see [step 4](#4-nothing-to-mount--but-read-this-if-youre-upgrading)
if you're upgrading from a version that needed one.

Prefer the git source — to track `main`, or to pick up a change before it's released?

```bash
dsh plugin --profile web add "github:dennisrongo/dsh-plugins#path:/plugins/dsh-todo"
dsh plugin --profile web add "github:dennisrongo/dsh-plugins#main&path:/plugins/dsh-todo"   # pin a ref
```

Quote the argument — `#` and `&` are shell metacharacters. Every package ships its built
`lib/`, so a git install works even though it runs no build step.

## Update to the latest

`dsh plugin` is a thin pnpm forwarder, so `update`, `outdated` and `remove` all work the
way they do in any pnpm project.

```bash
# what is out of date in this profile?
dsh plugin --profile web outdated

# update one plugin, or several
dsh plugin --profile web update @dennisrongo/dsh-git
dsh plugin --profile web update @dennisrongo/dsh-todo @dennisrongo/dsh-mission-control
```

**Restart the profile afterwards.** A client-half change lands on a browser refresh, but a
host-half change — a new `/api` endpoint, a changed service — does not: the Typert loader
caches its per-package verdict for the life of the process, so a plugin that gained an
endpoint will 404 on it until the profile restarts.

Two behaviours worth knowing. A caret range only moves within its major, so a major bump
needs the explicit tag: `dsh plugin --profile web add @dennisrongo/dsh-git@latest`. And
bundles reconcile by **installed state**, not by dependency diff — a version that newly
gains a `dsh.bundle` activates on its own, with no `cordis.patch.yml` edit.

From a clone rather than npm, the equivalent is `git pull` then a root `pnpm install` and
`pnpm run build`. pnpm replaces the profile links with frozen copies on every install, so the
root `postinstall` re-links them for you — check its output, since it warns rather than fails
(see [step 5](#5-optional-link-for-live-editing)).

### Updating the skills catalog

The skills themselves live in [`@dennisrongo/skills`](https://www.npmjs.com/package/@dennisrongo/skills),
a plain library that `dsh-skills` depends on — so refreshing the catalog is a dependency
update, not a plugin reinstall:

```bash
# newest catalog for a profile that has dsh-skills installed
dsh plugin --profile web update @dennisrongo/skills

# check what is available first
npm view @dennisrongo/skills version
```

Nothing is vendored — skill bodies are read at catalog-collection time — so pointing
`skillsRoot` at a working clone picks up edits with **no reinstall and no restart**. That
is the fast loop while authoring a skill; the npm update is for consuming a published one.

Expect this on install, and ignore it — it is orientation, not a fault:

> `warning: @dennisrongo/skills declares no dsh.bundle — installed as a plain dependency`

The library is a plain library; only the plugin is a bundle.

### The `dsh-todo` command

`dsh-todo` needs no profile and no running server, so it can also be installed on its own —
useful for CI, or to let an agent manage a project's tasks without the web UI:

```bash
npx @dennisrongo/dsh-todo list --open     # no install at all
pnpm add -g @dennisrongo/dsh-todo         # then: dsh-todo list --open
```

Installing it into a profile already puts the binary on that profile's `node_modules/.bin`.
Full command and flag reference: [plugins/dsh-todo](plugins/dsh-todo#cli--for-you-and-for-ai-agents).

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
  "file:C:/absolute/path/to/dsh-plugins/plugins/dsh-weather" \
  "file:C:/absolute/path/to/dsh-plugins/plugins/dsh-mission-control"
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
> If you have rows for `dsh-weather`, `dsh-todo`, `dsh-git`, `dsh-mission-control`,
> `superpowers`, `headless-plus-startup` or `headless-plus-runner` — or the
> `headless-startup` / `headless-runner` disables, which `dsh-headless-plus` now
> carries itself — **delete them**.
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

### 5. Optional: link for live editing

**Installing is done — the plugins work at this point.** A plain install resolves the harness
packages through the profile, so you can skip straight to step 6. This step is for editing
*this repo* and seeing the change without reinstalling, plus it's what makes this repo's own
`pnpm run test` and `pnpm run typecheck` resolve.

**Most of the time you do not run anything here.** `pnpm install` at the root ends in a
`postinstall` that runs `scripts/dev-link.mjs`, which does this for you on the platform you
are on. Run it by hand only to re-link without installing, or to pass targets:

```bash
node scripts/dev-link.mjs       # what postinstall runs: junctions on Windows, symlinks elsewhere
node scripts/anchor.mjs         # the anchoring half on its own, any platform
```

Two jobs, and **both are undone by any `pnpm install`** — which is exactly why the postinstall
exists, so the rule is enforced mechanically rather than from memory:

- **Profile links.** Points each profile's installed plugin at this repo so a rebuild
  self-deploys; pnpm otherwise materialises `file:` deps as copies frozen at install time.
- **Dependency anchoring.** Points each package's `node_modules/@deepseek-ai/*` at your
  global `dsh` install. Once a plugin is linked it resolves through its **real** path, so
  Node looks for dependencies here rather than in the profile — without anchoring a
  *linked* plugin dies at boot with `ERR_MODULE_NOT_FOUND`. `node scripts/anchor.mjs` does
  this half alone on any platform (`-IdentityOnly` on the PowerShell script); the shell
  script's `--no-anchor` is the inverse — link the profiles, skip the anchoring.

It only touches plugins a profile actually declares, follows the package name (so unscoped
packages work), and prints what it skipped. It is deliberately **non-fatal**: a machine with
no dsh installed, or without one of the profiles, gets a warning rather than a failed install
— so check its output rather than assuming it ran. `node scripts/verify.mjs` is the gate that
catches a genuinely unwired workspace.

`dev-link.mjs` dispatches by platform — `scripts/dev-link.ps1` (junctions) on Windows,
`scripts/dev-link.sh` (symlinks) on macOS and Linux — and either can be run directly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-link.ps1 -Profiles web -DesktopProfiles web
```

```bash
scripts/dev-link.sh --profiles web --desktop-profiles web
```

**Both default to a profile named `web` on both surfaces**, which is why the postinstall
usually needs no configuration. If your profiles are named something else, put them in a
`.dev-link.json` at the repo root — it is gitignored, so per-machine profile names stay out
of the shared manifest:

```json
{ "profiles": "web,mission-control", "desktopProfiles": "web" }
```

`plugins` is accepted too, to link just one package. An absent file means the underlying
script's own defaults.

#### Adding a plugin to a profile that is already linked

Linking follows the profile's manifest, so a plugin added to this repo **after** the profile was
set up is not picked up by re-running `dev-link` alone. It is skipped, by design and out loud:

```
--    dsh-headless-plus not a dependency of web - left alone
```

Junctioning a package a profile never declared would leave a module its own manifest does not
mention, which the next install removes again. So install it into the profile first (step 3, and
mind the absolute-path rule there), then link:

```bash
dsh plugin --profile web add "file:C:/absolute/path/to/dsh-plugins/plugins/dsh-hooks"
node scripts/dev-link.mjs
```

Do the same for the desktop's profile — including its `ERR_PNPM_UNEXPECTED_STORE` fallback in
step 3, where you add the `dependencies` line and the `dsh.profile.bundles` entry by hand. That
path needs no pnpm at all, so it is also the safe one while the desktop is running.

One asymmetry worth knowing: pnpm records a directory argument as `link:` rather than `file:`,
so newer entries in a profile look different from older ones. `link:` is the **stronger** of the
two — a `file:` dep is re-materialised as a frozen copy by every install, which is the whole
reason `dev-link` exists, while a `link:` stays a symlink to the source. Both work, and
`dev-link` matches on dependency **names**, so a profile mixing the two is managed identically.

Confirm the result rather than assuming it, because the failure is silent — a declared but
unlinked plugin serves a frozen copy, and edits simply never appear however often you rebuild:

```bash
node scripts/verify.mjs        # want: "N profile install(s) track this repo, 0 frozen"
```

`0 frozen` is the number that matters.

A newly added plugin needs a **profile restart** before it exists at all; a browser refresh only
picks up client-half edits to plugins the harness has already mounted.

### 6. Verify

```bash
node scripts/verify.mjs                     # static checks, no server needed
dsh --profile web --port 38111 --no-open    # then, in another shell:
node scripts/verify.mjs --port=38111        # adds the live /api probes
```

Cross-platform, exits non-zero on failure. It reports the dsh version on each surface, then for every package resolves each `@deepseek-ai` specifier its **built** output imports and asserts it lands in the dsh CLI's own copy (never a `.pnpm` store path), checks the other runtime dependencies resolve, imports each host entry point, and confirms each client bundle still carries its `window.__ModuleLoader__.load` wrapper. With `--port` it POSTs each host endpoint and requires `200` with `"ok":true`.

`404` on a probe means the package's `./typert` export wasn't registered — see the plugin's `AGENTS.md`. Then open the UI and confirm the tabs render; `Promise.allSettled` in the client swallows failures, so a tab can render while every call fails.

**Run this after upgrading dsh.** A harness upgrade doesn't break `pnpm test` — that only proves this repo is self-consistent. What it breaks is resolution and the wire contract, which is what this checks.

When something is wrong at the harness level rather than the plugin level — a session that won't load, a workspace showing no history, a hand-edited registry that reverts — see [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Most of those failures are silent.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request: install,
anchor the peers against a real dsh, build, typecheck, `pnpm run test`, and then a
`git diff --exit-code` that fails if the **committed `lib/` bundles no longer match their
sources**. The harness loads `lib/`, not `src/`, and those bundles are committed — so a stale
one ships code that was never reviewed.

Until it existed the suites ran only inside `publish.yml`, which is to say at release time,
after the code was already merged. The `.githooks/pre-commit` hook runs the same checks
locally, but it validates the working tree and `--no-verify` skips it; this runs against the
real commit on a clean machine.

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

`pnpm run test` also runs `check-type-scale.mjs` and `check-tokens.mjs` across every plugin —
one type scale (11/12/13/14/16/20/24 px) and no `var(--dsw-*)` naming a token the harness does
not define. A misspelt token never errors: CSS falls back to the second argument and silently
stops following the theme. The `.githooks/pre-commit` hook runs the same two.

Each package also ships **opt-in probes that are not part of `pnpm test`** — mostly headless
Chrome against the *built* bundle, asserting things a unit test cannot see: that opening a diff
does not move a row, that the branch menu stacks above the panes, that the todo modal clears
DSH Desktop's window-drag strip, that the git watcher wakes on a real commit. They are listed
in each package's `AGENTS.md`. Two are worth knowing about before you run them:
`dsh-todo`'s `test:agent` drives a **real model** (needs credentials, runs in a throwaway
`DSH_HOME`), and `dsh-mission-control`'s `test:installed` reads **machine state** — the copies
a profile actually serves — rather than anything the repo owns.

The root `postinstall` re-links profiles after every install (see [step 5](#5-optional-link-for-live-editing)).

Workspace configuration lives in `pnpm-workspace.yaml`: pnpm 11 ignores `pnpm` blocks in `package.json`, build permissions are `allowBuilds` (a map, not the older `onlyBuiltDependencies` list), and `autoInstallPeers` is off because the `@deepseek-ai/*` peers are dev-preview and partly unpublished.

One trap worth knowing: DSH Desktop runs a **profile-repair install** on startup that prunes this repo's per-package `node_modules` — which takes `zod` with it and makes the harness refuse to boot (`Cannot find package 'zod'`). Recovery is `pnpm install` at the root, whose `postinstall` re-links the profiles.

The other trap has no recovery that cheap: **never point `DSH_HOME` at a home another harness is already using.** Testing against DSH Desktop's home while the app is open corrupts the sessions the app has open — silently, across workspaces, and you only find out at a later restart when the history refuses to load. A different `--profile` does not help: `sessions/` is a sibling of `profiles/`, so every profile shares one session store. Use a throwaway `DSH_HOME`, or query the running app's own `/api` endpoint instead of starting a second harness. Repair is possible but manual — see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#never-run-two-harnesses-against-one-home).

## Repository layout

```
plugins/     one self-contained package each (pnpm workspace members)
scripts/     verify.mjs                    — check the plugins against your installed dsh
             anchor.mjs                    — point each package's @deepseek-ai at that dsh
             host-deps.mjs                 — locate the installed dsh (shared by the two above)
             dev-link.mjs                  — postinstall entry; dispatches to .ps1 / .sh
             dev-link.ps1                  — anchor + junction into profiles (Windows)
             dev-link.sh                   — anchor + symlink into profiles (macOS/Linux)
             check-type-scale.mjs          — one type scale across every plugin
             check-tokens.mjs              — every var(--dsw-*) must be a real token
             link-superpowers-skills.mjs   — link an upstream superpowers clone's skills

AGENTS.md            repo conventions and the rules that are not obvious
TROUBLESHOOTING.md   harness-level failure modes, mostly silent ones
```

`dsh-todo`, `dsh-git` and `dsh-weather` were consolidated here from standalone repos.

## License

MIT
