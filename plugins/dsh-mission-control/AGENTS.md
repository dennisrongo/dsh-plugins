# AGENTS.md — @dennisrongo/dsh-mission-control

Fleet dashboard for DeepSeek Harness: live sessions, subagent swarm tree, token burn and a
permission inbox, floating over the stock web UI.

The panel registers into dsh's additive `shell.overlay` slot and reads public faces
only: `ctx.sessions.list` (an ObservableSnapshot bridged into React), `sessionStats`
projections (turns / steps / llmMs / decodeTokens), and pending interactions — off the session
summaries on harness `0.1.1`, and off `uiSession.pendingInteractions` on `0.1.2`, which moved
them (see the waits section below). The fleet rendering stays a **pure consumer** — no tools,
no presets.

**It gained a minimal host half (v0.4.0) for exactly one reason: persistence that survives
DSH Desktop restarts.** Desktop serves the UI from an ephemeral port per launch, and
localStorage is origin-scoped, so every restart was a fresh origin and the pomodoro timer
vanished. The host owns one opaque JSON cell per harness home at
`<DSH_HOME>/storages/dsh-mission-control.json` (atomic tmp+rename writes, 64KB cap, never
parsed by the host — the client owns the envelope shape via `packPomodoroEnvelope` /
`parsePomodoroEnvelope`). The wire payload is a deliberately opaque string so the contract
never changes when the panel's state grows a field. **Degradation is the contract:** with no
host half reachable (older install), the panel runs on localStorage exactly as before; the
client seeds synchronously from localStorage and adopts the host cell only when its
`updatedAt` is newer and this mount is still untouched.

Host-half changes need a **profile restart**, not a browser refresh (the `./typert` export is
read at boot), and the wire probe the sibling packages document now applies:
`POST /api/dshMissionControl/load` → `{"type":"server-response","result":{"ok":true,"value":{"state":...}}}`;
a 404 means the `./typert` export is not registered.

Two halves in one package:

- **Host** (`src/index.ts` → `lib/index.js`) — `MissionControlService extends TypertRemoteService`,
  cordis service key `dshMissionControl`. Owns one opaque JSON cell at
  `<DSH_HOME>/storages/dsh-mission-control.json`. Never parses the payload.
- **Client** (`src/client.tsx` → `lib/client.js`) — the overlay, CSS prefix `dshmc-`, calling
  the host as `ctx.remote.dshMissionControl.load(...)` / `.save(...)`. Fleet rendering stays a
  pure consumer.

## Endpoints

`POST /api/dshMissionControl/<method>`, each taking one parameter named `request`:

- `load` — `{}` → `{ state: string | null }`; an absent or unreadable cell reads as `null`
- `save` — `{ state: string }` → `{ ok: true }`; refuses a non-string or a payload over 64KB;
  writes are atomic (tmp + rename)

`wire: 'request'` in `src/remote.ts` must match the host parameter name — the gateway
resolves endpoints by reading parameter names off the function source.

`lib/typert.host.js`, exported as the `./typert` subpath, is what publishes these to the API
gateway. **Without it the package is skipped silently**: the service constructs, the overlay
renders, every call 404s. The loader caches its per-package verdict for the process lifetime,
so registration needs a full profile restart.

## Surfaces

Two surfaces share one component tree, and that is why control sizing is tokenised rather
than hardcoded:

- **The docked panel** — a 400px right rail the shell reflows around. Compact controls are
  appropriate here. The frame reservation pads the shell by the rail's width PLUS
  `--mc-dock-gap` (16px): the centered chat supplies its own margins, but full-width
  `conversation.view` plugins (Todo, Source Control) would otherwise run flush against
  the rail's seam and read as if the panel sits on top of their components. The effect
  reads the gap back through `getComputedStyle`, so the stylesheet and the reservation
  cannot drift; `test/smoke.mjs` pins the marker.
- **Stage** — a full-screen takeover (`inset: 0`) holding a live grid of tiles. It is
  layered *over* the panel modes and is deliberately **not** a third mode, so exiting
  restores the tab you came from. Membership *and order* come from `stageRows`:
  running/waiting roots plus anything touched inside the activity window (`30m`/`2h`), most
  active first. A tile answers a pending permission **in place** through the same
  `PendingInteraction` path the inbox uses.

