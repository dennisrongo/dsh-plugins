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
sessions.create". So a launch is a six-step sequence, and its order is load-bearing:

1. `ctx.sessions.create({ workspaceId })`
2. `ctx.remote.agentPresets.select(sessionId, presetId)`
3. `ctx.modelDirectories.directoryFor(sessionId).select({ provider, model })`
4. `binding.session.prompt([{ type: 'text', text }], 'queue')`
5. `binding.session.rename(title)`
6. `ctx.sessions.open(sessionId)`

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
- **A successful launch calls BOTH dialog callbacks, so `closeLaunch` runs TWICE.**
  `LaunchDialog.launch()`'s resolve handler fires `onLaunched(id)` and then
  `onClose()`, which route to `closeLaunch(true)` and `closeLaunch(false)`. With
  the open dialog read from the render closure (`const open = launching`), the
  second call still saw the session the first had just cleared — `setLaunching(null)`
  does not rebind a captured `const` — took the `!launched` branch, and ran
  `discardSession()` on the session that had *just received its prompt*. The
  session started, got its brief, navigated, and then died, leaving the task
  flipped to `in-progress` pointing at an archived session. **Nothing surfaced
  anywhere**: `discardSession()` swallows every failure by design, on the
  reasoning that the user cancelled and has moved on. That deliberate silence is
  what turned a create-then-archive race into an invisible one.
  The fix reads a `launchingRef` mirror and **blanks it in the same step**, which
  is what makes the close idempotent. Both calls happen inside one handler,
  before React commits anything, so a ref refreshed only during render would be
  exactly as stale as the closure it replaced — and the setter's updater form is
  wrong here too, because discarding is a side effect and React may invoke an
  updater more than once per commit. `test/launch-lifecycle.mjs` pins both
  directions: confirming must archive NOTHING, and cancelling must STILL archive,
  since deleting the discard call trades this bug for the sidebar litter that
  create-on-open pays `discardSession` to prevent. It carries its own sanity row
  asserting the stale-closure form reproduces the archive, so the test cannot
  pass vacuously.
