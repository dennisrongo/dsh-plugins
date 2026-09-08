# AGENTS.md — dsh-hooks

Host + client. One cordis service (`dshHooks`), nine lifecycle listeners, five
`@Remote` endpoints, one client seat. Read `README.md` for what it does and how it
is configured; this file is what you need before changing it.

## Layout

```
src/types.ts        event names, config/payload/output/run shapes, limits
src/config.ts       settings namespace schema, <workspace>/.dsh/hooks.json reader, layer merge
src/matcher.ts      regex matcher over tool names, with compile + warn caches
src/runner.ts       spawn one hook, fold a matcher set into a HookVerdict
src/hints.ts        the PURE skill-hint engine: fingerprint, phrases, rule table
src/index.ts        HooksService: settings registration, the listeners, endpoints
src/client.tsx      conversation.input.dock chip strip + CSS
src/remote.ts       Typert descriptors (shared by both faces)
src/typert.host.ts  the ./typert manifest the loader imports
test/smoke.mjs      62 checks against BUILT lib/, incl. real child processes
```

## Build and verify

```bash
node build/build.mjs      # lib/index.js + lib/typert.host.js + lib/client.js
npx tsc --noEmit          # needs scripts/anchor.mjs to have run
node test/smoke.mjs       # builds nothing; run the build first
```

`npm test` does both. The hint engine is a plain class with no cordis imports,
which is the whole reason `src/hints.ts` is a separate file: the smoke test
drives every rule directly with a plain object, no fibers and no fake agent.

`npm test` does both. The smoke test drives `runHooks` against **real** child
processes through a stand-in subprocess seam whose `shell` is `[node, '-e']`, so
each "shell command" in the test is JavaScript source — no bash, no pwsh, no temp
scripts, and the exit-code contract is genuinely exercised rather than mocked.

## Things that will bite you

- **Never minify the host bundle.** The Typert gateway derives a `@Remote`
  method's wire fields from its PARAMETER NAMES via `Function.prototype.toString()`.
  Minification renames `request` to `e` and the endpoint fails at call time with
  a missing wire field, not at build time.
- **`target: es2021` is load-bearing.** `@Remote` is a TC39 standard decorator;
  Node 22 cannot parse native decorator syntax and esbuild only downlevels when
  the target predates decorators. es2022+ emits them verbatim and the host half
  fails to load outright.
- **`./typert` must stay in `exports` and in `files`.** Without it the loader
  skips the package **silently** — the service constructs, every listener fires,
  and only the `/api` calls 404. The verdict is cached per process, so adding it
  needs a full profile restart, not a refresh.
- **`tools/pre-execute` is on the hot path.** It is awaited before every single
  dispatch. Anything added here that can block without a deadline stalls the whole
  session. The runner owns the timeout; do not move it into a hook's hands.
- **Scope-filtered dispatch.** `tools/*`, `agent/*` and `approval/request` are
  scope-filtered by `@deepseek-ai/dsh-scope` — an agent-scoped listener sees only
  that agent's calls. This service registers on its own plugin fiber (unscoped),
  which is why subagent tool calls reach it. Moving the registration under an
  agent shadow would silently narrow it.
- **`subagent/end` carries no agent.** There is no cwd on it, which is why
  `subagent/start` stashes the child's directory in `subagentCwd` keyed by
  `runId`. Drop that and `SubagentStop` hooks run in the wrong directory.
- **The two non-mappings are deliberate and must stay loud.** `updatedInput` and
  a blocking `SessionEnd` cannot work here; both paths warn. Silently accepting
  either would let a security hook believe it sanitized something it did not.
- **`Stop` has two loop guards, and they are not redundant.** `stop_hook_active`
  is the protocol's guard for well-written hooks; `MAX_STOP_CONTINUATIONS` is the
  backstop for hooks that ignore it. Removing the cap makes
  `{"decision":"block"}` on `Stop` an unbounded token burn.

## Things that will bite you about the hint strip

- **`scripts/check-context.mjs` has a hardcoded `REMOTE_NAMESPACES` list.**
  `remote.dshHooks` has to be in it, or the client half's slot registration —
  which is parked on that service — never runs, the check measures ZERO slots,
  and it then fails the plugin for registering nothing. Both the bare name
  (`MOUNTED_NAMESPACES`) and the namespaced one are needed.
- **That check's remote stub answers EVERY method with a shape we never asked
  for** (`{ ok: true, value: { list: {...} } }`). `readHints` / `readToken` in
  `client.tsx` therefore treat anything that is not a hint array as empty. A
  loader that trusted `value.hints.map` would throw inside the deferred path
  the check exists to exercise — and the same guard covers a host still on an
  older version of this contract.
