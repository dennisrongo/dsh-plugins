# AGENTS.md — dsh-plan-board

Host + client. One cordis service (`dshPlans`), one `tools/execute` wrapper, four
`@Remote` endpoints, and two client seats. Read `README.md` for what it does;
this file is what you need before changing it.

## Layout

```
src/types.ts        PlanMeta/PlanRecord, limits, firstHeading/slugify/stamp
src/store.ts        markdown-file storage, JSON frontmatter, change token, pruning
src/index.ts        PlanService: the exit_plan_mode wrapper and the endpoints
src/markdown.tsx    dependency-free markdown → React elements
src/client.tsx      shell.overlay DOCK (measures + pushes the chat) + history tab + CSS
src/remote.ts       Typert descriptors (shared by both faces)
src/typert.host.ts  the ./typert manifest the loader imports
test/smoke.mjs      20 checks against BUILT lib/, on real files in a temp dir
```

## Build and verify

```bash
node build/build.mjs      # lib/index.js + lib/typert.host.js + lib/client.js
npx tsc --noEmit          # needs scripts/anchor.mjs to have run
node test/smoke.mjs       # builds nothing; run the build first
```

`npm test` does both. The smoke test drives `PlanStore` against real files in a
temp directory — the behaviour worth pinning here is all filesystem behaviour.

## Things that will bite you

- **Never minify the host bundle, and keep `target: es2021`.** The Typert
  gateway derives a `@Remote` method's wire fields from its parameter names via
  `Function.prototype.toString()`, and `@Remote` is a TC39 standard decorator
  Node 22 cannot parse natively. Both failures show up at call time or load
  time, never at build time.
- **`./typert` must stay in `exports` and in `files`.** Without it the loader
  skips the package silently: plans are still captured to disk, every `/api`
  call 404s, and the tab renders empty — which reads as a storage bug. Adding it
  needs a full profile restart, not a refresh.
- **The `tools/execute` wrapper must return `next()`'s outcome untouched, and
  rethrow.** This plugin observes the review; it does not participate in it. A
  swallowed throw would turn "keep planning" into an approval.
- **A storage failure must never reach the tool.** Capture is an addition, not a
  precondition — every write is wrapped, and a plan raised in a directory the
  plugin cannot write to still gets reviewed normally.
- **The window is `shell.overlay` for a reason.** `conversation.view` entries
  are rendered one-at-a-time (`only: <active id>`), so an inactive tab is not
  mounted and cannot open itself. Moving the window into the tab silently
  removes the auto-open behaviour — it will look like it still works, because
  the tab renders fine once you click it.
- **Do not register a `userQuestions` provider.** The service documents one
  active provider per context and the shipped UI holds it. Taking it to put
  approve buttons in the window would hijack every question in the harness.
- **`changeToken` is the polled endpoint and must stay cheap.** It does one
  `readdir` plus a parse per file and returns an in-memory counter. The moment
  it reads bodies it costs what `list` costs and the design is pointless — the
  same trap `dsh-git`'s `changeToken` documents.
- **Ids off the wire go through `isSafeId` before any `join`.** They name a file
  in the user's repository; `../` reaching `join` is a read-anywhere bug.
- **Pruning counts the FULL list, not the settled subset.** Pruning runs inside
  `create`, when the new plan is still pending and invisible to a settled-only
  count — that version leaked one plan per create-then-settle round forever. The
  smoke test pins this.

## Client conventions

CSS classes are namespaced `dshpb-`. Every colour is a `--dsw-*` alias the
harness defines (`node scripts/check-tokens.mjs` enforces it — a misspelt token
silently uses its CSS fallback forever and stops following the theme). Font
sizes are literal px on the shared 11/12/13/14/16 ladder
(`node scripts/check-type-scale.mjs`).

Markdown renders to React elements only. Never introduce
`dangerouslySetInnerHTML` here: the input is model-written text and may quote
untrusted material.

## Wire check

`node scripts/verify.mjs` from the repo root proves the entry points import, the
client bundle is well-formed, and the deps anchor to the dsh CLI copy. It does
**not** prove the endpoints mounted. That needs a live profile:

```bash
dsh --profile web --port 38111 --no-open
curl -s localhost:38111/api/dshPlans/list -H 'content-type: application/json' -d '{"request":{"workspaceId":"<id>"}}'
```