- **A launched session is NAMED after its task, and the only reachable rename is
  on the SESSION BINDING.** Without step 5 the title is *invented*: the
  deployment composes `dsh-session-title-first-prompt-llm`, which asks a model to
  summarise the first human message, so a session launched for an exact task gets
  a vague paraphrase of `composePrompt()` output instead of the name the task
  already had.
  The obvious route is a dead end. `sessionTitle` is a **host** service, its
  `rename()` carries **no `@Remote` decorator**, and `dsh-session-title`'s client
  face is literally `export {}` — types only, no runtime API. The client half
  therefore cannot reach it, and no amount of `inject` will change that. The path
  that works is the one the shell's own sidebar uses
  (`dsh-client-ui-workspace/lib/client.js:2720`):
  `sessions.binding(sessionId).session.rename(title)` — **the same binding object
  this module already holds to send the prompt**, so it costs no new service and
  no new guarded read.
  Three properties of that call, all read from the connection source
  (`dsh-client-connection/lib/client.js:3712`) rather than assumed:
  - It records `source: { kind: 'user' }`, which **PINS the title** — a user
    rename permanently supersedes automatic generation. That is the intent here,
    but it means the name is final, not a first guess the model may improve.
  - It normalises (`trim`, collapse whitespace runs) and **refuses a blank title**
    with `title-invalid`. `sessionTitleFor()` mirrors that normalisation so a task
    whose title is whitespace-only yields `undefined` and skips the call entirely,
    rather than spending a round-trip to be told no.
  - It is **step 5, after the prompt, deliberately.** Unlike the preset there is no
    blank-session window to beat — the connection just appends a `session/title`
    event — so going earlier buys nothing, while going later means a launch that
    failed above leaves no renamed session behind to explain.
  A rename failure is **non-fatal**, unlike the mode: a launch the user already
  confirmed must not fail over a cosmetic title, and the fallback is exactly the
  status quo. Both the call and the await are guarded, because `rename` is a
  borrowed face that may be absent on an older binding.
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
  - **`c.remote?.agentPresets` is NOT a safe fallback — it THROWS.** `remote` is
    itself a Proxy, and optional chaining guards a nullish object, never a proxy
    trap on the property. A `?? c.remote?.agentPresets` tail added as
    belt-and-braces behind the already-correct guarded read escaped the try/catch,
    crashed the `conversation.view` slot, and emptied the tab a SECOND time
    (`slot entry crashed in 'conversation.view'` in the browser console). There is
    no fallback now and there must not be one: the namespaced form is the only
    correct access, so the tail bought nothing and cost two outages.
  - **A service that RESOLVES is not a service you can CALL.** A separate bug
    class from every read above, and the cause of the THIRD `conversation.view`
    outage: `cannot get property "remote.session" without inject` — naming a
    service this package's source never mentions anywhere.
    `modelDirectories.directoryFor()` runs `this.ctx.remote.session` inside
    `dsh-client-ui-model-selection` (`lib/client.js:301` — the
    `Proxy.directoryFor` frame in the stack trace), but the proxy carrying that
    call is bound to **dsh-todo's** fiber, which declares only `remote.dshTodo`,
    `workspaces`, `slots`. So every existence guard passes — `ctx.get()` returns
    it, `probeNamespaced` returns it, `launchContext` stores it — and the FIRST
    METHOD CALL throws. Guarding the READ cannot catch this; the throw happens
    inside the callee.
    Guard at the **boundary**, not per call site: `safeModelDirectories()` wraps
    the handle once in `launchContext()` so `directoryFor` yields `undefined`
    instead of throwing, collapsing "unreachable" into the already-supported
    "absent" state (no picker, launch on the deployment default). Wrapping once
    is the point — the raw handle reached two call sites, and a per-site guard is
    one forgotten `try` away from outage four. `dsh-mission-control` had guarded
    both its `directoryFor` calls all along, which is why it never broke.
  - **Stub service objects as throwing Proxies, never plain objects** — letting
    symbols through, since cordis probes its own tracker symbols. A plain-object
    stub answers `undefined` for any missing key and therefore cannot fail, which
    is exactly why the matrix stayed green through both outages. For the same
    reason the matrix must NOT provide `remote.agentPresets`: a check that supplies
    the optional service can never exercise its absence.
  - `test/context-probe.mjs` pins all of it against a REAL `Context` and the REAL
    built bundle, over a six-row deployment matrix. The matrix is exhaustive on
    purpose: with the property guard removed, THREE separate rows fail on three
    different reads — including a fully-configured deployment that still dies on
    `uiWorkspace` — and the namespaced row is what catches the hidden button.
    Testing only the all-absent case would have caught one of the four.
    **Stub the service the way the harness registers it**, not the way the code
    happens to read it: the earlier matrix stubbed `remote.agentPresets` as a key
    and so stayed green against a UI where the button never appeared.
- **A catalog GROUP is a PROVIDER, and a shipped preset's name is TRANSLATED
  COPY.** Both pickers were broken for the same underlying reason — the shapes
  were guessed rather than read — and both failed silently.
  `dsh-client-ui-model-selection` builds every selection as
  `{ provider: group.id, model: model.id }`, labels it `model.name`, and heads
  the group with `group.name`; there is **no `model.provider` anywhere** in that
  catalog. `flattenModels` required one, so its guard skipped every row and the
  model picker rendered EMPTY with no error. The smoke test had invented its own
  fixture (`model.provider`, `group.label`, `group.items`) and asserted the code
  matched the invention, so it stayed green throughout — **a test that makes up
  its input can only prove the code agrees with the test.** The fixture is now
  copied from the real projection, and a negative row pins that a group without
  an `id` yields nothing.
  Likewise `presetDisplayText()` resolves a preset whose `trust === 'system'`
  through `t('presetCordisName')` and never renders the roster's own `name` —
  which in this build is Chinese. Reading the raw field put **创造模式** in the
  mode picker on an English UI. `presetOptions` now takes an optional locale
  lookup, translates ONLY the four shipped ids
  (`standard`/`ptc`/`minimal`/`cordis`), leaves a user-authored preset's name
  alone, and discards a lookup that echoes the key back. `locale` is optional
  and borrowed like the rest, so both the read and `bind()` are guarded.
- **Superpowers and the skills catalog need nothing here.** `dsh-superpowers` registers
  a system-prompt section on the context-GLOBAL layer, and `dsh-scope` merges every
  view starting from that layer before overlaying preset shadows — so a launched
  session gets the identical bootstrap to one started from the sidebar. The launcher
  always selects a preset explicitly, so it never hits the "published without joining
  an agent preset" path that resolves against the empty global layer.