- **`hintsToken` is the polled endpoint and must stay O(1).** It reads an
  in-memory counter and does nothing else: no fs, no catalog read, no compute.
  The moment it computes anything it costs what `hints` costs and polling is
  pointless — the same trap `dsh-git`'s and `dsh-plan-board`'s `changeToken`
  both document. The counter moves only inside `recomputeHints`, and only when
  the hint ids actually differ, so an idle session polls a constant.
- **The dock entry returns `null` when there are no hints.** That is the
  common case. An entry that always drew a container would shrink the
  conversation for every user of this plugin whether or not it had anything to
  say. There is deliberately no loading treatment either — hints are ambient,
  so `check-progress.mjs` has nothing to check here.
- **A chip calls `setDraft`, never `submit`, on a plain click.** The shipped
  `/`-menu resolves a pick as `{ text: '/${name} ' }`
  (`dsh-client-ui-skill/lib/client.js`), so `setDraft('/name ')` reproduces
  exactly what picking the skill from the slash menu does and the user still
  confirms with Enter. Submitting on click would start a turn from a stray
  click beside the composer; the `▶` button (and shift-click) is the explicit
  opt-in.
- **`inputActions` is threaded as a PROP, not a module variable.** It is a
  `SessionStandardProps` member the owning slot supplies to the registered
  view, and the shell can render two session-scoped docks at once — a single
  module-level holder would let a chip in one session write the other's draft.
- **`ctx.skills.list()` needs the `scope` argument.** Omitting it reads the
  GLOBAL layer alone, so every skill a preset's standing composition mounted is
  invisible and never suggested. `dsh-tool-skill` passes `scope: exec.agent`
  and the agent object IS the `ScopeKey` (`ScopeKey = object`); `HintState.scope`
  mirrors that exactly. The registry is read through `ctx.get('skills')` and is
  NOT in `static inject`, for the same reason `settings` is not.
- **Every rule carries a PATTERN, never a skill name.** A hint naming a skill
  this deployment does not have is worse than no hint: the user types it, gets
  "unknown skill", and stops trusting the strip. Patterns are resolved against
  the live catalog, and no match means no chip, silently.
- **`tools/pre-execute` stays untouched.** All hint signal capture is in
  `tools/post-execute`, which runs after the result has settled. The argument
  inspection is cheap, but "cheap" on a path awaited before every dispatch is
  how a session acquires a stall nobody can attribute.
- **The upgrade path off polling is `@Remote({ mode: 'stream' })`.** There is
  no plugin-defined host→client event — `dsh-api-remotes`' `remote-events` is a
  fixed allowlist — and stream mode is supported by `dsh-typert-protocol` but
  unproven in this repo and in the hand-written descriptor format. It was
  deliberately not used for v1.
- **`client.tsx` declares its own context interface** instead of importing
  `@deepseek-ai/dsh-client-runtime/client`. That package is absent from the dsh
  install this repo anchors against, and a type-only import of a missing module
  turns `npx tsc --noEmit` red for a file that compiles and runs fine. The
  interface is structural, so the real context satisfies it. (`dsh-plan-board`
  imports it and its typecheck is red for exactly this reason.)

## Optional services

`static inject = ['tools', 'subprocess']` — only these two. `settings` is picked
up through `this.ctx.inject(['settings'], ...)`, a fiber that tolerates settings
mounting later and unwinds cleanly if it unmounts; `workspaceRegistry`, `agents`
and `skills` are read with `ctx.get(...)`, which returns `undefined` when absent.
This cordis has no `optional` form of `inject` — every entry is a hard wait — so
adding `settings` to that array would make the plugin never mount in a deployment
that composes no settings provider.

## Wire check

Static verification (`node scripts/verify.mjs` from the repo root) proves the
entry points import and the deps anchor to the dsh CLI copy. It does **not** prove
the endpoints mounted. That needs a live profile:

```bash
dsh --profile web --port 38111 --no-open
curl -s localhost:38111/api/dshHooks/describe -H 'content-type: application/json' -d '{"request":{}}'
curl -s localhost:38111/api/dshHooks/hintsToken -H 'content-type: application/json' -d '{"request":{"sessionId":"1"}}'
```

`200` means the `./typert` export registered; `404` means it did not. Use a
throwaway `DSH_HOME` — never `~/.dsh` and never DSH Desktop's, which is very
likely running. Two harnesses on one home corrupt each other's sessions
silently; see the repo `AGENTS.md`.

The client half additionally needs a browser: confirm the strip renders above
the composer and that clicking a chip puts `/name ` in the input. The Desktop
runs the UI at 90% zoom — the strip is in normal flow and does no
`getBoundingClientRect` arithmetic, so it is low-risk there, but check it
anyway (see `dsh-plan-board`'s AGENTS.md for what that class of bug costs).
