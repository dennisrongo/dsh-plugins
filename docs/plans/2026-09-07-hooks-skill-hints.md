# dsh-hooks: contextual skill hints beside the composer

**Status:** shipped in 0.2.0 and verified live end to end on 2026-09-07 (throwaway harness, Claude Sonnet 4.6, .NET workspace: project hint, turn-done hints, prompt bug rule, dismiss, skill-use suppression, chip click → draft, Run → real skill turn). Author: Fable (plan), Opus (execution).
**Package:** `plugins/dsh-hooks` (`@dennisrongo/dsh-hooks`), 0.1.1 → 0.2.0.

## The ask

While the user works, the plugin watches what is happening in the session and shows
small hint chips *next to the chat input* saying "you could run `/dotnet-onion-api`
for this" or "feature looks done — `/code-review`?". Clicking a chip puts `/skill-name `
into the composer. Hints are derived from real signals (project files on disk, tools
the model used, the turn ending, the user's prompt text) and only ever name skills
that are actually installed and user-invocable in this deployment.

dsh-hooks is currently **host-only**. This adds a client half. Everything below was
read off the installed harness's shipped `.d.ts` files — not guessed. Re-read them
before deviating (path below).

## Verified harness facts (do not re-derive; do re-check if something disagrees)

Harness contracts live at
`C:/Users/denni/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/lib/types/*.d.ts`.

### Where the chips go: `conversation.input.dock`

`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:141`:

```ts
/** Full-width entries above the composer card. */
'conversation.input.dock': { kind: 'list'; scope: 'session'; owner: InputZone }
// InputZone = { readonly session: SessionSnapshot; readonly input: InputState }
// SessionStandardProps adds: useConversation, useInput, inputActions: InputActions
// InputActions: setDraft(text), addImages, removeImage, pruneImages, submit()
```

It is a **list** slot (additive — GoalBar and the Todo panel already live there,
orders 10 / unknown), **session-scoped** (the `inject(sessionId)` callback receives
the branded SessionId), and its props carry `inputActions`. The shipped `/`-menu skill
source resolves a pick as `{ text: '/${name} ' }` (`dsh-client-ui-skill/lib/client.js`),
so a chip click doing `inputActions.setDraft('/${name} ')` reproduces exactly what
picking the skill from the slash menu does. Do **not** call `submit()` on plain click;
the user confirms with Enter. A secondary "run" affordance (▶ button or Shift+click)
may call `setDraft` then `submit()`.

The concrete registration shape to copy is `dsh-client-ui-goal/lib/client.js`:

```js
ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
  name: 'conversation.input.dock', id: 'goal', order: 10, locale: NS,
  inject: (sessionId) => ({ ...callbacks }),
}, GoalDock))
```

Our entry: `id: 'dsh-hooks-hints'`, `order: 20` (after the goal strip). Render
`null` when there are no hints so the strip takes no height. Alternatives considered
and rejected: `conversation.composer.dock` (below the card — reads as a footer, not a
prompt); `conversation.input.overlay` (floats inside the card, collides with the
slash/@ popup that `dsh-client-ui-commands` self-registers there); `shell.overlay`
(would need the plan-board's fixed-position geometry machinery — see its AGENTS.md
for how much that costs).

### Where skills come from on the host: `ctx.skills`

`dsh-skill/lib/types/index.d.ts`. `ctx.skills.list(options?: SkillViewOptions):
Promise<SkillSummary[]>` where `SkillSummary = { name, description, whenToUse?,
invocation: { modelInvocable, userInvocable }, source, provider }`. `SkillViewOptions
= { cwd?, signal?, scope? }`; **`scope` selects the viewing agent's layers** — omit it
and you read the global layer alone, which may miss preset-scoped `skill-filesystem`
providers. Look at how `dsh-tool-skill/lib/index.js` obtains the scope when it calls
`ctx.skills.list(...)` (grep `skills.list` / `scopeOf`) and mirror it exactly. Read
`skills` through `this.ctx.get('skills')` (returns `undefined` when absent — never
add it to `static inject`, same reasoning as `settings` in `index.ts`).

`'skills/change'` (emit) fires when any provider/catalog may have changed → drop the
catalog cache. Filter to `isUserInvocable(skill)` (exported from `dsh-skill`, or
inline `skill.invocation.userInvocable`) — a hint the user cannot type is noise.

### Signals already flowing through `HooksService`

All eight listeners in `src/index.ts` already receive what the hint engine needs:

| signal | listener | fields to use |
|---|---|---|
| session started / resumed | `agent/session-start` | `agent.session.header.cwd` |
| user typed a prompt | `agent/pre-step` (gated to `source.kind === 'user'`) | joined text |
| a tool ran | `tools/post-execute` | `exec.name`, `exec.arguments`, `result.isError` |
| turn ended | `agent/turn-stopping` | `agent`, `turn` |
| session gone | `agent/disposed` | drop per-session state |

Tool names in this harness: `str_replace_editor`, `edit`, `write`, `read`, `bash`,
`skill` (args `{ name }` — `dsh-tool-skill/lib/index.js:60-72`). Check the path
argument name for `str_replace_editor`/`edit`/`write` in their `lib/index.js`
`parameters:` blocks before hardcoding it. A user-explicit `/skill` invocation injects
an `instructions`-form message with `source.kind === 'skill-invocation'` and
`source.name` (`dsh-skill/lib/types/index.d.ts` `SkillInvocationSource`) — check
whether it rides the `agent/pre-step` `messages` batch and record it as "skill used"
if so.

### Getting hints to the browser

There is **no** plugin-defined host→client event: `dsh-api-remotes/lib/types/remote-events.d.ts`
is a fixed allowlist. Options:

1. **Poll a cheap token endpoint** — the proven pattern in this repo (`dsh-git`
   `changeToken`, `dsh-plan-board` `changeToken`). Both AGENTS.md files document the
   trap: the polled endpoint must do no work; it returns an in-memory counter.
2. `@Remote({ mode: 'stream' })` async-iterable endpoint — supported by
   `dsh-typert-protocol` but unproven in this repo and in the hand-written descriptor
   format. **Do not use for v1.** Note it in AGENTS.md as the upgrade path.

Go with (1): `hintsToken({ sessionId })` polled every 1500 ms while the dock is
mounted, `hints({ sessionId })` fetched only when the token moves. Bump the token
only when the computed hint list actually changes (compare hint ids), so an idle
session polls a constant.

### Client-half rules that bite (all from this repo's memory + AGENTS.md files)

- Mount the contract with `ctx.remote.$mount(HOOKS_REMOTE)` in an effect, then
  `ctx.inject(['remote.dshHooks', 'slots'], ...)` for the slot registration. Never
  put `remote.dshHooks` in the top-level `inject` (deadlock — see plan-board
  `client.tsx` `apply()`).
- Resolve `remote.dshHooks` **once** in the ready context and pass it as a prop.
  Reading it during render yields `undefined`.
- Every reply is an envelope `{ ok, value } | { ok, error }`; declare it in the
  client's types so unwrapping is forced.
- Typert method names may not be `remove`, `has`, `install`, `installDirect`,
  `installScoped`, `ctx`, `empty`, `invokeRemote`, `methods`, `name`, `namespace`.
  Planned names `hints`, `hintsToken`, `dismissHint` are safe.
- Style-tag guard on the **element** (`tag !== null && tag.isConnected`), never a
  boolean — copy `injectStyles` from `dsh-plan-board/src/client.tsx:1271`.
- CSS: classes prefixed `dshhk-`; colours only via `var(--dsw-*)` tokens the
  harness defines (`node scripts/check-tokens.mjs`); font sizes on the
  11/12/13/14/16/20/24 ladder (`node scripts/check-type-scale.mjs`); if you add any
  loading treatment it must follow `scripts/check-progress.mjs` — simplest is to
  render nothing until loaded (hints are ambient; no skeleton).
- The Desktop runs the UI at 90 % zoom. The dock is in normal flow so geometry is
  low-risk, but verify nothing uses `getBoundingClientRect` arithmetic.
- **`scripts/check-context.mjs` has a hardcoded `REMOTE_NAMESPACES` list (line 208).**
  Add `'remote.dshHooks'` or the check passes on zero slots and then fails the slot
  count. Also its proxy stub returns `{ ok: true, value: { list: {...} } }` for every
  method — the dock's loader must tolerate a value shape it does not expect
  (treat anything that is not `{ hints: [...] }` as empty).
- `package.json` needs `"./client": { "default": "./lib/client.js" }` in `exports`,
  a `dsh.client` block identical to plan-board's (`platform: web`, `inject:
  ["@deepseek-ai/dsh-client-runtime"]`, `immediately: true`), `!lib/client.body.cjs`
  in `files`, and `@types/react` in devDependencies (copy the version plan-board uses).
  `build/build.mjs` gains the client build step — copy plan-board's, changing the
  loader `id` to `@dennisrongo/dsh-hooks`.
- Root `AGENTS.md` layout table says `plugins/dsh-hooks host` — update to `host + client`.

## Design

### Host: `src/hints.ts` — a pure `HintEngine`, wired from `HooksService`

Keep `HooksService` as the only cordis service and Typert namespace; the engine is a
plain class with no cordis imports so the smoke test can drive it directly.

```ts
export interface SessionSituation {
  cwd: string
  projectTypes: ReadonlySet<ProjectType>        // from fingerprint(cwd)
  skillsUsed: ReadonlySet<string>               // `skill` tool calls + /skill invocations
  editedPaths: ReadonlySet<string>              // whole session
  lastTurn: { edits: number; ranTests: boolean; committed: boolean; toolErrors: number }
  lastPrompt: string
  status: 'idle' | 'running'                    // running = between pre-step and turn-stopping
  dismissed: ReadonlySet<string>                // hint ids
}

export interface SkillHint {
  id: string            // `${rule}:${skill}` — stable so dismiss survives recompute
  skill: string         // exact catalog name; the chip inserts `/${skill} `
  title: string         // e.g. ".NET project detected"
  reason: string        // one sentence, ≤ 120 chars
  priority: number      // lower first
  rule: string          // which rule produced it, for the `recent`-style debugging
}
```

`HintEngine.compute(situation, catalog: SkillSummary[]): SkillHint[]` — pure,
deterministic, sorted by priority, capped at `maxHints` (default 3), excludes
`skillsUsed` and `dismissed`. Every rule matches against the **real catalog**, by
name pattern or by phrase, so nothing is suggested that is not installed.

### Rules (v1 built-ins)

Match skills by `RegExp` on `name` **or** by phrase match on the skill's own
`description` / `whenToUse`. Many skills in this user's catalogs carry literal trigger
phrases in quotes (`"review my code"`, `"debug this"`); `phrasesOf(skill)` extracts
every `"..."` span from description+whenToUse, lowercased, and `matchesPrompt` checks
for substring hits in the lowercased prompt. This is the generic rule; the named rules
below cover what phrases cannot see.

| rule | fires when | suggests (first installed match wins per line) | priority |
|---|---|---|---|
| `project:dotnet` | fingerprint has `*.csproj` / `*.sln` / `*.slnx` / `global.json` | `/dotnet/` | 20 |
| `project:nextjs` | `package.json` deps include `next` | `/nextjs/` | 20 |
| `project:tauri` | `src-tauri/tauri.conf.json` or `tauri.conf.json` | `/tauri/` | 20 |
| `project:remotion` | deps include `remotion` | `/remotion-best-practices|^remotion/` | 20 |
| `project:shadcn` | `components.json` with `"$schema"` containing `shadcn` | `/shadcn/` | 25 |
| `prompt:phrase` | user prompt contains a quoted trigger phrase of a skill | that skill | 10 |
| `prompt:bug` | prompt matches `/\b(bug|broken|failing|crash|error|regression|flaky)\b/i` and no phrase hit | `/^diagnose$|systematic-debugging|:debug$/` | 12 |
| `prompt:plan` | prompt matches `/\b(plan|design|architect|spec)\b/i` | `/plan-and-build|writing-plans|brainstorming/` | 12 |
| `turn:feature-done` | turn ended with `edits ≥ 3`, `toolErrors === 0`, no skill used this turn | `/^code-review$|verification-before-completion/` then `/write-tests|test-driven-development/` | 5 |
| `turn:tests-missing` | edits ≥ 3, `ranTests === false` (no `bash` with `test|vitest|jest|pytest|dotnet test|cargo test|go test`) | `/write-tests|test-driven-development/` | 8 |
| `turn:ready-to-ship` | `bash` ran `git add|git commit` this turn, or edits ≥ 3 and a `code-review` was used earlier this session | `/conventional-commits/` then `/create-pr|finishing-a-development-branch|ship-it/` | 6 |
| `session:long` | prompts this session ≥ 25 | `/^handoff$|:handoff$/` | 30 |

Project rules fire at session start and stay (they describe the workspace); prompt
rules replace the previous prompt rule's hints on each new prompt; turn rules replace
the previous turn's. Cap 3, priority order, so a turn-done hint outranks a standing
project hint.

`fingerprint(cwd)`: `readdirSync` of the top level plus **one** level of
non-hidden, non-`node_modules|bin|obj|dist|.git` subdirectories, bounded to 400
entries; `package.json` parsed once. Cache per cwd against the top-level directory
`mtimeMs` with a 30 s TTL. Synchronous fs is fine — it runs once per session start,
never on the tool hot path. Never throw: a permissions error means "no project types".

### Settings (user layer, same `dsh-hooks` namespace)

Extend `HooksSettings` in `src/config.ts`:

```yaml
dsh-hooks:
  hints:
    enabled: true        # master switch for the chip strip and the engine
    max: 3               # 1..6
    disableRules: []     # rule ids to silence, e.g. ["session:long"]
```

Live-reload through the existing `scope.watch`. `enabled: false` → `hints` returns
`[]`, `hintsToken` returns the frozen token, and the dock renders nothing. Project
layer (`.dsh/hints.json`) is **out of scope** for v1 — say so in the README.

### Endpoints (added to `HooksService`, `remote.ts`, `typert.host.ts`)

```
POST /api/dshHooks/hints        { sessionId }        → { hints: SkillHint[], token: number }
POST /api/dshHooks/hintsToken   { sessionId }        → { token: number }
POST /api/dshHooks/dismissHint  { sessionId, id }    → { ok: boolean, token: number }
```

`sessionId` is the branded id as a string; the service keys situations by
`String(agent.id)` (same value `basePayload` already uses). Unknown session → empty
list, token 0, never an error. Add the three descriptors with strict zod schemas and
the three `members`/`types` rows in the manifest.

### Client: `src/client.tsx`

- `apply(ctx)`: `$mount(HOOKS_REMOTE)` effect, then `inject(['remote.dshHooks',
  'slots'])` → register the dock entry (`order: 20`).
- `HintStrip` component: props `{ sessionId, remote, inputActions }` plus the owner
  `InputZone` props. State `{ hints, token }`. Effect: poll `hintsToken` every 1500 ms
  (`setInterval`, cleared on unmount; skip a tick while a request is in flight —
  copy the `polling` guard from `dsh-git`), fetch `hints` on change. Pause polling
  when `document.visibilityState === 'hidden'`.
- Render: a single row, `display:flex; gap:6px; flex-wrap:wrap`, one chip per hint:
  `[/skill-name] reason  ×`. Chip is a `<button>` with `title={reason}`; click →
  `inputActions.setDraft('/' + skill + ' ')`. `×` → `remote.dismissHint` then drop
  it locally. Optional ▶ → `setDraft` then `inputActions.submit()`.
- No hints → `return null`. No loading UI.
- Styles injected once via the element-guarded `injectStyles()`; prefix `dshhk-`;
  tokens `--dsw-*` only; 12 px chip text, 11 px reason.
- Export `inject = ['slots', 'remote']` and `apply` (what `check-context.mjs` reads).

### Suppression and hygiene

- A skill used this session (tool `skill` with `{name}` or a `/skill` invocation) is
  never suggested again in that session.
- Dismiss is per session, per hint id; dismissed ids survive recompute.
- Situations are dropped on `agent/disposed`; bound the map at 200 sessions (LRU).
- Nothing here may throw into a listener: wrap engine calls the way `dispatch`
  wraps `runHooks` (`console.warn('[dsh-hooks] hints: ...')`).
- `tools/pre-execute` is the hot path — **touch nothing there.** All signal capture
  goes in `tools/post-execute`, which already runs after the result settles.

## Steps (each ends with an observed check)

1. **Engine, pure.** `src/hints.ts`: types, `fingerprint`, `phrasesOf`,
   `matchesPrompt`, the rule table, `HintEngine.compute`. `npx tsc --noEmit` clean
   (run `node scripts/anchor.mjs` first if `TS2307` appears).
2. **Smoke tests for the engine** in `test/smoke.mjs` against BUILT `lib/`: temp dir
   with `Foo.csproj` → `dotnet` type; nested `src/Web/Web.csproj` found at depth 1;
   `node_modules/x/x.csproj` ignored; catalog of fake skills → `.NET` hint names the
   `/dotnet/` skill only when present; `skillsUsed` suppresses; `dismissed`
   suppresses; `turn:feature-done` fires at 3 edits/0 errors and not at 2; phrase
   match on `"review my code"`; cap honoured; deterministic order; token bump only
   on change. Export what the tests need from `src/index.ts`.
3. **Wire the service.** Situation map in `HooksService`; capture in the five
   listeners; `skills` catalog cache with `skills/change` invalidation and the
   agent-scope lookup mirrored from `dsh-tool-skill`; the three `@Remote` methods;
   settings `hints` block. `node build/build.mjs && node test/smoke.mjs` green.
4. **Descriptors + manifest.** `remote.ts` and `typert.host.ts` gain the three
   endpoints. Smoke-assert none of the method names is in the reserved list (copy the
   assertion from `dsh-plan-board/test/smoke.mjs`).
5. **Client half.** `src/client.tsx`, `build/build.mjs` client step, `package.json`
   (`exports`, `files`, `dsh.client`, `@types/react`), `REMOTE_NAMESPACES` in
   `scripts/check-context.mjs`. From the repo root: `pnpm run build` then
   `pnpm run test` (this runs check-suites, check-type-scale, check-tokens,
   check-progress, every package's tests, and check-context — all must be green).
   `node scripts/verify.mjs` green.
6. **Docs.** `plugins/dsh-hooks/README.md` (new "Skill hints" section: what fires,
   the settings block, that `.dsh/hints.json` is not yet a thing), `plugins/dsh-hooks/AGENTS.md`
   (layout gains `hints.ts` + `client.tsx`; bite list gains: REMOTE_NAMESPACES,
   `hintsToken` must stay O(1), dock returns null when empty, `setDraft` not
   `submit`, stream-mode as future upgrade, the scope argument to `skills.list`),
   root `AGENTS.md` layout row, `CHANGELOG` if the package has one (check), version
   `0.2.0` in `package.json`. Do **not** publish and do **not** commit — the release
   runs through the Actions workflow and commits are the owner's call.
7. **Live check (do it if a scratch profile can be stood up in under ~15 min;
   otherwise report it as NOT RUN, never as passed).** Use a throwaway `DSH_HOME`
   (never `~/.dsh`, never the Desktop's home — DSH Desktop is likely running). The
   rig recipe is in the project memory note "dsh-new-plugins-status": scaffold with
   `dsh plugin --profile <name> list`, add `@deepseek-ai/dsh-web-app` to
   `dsh.profile.bundles`, junction the plugin (PowerShell `New-Item -ItemType
   Junction`, not `cmd mklink`), seed a workspace with `createdAt`/`updatedAt`. Then
   `curl` `dshHooks/hintsToken` with the `{"type":"client-request",...}` envelope
   from `scripts/verify.mjs`: **200** proves the `./typert` export mounted; **404**
   means it did not. If a browser is reachable, open the app and confirm the strip
   renders and a chip click writes `/name ` into the composer.
8. **Self-review the diff** (`git diff --stat`, then read every hunk) before
   reporting: dead code, `any` leaks, missing `console.warn` guards, anything on the
   `tools/pre-execute` path.

## Out of scope for v1 (say so in the report)

- Project-layer hint rules (`.dsh/hints.json`) and user-defined rules in settings.
- Stream-mode push instead of polling.
- Hints for `SubagentStop` / `Notification`.
- An LLM-based classifier for prompt intent — the phrase/regex rules are deliberate;
  false positives here are just an ignorable chip, so cheap heuristics are right.

## Report format

State plainly: what was built, which checks were **observed** green (name the command
and the count of tests), what was skipped and why, the working-tree file list, and
any harness fact above that turned out wrong.