- The dialog's prompt textarea is **12px**, not 13px: `test/icon-probe.mjs` allows only
  12/14/16/20 in this package, which is stricter than the repo-wide scale.

**`sessionId` records where the work went** — the sixth field, and the first to cross all
SIX faces (the five places in "Adding a field" plus the CLI). `launchSession()` returns the id and
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

### Scanning for suggestions

**Suggest** in the tab header opens `SuggestDialog`: the host builds a bounded evidence
digest, the client hands it to a background session, and the session writes a result file
the modal polls. Checked rows become real backlog tasks. `src/scan.ts` (the digest) and
`src/suggest.ts` (the prompt and the parser) are both dependency-free — they import
`./types.ts` and node builtins and nothing else — so both are importable by the tests under
plain Node, the same constraint `launch.ts` carries.

**The result is a FILE, not a return value, because there is nothing to await.**
`session.prompt()` resolves when the prompt is *accepted*, not when the work is done, and
the harness publishes no completion promise anywhere. So the result needs a rendezvous
point rather than a callback. `<workspace>/.dsh/suggestions-<runId>.json` is one the host
can already read, is inspectable by hand when a scan misbehaves, and survives the modal
being closed mid-scan — a return value would not exist to be collected.

**The rendezvous is PER RUN, because ARCHIVING IS NOT CANCELLATION.** `discardSession()`
calls only `uiWorkspace.archiveSession(sessionId)`, which in the harness is a one-line
delegation to `workspaces.archiveSession` — **sidebar visibility, nothing else**. There is
no abort, interrupt, cancel or stop anywhere in `launch.ts`, and none is reachable: the
agent turn keeps running to completion and eventually writes its file. Against one fixed
workspace-global path that late write is indistinguishable from the current run's answer,
and it lands two ways:

- **Timeout.** Scan A exceeds `SCAN_TIMEOUT_MS`, the modal says so, A is archived-but-alive.
  The user clicks Refresh (legal — Refresh is disabled only while `phase === 'scanning'`),
  and B starts. A finishes, writes, and B's next poll — within 1.5s — reads A's file,
  reports `ready`, and presents **A's suggestions as B's results**, then deletes the file so
  B's real output is later read by nobody. A's answers were computed against a **stale
  exclusion set**, so they duplicate tasks the user added in between, defeating the feature's
  premise; `seenRef` is then poisoned with A's titles as though B produced them.
- **Closed modal, and this is the likelier one.** The user closes the modal mid-scan. The
  session finishes and writes. The file sits on disk. The *next* scan — minutes or days
  later, after the backlog has changed — reads it within 1.5s and presents it as fresh.
  Silently.

So `composeScanPrompt(digest, exclude, runId)` names a per-run path, `readSuggestions` takes
the `runId` and reads **only** that path, and a late writer therefore cannot be mistaken for
the current run. Deleting any pre-existing file before prompting would be the minimal fix and
is **not enough** — it leaves the closed-modal path wide open. `makeRunId()` mints the token
on the same terms `makeItem` mints an id (`Date.now()` + `Math.random()`, base36, no new
dependency); it needs to be unique per scan, not unguessable.

- **The runId must be named in `src/remote.ts`.** The change is additive, but a **strict
  codec strips fields it does not name**, so an unlisted `runId` never leaves the browser and
  the host rejects every poll — with the real cause invisible on both ends. This is the same
  trap as "Adding a field is a SIX-place change", one field wide.
- **The host REFUSES a malformed runId** (`/^[a-z0-9]+$/`) rather than interpolating it into
  a path. `..` would put the read outside `.dsh`, and the token is generated, so anything
  else is a caller bug worth naming.