`--mc-ctl-h`, `--mc-ctl-font`, `--mc-msg-size` and `--mc-msg-line` are declared on `.dshmc`
and **overridden on `.dshmc-stage`**. Hardcoding a px size in a rule both surfaces use is the
bug this prevents: the rail's 11.5px/28px controls read as undersized on a full-screen grid
of 420px tiles.

**A stage tile is never STAGED, so it owns its own history window — including the
retries.** `SessionRuntime.followCurrent` opens the window for the *current* session only,
which is why an off-stage tile starts at `openState: 'cold'` with an empty chat and must call
`session.open()` itself (`shouldOpenHistory`). The half that was missing is the failure path:
a failed open lands on `'error'`, and the host's only retry is "the next time this session is
staged" — which for a stage tile never comes. One lost race (an `open()` overlapping a
reconnect's `resync`, a blip while the socket is down) therefore pinned the tile on its
fallback caption for the life of the mount, and the caption told the user to go open the
conversation — a workaround standing in for the bug. `shouldRetryHistory` re-arms `'error'` a
bounded `HISTORY_RETRY_LIMIT` times, counted per face in a ref and keyed on the observed
`openState` so the effect re-runs on the transition into `'error'`. Budgeted per mount, not
per flush: retrying on every snapshot flush would hammer a genuinely broken session once per
render, which is why `shouldOpenHistory` refuses `'error'` and stays that way.

**The transcript LEFT the Session snapshot in 0.1.2, and both eras run on one machine.**
Up to `0.1.1-rc.2`, `Session.buildSnapshot()` carried the whole conversation, so `snap.chat`
was the tile's transcript. In `0.1.2-alpha.1` that method was cut down to status only —
`chat`, `views`, `nodes`, `turnTimings`, `partial`, `runningCalls` and `pending` all left the
Session face (`ConversationSnapshot` no longer exists, and `dsh-api-session-controller`
contains no reference to chat at all) — and assembly moved to the `uiConversation` service:
`uiConversation.binding(sessionId).target('chat')` is an ObservableSnapshot of the same
`{ order, nodes }` pair, so `extractTail` parses it unchanged. **DSH Desktop bundles its own
harness and upgraded ahead of the dsh CLI**, so a tile reading only `snap.chat` renders empty
on Desktop while still working on the CLI — every tile, on every session, which is what an
"empty chat" report actually means. `chatViewSource` reads the new service when present and
returns `undefined` otherwise, and the merge preserves snapshot identity when there is nothing
to merge so existing `useMemo([snap])` consumers keep caching. It is a **`ctx.get` probe,
never an `inject` entry**: declaring it would park `apply()` forever on the older harness
where the service does not exist.

Diagnosing this from the `.d.ts` files under `~/.dsh` is how it stays hidden — those describe
the **CLI's** harness, not the one Desktop is running, and they will confirm a contract the
browser is not using. `Object.keys()` off the live face is what settles it: keys the installed
CLI runtime never emits (`awaitingFirstTurn`, `pendingSubmissions`) prove which harness the
page actually loaded. Two matching traps sit around it — the served bundle is pinned to a
content hash taken **once at plugin activation**, so a rebuild needs a full app restart rather
than a browser refresh (a refresh silently re-runs the old bundle), and `installed-copy.mjs`
reads the file on disk rather than what the browser executes, so it passes either way.

**That new API is OBSERVED, not promised — so its next move must be loud.** Both 0.1.2
packages declare `lib/types/**/*.d.ts` in `files`, but the built packages ship **none**
(`dsh-api-session-controller` ships 32 files under `lib/types` and every one is `.js`), so
`uiConversation.binding(id).target('chat')` was read out of a shipped bundle rather than a
published contract. It is the same path the harness's own chat UI takes, and the layering
looks deliberate — a generic `target(name)` registry with `chat` as one target beside
`trajectory` — but an alpha may still rename it without that being a breaking change on their
part. The realistic failure is therefore not a crash: it is tiles silently going empty again,
indistinguishable from idle sessions. `transcriptUnavailable` states that condition instead —
an **open** window that resolved no chat container from either era is a harness mismatch, and
the tile says so. It is deliberately gated on `'open'` alone: claiming it mid-load would be
the same false-claim class, one rung further along.