`200` means the `./typert` export registered; `404` means it did not.

## The dock's coupling to harness DOM

The plan panel is `position: fixed` in `shell.overlay` and pushes the
conversation column aside. That is the only way to get a real split from a seat
that is not a layout sibling of the chat, and it buys three obligations:

- **Anchor on `[data-slot="conversation"]`, never on a class.** Slot names are
  the documented plugin API; the classes beside them (`wSkVaW_root`,
  `pI_x6G_centerCol`) are hashed CSS-module identifiers that change on any
  harness build. The slot host is `display: contents` and cannot be measured or
  padded — the element that lays out is its single child, reached by structure.
- **Push with an INLINE `padding-right`.** An attribute selector and the
  column's own class selector have equal specificity, and which stylesheet is
  appended last is not this plugin's to decide. Inline wins; the stylesheet rule
  only carries the transition.
- **Re-apply on mutation.** A React re-render that drops the attribute or the
  style would leave the chat un-pushed with the panel still over it. The
  `MutationObserver` in `useDock` watches exactly those two and re-syncs, so the
  worst case is a frame of overlap rather than a stuck layout.

Two more things `useDock` handles that look like paranoia and are not. It retries
on `requestAnimationFrame` until the column has a non-zero width, because a panel
that mounts before layout measures 0 and would otherwise stay hidden until
something else resized. And it degrades to the viewport edge when the column
cannot be found at all — overlaying the chat beats showing no plan.

`.dshpb-dock` must keep `pointer-events: auto`: the shell's overlay layer is
`pointer-events: none` so it cannot swallow clicks meant for the app, and a child
that does not opt back in renders perfectly and does nothing.

## Why the dock starts below the tab strip

It is aligned to `[data-slot="conversation.view"]`, not to the column's own top,
and that is a stacking decision rather than a cosmetic one. The shell's top band
belongs to other `shell.overlay` entries and they are entitled to it —
`dsh-weather` renders a fixed bar at `z-index: 2147482900`. A panel whose header
shares that band has its controls painted over: the Close button stops
responding and the panel reads as broken. Raising this plugin's z-index to
compete would be an arms race against a near-INT_MAX value and would hide a bar
the user chose to have. Starting below the tab strip removes the overlap
instead, and leaves the tabs visible.

The right edge is separately clamped to the frame's content edge, because
`dsh-mission-control` reserves its rail by setting `padding-right` on the frame.
Aligning only to the column puts this panel's top-right corner under the rail
whenever the two measurements disagree — which they do while the rail animates.
`useDock` observes the frame's content box and its inline style for exactly that.

The acceptance test for both is not a screenshot: it is
`document.elementFromPoint()` at the Close button's centre returning something
inside `.dshpb-close`. A panel can look perfect and still be unclickable.

## Two capture paths, deliberately independent

`exit_plan_mode` is the explicit route and carries a review outcome. A fenced
```plan block in an assistant message is the implicit route and carries none —
it is stored as `proposed`, which exists so those plans are not labelled
"Awaiting review" and send the user looking for an approve control that was
never raised. Neither path knows about the other.

The implicit path is **marker-based on purpose**. The plugin registers a
system-prompt section asking the model to fence its plans; `extractFencedPlans`
then matches exactly that. Do not replace it with prose sniffing: a heading plus
a list describes most structured answers, and false positives here write files
into the user's repository. An unfenced plan staying in the transcript is the
correct failure — it is the behaviour without this plugin.

Three consequences worth keeping:

- **`PLAN_FENCE` and the regex must agree.** The pattern is a literal, not
  `new RegExp` built from the constant, because `'\s'` in a quoted string is not
  a valid escape and degrades to `s` — `([\s\S]*?)` silently becomes `([sS]*?)`
  and the fence matches almost nothing. A test pins the tag instead.
- **Bodies are deduped.** A model that restates its plan, or a message replayed
  on resume, must not create a second file; `create` refuses an identical body.
- **The pin cache is bounded and is not a transcript.** `conversation.chat.assistant-actions`
  supplies only a `messageId`, so the host keeps recent assistant text to resolve
  it. A pin on something older reports that it is unavailable rather than
  silently doing nothing.