- **Orphans are swept on every poll**, not at scan start: one `readdir` of `.dsh` is trivial
  beside the digest walk that just ran, it clears a file left by a build that had no sweep,
  and it collects the **legacy fixed-path file** too, so the upgrade needs no migration step.
  Without it `.dsh` accrues one orphan per abandoned scan forever, and abandoning a scan is
  the ordinary case — closing the modal does it. `SUGGESTIONS_FILE_RE` is anchored at both
  ends: `.dsh` holds `todo.db` and whatever else the harness keeps there, and a wider guess
  would delete a neighbour's data.
  **Sweeping on every poll has one known cost: two SIMULTANEOUS scans on one workspace now
  DELETE each other's files rather than READING each other's.** The victim loses a result
  that had genuinely completed, then polls a path that will never appear and reports *"the
  scan did not finish in time"* — false, since the scan finished and the reader destroyed the
  answer. Accepted deliberately, because the failure it replaces was worse and silent: a
  stale run's suggestions presented as fresh, computed against an outdated exclusion set, and
  poisoning `seenRef` on the way through. This trades wrong-and-silent for lost-and-noisy.
  Reachability is low — `suggesting` is one boolean per tab and Refresh is disabled while
  scanning, so a single tab cannot self-collide; it takes two browser tabs, or a tab plus the
  Desktop, on one workspace at once. A proper fix needs an age threshold on the sweep, i.e. a
  second timing constant, which is not worth it for this case.

**A background session, and not a direct model call, because the alternatives are exactly
the bet this file records losing four times.** `@deepseek-ai/dsh-llm` (service key `llm`) is
a *config* service — `prepareCall`, `resolveModelInfo`, `listModels`. It resolves which
model and which credentials, and exposes no "send a prompt, get text" method at all; the
Desktop install ships no `.d.ts` for it, so building on it means reading a minified bundle
for a call shape this repo does not own. `dsh-subagent`'s `prompt()` does send text, but it
requires a live parent agent (`ctx.get('agents')?.get(parentSessionId)`, rejecting
`subagent-parent-unavailable`) — it serves the agent loop, not a UI button. Both routes are
reading harness internals that were guessed rather than published, which is the single
cause of every outage above: `flattenModels` requiring a `model.provider` the catalog never
had, the button gated on `ctx.remote.agentPresets`, the `ctx.remote?.agentPresets` fallback
that threw through its own try/catch, and `directoryFor` throwing from inside a callee.
All four failed silently, and none produced an error anywhere the tests could see. The scan
therefore uses only public paths the plugin already depends on: `sessions.create()`,
`sessions.binding(id).session.prompt()`, and its own host endpoints.

- **The digest is bounded, and every truncation MARKS ITSELF.** Not a nicety: a model given
  a clipped digest with no marker reasons confidently about a codebase it only half saw.
  Every section header routes through `sectionHeader()` and reports its true total against
  what survived (`(200 found, showing 80)`, with `+` when counting itself stopped at a
  ceiling and the total is a LOWER BOUND), `fileHeader()` discloses a README or manifest
  clipped to a leading slice, the walk appends its own `[walk truncated — …]` line, and
  `assemble()` marks the byte ceiling. Only `MAX_COMMENT_LINE`'s 160-char body clip is
  still silent, deliberately.
- **The effective ceiling is ~17KB, not `DIGEST_BYTE_CAP`'s 24KB**, because the per-section
  caps bind first and the byte ceiling is a backstop that rarely fires. Do NOT size a prompt
  budget against 24KB, and never read a small digest as a complete one.
- **`truncated` is advisory only.** It is a bare boolean over several independent caps, so
  it conflates "the file tree was clipped" (cosmetic) with "half the TODO comments are
  missing" (material). The digest TEXT is what distinguishes them, which is why the digest
  is self-describing and why `scanDigest` passes the flag through uninterpreted rather than
  branching on it.
- **`MAX_FILES_READ` (400) is what bounds the scan's cost — not the comment cap.** An
  earlier version removed `collectComments`' early exit so the total could be honest rather
  than asserting that the 80 kept comments were all there were, and that alone took a
  1200-file workspace to 3.4s and a 4000-file one to ~19s. A ceiling on comments FOUND does
  not fix it: with one TODO per file, counting to 800 still opens 800 files, which measured
  a 9% saving. The cost is per-FILE — the read and the line split — and is paid in full
  whether or not the file contains anything, so the bound has to be on files opened. The
  comment ceiling stays as the second of the two (whichever binds first stops the scan), and
  either one makes the reported total a disclosed lower bound (`400+ found`) rather than a
  silent drop. Deliberately not a time budget: a deadline makes the digest depend on machine
  speed, so the same workspace yields different evidence twice and a test can only assert it
  flakily.