**Stage is a conversation view, so it does not clip messages — and the clip lived at the CALL
SITE.** The tile used to pass `extractTail(snap, 30, 1200)` and hard-slice user text at 220,
limits sized for a small preview card. On a full-screen grid that cuts mid-sentence, and
because the text renders as markdown it can slice a `**` or a fence off its partner, so the
orphaned delimiter renders literally — the visible symptom is "why is `**alpha.1**` showing
asterisks", not "text is short". `maxChars` is now **opt-in** (`undefined` = no clipping) and
the entry `limit` plus the tile scroller are what bound the DOM. Note where the test has to
go: the unit assertions exercise `extractTail` directly, so restoring the cap at the call site
leaves every one of them green — `installed-copy.mjs` pins the call site itself, and that
assertion was verified by sabotage.

**A tile composer sends images the same way the host composer does.** Paste, drag-drop and a
picker stage `DraftImage`s (object URLs revoked on release, on unmount, and only after the
host accepts the prompt), and `send()` submits `[...images, text]` through
`session.prompt` — images first, matching the host's own order. `encodePromptImage` builds the
canonical `{ type: 'image', mediaType, data, name? }` part **directly** rather than borrowing
`conversation.serializeImages`: that service is unpublished, and its `sendSession` also drives
`beginSubmission`, which does not exist on 0.1.1. The plain-`prompt` shape is what both eras
accept and is the same fallback the host composer uses for subagent sessions. Filter with
`isPromptImage` before staging — the host throws `UnsupportedImageMediaTypeError` on anything
outside `png/jpeg/webp/gif`, so one stray HEIC would otherwise reject the whole send. An
image-only message is valid: do not gate the send button on non-empty text.

**The waits moved in 0.1.2 too — same relocation, four symptoms.** That release dropped
`pending` from `buildSnapshot()` *and* `pendingInteraction` from the session summary, moving
both onto `uiSession.pendingInteractions` (an ObservableSnapshot of
`Map<sessionId, interaction>`, one winner per session by domain precedence). A plugin reading
only the old fields therefore loses **the tile's question box, the fleet's amber dot, the
"needs you first" sort, and the permission inbox** simultaneously — and every one of them
fails as "nothing is waiting", which reads as calm rather than broken. `uiPendingMap` is the
single replacement source; `pendingKindOf` feeds the dot and the sort, and `withPendingKinds`
re-applies kinds as one post-pass over the built tree rather than threading a service-derived
argument through all four pure row builders.

`adaptPendingInteraction` normalizes an interaction to the carrier the inbox already renders,
so `InboxQuestion`/`InboxApproval` and their pure answer-building logic are untouched. The
verbs differ in more than name: 0.1.1's `respond()` takes the Remote-Event envelope
(`{ ok, value }`) and returns a receipt, while 0.1.2's `answer()` takes the **bare** payload —
just the batch for a question, just the outcome string for an approval — and resolves with
nothing. Unwrapping lives in the adapter, and a sabotage test pins it: passing the envelope
through unchanged fails.

Both new services are read with `ctx.get` and **never** appear in `inject`. That is also why
`get` belongs in the smoke test's `CTX_FRAMEWORK` set: cordis documents it as reading a
service *without* the inject requirement, so counting it as a service read would force exactly
the declaration that parks `apply()` forever on 0.1.1.

**`MarkdownText` requires `labels` in 0.1.2, and omitting it deletes the whole panel.** The
component gained a required `labels` prop with **no default**, and its code-block renderer
reads `labels.code.copyLabel` unguarded. Passing only `text`/`streaming` therefore throws
`Cannot read properties of undefined (reading 'code')` *inside the host component*, which the
shell catches at the slot boundary — `slot entry crashed in 'shell.overlay'` — so Mission
Control does not degrade, it **disappears**. `MARKDOWN_LABELS` supplies every key the markdown
path reads (`code.copyLabel`, `code.copiedLabel`, `markdown`, `footnotes`,
`contentTruncated`, `sourcesTruncated`) and is module-level and frozen because `MarkdownText`
rebuilds its streaming renderer whenever the `labels` identity changes. Borrowing a host
component means owning its prop contract across harness versions; `installed-copy.mjs` pins
that the prop is actually passed, verified by sabotage.

