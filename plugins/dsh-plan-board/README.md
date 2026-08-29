# dsh-plan-board

**npm:** [`@dennisrongo/dsh-plan-board`](https://www.npmjs.com/package/@dennisrongo/dsh-plan-board)

Plans that outlive the scrollback. Every plan the agent presents through `exit_plan_mode` is written to `<workspace>/.dsh/plans/` as markdown, a window opens so you can read it at full size, and a **Plans** tab keeps the history with each plan's outcome.

## Why this exists

dsh already has plan mode, and it is good: `@deepseek-ai/dsh-plan-mode` logs a `plan/mode` event that survives resume and fork, registers `/plan`, and exposes an `exit_plan_mode` tool that presents the complete markdown for Approve / Keep planning.

What it does not do is **keep** the plan. The markdown exists only inside the tool-call event in the session log — scroll past it and it is gone, it is not a file you can diff or commit, and the reviewer's feedback exists only as the text of a thrown error. A plan is the most reviewed artefact in the whole session and it was the least durable.

## What you get

**A panel that docks beside the chat when a plan is presented.** It opens by itself, takes the right half of the conversation column and *pushes the chat aside* rather than covering it, and closes on Esc or the X. Closing is per-plan, so dismissing one does not suppress the next, and the chat gets its full width back the moment it closes.

**A Plans tab** beside Chat, Trajectory and Todo: every plan for the workspace, newest first, each with a status pill — *Awaiting review* · *Approved* · *Kept planning* — and, on a rejected plan, the reviewer's own words.

**Files you can use.** `<workspace>/.dsh/plans/20260829T121500123-add-a-hook-lifecycle.md`, markdown with a small metadata block:

```
---
id: "20260829T121500123-add-a-hook-lifecycle"
title: "Add a hook lifecycle"
sessionId: "..."
createdAt: 1756470900123
status: "approved"
decidedAt: 1756470960000
---
# Add a hook lifecycle
...
```

The metadata is JSON-per-line rather than YAML. It reads the same, but the writer cannot produce something the reader mis-parses — and it has to survive a model-written title and free-form human feedback containing quotes and newlines, which is exactly where a hand-rolled YAML subset eventually breaks.

## What it will not do

**It does not approve plans.** `exit_plan_mode` presents the plan through `ctx.userQuestions.ask()`, and that service documents **one active provider per context** — the shipped question UI already holds it. Putting Approve / Keep-planning buttons in this window would mean registering a second provider and hijacking every question in the harness, not just plan reviews. So the window is a reading surface, and it says so: the approve control stays where the harness put it, in the conversation.

## How it works

The capture point is `tools/execute`, the around-dispatch waterfall. `next()` runs the tool body — the call that blocks on the human — so wrapping it is what makes the *outcome* observable: the plan is written `pending` before `next()`, and the same file is settled to `approved` or `rejected` after, with the rejection feedback lifted out of the error the tool threw. `tools/pre-execute` was the obvious alternative and sees the plan but never the outcome.

The dock is a `shell.overlay` entry, not a `conversation.view` tab, and that is not a style choice. Views are rendered one-at-a-time by the session body (`only: <active id>`), so an inactive tab is not mounted and cannot open itself when a plan appears. An overlay is shell-scoped and always mounted, so "show the plan the moment there is one" is something this plugin can actually guarantee. The tab exists too — it is the history browser, opened by hand.

`shell.overlay` is not a layout sibling of the chat, so the panel cannot simply occupy half a column: it is `position: fixed`, measures the conversation column, and applies an inline `padding-right` to push it aside by exactly the dock's width. Three details make that survivable. It anchors on **`[data-slot="conversation"]`** — slot names are the documented plugin API, while the class names beside them are hashed CSS-module identifiers that change on any harness build. The padding is applied **inline**, because the column's own class selector has the same specificity as an attribute selector and which stylesheet lands last is not this plugin's to decide. And a `MutationObserver` re-applies both if a React re-render drops them, so the failure mode is a moment of overlap rather than a chat stuck at half width. If the column cannot be found at all the panel still renders against the viewport edge and simply overlays — a plan you can read on top of the conversation beats no plan.

Freshness rides a **change token**, the same shape `dsh-git` uses, for the same reason: the UI needs to notice a new plan without re-reading everything. Here the token is a plain in-memory counter, because this process is the only writer — no `fs.watch`, no handle per workspace. Polling stops while the document is hidden and re-reads immediately on focus, so a background tab costs nothing.

Plan bodies never ride the list. `list` returns metadata only and `get` fetches one body at a time, so a workspace with 200 plans does not ship a megabyte of markdown to draw a sidebar.

Markdown is rendered into **React elements**, never `dangerouslySetInnerHTML` — a plan is model-written text that may quote something that came off the internet, and building elements means there is no escaping step to get wrong. Links render as `label (url)` rather than as anchors, so a model-authored destination is inspectable and inert.

Three storage details are deliberate. Writes go through a temp file and `rename`, which is atomic within a filesystem, so a crash mid-write leaves the previous plan intact rather than a truncated one — the plan you are about to approve is exactly the file that must not be half-written. Ids coming off the wire are validated against a strict slug pattern before they are ever joined into a path. And pruning keeps the newest 200 plans **plus every pending one**, whatever its age: a pending plan is one nobody has answered yet, and deleting it is deleting live work.

## Endpoints

| Method | Takes | Returns |
|---|---|---|
| `dshPlans/list` | `{ workspaceId }` | `{ plans, token }` — metadata only |
| `dshPlans/get` | `{ workspaceId, id }` | `{ plan? }` — with the markdown body |
| `dshPlans/changeToken` | `{ workspaceId }` | `{ token, pendingId? }` — the polled endpoint |
| `dshPlans/discard` | `{ workspaceId, id }` | `{ ok, token }` |

All take a single parameter named `request`, and each reply is an **envelope** — `{ ok: true, value }` or `{ ok: false, error }` — never the bare payload.

Two naming constraints are not obvious and both fail silently. A method may not be called `remove` (nor `has`, `install`, `installDirect`, `installScoped`, `ctx`, `empty`, `invokeRemote`, `methods`, `name`, `namespace`): the client's `RemoteNamespaceService` already owns those, and `$mount` **throws** on a collision, so the namespace never appears and every seat the plugin registers quietly fails to exist. And a client that reads the payload directly instead of unwrapping `value` gets `undefined` from a promise that resolved successfully, so the view sits on its loading state with no error to show. The smoke test pins the first; the client's types pin the second.

## Install

```bash
dsh plugin add @dennisrongo/dsh-plan-board
```

Restart the profile afterwards — the Typert loader caches its per-package verdict for the process lifetime, so a newly added service is not picked up by a browser refresh.

## Requires

`ctx.tools` and `ctx.workspaceRegistry`, both composed by `@deepseek-ai/dsh-web-app` by default, and `@deepseek-ai/dsh-plan-mode` on the agent roster — without plan mode there is no `exit_plan_mode` to capture, and the plugin sits inert rather than failing.
