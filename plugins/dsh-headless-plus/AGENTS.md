# AGENTS.md — dsh-headless-plus

Replaces the stock dsh headless app with one that can choose a model and continue a
conversation. **No host service and no `/api` endpoints** — it is a CLI app, not a UI plugin,
so the verification recipe here is a real headless run, not a wire probe.

The package name is **unscoped** (`dsh-headless-plus`, not `@dennisrongo/...`), so it
installs to `node_modules/dsh-headless-plus`.

## Two halves, two rows

- **`lib/startup.js`** — plugin `headless-plus-startup`, `inject: ["cmdlineArgs"]`. Owns the
  flag family via commander (`headlessPlusCommand()`), then publishes the
  `headlessPlusStartup` service (`HEADLESS_PLUS_STARTUP_SERVICE`) carrying the parsed task
  and options. Each dsh app owns its own flags, so this does not collide with the launcher's.
- **`lib/index.js`** — plugin `headless-plus-runner`,
  `inject: ["agentDefaultModel", "agents", "sessions", "headlessPlusStartup"]`,
  `Config = { task: string (required) }`. Resolves the session target, applies any model
  override, runs the agent and prints the result.

Flags: `--model provider/model`, `--resume <session-id|latest>`, `-c, --continue`
(alias for `--resume latest`), `--session-info` (session id to stderr at exit).

Resuming uses the public `ctx.agents.resume()`. `--resume latest` maps the cwd to its session
directory with `workspaceSlug()`, which **mirrors `dsh-session-persistence-jsonl`'s slug rule**
(separators → `-`, wrapped in `--`); if that convention changes upstream, this breaks and
`test/smoke.mjs` is what catches it.

## Mounting

Needs a profile on `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`. It **replaces** the
two stock rows, so they must be disabled explicitly. Both `id:` and `name:` are required on
insert rows — a bare `id:` is an id-targeted override and silently no-ops:

```yaml
- id: headless-startup
  disabled: true
- id: headless-runner
  disabled: true
- insert:
    - id: headless-plus-startup
      name: 'dsh-headless-plus/startup'
    - id: headless-plus-runner
      name: 'dsh-headless-plus'
      inject: [headlessPlusStartup]
      config:
        task: !!js ctx.headlessPlusStartup.task
```

Install with `dsh plugin --profile <name> add "file:<repo>/plugins/dsh-headless-plus"` using
a native forward-slash absolute Windows path; the MSYS `/c/...` form fails
`LINKED_PKG_DIR_NOT_FOUND`.

## Dev loop

`pnpm install` at the repo root, then `pnpm test` here — `test/smoke.mjs` is offline and
covers `parseModelOverride`, `workspaceSlug` and `resolveLatestSession` against a temp
session tree. There is no build step: `lib/` is hand-written and committed.

`scripts/dev-link.ps1` at the repo root junctions the package into a profile so edits take
effect on the next run. **Re-run it after any `pnpm install`** — pnpm replaces junctions with
copies, and a junctioned package resolves through its real path, so its dependencies must
live in *its* `node_modules`, not the profile's hoisted tree.

`commander` is a real **dependency** (imported by `startup.js` at runtime) and every
`@deepseek-ai/*` is a **peer** supplied by your dsh install. Both matter: `commander` was
once declared as a devDependency, which made a fresh consumer install fail with
`ERR_MODULE_NOT_FOUND: Cannot find package 'commander' imported from …/lib/startup.js`
while the developer's own machine kept working off a stale tree.

## Verification

```bash
pnpm test                      # offline unit coverage

# resolution — must print the dsh CLI install, never a .pnpm store path
node -e "const{createRequire}=require('module'),{resolve}=require('path');console.log(createRequire(resolve('lib/index.js')).resolve('@deepseek-ai/dsh-session'))"

# both entry points must import cleanly (this is what a broken declaration breaks)
node --input-type=module -e "await import('./lib/index.js'); await import('./lib/startup.js'); console.log('imports OK')"

# end to end, cheapest useful run
dsh --profile headless-plus --session-info "reply with the single word ok"
dsh --profile headless-plus --continue "and again"
```

The first run prints a session id on stderr; `--continue` must pick that same session up.
A `--model` value is `provider/model` — `parseModelOverride` throws on anything else, so a
malformed value fails fast at startup rather than silently using the default.