**A module-level `const` must be declared ABOVE every function that reads it.** `EMPTY_PENDING`
sat below `uiPendingMap`, so the first render — which happens while the module body is still
evaluating — hit the temporal dead zone and threw `Cannot access 'EMPTY_PENDING' before
initialization`, again taking the whole overlay down. The `try/catch` around the read could not
save it, because the catch branch returns the same binding. The smoke suite cannot see this
class of bug: it renders from an already-evaluated module, where the dead zone has closed. The
guard is therefore an assertion on the **emitted order** in the built bundle, and it is
sabotage-verified. A `function` declaration hoists; a `const` does not.

**Both harness eras are rendered end-to-end in `test/smoke.mjs`, and that is the only guard
that would have caught any of this.** Marker assertions prove a string is in the bundle; they
cannot prove the wiring resolves. So the suite renders the panel twice through the SSR
instance — once against a 0.1.2-shaped context (status-only face, `uiConversation` and
`uiSession` reachable only via `ctx.get`) and once against 0.1.1 (`snap.chat` and
`snap.pending` inline, neither new service present) — and asserts a transcript marker and a
question marker appear. Stage is opened by patching the second `useState(false)` for the
duration of the render rather than exporting the tile, so the test exercises the real
composition instead of a parallel one. Verified by sabotage: breaking the `uiConversation`
lookup, the snapshot merge, the wait merge, or the `snap.chat` fallback each turns it red.

**And an empty tail is not an empty session** — it is three states the tile must not conflate:
the window is still loading (`cold`/`loading`/no snapshot yet), it failed (`error`), or the
session really has no messages (`open`). Branch on `openState`, never infer from
`tail.length === 0`; that inference is the same false-claim class as `dsh-plan-board`'s "No
plans yet", and here it reported "status only" about a conversation that was about to render.

**A to-do list is not a chat node.** `extractTail` walks `snap.chat`, and todos are not
there — the host emits them as a per-session `todos` **projection** (on `todo/write` and
`turn/start`) and renders them in a dock beside the composer, not inline in the transcript.
So a tile reading only the chat store shows a `todo_write` tool row and nothing about the
plan it wrote. `sessionTodos` reads `projectionValues.todos` off the session row — the same
face `sessionOutTokens` uses — which is why the strip works without opening the conversation.
The host rewrites the **whole list** each time and writes `null` to clear, so the reader
guards for a non-array and drops entries with no text rather than trusting the shape.

Assistant text renders through the host's own `MarkdownText`, which ships its own font
sizing and can outrank a bare `.dshmc-md`. So `.dshmc-md, .dshmc-md *` force
`font-size: inherit`, and the exceptions (headings, code, tables) re-derive from
`--mc-msg-size` with `calc()`. Fixed px there left assistant messages a different size from
the plain user rows beside them in the same conversation.

**Stage spans DSH Desktop's window-drag strip; the docked panel does not.** That region
resolves before hit-testing and outranks this overlay's z-index, so raising z-index cannot
help — the bar clears the 36px band with `padding-top: calc(12px + var(--mc-titlebar-h))`
and every control in it carries `data-dsh-no-drag`. Without both, the exit and window
toggles land under the minimize/maximize/close buttons and simply do not click.

## Settings

The drawer itself is still `localStorage` under `dsh-mission-control:settings` via
`parseSettings`, which is **defensive by contract**: any bad shape falls back to defaults,
and a write failure (private mode, quota) keeps the in-memory value rather than throwing
into the shell. `parseSettings` is exported so it can be driven directly from a test.
Only the pomodoro timer is mirrored to the host cell; the drawer keys stay origin-local
until that envelope grows a field.

Settings are: sessions listed per workspace group (`0` = All), fleet sort order, whether the
pomodoro footer shows, and its work / break / long-break lengths. Sessions needing attention
stay on top regardless of sort.

The drawer is a **two-column grid** — one shared label column, one shared control column — so
controls line up across every row; per-row `space-between` aligns each control to its own
label instead, which is what it replaced. The control column is sized for the widest option
string the selects offer ("Least recently active"), not for the number inputs: a column that
merely fit those truncated the sort labels. Number inputs and the checkbox use
`justify-self: start` so they keep the column's left edge without stretching to its width.