- **`scanDigest` BLOCKS the host event loop for its whole duration.** `buildDigest` is fully
  synchronous and `async` does not yield, so the entire walk runs in one tick on a
  single-threaded host and every other RPC stalls behind it — measured ~3.15s on a
  1200-file fixture. The client therefore renders `SuggestSkeleton` **before** issuing the
  call, or the tab reads as frozen rather than busy. That ordering is pinned in `smoke.mjs`
  by comparing source indices (`setPhase('scanning')` before `remote.scanDigest(`), and
  anyone issuing this call from a new place must preserve it.
- **An EMPTY digest is guarded, and the guard runs BEFORE `sessions.create`.** `buildDigest`
  returns `{digest: '', truncated: false}` for **four** distinct cases — a missing workspace
  directory, a root that is not a directory, a genuinely empty workspace, and one whose files
  are all under `IGNORED_DIRS`/dotdirs — and none of them is an error. Unguarded,
  `composeScanPrompt('')` emits an empty `## Evidence` section directly under the instruction
  *"do not speculate about code you cannot see"*. A compliant model then writes `[]`, and the
  modal renders *"Nothing new to suggest — the backlog already covers what the scan found"*:
  a **FALSE CLAIM about the user's workspace**, since the scan found nothing because it could
  not look. That is the `dsh-plan-board` defect — "there is nothing" conflated with "we could
  not look" — reintroduced one layer up, where the loading flag is right and the EMPTY STATE
  is the lie. A non-compliant model instead writes prose and the user watches the skeleton for
  the full 180s.
  The **ordering is the fix, not the message**. A guard placed after `sessions.create` still
  shows the right text but has already spent a real session and its tokens on evidence that
  does not exist. `smoke.mjs` therefore compares source indices — the same technique that pins
  `setPhase('scanning')` before `scanDigest` — because otherwise the fix is one refactor away
  from silently reverting. It lands in `phase: 'error'`, deliberately the recoverable state, so
  a workspace that was merely being remounted retries with one Refresh click.
- **Only `ENOENT` means "not yet".** `readSuggestions`' read catch branches on errno,
  because most failures are TERMINAL and waiting cannot clear them: a directory sitting at
  the result path (`EISDIR`, from a bad `mkdir -p` or a hand-created folder) or a locked-down
  volume (`EACCES`) will read the same way forever. Reported as `pending` those poll
  FOREVER — the modal spins on "Scanning…", never offers Refresh, and never terminates.
  Unknown errnos default to `error` **deliberately**, which slightly over-reports
  (`EMFILE`/`ENFILE`/`EBUSY` are genuinely transient): the trade is asymmetric, because a
  misclassified transient costs one dismissible error that Refresh recovers, while a
  misclassified terminal costs an unbounded hang with no exit. A recoverable wrong answer
  beats an unrecoverable one. The modal's half of that bargain is that **Refresh is disabled
  only while `phase === 'scanning'`** and never latches off on an error.
- **The result file is consumed on BOTH paths**, and the error path is the load-bearing one.
  `unlinkSync` sits BEFORE the `parsed.ok` branch, so a malformed result cannot survive the
  read. Left on disk it would be re-read on every poll and pin the modal to the same error
  forever, with no way out but deleting the file by hand. Deleting on success separately
  stops a previous run's answers appearing while a new scan is still working — a stale list
  that looks fresh is worse than an honest empty one.
- **The skeleton keyframe MUST be named `*-shimmer`, and this is a live trap for any future
  skeleton in this package.** `scripts/check-progress.mjs` matches sweep keyframes as
  `[a-z-]*shimmer`; under any other name all three sweep invariants — gradient
  `background-position`, timing, the `prefers-reduced-motion` flatten — silently do not
  apply. Proven by sabotage rather than reasoned about: under the original name
  `dshtd-sug-sweep`, a deliberately broken `2s linear` animation printed *"ok — every
  loading state follows the shared rule"*; renamed to `dshtd-sug-shimmer`, the identical
  sabotage goes red. Note also that the checker's a11y regexes match `[a-z]+-skel`, which
  cannot see a two-segment class like `dshtd-sug-skel` — so the `role="status"` /
  `aria-busy` / `aria-hidden` contract escapes the repo-wide check and is pinned LOCALLY in
  `smoke.mjs` instead. Widening the checker is a repo-wide change affecting all eleven
  plugins and was left out of scope; until it lands, a new skeleton here gets no a11y
  enforcement it does not write itself.
