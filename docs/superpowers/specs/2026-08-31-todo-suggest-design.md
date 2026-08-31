# dsh-todo — workspace scan and suggestion modal

Status: approved design, not yet implemented.
Package: `@dennisrongo/dsh-todo`.

## Problem

The Todo tab holds work someone already thought of. Deciding *what to work on
next* happens somewhere else — usually by reading the codebase and noticing
what is missing. This feature moves that noticing into the tab: a button that
scans the workspace, proposes concrete work, and lets the user promote the
proposals they like into real tasks.

The backlog is part of the input, not just the output. A suggestion that
duplicates an existing unchecked task is noise, so the scan is told what is
already planned and asked not to repeat it.

## Scope

In scope: a **Suggest** button in the Todo tab header, a modal listing
suggestions with checkboxes, a **Refresh** that returns different ideas, and an
**Add selected** that creates backlog tasks.

Out of scope: automatic or scheduled scanning, editing a suggestion's text
before adding it (it becomes a normal task and the task modal already edits
tasks), and persisting suggestions across a page reload.

## Why not a direct model call

Three routes were considered and one rejected on evidence.

`@deepseek-ai/dsh-llm` (service key `llm`) is a **configuration** service —
`prepareCall`, `resolveModelInfo`, `listModels`. It resolves which model to use
and with what credentials; it exposes no "send a prompt, get text" method. The
Desktop install ships no `.d.ts` for it, so building on it means reading a
minified bundle for a call shape this repo does not own.

`@deepseek-ai/dsh-subagent` (`subagents`) has `prompt()`, but it requires a live
parent agent (`ctx.get("agents")?.get(parentSessionId)`, rejecting
`subagent-parent-unavailable`). It serves the agent loop, not a UI button.

That is exactly the bet `plugins/dsh-todo/AGENTS.md` records losing four times:
`flattenModels` requiring a `model.provider` the catalog never had, gating a
button on `ctx.remote.agentPresets` when only `ctx['remote.agentPresets']`
resolves, and `directoryFor` throwing from inside a callee that every existence
guard passed. Each failed **silently**. This design therefore uses only public
paths the plugin already depends on.

## Architecture

A scan is a **background session** that writes a result file the modal polls.

```
Suggest click
  -> host: dshTodo/scanDigest  (build bounded evidence)
  -> client: sessions.create({ workspaceId })      [NOT opened]
             session.prompt(digest + exclusions + output contract)
  -> agent writes <workspace>/.dsh/suggestions.json
  -> client polls host: dshTodo/readSuggestions
  -> modal renders rows; session is archived
```

Creating a session without navigating to it is **already proven in this file**:
`LaunchDialog` creates on open (`client.tsx:2615`), navigates only on confirm
(`:2634`), and `discardSession()` archives the unused one. This feature reuses
that lifecycle with the navigation step permanently omitted.

### Why a file and not a return value

`session.prompt()` resolves when the prompt is *accepted*, not when the work is
done. There is no public completion promise to await, so the result needs a
rendezvous point. A file under `.dsh/` is one the host can already read, is
inspectable when something goes wrong, and survives the modal being closed
mid-scan.

## Host half

### `src/scan.ts` — building the digest

Dependency-free apart from `node:fs` / `node:path`, so it is unit-testable
under plain Node, matching `src/launch.ts`'s constraint.

Three evidence sources, chosen with the user:

1. **Code smells** — `TODO`, `FIXME`, `HACK` comments with file and line.
2. **Docs-vs-implementation gaps** — README plus any `docs/` index, paired with
   the file tree so the model can see what is promised but absent.
3. **Test coverage gaps** — source modules with no corresponding test file.

Every source is **bounded before it is sent**, because this spends tokens on a
click:

- file tree: depth-capped and count-capped, respecting `.gitignore`
- comment scan: capped total matches, each truncated to one line
- README: leading N KB only
- the whole digest carries a hard byte ceiling; overflow truncates with an
  explicit marker rather than silently dropping a section

`.git`, `node_modules`, `lib/`, and build output are excluded. The digest never
contains file *contents* beyond the caps above.

### Endpoints

Both follow the existing `wire: 'request'` single-parameter convention, and
both must be added to `src/remote.ts` as **strict** zod codecs — the client's
`$mount` rejects anything else, and a strict codec silently strips fields it
does not name.

- `POST /api/dshTodo/scanDigest` — `{ workspaceId }` -> `{ digest, truncated }`
- `POST /api/dshTodo/readSuggestions` — `{ workspaceId }` ->
  `{ status: 'pending' | 'ready' | 'error', suggestions?, error? }`

