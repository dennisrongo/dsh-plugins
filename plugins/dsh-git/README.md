# @dennisrongo/dsh-git

[![npm](https://img.shields.io/npm/v/@dennisrongo/dsh-git)](https://www.npmjs.com/package/@dennisrongo/dsh-git)

**npm:** [`@dennisrongo/dsh-git`](https://www.npmjs.com/package/@dennisrongo/dsh-git) ·
**source:** [dennisrongo/dsh-plugins](https://github.com/dennisrongo/dsh-plugins/tree/main/plugins/dsh-git)

A per-workspace **source-control tab** for the DeepSeek Harness web UI. It adds
a **Source Control** tab beside Chat, Trajectory, and Todo that shows everything
that differs in the workspace's repository, and lets you stage, commit (with an
AI-written message), initialize, sync, branch, merge, stash, manage worktrees,
and browse history — without leaving the session. The tab holds three panes,
**Changes**, **History** and **Repo**, switched by a segmented control below the
branch header.

## What it does

- **View changes** — staged, unstaged, untracked, and conflicted files, each
  with a status letter and a click-to-open unified diff.
- **Browse history** — the recent commits, newest first. Click one to see the
  files it touched, then click a file for the patch that commit introduced, in
  the same diff pane the Changes pane uses.
- **Stage / unstage / discard** — per file or per section. Discard is the one
  destructive action and always confirms first.
- **AI commit messages** — "✦ AI message" sends the diff to the model you
  already selected for new sessions and writes a Conventional Commits message.
  It describes **the staged changes** whenever anything is staged, and every
  uncommitted change (including brand-new files) when the index is empty. The
  log strip says which it used.
- **Commit** — commits the index, and only the index. The button is live only
  with something staged and a message written; when it is not, the row says
  why. `Ctrl`/`Cmd`+`Enter` commits from the box.
- **Initialize** — a directory that is not a repository shows an
  Initialize button with an editable initial branch name.
- **Sync** — Fetch, Pull (fast-forward only), Push / Publish, and a combined
  pull-then-push, with ahead/behind counts on the buttons.
- **Branches** — the branch name in the header is a menu: switch, create,
  merge another branch in, delete, or rename. Nothing is ever auto-stashed; a
  switch git refuses offers an explicit "Stash changes and switch" instead.
- **Merge** — allowed to conflict. The repository is left mid-merge with a
  banner offering Abort and Continue, and the conflicts appear in the Changes
  list you already use, where staging a file marks it resolved.
- **Stash** — push, pop, apply and drop from the Repo pane, and click a stash to
  see the files it holds and their patches, the same way you read a commit.
- **Worktrees** — add, remove and prune, each row with an **Open** button that
  registers the directory as a workspace and switches to it.
- **Live updates** — the list follows the repository on its own. An edit from
  an agent, your editor, or a terminal `git checkout` shows up within about a
  second, with no refresh click.

## The Repo pane: stashes and worktrees

A third pane lists your stashes and your worktrees. Both lists are fetched
**lazily** — when you open the branch menu or enter the pane — and never polled,
so the tab's idle cost is unchanged.

A stash **is a commit**, so clicking one expands into the files it holds and each
file opens its patch, exactly like a commit in History. It is specifically a
*merge* commit: parent 1 is the base, parent 2 the index, and parent 3 — present
only when the stash was taken with `-u` — is a commit whose entire tree is the
untracked files. That third parent is why viewing a stash needs its own
endpoints rather than reusing the commit reader, which walks `--first-parent`
and would hide every new file.

**Worktrees go beside the project, named `<project>-<branch>`.** Type a branch
and the path fills itself in: `feature/login` in `myproj` suggests
`../myproj-feature-login`, which puts the worktree next to the project on disk
*and* next to it in dsh's workspace list, since workspaces are listed by title.
Slashes are flattened, because `../myproj-feature/login` would quietly create a
`myproj-feature` directory with the worktree buried inside it. The suggestion is
editable and stops auto-filling the moment you type a path of your own.

Open the form with nothing in mind and it is already usable: the path is
prefilled with a readable `adjective-noun` name (`../myproj-brave-otter`), so
"just give me a worktree" needs no typing at all. An empty branch box creates a
new branch from that generated name — a worktree cannot check out a branch that
is already checked out somewhere else, so reusing the current one is not an
option git would allow.

**The model names the branch, not the path.** Type a rough description — "fix
login retry" — press ✦, and it becomes `fix/login-retry`, with the path
following as `../myproj-fix-login-retry`. Naming is a judgement call worth a
model; deriving a path from a branch is arithmetic with one right answer, so a
regex does that. It fails soft: no provider configured, or any error, leaves
your text untouched with the reason in the log strip.

**Paths resolve like a terminal opened at the repository root.** `../worktree-test`
lands exactly where `git worktree add ../worktree-test` would put it, and the
form shows the resolved absolute path live as you type. A path landing *inside*
the repository is refused — a checkout does not belong in the project, and
whether it would even be clean depends on that project's `.gitignore`.

A **from** select lets a worktree fork from a branch other than the one you are
on, defaulting to the current one. Rows for the **main** worktree and the one you
are currently in carry no Remove button: git refuses both, and on Windows it
refuses the second with a file-lock `Permission denied` that reads like a bug in
the tab. Removing a worktree dsh has registered as a workspace offers to remove
that workspace too — registration was otherwise one-way, leaving a workspace
pointing at a deleted directory.

## Dialogs

Both forms — New worktree and New branch — are **modals** on one shared
component, as is the confirmation every destructive action goes through. A modal
portals to `document.body`, traps Tab, closes on Escape or a backdrop click,
focuses the first field on open, and hands focus back to the opener on close.
**Dismissing never validates**: backdrop, Escape and ✕ all just close, and only
the action button commits — a dialog you cannot leave while a field is half-typed
is a trap, and this one holds a path.

Two details are load-bearing and both shipped as bugs first. The backdrop sits
*below* DSH Desktop's window-drag strip with padding to clear it, because that
strip resolves drag regions before hit-testing and swallows clicks no z-index can
outrank. And the plugin's palette is redeclared **on the backdrop**: every
`--g-*` is declared on `.dshgit`, and a portalled dialog renders outside it, so
without that the primary button — `background: var(--g-accent)` with hard-coded
dark text — painted as a blank rectangle on a dark panel.

## Staying live without polling git

Re-reading `status` on a timer would be the obvious way to keep the list fresh
and the wrong one: a status read spawns four git processes, so a one-second
poll would cost that *per second, per open tab*. Measured on a real repository,
`status` averages **141 ms** per call.

Instead the host watches the repository with `fs.watch` and keeps a monotonic
**change token**. The tab polls `changeToken`, which answers from that counter
and never runs git — **52 ms** per call, essentially all HTTP round-trip — and
only re-reads the full status when the token actually moves. Idle repositories
cost nothing beyond the probe, because a watcher that fires no events never
advances the token.

Three details make it behave:

- **Two watches, not one.** The worktree watch is recursive and catches file
  edits; a second watch on `.git` is what catches staging, commits, and branch
  switches, because git's metadata writes never surface as worktree events.
  Without it the tab looks live until you commit, and then silently stops.
- **Events are debounced (120 ms).** One logical action fires many events — git
  writes `index.lock`, then the index, then `ORIG_HEAD`; an editor save writes a
  temp file and renames it. A burst of 40 writes collapses to a couple of
  refreshes rather than 40.
- **Hidden tabs don't poll.** The loop is gated on `visibilitychange`, and a
  `focus` handler re-checks immediately, so the list is already correct the
  moment you look at it and costs nothing while you're in Chat.

Watchers are reference-counted per repository root, so ten tabs on one
workspace share a single OS handle, and released through `ctx.effect()` when
the fiber unloads.

## The layout

The diff sits **beside** the file list when the tab is wide and **below** it when
it is narrow. The switch is a **container query** (`@container dshgit (min-width:
720px)`), not a media query: this is a tab inside a shell whose sidebar and
panels resize independently of the viewport, so the width that matters is the
tab's own. `container-type` is declared on `.dshgit` — the root — because a
container query cannot style its *own* container.

**Opening a diff never moves a row.** The list's column width is reserved even
with no diff open, so the first click can't cut it from full width to a column
and reflow every filename under the pointer. Stacked, the diff takes the lower
55% *in normal flow* rather than floating over the list — shrinking a scrollport
does not move the content inside it (`scrollTop` stays put and the maximum
`scrollTop` rises), whereas an overlay hid the very row you had just clicked
whenever the list was scrolled near its end.

While a patch is in flight the pane shows a **skeleton shaped like a diff** —
shimmering meta / hunk / add / del bands at varied widths, sized off the real
18px diff line — instead of a spinner, which blanks a large surface. The shimmer
animates `background-position` over an oversized gradient, never a transform or
a box dimension, so it cannot shift layout, and `prefers-reduced-motion`
flattens the bars to a static tone. Loading is a separate flag rather than a
sentinel string, so a diff whose text genuinely reads "Loading diff…" can't
render as a skeleton. Clicking down a list starts overlapping requests, so each
carries a monotonic sequence number and any reply that isn't the newest is
discarded — otherwise a slow one settling late paints the wrong file's patch
under the right filename.

Icons are inline 16px SVGs on a matching `0 0 16 16` viewBox, in 20px buttons.
The size is fixed and not a prop: the shell pairs each icon size with its own
viewBox, so 16-unit path data rendered into a 14px box comes out shrunk with
thinned strokes. The 20px button box (not 24px) and `.dshgit-row`'s pinned
`line-height: 20px` are what keep file rows at 32px — in a flex row the tallest
child sets the height.

## History without a second fetch

The commit list costs nothing extra: `status` already returns the 15 most recent
commits, so the History pane renders what the tab has been fetching all along.
Only expanding a commit talks to the host, and only for that one commit — a
commit touching hundreds of files ships its file *names* (`--name-status`), not
its entire patch, and the patch arrives only for the file you actually click.

A commit sha arrives from the browser, so it is validated as plain hex before it
reaches git. The risk isn't a shell — git is always invoked with an argument
array — it's git's own argument grammar: a value starting with `-` is read as a
flag, and revision syntax like `HEAD~3`, `main..dev` or `:/secret` would address
commits the UI never offered. Merge commits are read with `--first-parent`,
without which `git show` prints no file list at all and a merge would expand into
a convincing but false "No files in this commit."

## Architecture

The plugin ships **two halves** that never share a process:

| File | Half | Role |
| --- | --- | --- |
| `src/index.ts` | host | The `dshGit` service. Resolves a workspace id to its directory via `workspaceRegistry`, runs git, and calls `llm` for messages. |
| `src/git.ts` | host | The git engine: `execFile` wrapper and porcelain parsers. |
| `src/watch.ts` | host | Filesystem watchers behind the change token, so the tab stays live without polling git. |
| `src/remote.ts` | both | Strict zod Typert descriptors — the wire contract. |
| `src/client.tsx` | browser | The Source Control tab (Changes + History + Repo), registered into the `conversation.view` slot at `order: 30`. |
| `src/types.ts` | both | Shared, dependency-free vocabulary. |

The browser never touches a repository: it calls `ctx.remote.dshGit.*` over the
Typert bridge, and the host does the work.

### Things that are load-bearing

Several details are easy to "clean up" and thereby break:

- **The host half must not be minified**, and must target `es2021`. The Typert
  gateway discovers a `@Remote` method's wire fields by reading its *parameter
  names* from `Function.prototype.toString()`; minification renames `request`
  and silently breaks the contract. `@Remote` is also a TC39 *standard*
  decorator, which Node cannot yet parse — esbuild only downlevels it when the
  target predates decorators.
- **Every remote codec must be `strict`.** The client's `$mount` rejects
  `src-json` codecs, and a rejected mount means the tab silently never appears.
- **`provider` and `model` are required** on `ctx.llm.stream()`. Omitting them
  yields an empty stream that looks like "the model produced no message".
- **Git status is parsed from `-z` output.** The default format quotes and
  escapes paths containing spaces or non-ASCII bytes; `-z` emits them raw.
- **The `.git` watch is not optional.** Dropping it leaves a watcher that
  reports file edits but never notices a stage, commit, or branch switch — and
  every other test still passes. `pnpm run test:watch` is the guard.
- **Watchers are released through `ctx.effect()`.** cordis's `Service` has no
  stop symbol (only `Service.init`) and `dispose` is not in its `Events` map,
  so the two obvious spellings leak an OS handle per repository on each reload.
- **Git is invoked with an argument array, never a shell.** Paths, branch names,
  and commit messages are untrusted text. Branch names and shas are additionally
  validated, because git's *own* argument grammar is the risk: a leading `-` is
  read as a flag, `..` forms a revision range, and `~`/`^`/`:`/`@{` all address
  commits the UI never offered.
- **A stash index is a cursor, not an identifier.** Dropping or popping an
  earlier entry renumbers everything after it, so the client re-reads `refs`
  after every mutation.
- **`refs` returns a discriminated outcome, never bare arrays.** Collapsing a
  failed read into empty lists renders "this repository has no branches" when the
  truth is "restart the profile" — measured against a stale host half, where
  `status` answered 200 while `refs` 404'd.
- **Worktree paths are the one place this plugin writes outside the workspace**,
  so they get `resolveWorktreePath` rather than `assertSafePath`, which refuses
  absolute paths and `..` — correct for repo files, wrong for a worktree by
  definition. The path arithmetic lives in `types.ts` because the host needs it
  to build the command and the browser needs it to show where the input lands.

## Endpoints

`POST /api/dshGit/<method>`, each taking a single parameter named `request`:

| Method | Does |
| --- | --- |
| `status` | One workspace's repository snapshot — branch, upstream, files, recent commits, plus `merging`, `mergeHead` and `stashCount` |
| `diff` | A unified patch for the workspace or one path |
| `commitFiles` | The paths one commit touched |
| `commitDiff` | The patch one commit introduced |
| `stage` | Stage, unstage or discard paths |
| `commit` | Commit the staged tree |
| `init` | Initialize a repository in the workspace |
| `sync` | Pull, push, fetch, sync or publish |
| `suggestMessage` | Draft a commit message from the diff via the LLM |
| `refs` | Branches, stashes and worktrees in **one** read, fetched lazily |
| `branch` | Create, switch, delete or rename a branch |
| `merge` | Merge a branch, or abort/continue one in progress |
| `stash` | Push, pop, apply, drop or clear stash entries |
| `worktree` | Add, remove or prune a worktree |
| `suggestBranch` | Draft a branch name from a short description via the LLM |
| `stashFiles` | Every path a stash holds, untracked additions flagged |
| `stashDiff` | The patch a stash holds, optionally narrowed to one path |
| `changeToken` | The **polled** endpoint. Answers from an `fs.watch` counter and never spawns git; `0` means "not a repository" |

**Requires** `workspaceRegistry` and `llm` (both composed by `dsh-base`), and
`agentDefaultModel` for the two drafting endpoints.

## Install

```bash
dsh plugin --profile web add @dennisrongo/dsh-git
```

That is the whole install. The package declares `dsh.bundle`, so it **mounts itself** —
do **not** also add an `insert:` row to the profile's `cordis.patch.yml`. A second row
with the same id is fatal (`duplicate loader entry id: dsh-git`). Restart the profile
and the Changes tab is there.

Works the same on the `dsh` CLI and on [DSH Desktop](https://dshdesktop.com/), which
keeps its own `DSH_HOME`; pass that profile's name instead.

To track `main` or pick up an unreleased change, install from git — quote it, since `#`
and `&` are shell metacharacters:

```bash
dsh plugin --profile web add "github:dennisrongo/dsh-plugins#path:/plugins/dsh-git"
```

The built `lib/` is committed, so a git install works even though it runs no build step.

## Update

`dsh plugin` forwards to pnpm, so the usual verbs work:

```bash
dsh plugin --profile web outdated                        # what is behind
dsh plugin --profile web update @dennisrongo/dsh-git     # within the caret range
dsh plugin --profile web add @dennisrongo/dsh-git@latest # cross a major
```

**Restart the profile after updating.** The client half would reload on a browser
refresh, but the host half will not: the Typert loader caches its per-package verdict
for the life of the process, so a version that adds an endpoint (as `changeToken` did)
returns 404 on it until the profile restarts.

## Develop

```bash
pnpm install
pnpm build        # emits lib/index.js + lib/client.js
pnpm typecheck
pnpm test         # parsers, contract, and real-git operations
```

`pnpm test` runs git against throwaway repositories across three layers: the
parsers (`test:branch`), the **host service** driven directly against real
repositories (`test:worktree`, `test:ops`, `test:core`, `test:read`), and the
wire contract pushed through the real zod codecs (`test:wire`). That middle
layer exists because two bugs lived in the gap between the parsers below the
endpoint and the client store above it — branch switching never worked at all,
and every command reported `ok: true` even when git failed.

The codecs matter more than they look: zod objects **strip** unknown keys rather
than rejecting them, so a field the schema does not declare silently never
arrives, in either direction. Every wire check asserts a lossless round trip
rather than that parsing merely succeeded.

Seven probes drive headless Chrome against the **built** `lib/client.js` and
need no running harness:

```bash
pnpm test:layout     # the diff sits beside the list at 1200px, below it at 560px
pnpm test:stability  # opening a diff moves no row, and never covers the list
pnpm test:skeleton   # the loading placeholder matches the real diff line's rhythm
pnpm test:icons      # icon geometry and the 32px row budget
pnpm test:history    # expanding a commit moves no row, and holds the row budget
pnpm test:menu       # the branch menu stacks above the panes and stays on-screen
pnpm test:modal      # the dialog clears the drag strip and is actually clickable
```

Three further checks drive a real headless Chrome against a running server:

```bash
pnpm test:ui      # the tab registers, mounts, and renders
pnpm test:ai      # the AI button produces a Conventional Commits message
pnpm test:commit  # staging + committing changes real bytes on disk
```

A probe passing proves less than it appears to. `test:menu`'s first version had
no positioned elements to compete with, so deleting the menu's `z-index` still
passed; `test:modal` measured only the panel, so it stayed green while every
control inside it rendered unstyled. Both now assert against the real competitor
and a real control.

`test:layout` and `test:stability` both slice the CSS out of the built bundle,
which is also why **a backtick must never appear in the stylesheet's comments**:
it is a template literal, so a stray one closes it early and silently truncates
every rule after it.
