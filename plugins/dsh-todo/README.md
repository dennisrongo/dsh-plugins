# @dennisrongo/dsh-todo

A todo list for the [DeepSeek Harness](https://github.com/deepseek-ai) (dsh) web UI.

Registers into the additive `conversation.view` slot — the conversation view
ring — so it appears as its **own tab beside Chat and Trajectory** (`order: 20`,
after chat at `0` and trajectory at `10`) and fills the session pane when
selected.

## Features

- **Persisted on disk by the host** — the list lives in a dsh storage domain at
  `~/.dsh/storages/dsh_todo.json`, not in the browser. It survives a restart, a
  cleared browser cache, and a different browser entirely.
- **Per-workspace** — each workspace has its own list, keyed by workspace id.
- **Safe against races** — every write carries the revision it observed; a
  losing write is refused and the view adopts the authoritative list, so two
  open tabs can never silently clobber each other.
- **Own tab** — full-pane view with a progress header and `done/total` score.
- **Filter ring** — All · Open · Done · Archive, with live counts.
- **Archive, not delete** — check items off, then "Archive completed" files them
  away. Archived items leave every active view but stay in the record, and can be
  restored (↩) or permanently deleted from the Archive view.
- **Full editing** — add, check off, click-to-edit, reorder (▲/▼), archive, and
  delete.
- **Themed** — colors come only from the shell's `--dsw-*` tokens, so it follows
  light/dark automatically. Respects `prefers-reduced-motion`.

## Architecture

This is a **dual-face plugin**. Both halves ship from one package.

| Half | File | Role |
| --- | --- | --- |
| Host | `src/index.ts` | `TodoService`, a `TypertRemoteService` that owns the storage domain and exports `list` / `replace` as `@Remote` methods. |
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
```

`pnpm test` asserts against `lib/`, so **build before testing**.

## Install into a dsh profile

The profile must already compose the storage rows (`storage`, `storage-json`,
`storage-domain`); `@deepseek-ai/dsh-web-app` does this by default.

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
| Delete (✕) | row hover | Removes one item outright. |
| Delete archived | footer, Archive view | Permanently drops every archived item — the only destructive bulk action, and the only one that asks for confirmation. |

Archived items are excluded from the progress bar and the done/total score, so
tidying up never makes progress appear to regress. They sort newest-archived
first, so the Archive view reads as a log. Reordering is computed in
active-list space, so a hidden archived entry between two visible rows cannot
swallow a move.

`clearCompleted` (hard delete of done items) is still exported for callers that
want it, but it is no longer wired to a button.

## Storage

| Location | Contents |
| --- | --- |
| `~/.dsh/storages/dsh_todo.json` | `tables.workspaces[<workspaceId>]` → `{ items, revision, updatedAt }` |

Each item is `{ id, text, done, createdAt, completedAt?, archivedAt? }`. Archived
items live in the same `items` array — archiving never moves data between
collections, so nothing can be lost in a partial write.

The file is plain JSON and safe to read. Editing it by hand while dsh is running
is not recommended — the host holds the authoritative copy in memory and will
overwrite the file on its next write.

### Migration from the old browser-only version

Earlier versions stored todos in `localStorage` under `dsh-todo:items`. On first
run, that list is imported **once** into the first workspace that opens with an
empty stored list, and the import is then marked with `dsh-todo:migrated`. The
original key is deliberately left in place rather than deleted.

## Notes

- The host half publishes a service, so it belongs to the profile's host
  composition — not to an agent preset.