`readSuggestions` validates the agent's JSON against a schema and returns
`status: 'error'` on malformed output. A model writing bad JSON is an expected
case, not an exception.

### Suggestion shape

```ts
{ title: string, rationale: string, priority: 'p0'|'p1'|'p2'|'p3', evidence?: string }
```

`evidence` is a `file:line` pointer where one exists. A suggestion that cannot
point at anything is still allowed — a missing feature has no line number — but
the field is what makes a suggestion checkable rather than plausible.

Suggestions are **not** stored in the todo database. They are proposals until
promoted; only `Add selected` writes tasks.

## Client half

### `SuggestDialog`

Follows the three rules the existing dialogs already encode:

- portals to `document.body` via `createPortal` (`.dshtd-scroll` is
  `overflow-y: auto` and would clip it)
- backdrop at z-index **2147483100**, deliberately below Desktop's drag region
  (2147483644), clearing the 36px strip with top padding instead
- `role="dialog"`, focus trapped, Escape dismisses

### Loading

A **skeleton** shaped like the suggestion rows — the repo rule assigns a
skeleton to a large content pane, a caption row to a small one. Geometry is
copied from the real row (its padding, line box, gaps), the sweep animates
`background-position` over an oversized gradient, and `prefers-reduced-motion`
flattens it to a flat tone. The root is `role="status"`; decorative bars are
`aria-hidden`.

Loading is **its own flag**, armed where the scan starts — never inferred from
`suggestions.length === 0`. That conflation is the bug `dsh-plan-board` shipped,
where "no plans yet" was displayed during every read.

A scan is slower than a fetch, so the skeleton is paired with a plain-language
status line ("Scanning the workspace…") and a **Cancel** that archives the
session.

### Rows

Each suggestion is a checkbox row: title, one-line rationale, a priority band
reusing `PRIORITY_LABEL`, and the `evidence` pointer as a caption when present.
Nothing is checked by default — the user opted into scanning, not into the
results.

### Refresh

Re-runs the scan with the already-shown titles **added to the exclusion set**,
so "fresh ideas" are genuinely new rather than a reshuffle. Checked rows survive
a refresh; the selection is the user's, not the model's.

### Add selected

Writes through the existing `store.update` path, so it inherits revision-conflict
reconciliation for free. Each becomes a real task via `makeItem` with status
`backlog`, the suggested priority, and the rationale as the description. One
`store.update` call for the whole batch — not one per row — so the wire sees a
single write.

## Failure modes, each handled explicitly

| Failure | Behaviour |
|---|---|
| No workspace open | Button hidden; nothing to scan |
| `sessions` unreachable from this fiber | Button hidden, same guarded probe as Launch |
| Agent never writes the file | Poll times out (~3 min); modal offers Retry |
| Malformed JSON | `status: 'error'`; modal shows it, offers Refresh |
| Zero suggestions | Explicit empty state, distinct from the skeleton |
| Modal closed mid-scan | Session archived; no orphan in the sidebar |

Every borrowed service is read through the existing `probeNamespaced()` /
`launchContext()` guards. Per `AGENTS.md`: `ctx.get()` is the safe probe, a
dotted name resolves **only** as `ctx['remote.foo']`, `ctx.remote?.foo` throws
because `remote` is itself a Proxy, and a service that resolves is still not one
you can call — so any borrowed handle is wrapped **once at the boundary**.

## Testing

- `test/scan.test.mjs` — digest building against a temp workspace: caps hold,
  ignored directories stay out, truncation marks itself.
- `test/smoke.mjs` additions — new marker strings; `Add selected` writes tasks
  in exactly one place, mirroring the existing single-deletion-path assertion.
- `test/context-probe.mjs` additions — the Suggest button must stay hidden, and
  must not throw, on a deployment without `sessions`.
- Suggestion-quality is **not** unit-tested; it is model output. What is tested
  is that malformed output degrades to a visible error rather than a crash.

Every new test is verified to **fail** before it is trusted — the repo's own
standard, and the reason `check-progress.mjs` was sabotage-checked.

## Open risk

The quality of the suggestions is unproven and is the real risk in this
feature. The plumbing is ordinary; whether a scanned digest yields work worth
doing is not knowable until it runs against a real repository. The first
implementation milestone is therefore a single end-to-end scan whose output is
read and judged before any of the modal polish is built.