## Mounting

**Self-mounting.** `package.json` declares `dsh.bundle.patch` pointing at this package's own
`cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-mission-control
      name: '@dennisrongo/dsh-mission-control'
```

`dsh plugin add` appends the package to the profile's `dsh.profile.bundles` and that row
composes automatically. **Do not also add an `insert:` row to the profile's
`cordis.patch.yml`** — a second row with the same id is fatal: `duplicate loader entry id:
dsh-mission-control`. A bare `id:` entry there is still the right way to *configure* the row.

Works on both surfaces: the dsh CLI and DSH Desktop, which keeps its own `DSH_HOME`.

## Dev loop

`pnpm install` at the monorepo root, then `pnpm run build` here (emits `lib/index.js`,
`lib/client.js`, `lib/typert.host.js`, via the gitignored `client.body.cjs`). The three
real artifacts are **committed** so a GitHub subdirectory install works — rebuild and
commit them when you change `src/`. `pnpm test` runs build + `test/smoke.mjs`
(offline, exercising the **built** bundle).

**`pnpm test` rebuilds first** (`node build/build.mjs && node test/smoke.mjs`), matching
`dsh-git`, `dsh-weather` and `dsh-todo`. The suite imports `lib/client.js` and
`lib/typert.host.js` and calls their exports, so without that prefix it happily passes
against a stale bundle — verified by changing `fmtTokens`' divisor in `src/` without
rebuilding and watching the suite stay green. This is the same defect class that let this
package's own `dshmc-burn-row` marker rot unnoticed. Running `test/smoke.mjs` directly
still skips the build, so prefer `pnpm test`.

`scripts/dev-link.ps1` junctions the package into a profile so a rebuild self-deploys;
host-half edits need a **profile restart**. Re-run it, or `node scripts/anchor.mjs`, after any
`pnpm install`. **A client-half edit needs a full app restart too, not a browser refresh** —
`dsh-client-modules` hashes each bundle **once at plugin activation** and serves it as
`/plugins/<id>/client.js?rev=<hash>`, re-hashing only on an HMR rebuild notification. Without
`pnpm run dev:web` watching, a refresh re-requests the same pinned `rev` and silently runs the
OLD bundle: instrumentation added to a rebuilt file reports nothing, which reads exactly like
the code never executing. `performance.getEntriesByType('resource')` in the console shows the
`rev` the page actually loaded. DSH
Desktop's profile-repair install additionally empties this package's `node_modules`,
taking `zod` with it, after which the harness refuses to boot with
`Cannot find package 'zod'`. Fix: `pnpm install` at the monorepo root, then the script.

`test/installed-copy.mjs` checks the copies a profile actually serves. It is deliberately
**not** part of `pnpm test`: it reads machine state rather than something the repo owns, so
wiring it in would make the suite depend on profile layout. It **discovers** every install of this package
across both surfaces (the dsh CLI's `~/.dsh/profiles` and DSH Desktop's own `DSH_HOME`) and
checks each one, labelling them `dsh:<profile>` / `desktop:<profile>`. It **exits 0 with a
note** only when no install exists anywhere, so a contributor without one does not see a red
test. Override with `DSH_PROFILE_COPY` (an exact path) or `DSH_PROFILE` (a profile name) —
and a target named that way is then **fatal if missing**, rather than skipped.

It previously defaulted to a hardcoded `mission-control` profile that did not exist on the
dev machine, so it skipped — reporting success — while the markers it asserts drifted from
the source. That is how `dshmc-burn-row` rotted. Discovery is what closes it.

## Verification

```bash
pnpm run build && pnpm test          # marker assertions against the built bundle
npx tsc --noEmit                     # needs the @deepseek-ai anchoring (anchor.mjs)

# 1. identity — must print the %APPDATA%\npm host path, never a .pnpm store path
# run from this package folder
node -e "const{createRequire}=require('module'),{resolve}=require('path');console.log(createRequire(resolve('lib/index.js')).resolve('@deepseek-ai/cordis'))"

# 2. wire probe — 200 = mounted; 404 = the ./typert export is not registered
curl -s -X POST http://127.0.0.1:38111/api/dshMissionControl/load -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"t1","method":"dshMissionControl/load","payload":{"args":{"request":{}}}}'

# 3. the bundle the browser receives — size should match the build's reported bytes
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' \
  http://127.0.0.1:38111/plugins/@dennisrongo/dsh-mission-control/client.js
```

