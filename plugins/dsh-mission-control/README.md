# dsh-mission-control

[![npm](https://img.shields.io/npm/v/@dennisrongo/dsh-mission-control)](https://www.npmjs.com/package/@dennisrongo/dsh-mission-control)

**npm:** [`@dennisrongo/dsh-mission-control`](https://www.npmjs.com/package/@dennisrongo/dsh-mission-control) ·
**source:** [dennisrongo/dsh-plugins](https://github.com/dennisrongo/dsh-plugins/tree/main/plugins/dsh-mission-control)

**Mission Control** — a fleet dashboard plugin for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness).

One glass panel over your entire agent fleet: live sessions, subagent swarm tree,
token burn, and a permission inbox — registered into dsh's additive
`shell.overlay` slot, so it floats over the stock web UI without touching it.

## What it shows

Docked as a right rail that the shell's layout reflows around:

- **Fleet** — every session (root + subagents) with running / waiting / done
  states, grouped by workspace
- **Swarm tree** — coordinator → worker lineages, nested
- **Stats strip** — session count, running, subagents, waiting-on-you
- **Token burn** — estimated spend broken down by model
- **Permission inbox** — sessions blocked on `approval` / `question` / `plan-review`
- **Feed** — a running log of fleet events

Built on public faces only: `ctx.sessions.list` and `ctx.workspaces.list`
(ObservableSnapshot → React), `sessionStats` projections (turns / steps / llmMs
/ decodeTokens), and `PendingInteraction` off the session summaries. No
services, no tools, no presets — a pure consumer, same posture as the shipped
`ui-trajectory` plugin.

## Stage

**Stage** is a full-screen takeover, not a fourth panel mode — it layers over
whichever tab you were on and returns you to it on exit, via Esc or ×.

It renders a live grid of tiles: one per session that is **running**, **waiting
on you**, or was touched inside the **activity window** (a `30m` / `2h` toggle),
most active first so the busiest tiles sit far left. A tile carries the
session's live conversation and lets you **answer a pending permission in
place** — the operator is already looking at the tile, so sending them back to
the inbox to approve it would be the wrong move. Clicking through jumps to the
session.

Stage covers the whole viewport, so unlike the docked panel it also spans DSH
Desktop's 36px window-drag strip. That region resolves before hit-testing and
outranks the overlay's z-index, so the bar clears the band with top padding and
every control opts out with `data-dsh-no-drag` — otherwise the exit button
lands under the caption controls and simply doesn't click.

Control metrics are CSS custom properties (`--mc-ctl-h`, `--mc-ctl-font`,
`--mc-msg-size`). The 400px rail wants compact controls; Stage is a full-screen
surface and overrides the same tokens with comfortable ones, so the two scales
derive from one place instead of drifting apart.

## Settings

A drawer in the panel header, persisted to `localStorage` under
`dsh-mission-control:settings`. Parsing is defensive — any bad shape falls back
to defaults, and a storage failure (private mode, quota) degrades to an
in-memory value rather than throwing into the shell.

| Setting | Does |
| --- | --- |
| Sessions per workspace | How many sessions each Fleet group lists; the rest stay one click away. `0` = all. |
| Fleet sort | Orders sessions inside a group. Sessions needing attention always stay on top regardless. |
| Show break timer | Toggles the pomodoro footer. |
| Work / break / long break | Pomodoro phase lengths, in minutes. |

The **pomodoro timer** runs in the footer and fires a desktop notification on
each phase change. The drawer is a two-column grid — one column for every label,
one for every control — so labels and controls line up across all rows; per-row
`space-between` cannot do that, because it aligns each control to its own label.

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

Verified against dsh `0.1.1-rc.2` seams: `window.__ModuleLoader__.load`
closure-factory convention, `ctx.slots.register` additive list entry, and
`useSyncExternalStore` binding over `ctx.sessions.list`.

dsh is a fast-moving 0.1.x dev preview — re-verify seams on upgrade.
