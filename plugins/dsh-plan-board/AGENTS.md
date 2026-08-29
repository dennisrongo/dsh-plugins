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
src/client.tsx      shell.overlay window + conversation.view history tab + CSS
src/remote.ts       Typert descriptors (shared by both faces)
src/typert.host.ts  the ./typert manifest the loader imports
test/smoke.mjs      18 checks against BUILT lib/, on real files in a temp dir
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
