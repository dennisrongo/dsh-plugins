# dsh-git advanced operations — design

**Date:** 2026-08-28
**Package:** `@dennisrongo/dsh-git` (0.3.1 → 0.4.0)
**Status:** approved for implementation

## Goal

Add branch management, stash, worktree management and merge to the Source
Control tab, on both surfaces (dsh CLI and DSH Desktop), without regressing the
two properties the existing design spends the most effort protecting: a cheap
polling path, and a UI that never disagrees with the repository.

## Decisions taken

Four judgment calls were settled with the user before design:

1. **Information architecture** — branch operations hang off the branch name in
   the header; stash and worktrees get a third segment, "Repo", beside Changes
   and History.
2. **Merge conflicts** — a conflicting merge LEAVES the repository mid-merge and
   is resolved in the Changes pane, which already renders a Conflicts section
   and already blocks Commit while conflicts exist. This reverses the stance
   `sync` takes (`pull --ff-only`, chosen because the tab had no
   conflict-resolution surface); the surface now exists.
3. **Worktrees** — list / add / remove / prune, with optional registration of a
   new worktree as a dsh workspace through `ctx.workspaceRegistry.create()`.
4. **Dirty-tree switching** — git is allowed to refuse. The tab then offers an
   explicit "Stash changes and switch" button. Nothing is stashed implicitly.

## Wire contract

Five new endpoints, shaped as **noun + action discriminant**. This is not a new
pattern: `stage({action})` and `sync({action})` already do exactly this, and
the alternative (one endpoint per verb, ~13 descriptors) multiplies the
three-place drift risk between `remote.ts`, `typert.host.ts` and
`smoke.mjs`'s count assertion — the documented failure mode in this package.

| Endpoint | Request | Result |
|---|---|---|
| `refs` | `{workspaceId}` | `{ok: true, branches, stashes, worktrees}` \| `{ok: false, error}` |
| `branch` | `{workspaceId, action, name?, startPoint?, force?}` | `CommandResult` |
| `merge` | `{workspaceId, action, from?, noFF?}` | `CommandResult` |
| `stash` | `{workspaceId, action, index?, message?, includeUntracked?}` | `CommandResult` |
| `worktree` | `{workspaceId, action, path?, branch?, newBranch?, force?, register?}` | `CommandResult` |

Actions: `branch` — create, switch, createSwitch, delete, rename, stashSwitch.
`merge` — merge, abort, continue. `stash` — push, pop, apply, drop, clear.
`worktree` — add, remove, prune.

### Why `refs` is one endpoint, not three

The Repo pane needs stashes and worktrees together; the branch menu needs
branches. One round trip serves both, and the three git calls run under
`Promise.all`. It is fetched lazily — on menu open or Repo-pane entry — so it
never lands on the polling path.

### Why `refs` returns a discriminated outcome

`commitFiles` already paid for this lesson. A new client bundle against a host
that has not restarted 404s every new endpoint, and collapsing that into empty
arrays renders as "this repository has no branches" rather than "restart the
profile". The failure must stay self-diagnosing.

## Status additions, at zero extra git processes

`GitStatus` (the `repo: true` arm) gains `merging: boolean`,
`mergeHead?: string` and `stashCount: number`.

`status` runs on every token move, so its cost is load-bearing. None of the
three additions spawns a process:

- `repoRoot()` today runs `rev-parse --show-toplevel`. It becomes
  `rev-parse --show-toplevel --git-dir --git-common-dir`, which prints all
  three on separate lines for the same single-process cost. A new
  `repoPaths()` returns the triple; `repoRoot()` becomes a thin wrapper so
  `changeToken` is unaffected.
- `merging` is an `fs` existence check on `MERGE_HEAD`; `mergeHead` is the
  first line of `MERGE_MSG`.
- `stashCount` is a line count of `logs/refs/stash`. Git's stash IS a reflog
  on `refs/stash`, so this is exact rather than an estimate.

The `--git-common-dir` value matters because `.git` is a FILE containing a
`gitdir:` pointer inside a linked worktree, and `refs/stash` lives in the
common directory. Deriving these by hand would be the trap; asking rev-parse is
not.

**rev-parse returns those two paths RELATIVE to the cwd** — verified on git
2.50.0: run at a repository root, `--git-dir` prints `.git`, not an absolute
path. Both must be resolved against the root before any `fs` call, or the
merge and stash probes silently read nothing and report `merging: false` on a
repository that is mid-merge. Failing open like that is worse than erroring.

## Watcher

`refs` and `MERGE_HEAD` are already in `GIT_SIGNIFICANT`, so stash and merge
state changes advance the token for free. `worktrees` is NOT, so worktree
add/remove would leave the Repo pane stale. It is added to the allowlist — a
genuinely low-rate entry — and pinned directly in `watch-probe.mjs` alongside
the existing `isSignificantGitEntry` assertions, because the behavioural form
of that test is timing-sensitive and has already rotted once here.

## Security

