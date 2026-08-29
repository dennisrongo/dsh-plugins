# AGENTS.md — dsh-hooks

Host-only plugin. One cordis service (`dshHooks`), eight lifecycle listeners, two
`@Remote` endpoints, no client half. Read `README.md` for what it does and how it
is configured; this file is what you need before changing it.

## Layout

```
src/types.ts        event names, config/payload/output/run shapes, limits
src/config.ts       settings namespace schema, <workspace>/.dsh/hooks.json reader, layer merge
src/matcher.ts      regex matcher over tool names, with compile + warn caches
src/runner.ts       spawn one hook, fold a matcher set into a HookVerdict
src/index.ts        HooksService: settings registration, the eight listeners, endpoints
src/remote.ts       Typert descriptors (shared by both faces)
src/typert.host.ts  the ./typert manifest the loader imports
test/smoke.mjs      26 checks against BUILT lib/, incl. real child processes
```

## Build and verify

```bash
node build/build.mjs      # lib/index.js + lib/typert.host.js
npx tsc --noEmit          # needs scripts/anchor.mjs to have run
node test/smoke.mjs       # builds nothing; run the build first
```

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

## Optional services

`static inject = ['tools', 'subprocess']` — only these two. `settings` is picked
up through `this.ctx.inject(['settings'], ...)`, a fiber that tolerates settings
mounting later and unwinds cleanly if it unmounts; `workspaceRegistry` and
`agents` are read with `ctx.get(...)`, which returns `undefined` when absent.
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
```

`200` means the `./typert` export registered; `404` means it did not.
