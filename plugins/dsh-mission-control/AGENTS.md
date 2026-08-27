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
(`test/smoke.mjs`, offline, asserts marker strings against the **built** bundle — build
first or it passes against a stale one).

`scripts/dev-link.ps1` junctions the package into a profile so a rebuild self-deploys;
client-half edits then land on a **browser refresh** with no profile restart. Re-run it, or
`node scripts/anchor.mjs`, after any `pnpm install`.

`test/installed-copy.mjs` checks the copy a profile actually serves, which is machine state
rather than something the repo owns. It derives the path from `$DSH_HOME/profiles/<profile>`
and **exits 0 with a note** when that profile does not exist, so a contributor without it
does not see a red test. Override with `DSH_PROFILE_COPY`, or `DSH_PROFILE` to name a
different profile.

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

- CSS classes are namespaced `dshmc-`. `test/smoke.mjs` asserts on specific marker strings
  (`dshmc-burn-row`, `dshmc-tool-head`, `--mc-msg-size`, …), so renaming a class breaks tests
  by design — update both together.
- `tsconfig.json` `paths` point at `./node_modules/@deepseek-ai/...`, which only exist after
  anchoring. `TS2307: Cannot find module '@deepseek-ai/...'` means run `node
  scripts/anchor.mjs`, not add a stub.
- The overlay must degrade rather than throw: a session list that fails to load should render
  an empty or error state, never take down the shell it floats over.