Branch names, stash indices and worktree paths all arrive from the browser and
are handed to git's argv. `runGit` uses an argument array, so the risk is not a
shell — it is git's own argument grammar, the same risk `assertSafeSha` exists
for.

- **`assertSafeRef()`** — new sibling of `assertSafeSha()`. Rejects a leading
  `-` (read as a flag), `..`, `~`, `^`, `:`, `?`, `*`, `[`, backslash,
  whitespace, control characters, `@{`, and a trailing `.lock`. Permits
  `feature/x` and `origin/feature/x`. Mirrored in `remote.ts` so the browser's
  strict codec refuses a bad ref before it costs a round trip; the host check
  remains the real boundary.
- **`assertSafeStashIndex()`** — a non-negative integer only, rendered as
  `stash@{n}`.
- **Worktree paths are a real widening of scope.** `assertSafePath` rejects
  absolute paths and `..` segments, which is correct for repo-relative files and
  wrong for a worktree, which lives outside the repository by definition. A
  separate validator resolves a relative path against the repository root's
  PARENT, rejects a leading `-` and null bytes, and relies on git itself to
  refuse a non-empty target. This is the one genuine security delta in the
  change and is called out here deliberately rather than buried.

Every command keeps its `--` separator.

## Client

- **Header** — the branch name becomes a real `<button aria-haspopup="menu">`
  opening `.dshgit-branchmenu`: a filter input, local branches with the current
  one marked, "Create branch…", a divider, and "Merge <branch> into <current>".
  Modelled on `dsh-mission-control`'s `.dshmc-rowmenu` — fixed positioning off
  `getBoundingClientRect`, Escape to close, click-outside, arrow-key movement.
- **Repo segment** — collapsible Stashes and Worktrees sections reusing
  `.dshgit-section`, `.dshgit-sechead` and `.dshgit-row`, so the 32px row
  budget and the fixed-16px `Icon` geometry the icon probe pins hold unchanged.
- **Merge banner** — shown while `status.merging`: "Merging <ref> — resolve
  conflicts, then commit", with Abort and Continue, in `--g-warn`. The commit
  box prefills from `MERGE_MSG` when it is empty.
- **Stash-and-switch** — a switch whose `CommandResult` is `ok: false` with
  output matching git's "would be overwritten" sets a pending-switch state and
  reveals one explicit button. The two-step is the feature, not an omission.
- **Destructive actions** — branch delete, stash drop and worktree remove reuse
  the existing `confirmDiscard` guard shape, which refuses rather than proceeds
  when `window.confirm` is unavailable.

## Both surfaces

**No browser-persisted preference is introduced.** Segment choice and section
expansion are React state. That is what makes the two surfaces identical here:
DSH Desktop serves the UI from a new ephemeral port each launch, so an origin's
`localStorage` is empty on every start, and any preference parked there would
work on the CLI and silently fail on the Desktop. Nothing in this change needs
to survive a restart, so nothing is stored.

## Testing

- `smoke.mjs` — descriptor count 10 → 15, method list, every codec strict;
  `assertSafeRef` accept/reject table; branch, stash and worktree parsers
  against captured real output; `canCommit`/`commitBlocker` during a merge.
- `test/branch-ops.mjs` (new, wired into `pnpm test`) — against a real
  throwaway repository: create, switch, dirty-tree switch refusal, stash
  push/list/pop round trip, fast-forward merge, a REAL conflicting merge
  (asserting `merging: true`, the commit gate blocking, and abort clearing the
  state), and worktree add/list/remove/prune.
- `watch-probe.mjs` — a stash push advances the token;
  `isSignificantGitEntry('worktrees')` pinned directly.
- `test/menu-probe.mjs` (new, headless Chrome against the BUILT stylesheet) —
  the branch menu stacks above the panes and does not overflow the tab at 560px;
  Repo-pane rows hold the 32px budget.
- Root `check-type-scale.mjs` and `check-tokens.mjs` cover the new CSS: every
  `var(--dsw-*)` must name a token the harness really defines, and every
  `font-size` must sit on the 11/12/13/14/16/20/24 ladder.

Every probe must be seen FAILING against a deliberate sabotage before it is
trusted, per this package's existing practice.

## Also updated

`types.ts`, `remote.ts`, `typert.host.ts`, `watch.ts`, `AGENTS.md`,
`README.md`, the version, and a rebuilt-and-committed `lib/` — a git
subdirectory install runs no build step, and the tests assert against built
output.

## Risks

- **Worktree add writes outside the workspace.** Mitigated by the dedicated
  validator above, but the capability is new and worth stating.
- **A merge leaves durable repository state.** Someone who navigates away
  mid-merge has a repo in a merging state; `status.merging` and the banner are
  what make that visible on return rather than mysterious.
- **Host and client deploy at different speeds.** A browser refresh ships the
  new client; the new host needs a profile restart. The `refs` discriminated
  outcome is what keeps that window self-diagnosing instead of silent.
