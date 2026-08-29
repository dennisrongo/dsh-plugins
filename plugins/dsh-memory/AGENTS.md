# AGENTS.md — dsh-memory

Host + client. One cordis service (`dshMemory`), one slash command, three
`@Remote` endpoints, one `conversation.view` tab. Read `README.md` for what it
does; this file is what you need before changing it.

## Layout

```
src/types.ts        scopes, the memories heading, fact validation/formatting
src/files.ts        project-root walk, append-under-heading, the inspector
src/index.ts        MemoryService: /remember registration and the endpoints
src/client.tsx      Memory tab: capture box + instruction file list + CSS
src/remote.ts       Typert descriptors (shared by both faces)
src/typert.host.ts  the ./typert manifest the loader imports
test/smoke.mjs      14 checks against BUILT lib/, on real files in a temp tree
```

## Build and verify

```bash
node build/build.mjs      # lib/index.js + lib/typert.host.js + lib/client.js
npx tsc --noEmit          # needs scripts/anchor.mjs to have run
node test/smoke.mjs       # builds nothing; run the build first
```

The smoke test drives the inspector through the **real**
`@deepseek-ai/dsh-agent-instructions` discovery against a fixture tree with a
`.git` marker — including the budget case, where the assertion is that the
broader file reports `included: false` and the more specific one reports a
`truncatedTo` below its own size. That is the pair of facts the tab exists to
show, so it is the pair the test pins.

## Things that will bite you

- **Never reimplement discovery.** `inspect` calls
  `discoverBaselineInstructionFiles` and `loadBaselineInstructions` from the
  loader package. A local reimplementation would drift, and an inspector that
  disagrees with the loader is worse than no inspector: it is trusted precisely
  when it contradicts your expectations.
- **`maxBytes` is a restated constant, not a read one.** A cordis plugin cannot
  read another plugin's entry config, so `DEFAULT_MAX_BYTES` mirrors the `code`
  preset's `agent-instructions` `maxBytes` (65536). If the two disagree the tab
  reports omissions that are not happening, or misses ones that are. Both the
  config comment in `cordis.patch.yml` and the README say so; keep them in sync.
- **`read` must stay gated on discovery.** It takes an absolute path off the
  wire. Dropping the "was this discovered for this workspace" check turns it
  into a read-any-file-on-the-host endpoint.
- **The append must never move anything.** `appendFact` targets the end of the
  memories SECTION, not the end of the file, and creates the heading with a
  guarded blank line. It edits a file the user probably hand-wrote and probably
  has in version control — four of the smoke checks exist only to pin what it
  does not disturb.
- **`findProjectRoot` here is a write-target helper only.** It re-derives the
  `.git` walk because the loader's exported discovery returns files, not the
  root it chose. It must never be used to decide what is loaded — a
  disagreement there would make the report lie.
- **Never minify the host bundle, and keep `target: es2021`.** The Typert
  gateway derives a `@Remote` method's wire fields from its parameter names via
  `Function.prototype.toString()`, and `@Remote` is a TC39 standard decorator
  Node 22 cannot parse natively.
- **`./typert` must stay in `exports` and in `files`.** Without it the loader
  skips the package silently: `/remember` still works and every `/api` call
  404s, so the tab renders empty while the command succeeds — a confusing pair
  of symptoms. Adding it needs a full profile restart.

## Optional services

`static inject = ['workspaceRegistry']` — only that one, because every endpoint
is addressed by workspace id. `commands` is picked up through
`this.ctx.inject(['commands'], ...)`, a child fiber that tolerates the registry
mounting later and unwinds the registration if it unmounts. This cordis has no
`optional` form of `inject` (every entry is a hard wait), so adding `commands`
to that array would make the plugin never mount in a deployment without one.

## Client conventions

CSS classes are namespaced `dshmem-`. Every colour is a `--dsw-*` alias the
harness defines (`node scripts/check-tokens.mjs`); font sizes are literal px on
the shared 11/12/13/14/16 ladder (`node scripts/check-type-scale.mjs`).

## Wire check

`node scripts/verify.mjs` from the repo root proves the entry points import, the
client bundle is well-formed, and the deps anchor to the dsh CLI copy. It does
**not** prove the endpoints mounted. That needs a live profile:

```bash
dsh --profile web --port 38111 --no-open
curl -s localhost:38111/api/dshMemory/inspect -H 'content-type: application/json' -d '{"request":{"workspaceId":"<id>"}}'
```

`200` means the `./typert` export registered; `404` means it did not.
