# AGENTS.md — @dennisrongo/dsh-mission-control

Fleet dashboard for DeepSeek Harness: live sessions, subagent swarm tree, token burn and a
permission inbox, floating over the stock web UI.

**Client-only plugin — no host service, no `/api/` endpoints.** It registers into dsh's
additive `shell.overlay` slot and is a **pure consumer**: no services, no tools, no presets,
same posture as the shipped `ui-trajectory` plugin. Keep that — a host half here would be a
design change, not an addition.

It reads public faces only: `ctx.sessions.list` (an ObservableSnapshot bridged into React),
`sessionStats` projections (turns / steps / llmMs / decodeTokens), and `PendingInteraction`
off the session summaries.

Because there is no host half, the identity check and wire probe the sibling packages
document don't apply. Verify through the served bundle and the rendered DOM instead.

## Surfaces

Two surfaces share one component tree, and that is why control sizing is tokenised rather
than hardcoded:

- **The docked panel** — a 400px right rail the shell reflows around. Compact controls are
  appropriate here.
- **Stage** — a full-screen takeover (`inset: 0`) holding a live grid of tiles. It is
  layered *over* the panel modes and is deliberately **not** a fourth mode, so exiting
  restores the tab you came from. Membership *and order* come from `stageRows`:
  running/waiting roots plus anything touched inside the activity window (`30m`/`2h`), most
  active first. A tile answers a pending permission **in place** through the same
  `PendingInteraction` path the inbox uses.

`--mc-ctl-h`, `--mc-ctl-font`, `--mc-msg-size` and `--mc-msg-line` are declared on `.dshmc`
and **overridden on `.dshmc-stage`**. Hardcoding a px size in a rule both surfaces use is the
bug this prevents: the rail's 11.5px/28px controls read as undersized on a full-screen grid
of 420px tiles.

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

Persisted to `localStorage` under `dsh-mission-control:settings` via `parseSettings`, which
is **defensive by contract**: any bad shape falls back to defaults, and a write failure
(private mode, quota) keeps the in-memory value rather than throwing into the shell.
`parseSettings` is exported so it can be driven directly from a test.

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

`pnpm install` at the monorepo root, then `pnpm run build` here (esbuild dual build →
`lib/index.js` + `lib/client.js`, via the gitignored `client.body.cjs`) and `pnpm test`
(`test/smoke.mjs`, offline, exercising the **built** bundle).

**`pnpm test` rebuilds first** (`node build/build.mjs && node test/smoke.mjs`), matching
`dsh-git`, `dsh-weather` and `dsh-todo`. The suite imports `lib/client.js` and calls its
exports, so without that prefix it happily passes against a stale bundle — verified by
changing `fmtTokens`' divisor in `src/` without rebuilding and watching the suite stay
green. This is the same defect class that let this package's own `dshmc-burn-row` marker
rot unnoticed. Running `test/smoke.mjs` directly still skips the build, so prefer
`pnpm test`.

`scripts/dev-link.ps1` junctions the package into a profile so a rebuild self-deploys;
client-half edits then land on a **browser refresh** with no profile restart. Re-run it, or
`node scripts/anchor.mjs`, after any `pnpm install`.

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

# the bundle the browser receives — size should match the build's reported bytes
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' \
  http://127.0.0.1:38111/plugins/@dennisrongo/dsh-mission-control/client.js
```

Then open the UI and confirm the overlay renders: `dshmc-*` nodes present, the stats strip
populated, sessions listed. Verify against the **server**, not the filesystem — dsh reads the
plugin from disk per request, so a refreshed bundle needs only a browser refresh.

## Gotchas

- CSS classes are namespaced `dshmc-`. `test/installed-copy.mjs` asserts on specific marker
  strings (`dshmc-stats`, `dshmc-tool-head`, `--mc-msg-size`, …), so renaming a class breaks
  tests by design — update both together. Removing a feature means removing its markers too:
  `dshmc-burn-row`/`dshmc-burn-model` outlived the burn block they described and sat green
  for months, which is why a negative assertion now pins their absence.
- `tsconfig.json` `paths` point at `./node_modules/@deepseek-ai/...`, which only exist after
  anchoring. `TS2307: Cannot find module '@deepseek-ai/...'` means run `node
  scripts/anchor.mjs`, not add a stub.
- The overlay must degrade rather than throw: a session list that fails to load should render
  an empty or error state, never take down the shell it floats over.