- **A suggestion's TITLE is its identity** — the React key, the `checked` `Set` member, and
  the dedupe key, all three. So `parseSuggestions` dedupes case-insensitively after
  trimming, and models do repeat themselves. Without it two rows sharing a title collided
  twice over: one checkbox toggled BOTH rows, and "Add selected" wrote the same task into
  the backlog twice from one click. Keying rows by index would silence the React warning and
  fix neither. The dedupe keys off the **clamped** title (post-`MAX_TEXT`), because the clamp
  is what the modal renders and keys by — keying on the raw title would let two rows collide
  downstream and reintroduce the exact bug. It also runs BEFORE `MAX_SUGGESTIONS` counts an
  entry, so a repetitive response still yields up to 12 distinct ideas.
- **The scan session's cleanup reads a ref and blanks it in the same step.** Same discipline
  as the launch flow and for the same reason — see the `closeLaunch` outage documented
  above, where a render-closure copy archived a session that had *just* received its prompt.
  Here `cleanup()` takes `sessionRef.current`, nulls it, and only then discards, which is
  what makes it idempotent across the five paths that call it (ready, error, timeout, the
  catch, and unmount). A `cancelledRef` guards the poll loop; `runScan` may only clear it
  because Refresh carries `disabled={phase === 'scanning'}`, so no earlier loop can still be
  live — an invariant enforced in the JSX and consumed in the callback with nothing linking
  the two.
- **Suggestions are never stored.** They are proposals until promoted; only "Add selected"
  writes, and it writes through the existing `store.update` path in exactly ONE place, as a
  single batched call, so it inherits revision-conflict reconciliation and puts one
  round-trip on the wire rather than one per checkbox. Note `makeItem(title, now, rand,
  fields)` — `fields` is the FOURTH parameter, and passing the options object second
  silently makes it the `now` timestamp, producing a garbage `id` and `createdAt` with no
  error anywhere.
- **…which is exactly why the close is GATED on the write applying.** `store.update` returns
  early and silently when `this.state.status !== 'ready'`, so a store in `error` swallows the
  transform. Closing anyway meant the user checked five suggestions, clicked **Add selected**,
  watched the modal close, and got nothing — and since suggestions are never stored, the picks
  were unrecoverable without another 180s scan. `update` therefore returns **whether it
  applied** (false also covers a no-op transform, which callers that close on success want
  too), and `addSelected` returns early on false. Two details are load-bearing:
  - The refusal is reported through its **own** `addError` state, never `phase`. The rows
    render only while `phase === 'ready'`, so `setPhase('error')` would blank the very picks
    the guard exists to preserve — the fix reintroducing its own bug.
  - Gating beats disabling the button. `disabled` tracks `phase`, which is the **scan's**
    state and says nothing about the store's, so the two can legitimately disagree; and
    leaving the dialog open with the rows still checked lets the user retry the moment the
    list reloads.
- **The button is gated on the SAME `launch` context the rocket button uses**, and on
  nothing else. A scan runs in a real session, `sessions` is the one service it cannot fake,
  and `launchContext()` already yields `undefined` when it is unreachable — so a profile
  without it gets a working todo tab with the button simply absent, never a throw inside the
  `conversation.view` slot. `test/context-probe.mjs` covers it with the launch matrix.

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
- `POST /api/dshTodo/scanDigest` — `{ workspaceId }` → `{ digest, truncated }`. Read-only and side-effect free: it neither starts a scan nor touches the database. **Synchronous, and it blocks the host event loop** for the whole walk — never treat it as cheap.
- `POST /api/dshTodo/readSuggestions` — `{ workspaceId, runId }` → `{ status: 'pending' }` while `<workspace>/.dsh/suggestions-<runId>.json` is absent, `{ status: 'ready', suggestions }` once it parses, or `{ status: 'error', error }` on a malformed result or any non-`ENOENT` read failure. **Consumes the file on both the ready and the error path**, reads **only** the named run's file, and sweeps every other `suggestions*.json` in `.dsh` as an orphan. `runId` is **required** and must match `/^[a-z0-9]+$/`; a missing or malformed one rejects rather than being joined into a path.

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
