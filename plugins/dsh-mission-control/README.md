# dsh-mission-control

**Mission Control** — a fleet dashboard plugin for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness).

One glass panel over your entire agent fleet: live sessions, subagent swarm tree,
token burn, and a permission inbox — registered into dsh's additive
`shell.overlay` slot, so it floats over the stock web UI without touching it.

## What it shows

- **Fleet** — every session (root + subagents) with running / waiting / done states
- **Swarm tree** — coordinator → worker lineages, nested
- **Stats strip** — session count, running, subagents, waiting-on-you
- **Permission inbox** — sessions blocked on `approval` / `question` / `plan-review`

Built on public faces only: `ctx.sessions.list` (ObservableSnapshot → React),
`sessionStats` projections (turns / steps / llmMs / decodeTokens), and
`PendingInteraction` off the session summaries. No services, no tools, no
presets — a pure consumer, same posture as the shipped `ui-trajectory` plugin.

## Install (dev)

```bash
pnpm install
pnpm run build          # emits lib/index.js + lib/client.js
pnpm test               # offline smoke test
```

Mount into a profile (dev checkout):

```yaml
# ~/.dsh/profiles/<name>/cordis.patch.yml
- insert:
    - id: dsh-mission-control
      name: '@dennisrongo/dsh-mission-control'
```

with the package linked into the profile workspace:

```bash
cd ~/.dsh/profiles/<name>
dsh plugin --profile <name> add @dennisrongo/dsh-mission-control
```

Then `dsh web` and the panel rides in the overlay seat.

## Status

v0.1 — scaffold verified against dsh `0.1.1-rc.2` seams:
`window.__ModuleLoader__.load` closure-factory convention, `ctx.slots.register`
additive list entry, `useSyncExternalStore` binding over `ctx.sessions.list`.

dsh is a fast-moving 0.1.x dev preview — re-verify seams on upgrade.