A healthy load reply is `{"type":"server-response","result":{"ok":true,"value":{"state":...}}}`
(`state` is `null` when nothing has been saved yet). Boot a scratch server with captured
output (`dsh --profile web --port 38111 --no-open`) — an `ERR_MODULE_NOT_FOUND` there is a
broken junction that a running server would swallow. Leave `DSH_HOME` alone: a scratch
server on the Desktop's home corrupts the sessions the Desktop has open.

Then open the UI and confirm the overlay renders: `dshmc-*` nodes present, the stats strip
populated, sessions listed. Verify against the **server**, not the filesystem: the bundle's
`rev` is hashed at activation, so a rebuilt client bundle needs a full restart before the
browser can see it, and a new `./typert` export needs one too.

## Gotchas

- **Text sizes are on the repo type scale (11/12/13/14/16), not the panel's old dense one.**
  This panel had drifted to 9–15px with half-pixel steps (10.5, 11.5, 12.5) — smaller than
  anything dsh itself ships and off its ladder entirely, so beside the shell's chrome it read
  as a different application rather than a denser one. 42 literal declarations were rounded to
  the nearest step, and a second pass caught four more hiding behind indirection —
  `--mc-ctl-font: 11.5px` and `--mc-msg-size: 13.5px` consumed as `font-size: var(…)`, plus
  seven `calc(var(…) ± Npx)` derivations that landed between rungs by construction (11px − 1px
  is 10px). Derived steps are now their own custom properties (`--mc-msg-sm`, `--mc-msg-lg`,
  `--mc-ctl-font-sm`, `--mc-close-glyph`) rather than arithmetic. The 400px rail was
  re-measured afterwards: 73 elements, zero horizontal overflow.
  Do not "restore" the tighter sizes to win back a few pixels:
  `scripts/check-type-scale.mjs` fails the build and the pre-commit hook. Line-height is not
  policed, so that is the lever for density — several rows already use unitless values that
  scale with the size.
- CSS classes are namespaced `dshmc-`. `test/installed-copy.mjs` asserts on specific marker
  strings (`dshmc-stats`, `dshmc-tool-head`, `--mc-msg-size`, …), so renaming a class breaks
  tests by design — update both together. Removing a feature means removing its markers too:
  `dshmc-burn-row`/`dshmc-burn-model` outlived the burn block they described and sat green
  for months, which is why a negative assertion now pins their absence.
- `tsconfig.json` `paths` point at `./node_modules/@deepseek-ai/...`, which only exist after
  anchoring. `TS2307: Cannot find module '@deepseek-ai/...'` means run `node
  scripts/anchor.mjs`, not add a stub.
- The overlay must degrade rather than throw: a session list that fails to load should render
  an empty or error state, never take down the shell it floats over. The same rule covers
  the host cell — a missing `./typert` export, a 404, or a rejected `save` leaves the
  panel on localStorage. Do not make `inject(['remote.dshMissionControl'])` a hard
  requirement of `apply()`; an older install never resolves that inject.
- `build/build.mjs` keeps `minify: false` on the host and typert builds for the same
  reason as dsh-todo: the gateway reads `@Remote` parameter names out of
  `Function.prototype.toString()`.

- **The rail's frame reservation measures with `offsetWidth`, never `getBoundingClientRect().width`.** `dsh-theme`'s UI scale puts the shell under `#root { zoom: var(--dshth-ui-scale, 1) }`, where the rect is TRUE viewport px while the `frame.style.paddingRight` written from it is an AUTHOR px the zoom scales AGAIN — so feeding the rect back in under-reserves by exactly the zoom factor. Measured at the 90% step: the rail claimed `377px`, rendered 339px, and left the conversation column 22px underneath the rail, taking `dsh-plan-board`'s panel (docked flush to that column) with it. `offsetWidth` is author px, the same space as `--mc-dock-gap` and the padding, so all three agree at every scale. The smoke test pins both the presence of `offsetWidth` and the absence of the rect form.
