# @dennisrongo/dsh-todo

[![npm](https://img.shields.io/npm/v/@dennisrongo/dsh-todo)](https://www.npmjs.com/package/@dennisrongo/dsh-todo)

**npm:** [`@dennisrongo/dsh-todo`](https://www.npmjs.com/package/@dennisrongo/dsh-todo) ·
**source:** [dennisrongo/dsh-plugins](https://github.com/dennisrongo/dsh-plugins/tree/main/plugins/dsh-todo)

A todo list for the [DeepSeek Harness](https://github.com/deepseek-ai) (dsh) web UI.

Registers into the additive `conversation.view` slot — the conversation view
ring — so it appears as its **own tab beside Chat and Trajectory** (`order: 20`,
after chat at `0` and trajectory at `10`) and fills the session pane when
selected.

A **sprint/roadmap task list**, not just a checklist: each task carries a status,
a priority, and optional release and sprint labels, so a real backlog can live
next to the code it describes.

## Features

- **Persisted on disk by the host** — one SQLite database per project at
  `<workspace>/.dsh/todo.db`, not in the browser. It survives a restart, a
  cleared browser cache, and a different browser entirely, and it travels with
  the project.
- **Per-workspace** — each workspace has its own list, keyed by workspace id.
- **Safe against races** — every write carries the revision it observed; a
  losing write is refused and the view adopts the authoritative list, so two
  open tabs can never silently clobber each other.
- **Real workflow states** — `backlog · todo · in-progress · blocked · done`,
  changed from a pill on the row. A boolean cannot express the two things a
  standup actually asks about: what is moving, and what is stuck.
- **Priority** — `P0`–`P3`, shown as a chip. Only P0/P1 are coloured, so the
  list flags what is urgent instead of turning into a rainbow.
- **Release and sprint** — two independent labels: what ships together
  (`v1.2.0`) and when it is worked (`Sprint 24`). A task can be in both.
- **Group by** — None · Status · Release · Sprint · Priority, with collapsible
  section headers carrying their own `done/total` and progress bar. Grouping by
  status gives you a kanban board without drag-and-drop.
- **Task detail modal** — click a task's title to open the full dialog: a
  roomy description box plus status, priority, release, sprint and due date.
  Esc or the backdrop closes it, focus is trapped inside and returned to the row
  you came from, and edits commit on close so a stray click never loses them.
- **Expandable rows** — the chevron still gives a quick in-row peek without
  leaving the list. Double-click a title to rename it inline. One scannable line
  collapsed is what lets a task carry nine fields without becoming a wall of text.
- **Due dates** — stored as calendar days, so "due the 14th" reads as the 14th
  in every timezone. Overdue tasks are flagged red on the row, due-today amber,
  and a finished task is never overdue.
- **Own tab** — full-pane view with a progress header and `done/total` score,
  plus live in-progress and blocked counts.
- **Filter ring** — All · Open · In Progress · Blocked · Backlog · Done ·
  Archive, with live counts; empty states are hidden rather than shown at zero.
- **Archive, not delete** — check items off, then "Archive completed" files them
  away. Archived items leave every active view but stay in the record, and can be
  restored (↩) or permanently deleted from the Archive view.
- **Full editing** — add, check off, click-to-edit the title, edit the
  description and labels, reorder (▲/▼), archive, and delete. Release and sprint
  inputs suggest labels already in use, so free text converges on a shared
  vocabulary without a releases table to administer.
- **Themed** — colors come only from the shell's `--dsw-*` tokens, so it follows
  light/dark automatically. Respects `prefers-reduced-motion`.

## Architecture

This is a **dual-face plugin**. Both halves ship from one package.

| Half | File | Role |
| --- | --- | --- |
| Host | `src/index.ts` | `TodoService`, a `TypertRemoteService` that owns the per-workspace SQLite database and exports `list` / `replace` as `@Remote` methods. |
| Client | `src/client.tsx` | The React tab. Mounts the host contract and calls it as `ctx.remote.dshTodo.*`. |
| Bridge | `src/remote.ts` | The Typert Remote descriptor the client mounts. |
| Shared | `src/types.ts` | Dependency-free vocabulary used by both halves. |

The browser holds no authority over the data: it renders an optimistic echo and
the committed host revision always wins.

### Two build constraints that are easy to break

Both are asserted by the smoke test, because both fail silently at runtime:

1. **The host half must not be minified.** The Typert gateway discovers a
   `@Remote` method's wire fields by reading its *parameter names* out of
   `Function.prototype.toString()`. Minifying `request` to `e` changes the wire
   contract.
2. **The host half must target `es2021`.** `@Remote` is a TC39 *standard*
   decorator, and Node 22 cannot yet parse native decorator syntax. esbuild only
   downlevels decorators when the target predates them; at `es2022+` it emits
   them verbatim and the host half fails to load.

### Peer dependencies, not dependencies

`@deepseek-ai/cordis`, `dsh-typert-protocol`, and `dsh-storage-domain` are
declared as **peer** dependencies and marked external in the host build. They
must resolve to the *running dsh install's* copies — a second cordis instance
would register into a different registry and the service would never appear.
dsh profiles set `autoInstallPeers: false`, so this resolves correctly.

## Commands

```bash
pnpm install
pnpm run build      # node build/build.mjs — emits lib/index.js + lib/client.js
pnpm run typecheck  # tsc --noEmit
pnpm test           # node test/smoke.mjs — offline, exercises the BUILT lib/ output
pnpm run test:icons # headless Chrome: icon sizes and the 40px row budget
pnpm run test:modal # headless Chrome: the dialog escapes the list's scroll container
```

`pnpm test` asserts against `lib/`, so **build before testing**.

## Install into a dsh profile

The profile must already compose the workspace registry, which `@deepseek-ai/dsh-web-app`
does by default.

```bash
cd ~/.dsh/profiles/<profile>
pnpm add "file:/absolute/path/to/dsh-plugins/plugins/dsh-todo"
```

then add the row to `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-todo
      name: '@dennisrongo/dsh-todo'
```

and restart the profile. The single row mounts both halves: the host service
and the browser tab.

> The profile installs `file:` dependencies as a **copy**, not a symlink, so
> after `pnpm run build` you must re-run `pnpm install` in the profile to pick
> up the new artifacts.

## Archiving

Completed work is **archived, not deleted**. An item carries an optional
`archivedAt` epoch-ms stamp; its *presence* is the archived state, so there is
one source of truth and no way to store an archived item without a date.

| Action | Where | Effect |
| --- | --- | --- |
| Archive completed | footer, any active view | Stamps every done item. Recoverable. |
| Archive (⌸) | row hover, completed items | Stamps one item. Recoverable. |
| Restore (↩) | row hover, Archive view | Clears the stamp, returning it to the list. |
| Delete (✕) | row hover | Removes one item outright, after a confirmation dialog naming the task. |
| Delete archived | footer, Archive view | Permanently drops every archived item — the only destructive bulk action, and the only one that asks for confirmation. |

Archived items are excluded from the progress bar and the done/total score, so
tidying up never makes progress appear to regress. They sort newest-archived
first, so the Archive view reads as a log. Reordering is computed in
active-list space, so a hidden archived entry between two visible rows cannot
swallow a move.

`clearCompleted` (hard delete of done items) is still exported for callers that
want it, but it is no longer wired to a button.

## CLI — for you and for AI agents

The same list is reachable from a terminal, so an agent can shell out and manage your tasks
(and so can you). It targets a workspace **directory** and needs no profile, no session and
no running server — it works offline and in CI.

### Getting the command

The plugin ships a `dsh-todo` binary. If the package is already installed into a dsh
profile, that profile's `node_modules/.bin` has it; otherwise reach it directly:

```bash
npx @dennisrongo/dsh-todo list          # no install
pnpm add -g @dennisrongo/dsh-todo       # then just: dsh-todo list
node /path/to/plugins/dsh-todo/lib/bin.js list   # from a checkout
```

Requires **Node 22+** — storage is `node:sqlite`, which is built in (and still prints an
experimental-feature warning on stderr; it is harmless, and `2>/dev/null` silences it).

### Everyday use

```bash
cd ~/projects/my-app          # the workspace IS the current directory

dsh-todo add "Fix token refresh" --priority p0 --release v1.2.0 --due 2026-03-14
dsh-todo add "Write migration guide" --sprint "Sprint 24"
dsh-todo list
```

```text
[ ] tmtcfbutukp4j todo        p0 Fix token refresh  (release=v1.2.0 due=2026-03-14)
[ ] tmtcfbuxr5y9x todo        p2 Write migration guide  (sprint=Sprint 24)
[ ] tmtcfbv071e6w in-progress p2 Ship it
```

One task per line: checkbox, id, status, priority, title, then any labels in parentheses.
That is the whole display contract — it stays greppable and diffable.

Move work along, then file it away:

```bash
dsh-todo update tmtcfbut --status in-progress --sprint "Sprint 24"
dsh-todo show tmtcfbut                  # everything about one task
dsh-todo done tmtcfbut
dsh-todo archive                        # archive EVERY completed task
```

Work on a project you are not `cd`'d into with `--workspace`:

```bash
dsh-todo --workspace ~/projects/other list --open
```

### Commands

| Command | Does |
| --- | --- |
| `list` | Show tasks — active only unless `--archived` |
| `add <title>` | Create a task; every field flag is accepted |
| `update <id>` | Change one or more fields; needs at least one |
| `done` / `reopen` | Flip completion, stamping or clearing `completedAt` to match |
| `rm <id>` | Delete outright — no confirmation, no archive |
| `archive [<id>]` | Archive one task, or every completed one when no id is given |
| `show <id>` | Print one task in full, including description and timestamps |
| `help` | The same reference, in the terminal |

### Options

| Option | Applies to | Notes |
| --- | --- | --- |
| `--workspace <dir>` | all | Workspace directory. Defaults to cwd, and is used **as given** — no upward search for a `.dsh`, so an agent in a subdirectory targets the project it was pointed at. |
| `--json` | all | Machine-readable output, **including on errors** |
| `--status <s>` | add, update, list | `backlog` · `todo` · `in-progress` · `blocked` · `done` |
| `--priority <p>` | add, update, list | `p0`–`p3` (default `p2`) |
| `--release <label>` | add, update, list | e.g. `v1.2.0` |
| `--sprint <label>` | add, update, list | e.g. `"Sprint 24"` |
| `--due <YYYY-MM-DD>` | add, update | A calendar day; impossible dates are refused |
| `--description <text>` | add, update | Body text — acceptance criteria, repro steps |
| `--title <text>` | update | Rename |
| `--open` | list | Everything unfinished, whatever stage |
| `--archived` | list | Show archived tasks *instead of* active ones |

Filters combine, so `list --open --priority p0 --release v1.2.0` is an AND across all three.
`--key value` and `--key=value` are both accepted.

### Driving it from a script or an agent

**`--json` is the one to use from a script.** It prints structured output on the error path
too, so a caller never has to parse a human sentence to find out what went wrong:

```bash
dsh-todo list --open --json
```

```json
{
  "count": 3,
  "items": [
    {
      "id": "tmtcfbutukp4j",
      "title": "Fix token refresh",
      "status": "todo",
      "priority": "p0",
      "release": "v1.2.0",
      "dueDate": "2026-03-14",
      "createdAt": 1787889639378
    }
  ]
}
```

`list` returns `{ count, items }`; `add` / `update` / `done` / `reopen` / `rm` return
`{ item, revision }`; `archive` returns `{ archived, revision }`; `show` returns the task
itself. A failure returns `{ error, code }` and exits with that code:

```bash
$ dsh-todo update nope --status done --json; echo "exit=$?"
{
  "error": "no task matching \"nope\"",
  "code": 3
}
exit=3
```

Exit codes are distinct so a script can branch on **why** a command failed:

| Code | Means |
| --- | --- |
| `0` | Success |
| `2` | Usage — unknown command, bad flag, malformed value |
| `3` | Not found — a well-formed request that matched no task |

Piping into `jq` covers most agent work:

```bash
# ids of everything blocked
dsh-todo list --status blocked --json | jq -r '.items[].id'

# fail CI if any P0 is still open
test "$(dsh-todo list --open --priority p0 --json | jq '.count')" -eq 0
```

Ids accept any **unambiguous prefix** — `dsh-todo done tmtcfbut`. Ids are time-ordered so
short prefixes collide; an ambiguous one is an **error listing the candidates** rather than a
guess at which task you meant.

An **empty value clears a field**: `--release ""` removes the release. From a shell there is
no other way to say "unset this" as opposed to "leave it alone".

> **PowerShell drops empty arguments.** `--release ""` arrives at Node as a bare `--release`
> flag, so the field is left untouched instead of cleared. Use the `--release=` form there,
> which survives intact on every shell.

Invalid values are **refused, never dropped** — `--due 2026-02-31` exits `2` instead of
quietly storing nothing, because an agent would otherwise never learn its date was ignored.

### Is it safe alongside the running app?

Yes, and it is tested. SQLite is a multi-process database: the file lock refuses a writer that
lands inside another process's transaction rather than letting it interleave, and the CLI sets
a `busy_timeout` so it waits for the harness to commit instead of failing. Verified live — the
CLI wrote while a running server held its handle, and the API returned the new task with no
restart.

The one visible effect is that an **already-open browser tab** may need a refresh: every write
bumps a revision token, so the tab's next write is refused and it adopts the authoritative
list. That is the designed reconciliation, not lost data.

## The task model

```ts
{ id, title, description?, status, priority, release?, sprint?, dueDate?,
  createdAt, completedAt?, archivedAt? }
```

| Field | Notes |
| --- | --- |
| `title` | Short and scannable — the one line a collapsed row shows. Capped at 500. |
| `description` | The body: acceptance criteria, repro steps, links. Its own 5000 cap, because reusing the title's 500 would silently truncate real notes. |
| `status` | `backlog \| todo \| in-progress \| blocked \| done`. **The source of truth** — there is no separate `done` flag to fall out of sync. |
| `priority` | `p0`–`p3`, default `p2` so an unranked task sits mid-pile rather than jumping the queue. |
| `release` | What ships together, e.g. `v1.2.0`. |
| `sprint` | When it is worked, e.g. `Sprint 24`. |
| `dueDate` | `YYYY-MM-DD`. A calendar day, not an instant — an epoch would bind it to a timezone and let one task read as two different days. Impossible dates like `2025-02-31` are rejected rather than rolled forward. |

**Release and sprint are separate on purpose.** A task can be worked in Sprint 24
and ship in v1.3.0; collapsing them into one field loses the ability to answer
either question. Both are free text rather than entities — grouping and
filtering work with no releases table, no CRUD, and no migration to rename one.

`completedAt` is written only by the status transition, so it can never claim a
task is finished that isn't. Absent optional fields are absent *keys*, never
`''`, so "no release" has exactly one representation.

## Storage

| Location | Contents |
| --- | --- |
| `<workspace>/.dsh/todo.db` | SQLite: one `todo` row per task, plus a `meta` table holding `revision` and `updatedAt`. |

Archived items live in the same table — archiving never moves data between
collections, so nothing can be lost in a partial write.

### Upgrading from the checklist version

Existing databases are migrated **in place** on first open: the new columns are
added with `ALTER TABLE`, `title` is backfilled from the old `text`, and
`done = 1` becomes `status = 'done'`. Nothing is dropped, and a list written by
the old version keeps its order, its completion stamps and its archive.

The old `text`/`done` columns are still written alongside their replacements, so
downgrading to the previous version still reads a sane list.

### Migration from the old browser-only version

Earlier versions stored todos in `localStorage` under `dsh-todo:items`. On first
run, that list is imported **once** into the first workspace that opens with an
empty stored list, and the import is then marked with `dsh-todo:migrated`. The
original key is deliberately left in place rather than deleted.

## Notes

- The host half publishes a service, so it belongs to the profile's host
  composition — not to an agent preset.
