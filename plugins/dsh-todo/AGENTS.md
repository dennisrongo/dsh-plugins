# AGENTS.md — @dennisrongo/dsh-todo

Per-workspace todo list for DeepSeek Harness. Two halves in one package:

- **Host** (`src/index.ts` → `lib/index.js`) — `TodoService extends TypertRemoteService`, cordis service key `dshTodo` (`super(ctx, 'dshTodo')`). Owns the durable list as one SQLite database per project at `<workspace>/.dsh/todo.db`, resolved through `workspaceRegistry`; migrates the legacy central `~/.dsh/storages/dsh_todo.json` on first read.
- **Client** (`src/client.tsx` → `lib/client.js`) — the Todo tab, calling the host over the Typert bridge as `ctx.remote.dshTodo.list(...)` / `.replace(...)`.

## Data model

An item is a **task**, not a checklist line:

```ts
{ id, title, description?, status, priority, release?, sprint?, dueDate?,
  sessionId?, createdAt, completedAt?, archivedAt? }
```

- `status` (`backlog | todo | in-progress | blocked | done`) is the source of truth and
  **replaces the old boolean `done`**; `isDone(item)` derives it. Only `setStatus` writes it,
  so `completedAt` can never contradict the status.
- `release` and `sprint` are **deliberately separate axes** — what ships together vs. when it
  is worked — and both are **numeric labels**, but they do NOT share one rule
  (`normalizeVersionLabel(raw, field)` in `types.ts`):
  a **release** takes up to three segments (`1`, `1.5`, `0.5.1`) because a patch release needs
  a label of its own; a **sprint** takes one dot at most (`1`, `1.5`, `24`) because it is a
  calendar point, not a shipped artefact. `v1.5`, `Sprint 24`, `1.2.3.4` and `1.` are refused
  for both. Sorting is `compareVersionsDesc` — SEGMENT-WISE, not decimal, so `1.10` outranks
  `1.9` and `0.5.1` sits between `0.5` and `0.6`; a non-numeric legacy label falls back to a
  numeric-aware string compare. Enforcement is at the write paths only — CLI `add`/`update`
  throw via `assertLabel` (whose message names that field's shape), the UI inputs strip every
  character but digits and dots as you type (`sanitizeDecimalInput`), and an edit that is still
  invalid on blur is FLAGGED with an inline error (`labelError(raw, field)`, `RELEASE_ERROR` /
  `SPRINT_ERROR`, `.dshtd-label-err`, `aria-invalid`) and never committed — silently reverting
  read as the field being broken. In the task modal an invalid label blocks the Done button —
  and ONLY that button; dismissing is always allowed. Meanwhile READ paths (`db.ts`, `sanitizeItems`, `coerceItems`) still pass
  legacy labels through, because there is no migration and pre-rule data must keep loading.
  Grouping and filtering need no releases table, and `knownLabels()` feeds a `<datalist>` so
  labels converge without one.
- `title` caps at `MAX_TEXT` (500); `description` has its own `MAX_DESC` (5000), because
  reusing 500 silently truncates acceptance criteria. Labels cap at `MAX_LABEL` (60).
- `dueDate` is a `YYYY-MM-DD` **calendar day, not an epoch** — "due the 14th" must read as the
  14th in every timezone. `isOverdue` compares the strings directly (ISO dates sort
  chronologically), so no `Date` parsing can shift the boundary a day. `normalizeDueDate`
  round-trips through `Date` to reject `2025-02-31`, which a date input would otherwise roll
  forward to March 3rd.
- Absent optional fields are **absent keys**, never `''`, so "no release" has one representation.
- Pure transforms return the SAME array when nothing changed. The store treats a new array as a
  reason to write, so a no-op that allocated would put a round-trip on the wire per keystroke.

### Adding a field is a SIX-place change

Miss one and it fails silently — the field simply never arrives:

1. `src/types.ts` — the interface.
2. `src/remote.ts` — both wire schemas. **Strict codecs strip fields they do not name.**
3. `src/index.ts` — the zod read schema AND `sanitizeItems`.
4. `src/db.ts` — `migrateSchema` (an `add()` line: `CREATE TABLE IF NOT EXISTS` will NOT
   add a column to an existing table), plus the `readList` SELECT and the `writeList`
   INSERT columns **and** its value list.
5. `src/client.tsx` — `coerceItems`, or it is dropped on reload.
6. `src/cli.ts` — the third face on the same database. `--json` emits the whole item so it
   follows for free, but the human `show` / `list` views and any write flag do not.

Only place 4 fails loudly (`no such column`); the other five drop the field in silence.
The cheapest check that covers all six is an end-to-end CLI round-trip against a temp
workspace — write the field, read it back, confirm it survives:

```bash
node lib/bin.js add "probe" --workspace /tmp/x --json
node lib/bin.js update <id> --workspace /tmp/x --session sess-1 --json
node lib/bin.js show <id> --workspace /tmp/x --json   # the field must be here
```

### The task modal

`TodoModal` is the detail dialog: clicking a row title opens it, double-clicking renames
inline, and the chevron still expands the cheap in-row peek.

- It **must portal to `document.body`** (`createPortal` from `react-dom`). `.dshtd-scroll` is
  `overflow-y: auto`, so a dialog rendered in place is clipped by its own scroller.
- `react-dom` is a **build-time external**, supplied by the shell's module table exactly as the
  shipped `ui-trajectory` / `ui-renderer` / `ui-attachment` bundles receive it. Bundling a copy
  would fight the shell's React. `test/smoke.mjs` asserts `require("react-dom")` survives.
- The backdrop sits at **z-index 2147483100 — deliberately BELOW** DSH Desktop's window-drag
  region (2147483644), which swallows clicks even under `pointer-events: none` because the
  compositor resolves drag regions before hit-testing. Raising z-index cannot beat it; the panel
  clears the 36px strip with top padding instead. `pnpm run test:modal` asserts both.
- The dialog holds the open task's **id**, not the item, so it re-reads the current version after
  a commit and closes itself if another tab deletes the task.
- Text fields commit on blur and the dialog force-commits title/description on exit, so a
  backdrop click cannot lose an edit and typing does not put one host round-trip on the wire
  per keystroke.
- **Done saves; everything else dismisses.** `save()` is the ONLY path that validates: it
  re-reads the label refs, refuses on a bad one (flagging it and focusing the offending input),
  and otherwise commits and closes. `dismiss()` — backdrop, Escape, the X — never validates,
  because a dialog you cannot leave while a field is half-typed is a trap; the unsaved bad
  label is simply discarded and the stored value stands. `test/smoke.mjs` asserts the wiring
  against the SOURCE, since minification renames the handlers.

`pnpm run test:modal` drives headless Chrome against the built CSS and fails if the panel is
clipped, off-screen, transparent, or under the drag strip.

### Launching a session from a task

The rocket button on a row (and **Launch session** in the task modal) opens
`LaunchDialog`: a model picker, a mode picker, and an editable prompt composed from
the task. Confirming starts a real session on the work. `src/launch.ts` owns the flow
and is deliberately dependency-free — it imports `./types.ts` and nothing else — so
`lib/launch.js` can be imported by the smoke test under plain Node, with no React and
no harness packages on the import path.

**There is no single harness call that creates a session with a model and a mode.**
`sessions.create()` accepts only `{ workspaceId, sessionId? }`; the shipped
`dsh-client-ui-agent-preset` says a pick "cannot simply ride along on
sessions.create". So a launch is a five-step sequence, and its order is load-bearing:

1. `ctx.sessions.create({ workspaceId })`
2. `ctx.remote.agentPresets.select(sessionId, presetId)`
3. `ctx.modelDirectories.directoryFor(sessionId).select({ provider, model })`
4. `binding.session.prompt([{ type: 'text', text }], 'queue')`
5. `ctx.sessions.open(sessionId)`

- **Steps 2–3 MUST precede step 4, and getting it wrong fails SILENTLY.** The preset
  applier drops a pick aimed at a session that is no longer `blank`, and prompting is
  exactly what un-blanks it. Prompt first and the session runs the DEFAULT mode with no
  rejected promise, no console warning and no visible difference — until the agent
  behaves unexpectedly many turns later. `test/smoke.mjs` compares source indices to
  pin the order, and asserts the prompt has exactly ONE call site so a second path
  cannot bypass it.
- **The session is created when the dialog OPENS, not on confirm.** The model directory
  is per-session (`directoryFor(sessionId)`), so an accurate picker needs a session to
  bind to; a catalog read without one can offer a model the session then refuses. The
  price is `discardSession()`, which archives the blank session when the dialog is
  cancelled — without it every dismissed dialog litters the sidebar.
- **The task flips to `in-progress` only after the prompt is accepted**, inside
  `onLaunched`. A failed launch must not leave a task claiming work that never started.
- **The launch services are NOT in the plugin's `inject` array.** `sessions`,
  `modelDirectories` and `remote.agentPresets` are read opportunistically by
  `launchContext()`; a profile composing none of them still gets a working todo tab
  with the button simply absent. Parking the tab on services it needs for one button
  would make the whole list vanish on a slim profile.
- **…and reading an undeclared service THROWS, so every such read must be guarded.**
  A cordis context is a Proxy: inside a plugin fiber, `ctx.sessions` for a service
  not in `inject` raises `cannot get property "sessions" without inject` — it does
  NOT yield `undefined`. This shipped an outage: the unguarded read threw inside the
  `conversation.view` slot's `inject` callback, no store reached the view, and every
  task vanished from a tab that still drew its own chrome. **Three green suites and a
  green icon probe all passed**, because `smoke.mjs` renders against plain stub
  objects and a stub returns `undefined` for a missing key. Rules:
  - `ctx.get(name)` is the SAFE probe (returns `undefined`); the bare property read
    is the trap. `launchContext()` wraps both in try/catch regardless.
  - **A dotted service name is NOT a key on its parent.** `remote.agentPresets` is a
    SERVICE, reachable only as `ctx['remote.agentPresets']`; `ctx.remote.agentPresets`
    is permanently `undefined` however the deployment is composed. Gating the launch
    button on the key form is what made it invisible on a harness that had
    ui-agent-preset loaded all along — it fails CLOSED, with no error anywhere. An
    earlier version of this file asserted the reverse, and the test pinning it only
    exercised the ABSENT case, so it stayed green while documenting the wrong rule.
    `probeNamespaced()` is the single guarded helper for this; the guard is still
    needed, because a profile that never provides the service does throw.
  - `test/context-probe.mjs` pins all of it against a REAL `Context` and the REAL
    built bundle, over a six-row deployment matrix. The matrix is exhaustive on
    purpose: with the property guard removed, THREE separate rows fail on three
    different reads — including a fully-configured deployment that still dies on
    `uiWorkspace` — and the namespaced row is what catches the hidden button.
    Testing only the all-absent case would have caught one of the four.
    **Stub the service the way the harness registers it**, not the way the code
    happens to read it: the earlier matrix stubbed `remote.agentPresets` as a key
    and so stayed green against a UI where the button never appeared.
- **Superpowers and the skills catalog need nothing here.** `dsh-superpowers` registers
  a system-prompt section on the context-GLOBAL layer, and `dsh-scope` merges every
  view starting from that layer before overlaying preset shadows — so a launched
  session gets the identical bootstrap to one started from the sidebar. The launcher
  always selects a preset explicitly, so it never hits the "published without joining
  an agent preset" path that resolves against the empty global layer.
- The dialog's prompt textarea is **12px**, not 13px: `test/icon-probe.mjs` allows only
  12/14/16/20 in this package, which is stricter than the repo-wide scale.

**`sessionId` records where the work went** — the sixth field, and the first to cross all
SIX faces (the five places above plus the CLI). `launchSession()` returns the id and
`onLaunched` writes it in the SAME `store.update` as the `in-progress` flip, so the
status and the session can never disagree about whether work started.

- **It is a HINT, not a foreign key.** Sessions are deletable and a task outlives the one
  that worked it. The row asks `sessions.binding(id) !== undefined` before offering
  **Open session**, so a dangling id falls back to Launch rather than rendering a button
  that errors on click. A miss **never clears the field** — an archived session can be
  restored, and this is the only record work was ever started. Storage stays honest; the
  UI decides what is actionable.
- **Single, last-launch-wins.** A relaunch overwrites it; follow-up work belongs in its own
  task, where the roadmap can see it. An array would hide that history in a field nobody
  reads.
- **v2 → v3 is one `add('session_id', 'session_id TEXT')` line**, backfill-free — every
  pre-v3 row correctly has no session. `todoDomainSpec.version` stays 2 deliberately: it
  is a dead compat marker for old test imports, NOT the SQLite schema version, and bumping
  it would imply a storage-domain migration that does not exist.
- The smoke test pins each boundary separately (wire codec, `coerceItems`, and a real v2
  database upgraded and reopened), because one round-trip passing hides which of the six
  places is broken. Verified against sabotages: dropping the `ALTER TABLE` fails loudly
  with `no such column: session_id` at the first read, and removing it from the wire
  schema or `coerceItems` each trips its own assertion.
- On the CLI: `--session <id>` on `update` (empty value clears, as with every optional
  field), shown by `show` and as `session=` in `list`. Unvalidated on purpose — a session
  id is an opaque harness token with no shape to check from a bare checkout.

### Destructive actions

`ConfirmDialog` guards every irreversible action. There are three paths to deletion (a row,
an archived row, and the bulk **Delete archived**) and all three route through one
`pending` slot on `TodoView` — a button that filtered the list inline would silently bypass
the guard, so `test/smoke.mjs` asserts a task is removed in exactly ONE place and that the
place is an `onConfirm` handler.

- `role="alertdialog"`, not `dialog`: this interrupts to demand a decision.
- **Focus opens on Cancel**, so a stray Enter dismisses rather than confirms the very thing
  the dialog exists to guard.
- The dialog **quotes the subject verbatim**. A prompt that does not name what it is about to
  destroy is one people learn to click through, and rows differ only by title.
- Wording differs by recoverability: an active task is offered archiving as the safe
  alternative; an archived one is told plainly that it is permanent.
- It replaced `window.confirm`, which is asserted absent — two confirmation UIs in one tab is
  its own bug.

### Schema migration

`CREATE TABLE IF NOT EXISTS` **does not add columns to an existing table**, so `migrateSchema()`
adds each v2 column with `ALTER TABLE` after consulting `PRAGMA table_info`, then backfills
`title` from v1 `text` and `status` from v1 `done`. The v1 `text`/`done` columns are still
written on every insert: a v1 table keeps them `NOT NULL`, so omitting them fails the insert.
The smoke test builds a real v1 database and asserts the upgrade — a fresh-install test cannot
catch this, because it only breaks for users who already have data.

## The CLI

`lib/bin.js` (bin name `dsh-todo`) is a THIRD face on the same list, built so an AI agent can
shell out and manage the tasks you see in the tab. Scoped to a workspace DIRECTORY
(`--workspace`, default cwd) — no profile, no session, no running server.

```bash
dsh-todo list --open --json
dsh-todo add "Fix token refresh" --priority p0 --release 1.5 --due 2026-03-14
dsh-todo update <id> --status in-progress --sprint 24
dsh-todo done|reopen|rm|show <id>
dsh-todo archive [<id>]        # no id = every completed task
```

`--json` shapes, which is what an agent parses. **Every payload leads with `ok`**, so the
verdict never has to be inferred from the shape: `{ ok: true, ... }` on success — `list` adds
`{ count, items }`, `add` / `update` / `done` / `reopen` / `rm` add `{ item, revision }`
(the stored task, so a write is confirmable without a second call), `archive` adds
`{ archived, revision }`, `show` adds the task — and `{ ok: false, error, code }` on failure,
plus `{ field, expected, got }` when a value was REFUSED, which is enough for an agent to
correct itself without parsing the sentence. Requires Node 22+ for `node:sqlite`, which warns on
stderr that it is experimental — harmless, and stdout stays clean JSON regardless.

- **It talks to SQLite directly, and that is safe.** SQLite is a multi-process database: its
  file lock refuses a writer that lands inside another process's transaction rather than
  letting it interleave, and `db.ts` sets `busy_timeout` so a CLI write WAITS for the harness
  commit instead of failing (the default is 0, i.e. fail fast). Verified live: the CLI wrote
  while a running server held its handle and the API returned the new task with no restart.
- **The `revision` token is the only visible side effect.** It is an in-memory optimistic
  check, so a CLI write makes an open browser tab's next write a `revision-conflict`; the tab
  then adopts the authoritative list. Designed reconciliation, not data loss.
- **`src/db.ts` is shared with the host on purpose.** A second copy of `migrateSchema` is the
  one duplication that could actually corrupt a database — the two would drift and leave a
  half-migrated table the revision token cannot protect. `test/cli.test.mjs` builds a real v1
  database and asserts the CLI upgrades it identically.
- **The CLI bundles NO harness packages and no zod**, so it runs in a bare checkout. It
  validates through the dependency-free helpers in `types.ts`.
- **Ids accept any unambiguous prefix.** Ids are time-ordered, so short prefixes collide
  often; an ambiguous one is an ERROR rather than a guess at which task you meant.
- **An empty option value CLEARS a field** (`--release ""`). From a shell there is no other
  way to distinguish "unset this" from "leave it alone". **PowerShell strips empty arguments**
  before Node sees them, turning that into a bare `--release` flag that clears nothing — use
  `--release=`, which the parser splits on `=` and which survives every shell.
- **Invalid values are refused, never dropped.** `--due 2026-02-31` and
  `--release v1.5` exit non-zero instead of silently storing nothing, because an agent would
  otherwise never learn it was ignored. `--release` takes up to three numbers (`0.5.1`),
  `--sprint` one dot at most, and `assertLabel` names the right shape per field; an empty
  value still CLEARS the field.
- **Exit codes are distinct**: `2` usage, `3` not-found, `0` ok — so a script can branch on
  why a command failed. `--json` prints JSON on the ERROR path too, and `CliError` carries a
  `details` bag that `main` merges into that payload (`assertLabel` fills it with
  `field`/`expected`/`got`), so a refusal is self-describing rather than a sentence to parse.
- **The shebang comes from the esbuild `banner`, not the source.** One in each makes the
  output a syntax error at load; `test/cli.test.mjs` asserts there is exactly one.

### Two test layers, and why both exist

`cli.test.mjs` imports `lib/cli.js` and calls `run()` / `main()` **in-process** — fast, and
where the argument parsing, filtering, id resolution and migration coverage lives.
`cli-integration.mjs` **spawns `lib/bin.js`** for one realistic agent workflow (plan a release,
inspect it, hit a refusal, recover from the payload alone, finish and archive). Both run in
`pnpm test`.

The split is not redundancy: the in-process suite cannot see the shebang'd entry point,
`process.exitCode`, the stdout/stderr split, or argv as a shell delivers it, so a refactor
that breaks any of those keeps it green. The integration suite was verified to FAIL against
four separate sabotages before being trusted — dropping `ok: true`, printing human errors to
stdout, treating `--release=` as invalid instead of a clear, and removing label validation
outright.

Two traps it encodes, both learned by getting them wrong:

- **Ids are time-ordered, so tasks created together share a long prefix.** A 4-character
  prefix over three fresh tasks is AMBIGUOUS, and the CLI must refuse it rather than resolve
  to whichever matched first. The test asserts the refusal, not a lucky resolution.
- **stdout must stay pure JSON under `--json`.** `node:sqlite` prints an experimental
  warning on every run; if it ever reached stdout, every `jq` caller would break. Pinned
  directly.

### `pnpm run test:agent` — opt-in, never in CI

`test/verify-agent.mjs` hands a REAL model nothing but the binary path and a goal, then
asserts on the **database**, never on what the model said. What it measures is whether the
agent-facing surface is self-serving: is `help` enough to discover the flags, and is a
refusal payload enough to correct a bad value unaided? The task deliberately plants
`v2.0` — a value the CLI must refuse — so recovering from the refusal is an objective, not
an accident. A failure here is usually a DOCUMENTATION bug (help text, refusal wording),
not a code bug.

It is excluded from `pnpm test` for the usual reasons — network, credentials, cost,
non-determinism — and it runs the harness in a **throwaway `DSH_HOME`**. That isolation is
mandatory, not tidiness: DSH Desktop sets `DSH_HOME` to its own directory, and a second
harness on a live home corrupts the sessions it is holding open. The cost of that isolation
is that a throwaway home has **no stored credentials**, so the probe needs
`DEEPSEEK_API_KEY` exported, or `DSH_AGENT_HOME` pointed at a home that has one *with no
harness running*. It distinguishes a runner failure from a model failure explicitly — an
empty transcript is reported as the harness failing to start, never as the model failing
the task. **The model-driving path is unverified here**: it has only been run as far as the
credential check.

## Endpoints

- `POST /api/dshTodo/list` — `{ workspaceId }` → `{ list: { items, revision, updatedAt } }`
- `POST /api/dshTodo/replace` — `{ workspaceId, items, ifRevision }` → `ok:true` with the new list, or `ok:false, code:'revision-conflict'` when `ifRevision` is stale

Each takes exactly one parameter named `request`, and `wire: 'request'` in `src/remote.ts` must match it — the gateway resolves endpoints by reading parameter names off the function source.

`lib/typert.host.js`, exported as the `./typert` subpath, is what publishes these to the API gateway. **A package without that export is skipped silently**: the service still constructs, the tab renders, and every call 404s. The loader caches its per-package verdict for the process lifetime, so registration needs a full profile restart, not a refresh.

## Mounting

**Self-mounting.** `package.json` declares `dsh.bundle.patch` pointing at this package's own
`cordis.patch.yml`, which carries the insert row:

```yaml
- insert:
    - id: dsh-todo
      name: '@dennisrongo/dsh-todo'
```

`dsh plugin add` appends the package to the profile's `dsh.profile.bundles` and that row composes
automatically. **Do not also add an `insert:` row to the profile's `cordis.patch.yml`** — a second
row with the same id is fatal: `duplicate loader entry id: dsh-todo`. A bare `id:` entry there is
still the right way to *configure* the row.

Works on both surfaces: the dsh CLI (`~/.dsh/profiles/<name>`) and DSH Desktop (`%APPDATA%\dsh-desktop\harness\profiles\<name>` — the desktop keeps its own DSH_HOME). Install per profile with `pnpm add "file:<repo>/plugins/dsh-todo"`, using a native forward-slash absolute Windows path; the MSYS `/c/...` form fails `LINKED_PKG_DIR_NOT_FOUND`.

## Dev loop

`pnpm install` at the monorepo root, then `pnpm run build` here (emits `lib/index.js`, `lib/client.js`, `lib/typert.host.js`, `lib/cli.js`, `lib/bin.js`) and `pnpm test` (offline).

**`pnpm test` rebuilds first** (`node build/build.mjs && …`), matching `dsh-git` and `dsh-weather`. Both suites read the **built** `lib/` — `smoke.mjs` asserts marker strings against `lib/client.js`, and `cli.test.mjs` imports `lib/cli.js` — so without that prefix they pass against a stale bundle. Verified on both halves: renaming `dshtd-confirm-subject` in `src/client.tsx`, and `no task matching` in `src/cli.ts`, each left the un-prefixed suite green and each is now caught. That is the defect class that rotted `dsh-mission-control`'s markers unnoticed. Running a test file directly still skips the build, so prefer `pnpm test`.

Note `test` invokes `build.mjs` directly rather than `pnpm run build`, so any `postbuild` hook stays out of the test path — testing must not mutate a profile.

Profiles materialise `file:` deps as copies **frozen at install time**, so a rebuild does not reach them. `scripts/dev-link.ps1` at the repo root replaces those copies with junctions: client-half edits then deploy on **browser refresh**, host-half edits need a **profile restart**.

**Re-run `scripts/dev-link.ps1` after any `pnpm install`.** It restores both the profile junctions and this package's `node_modules\@deepseek-ai\*` junctions to the CLI host copies. DSH Desktop's profile-repair install additionally empties this package's `node_modules`, taking `zod` with it, after which the harness refuses to boot with `Cannot find package 'zod' imported from ...\lib\index.js`. Fix: `pnpm install` at the monorepo root, then the script.

`pnpm run test:icons` drives headless Chrome against the **built** `lib/client.js` and
asserts the shell's sizing conventions. It needs no running harness.

- **Icons are 16px inline SVGs on a matching `0 0 16 16` viewBox.** The shell draws icons at
  12/14/16/20 but pairs every size with its own viewBox, so 16-unit path data rendered into a
  14px box comes out shrunk with thinned strokes. `Icon` is therefore fixed at 16 with no size
  prop — footprint is the button box's job. The set is inlined because
  `@deepseek-ai/dsh-client-ui-primitives` is a build-time external of the host bundles: not a
  loadable client module, not served over `/plugins/`, so a plugin cannot import it.
- **Native controls need `color-scheme`, not CSS.** A `<select>`'s dropdown popup and the
  date input's calendar are painted by the OS *outside* the page, so no descendant rule
  reaches them — they obey `color-scheme` alone. Left unset the popup renders LIGHT while the
  option text inherits the shell's near-white label colour: white-on-white and unreadable.
  The rule is keyed to `@media (prefers-color-scheme: dark)` — the same signal
  `dsh-client-ui-theme` listens to via `matchMedia` — because the shell publishes its theme as
  CSS variables and sets **no** `color-scheme` or `data-theme` to inherit from. Scoping to the
  query is load-bearing: applying the `option` colours unconditionally paints a dark popup
  under a light theme, the same bug inverted. `.dshtd-modal` repeats the declaration because
  it portals to `document.body` and inherits nothing from `.dshtd`.
- **Text is on the shell's 12/14/16 scale** with paired line-heights; the probe fails on any
  other declared `font-size`. Body text is 14px/22px, captions 12px/18px.
- **Rows are 40px and the probe fails if they grow.** In a flex row the tallest child sets the
  height, and three separate things tried to add pixels here: a 24px icon button (use 20px), the
  body scale's 22px line-height leaking into the row (`.dshtd-row` pins `line-height: 20px`),
  and the checkbox's `margin-top` — at 16px a 2px top nudge alone exceeded the 20px line, so it
  uses symmetric `margin: 2px 0` to centre on the first text line and stay put when text wraps.
  Sizing the checkbox to `height: 20px` instead stretches the native control and makes rows
  *worse* (46px). Each of these was measured, not reasoned about.

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
