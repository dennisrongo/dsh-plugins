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
/ decodeTokens), and `PendingInteraction` off the session summaries. No tools,
no presets. One minimal host service persists the panel's timer state to a JSON
cell under the harness home — browser storage is origin-scoped and DSH Desktop
serves the UI from an ephemeral port per launch, so without it a restart reset
the pomodoro. Without the host half the panel degrades to localStorage.

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
`dsh-mission-control:settings` (origin-local; only the pomodoro is mirrored
to the host cell). Parsing is defensive — any bad shape falls back to
defaults, and a storage failure (private mode, quota) degrades to an
in-memory value rather than throwing into the shell.

| Setting | Does |
| --- | --- |
| Sessions per workspace | How many sessions each Fleet group lists; the rest stay one click away. `0` = all. |
| Fleet sort | Orders sessions inside a group. Sessions needing attention always stay on top regardless. |
| Show break timer | Toggles the pomodoro footer. |
| Work / break / long break | Pomodoro phase lengths, in minutes. |

The **pomodoro timer** runs in the footer and fires a desktop notification on
each phase change. Its state survives restarts: it is mirrored to the host's
state cell (`<DSH_HOME>/storages/dsh-mission-control.json`) with a timestamped
envelope, and the newer copy wins on load — so a running timer picked up after a
Desktop restart simply re-derives its remainder from the wall clock. The drawer is a two-column grid — one column for every label,
one for every control — so labels and controls line up across all rows; per-row
`space-between` cannot do that, because it aligns each control to its own label.

## Install (dev)

```bash
pnpm install
pnpm run build          # emits lib/index.js + lib/client.js + lib/typert.host.js
pnpm test               # offline smoke test
```

The package declares `dsh.bundle`, so one command installs **and** mounts both
halves — do **not** also add an `insert:` row to the profile's
`cordis.patch.yml`; a second row with the same id is fatal
(`duplicate loader entry id: dsh-mission-control`):

```bash
dsh plugin --profile web add @dennisrongo/dsh-mission-control
# or, from a clone:
dsh plugin --profile web add "file:C:/absolute/path/to/dsh-plugins/plugins/dsh-mission-control"
```

Restart the profile. The overlay rides in the `shell.overlay` seat; the host
cell is at `<DSH_HOME>/storages/dsh-mission-control.json`.

## Status

Verified against dsh `0.1.1-rc.2` seams: `window.__ModuleLoader__.load`
closure-factory convention, `ctx.slots.register` additive list entry,
`useSyncExternalStore` binding over `ctx.sessions.list`, and the
`./typert` host-face export that publishes `dshMissionControl/load` and
`save`.

dsh is a fast-moving 0.1.x dev preview — re-verify seams on upgrade.
