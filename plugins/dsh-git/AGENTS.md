# AGENTS.md — @dennisrongo/dsh-git

Source-control ("Source Control") tab for DeepSeek Harness. Two halves in one package:

- **Host** (`src/index.ts` → `lib/index.js`) — `GitService extends TypertRemoteService`, cordis service key `dshGit`. Runs git in the workspace directory resolved through `workspaceRegistry`, serialises writes per repo root, and drafts commit messages through `llm`. A directory that is not a repository reports `repo: false`, never an error. `src/watch.ts` holds the `fs.watch` layer behind `changeToken`.
- **Client** (`src/client.tsx` → `lib/client.js`) — the Source Control tab, CSS prefix `dshgit-`, calling the host over the Typert bridge as `ctx.remote.dshGit.*`. The tab holds three sub-panes — **Changes**, **History** and **Repo** (stashes and worktrees) — switched by a segmented control below the branch header. The branch name in the header is a menu button: switch, create, merge and delete.

## Endpoints

`POST /api/dshGit/<method>`, each taking one parameter named `request`:

- `status` — `{ workspaceId }` → branch, head, unborn, upstream, hasRemote, files, recent, **merging, mergeHead, stashCount**
- `diff` — `{ workspaceId, path?, staged? }` → `{ patch, binary }`; untracked files are synthesized into a `/dev/null` patch so a new file never renders a blank pane
- `commitFiles` — `{ workspaceId, sha }` → `{ files }`; the paths one commit touched, via `show --name-status -z`
- `commitDiff` — `{ workspaceId, sha, path? }` → `{ patch, binary }`; the patch one commit introduced, same shape as `diff` so one pane renders both
- `stage` — `{ workspaceId, paths, ... }`, `commit` — `{ workspaceId, message, all? }`, `init` / `sync` — `{ workspaceId, ... }`, all → `{ ok, output }`
- `suggestMessage` — AI-drafted commit message
- `refs` — `{ workspaceId }` → `{ ok: true, branches, stashes, worktrees }` | `{ ok: false, error }`; ONE read for all three lists, fetched lazily (menu open / Repo pane entry), never polled
- `branch` — `{ workspaceId, action, name?, startPoint?, force? }`; action is create | switch | createSwitch | delete | rename | stashSwitch
- `merge` — `{ workspaceId, action, from?, noFF? }`; action is merge | abort | continue
- `stash` — `{ workspaceId, action, index?, message?, includeUntracked? }`; action is push | pop | apply | drop | clear
- `worktree` — `{ workspaceId, action, path?, branch?, newBranch?, force?, register? }`; action is add | remove | prune
- `suggestBranch` — `{ workspaceId, hint }` → `{ name }`; drafts a branch name from a typed description via the LLM. Fails soft — the form stays usable with no provider configured
- `changeToken` — `{ workspaceId }` → `{ token }`; the POLLING endpoint. Answers from an `fs.watch` counter and **never spawns git** (measured 52 ms vs `status`'s 141 ms). `token: 0` means "not a repository", which is the client's signal to stop polling. A token is comparable only against an earlier token for the same workspace.

`wire: 'request'` in `src/remote.ts` must match the host parameter name — the gateway resolves endpoints by reading parameter names off the function source.

`lib/typert.host.js`, exported as the `./typert` subpath, is what publishes these to the API gateway. **Without it the package is skipped silently**: the service constructs, the tab renders, every call 404s. The loader caches its per-package verdict for the process lifetime, so registration needs a full profile restart.

## Mounting

**Self-mounting.** `package.json` declares `dsh.bundle.patch` pointing at this package's own
`cordis.patch.yml`, which carries the insert row:

```yaml
- insert:
    - id: dsh-git
      name: '@dennisrongo/dsh-git'
```

`dsh plugin add` appends the package to the profile's `dsh.profile.bundles` and that row composes
automatically. **Do not also add an `insert:` row to the profile's `cordis.patch.yml`** — a second
row with the same id is fatal: `duplicate loader entry id: dsh-git`. A bare `id:` entry there is
still the right way to *configure* the row.

**The profile must supply `workspaceRegistry`, which `dsh-base` does not.** It comes from
`@deepseek-ai/dsh-web-app`. `dsh plugin --profile <name> add` scaffolds an unknown `<name>`
with `dsh-base` only, so installing into a freshly-invented profile name boots straight into
`1 entry did not activate — @dennisrongo/dsh-git: pending (waiting for service:
workspaceRegistry)`. Verified on a clean `DSH_HOME`: profile `clean` fails, profile `web`
(which gets the real template) works. That is a profile-composition error, not a plugin bug.

Works on both surfaces: the dsh CLI (`~/.dsh/profiles/<name>`) and DSH Desktop (`%APPDATA%\dsh-desktop\harness\profiles\<name>` — the desktop keeps its own DSH_HOME). Install per profile with `pnpm add "file:<repo>/plugins/dsh-git"`, using a native forward-slash absolute Windows path; the MSYS `/c/...` form fails `LINKED_PKG_DIR_NOT_FOUND`.

## Dev loop

`pnpm install` at the monorepo root, then `pnpm run build` here (emits `lib/index.js`, `lib/client.js`, `lib/typert.host.js`, plus the gitignored `client.body.cjs` and `client.test.mjs`). The three real artifacts are **committed** so a GitHub subdirectory install works — rebuild and commit them when you change `src/`. `pnpm test` runs build + `smoke.mjs` + `host-ops.mjs` + `env-isolation.mjs` + `branch-ops.mjs` + `watch-probe.mjs`. The headless-Chrome probes (`test:icons`, `test:layout`, `test:stability`, `test:skeleton`, `test:history`, `test:menu`) are separate scripts and are NOT part of `pnpm test`.

Profiles materialise `file:` deps as copies **frozen at install time**, so a rebuild does not reach them. `scripts/dev-link.ps1` at the repo root replaces those copies with junctions: client-half edits then deploy on **browser refresh**, host-half edits need a **profile restart**.

**Re-run `scripts/dev-link.ps1` after any `pnpm install`.** It restores both the profile junctions and this package's `node_modules\@deepseek-ai\*` junctions to the CLI host copies. DSH Desktop's profile-repair install additionally empties this package's `node_modules`, taking `zod` with it, after which the harness refuses to boot with `Cannot find package 'zod' imported from ...\lib\index.js`. Fix: `pnpm install` at the monorepo root, then the script.

`pnpm run test:watch` drives the real `RepoWatcher` against a real repository in a temp
dir — no mocks, because the whole question is whether the OS actually delivers the
events. It asserts that an idle repo does NOT advance the token, that a new file, a
modification, a stage, and a commit each DO, and that a 40-write burst collapses to
fewer than 10 advances.

**The `.git` filter is an ALLOWLIST, and that is load-bearing.** Merely *reading* a
repository touches `.git/objects`, and the tab's own status read is such a read — so a
denylist ("filter out `index.lock` and friends") lets `objects` through and the feature
feeds itself: status → objects event → token bump → status, forever, on a repository
nobody is touching. That was measured here (token advanced on an idle repo with only
status reads running) before the allowlist replaced it. `isSignificantGitEntry` is
exported and pinned directly by the probe, because the behavioural version of that test
is timing-sensitive and silently stopped proving anything as the repo's state drifted.

**Worktree events are filtered by first path SEGMENT, not by prefix.** `startsWith('.git')`
also swallows `.gitignore`, `.gitattributes` and everything under `.github/` — precisely
the files a source-control tab most needs to notice, since editing `.gitignore` changes
the untracked list wholesale. `IGNORED_DIRS` additionally drops `node_modules`, `dist`,
`.next` and similar: they are gitignored in practice, and an install writing thousands of
files there costs a wakeup each and re-arms the debounce.

**The debounce has a MAXIMUM wait.** A pure trailing-edge debounce is a starvation bug:
anything emitting events faster than `DEBOUNCE_MS` re-arms it forever, so a watch-mode
build or a long checkout keeps the token still for exactly as long as work is happening —
the opposite of the goal. `MAX_DEBOUNCE_MS` caps the total deferral.

**Tokens are seeded from a process-wide counter, never restarted at 1.** `close()` clears
the map, so a reload would otherwise hand out `1` again — and a client still holding the
very common baseline of `1` reads that as "no change" and goes blind until the counter
climbs past it. The client compares with `!==`, so a reused value is not self-correcting.

**The `.git` watch is the part that rots silently.** Two watches are needed: the
recursive worktree watch sees file edits, and a second watch on `.git` sees staging,
commits, and branch switches, because git's metadata writes never surface as worktree
events. Delete the second and the tab still looks live — files appear and change — right
up until you stage something, at which point it quietly stops updating. Every other test
in this package still passes in that state. The probe was verified to fail on exactly
that sabotage before being trusted.

Two host-side traps sit behind this:

- **Release watchers through `ctx.effect(() => () => ...)`.** cordis's `Service` declares
  no stop symbol (only `Service.init`), and `dispose` is not a member of its `Events`
  map — `ctx.on('dispose', ...)` is a typecheck error, and a `[Service.stop]` method
  would simply never run. Either mistake leaks an OS watch handle per repository on
  every plugin reload.
- **`changeToken` must never spawn git.** It exists to be polled once a second per open
  tab; the moment it shells out it costs the same as `status` (141 ms vs 52 ms measured)
  and the whole design is pointless. Its only git call is the `repoRoot` probe that
  decides whether there is anything to watch at all.

On the client, the loop is gated on `visibilitychange` with a `focus` handler that
re-checks immediately, so a hidden tab costs nothing and a re-shown one is correct
before it is read. Two client-side subtleties are easy to reintroduce:

- **`refresh()` samples the token BEFORE the status read and adopts it only after that
  read succeeds** (`probeToken` returns the value rather than assigning it). They are two
  independent round-trips, so a change landing between them must leave the host's token
  ABOVE the sample — otherwise the tab baselines away a change its displayed status
  predates and freezes on stale content until some unrelated event moves the token again.
  Sampling after the read, or un-awaited alongside it, reintroduces that lost update.
- **The disposer returned by `watch()` is guarded against a double call.** React may run a
  cleanup more than once; an unguarded decrement drives the refcount negative, after which
  a later mount sees `0`, never restarts the loop, and the tab silently stops updating.
  The same double-call with two views open stops polling while one is still mounted.

`tick()` skips while a command is in flight, which is safe only because the token is
adopted together with a completed read — whatever moved is still pending at the next tick
rather than being marked as seen.

`pnpm run test:icons` asserts the icon geometry against the **built** bundle. The shell
draws icons at 12/14/16/20 and **pairs every size with a matching viewBox** — a 14px icon
is authored on `0 0 14 14`. Rendering 16-unit path data into a 14px box instead scales the
artwork down and thins its strokes, which is what made these icons read as off-size next to
the file rows. So the `Icon` component is fixed at 16 with no size prop; footprint is the
button box's job, not the glyph's. That box is **20px, not 24px**: in a file row the tallest
child sets the row height, so a 24px button silently added 4px to every row. For the same
reason `.dshgit-row` pins `line-height: 20px` — the body scale's 22px line-height would
otherwise let the filename set the row height. Rows measure 32px; the probe fails if they grow.

`pnpm run test:layout` drives headless Chrome against the **built** `lib/client.js`
stylesheet and asserts the diff pane's placement at two widths: beside the file list at
1200px, below it at 560px. It needs no running harness. The breakpoint is a **container**
query (`@container dshgit (min-width: 720px)`), not a media query, because the tab is
resized by the shell's own panels independently of the viewport. `container-type` is
declared on `.dshgit` — the root — deliberately: **a container query cannot style its own
container**, so putting it on `.dshgit-panes` silently leaves the panes stacked at every
width. That exact bug shipped once and only the layout probe caught it.

`pnpm run test:stability` drives headless Chrome against the **built** stylesheet and
asserts the two invariants that make the list clickable: **opening a diff must not move a
row**, and **the diff must never cover the list**. It measures rows before and after the
click at 1200px and 560px, each at the top of the list *and* scrolled hard to the bottom —
the bottom is where a resize has the least room to absorb, and where the first fix's
occlusion bug surfaced. Three separate bugs have broken this. The first two came from the
list's own box being sized off the open/closed state:

- Wide, the list was `flex: 1 1 auto` until a diff opened and `clamp(240px, 34%, 420px)`
  after, so the **first** click cut it from full width to a column and every filename
  reflowed and re-truncated under the pointer.
- Narrow, `max-height: 45%` cut the scrollport roughly in half, sliding rows out from
  under the cursor on any click while the list was scrolled.

The **width** fix is what matters and it stands: the column width is reserved even with no
diff open, so the first click no longer reflows every filename. The state class also moved
from `.dshgit.diffopen` (the root) to `.dshgit-panes.hasdiff`, which only styles the
**diff**. Anything that reintroduces a state-dependent width on `.dshgit-scroll` brings the
reflow back.

The third bug was the *fix* for the second. Stacked, the diff was floated over the list
(`position: absolute`, bottom 55%) to avoid resizing the scrollport at all. That held every
row still — and hid the row the user had just clicked whenever the list was scrolled near
its end, which reads as the list jumping away. **The premise was wrong**: shrinking a
scrollport does not move the content inside it. `scrollTop` stays put, and the maximum
`scrollTop` *rises* as the port shrinks, so the browser never clamps it and no row moves.
The probe confirms this at the bottom of a 40-row list: `clientHeight 629 -> 283` with
`dy 0` on every row. So the stacked diff is back **in normal flow** at `flex: 0 0 55%`,
which is both stable and visible. Do not reintroduce the overlay; `test:stability` fails it
on the occlusion check.

**Do not put a backtick in the CSS comment block.** The stylesheet is a template literal,
so a stray `\`` closes it early and silently truncates every rule after it — the container
queries vanish and the tab renders stacked at all widths. That exact mistake happened here;
the layout and stability probes both caught it because they slice the CSS out of the built
bundle the same way.

`pnpm run test:skeleton` asserts the diff pane's loading placeholder against the **built**
stylesheet. While a patch is in flight the pane shows `DiffSkeleton` — shimmering bars
shaped like a patch (meta / hunk / add / del bands at varied widths) rather than a spinner,
because the pane is a large surface and a centred spinner blanks it.

The loader is sized off the **real diff line**, not off a round number: rows are 18px on the
same `8px 0` container padding as `.dshgit-diffbody`, and each bar is 10px. The probe
measures both and fails on any drift, which is what keeps the swap from lurching. Bars are
padded `0 20px` while real lines use `padding-left: 32px` with `text-indent: -12px` — those
two land a glyph at the *same* x, so the probe compares the resulting **x position**, not the
padding strings. Changing one without the other misaligns the bars against the text they
stand in for.

The shimmer animates `background-position` over an oversized gradient, never `transform` or a
box dimension, so it cannot shift layout; `prefers-reduced-motion` flattens the bars to a
static tone and the probe covers that branch too.

Two correctness details ride along. Loading is a **separate `loading` flag**, not the old
`setPatch('Loading diff…')` sentinel, so a diff whose text genuinely contains that string
cannot render as a skeleton. And `openDiff` stamps each request with a monotonic
`requestSeq`, discarding any reply that is not the newest — clicking down a list starts
overlapping requests, and a slow one settling late would otherwise paint the wrong file's
patch under the right filename.

## History pane

The commit list is **free**: `status` already returns `recent` (15 commits), so the pane
renders what the tab has fetched all along and only the expansion talks to the host. Four
things here are load-bearing:

- **A sha is untrusted input and needs `assertSafeSha`.** The risk is not a shell —
  `runGit` uses an argument array — but git's own argument grammar: a value starting with
  `-` is read as a FLAG, and revision syntax (`HEAD`, `main..dev`, `:/secret`,
  `refs/heads/main`) addresses commits the UI never offered. Hex-only refuses all of it,
  and `remote.ts` carries the same regex so the browser's strict codec rejects a bad sha
  before it costs a round trip. Verified live: all three of `HEAD`, `--output=...` and
  `main..dev` fail boundary validation at the gateway.
- **`--first-parent` is what makes a MERGE commit list its files.** Without it `git show`
  prints no file list at all for a merge, so the row expands into a convincing but false
  "No files in this commit." `host-ops.mjs` builds a real merge and was verified to fail
  when the flag is dropped.
- **A rename emits TWO path fields, not one.** `parseCommitFiles` must consume both, or
  the destination path is misread as the next record's status token and the list gains a
  phantom entry. The probe pins the destination as the row's path and asserts the source
  does not appear separately.
- **The stale-patch effect is scoped to `mode === 'changes'`.** It closes a diff whose
  file has left the working tree — correct there, but a commit's paths are history, not
  working-tree entries, so unscoped it closes every commit diff the instant it opens.
- **`commitFiles` returns a discriminated outcome, never a bare array.** It must not
  reject (that strands the clicked row in "Reading commit…" forever), but collapsing a
  failure into `[]` is worse: "this commit changed nothing" and "we could not ask" then
  render identically as an empty expansion. That is exactly how a stale host half — one
  booted before these endpoints existed, which 404s them while the browser happily serves
  the NEW client bundle — showed up as *clicking a commit does nothing at all*. The pane
  now renders "Couldn't read this commit — <reason>" in `.dshgit-loadingrow.err`, which
  makes that specific misconfiguration self-diagnosing. `smoke.mjs` pins all four states
  (failed reply, thrown rejection, empty-but-successful, populated) against a stub remote.

**`smoke.mjs`'s `test()` helper AWAITS its body, and every call site is `await`ed.** It
was synchronous, which silently reported any async test as passing the moment it returned
a promise — a failed assertion inside one would surface only as an unhandled rejection,
after the run had already printed its success count.

A commit that leaves the 15-commit window (a rebase, a reset, or simply fifteen newer
commits) collapses its expansion, because an expansion left pointing at it would show a
file list belonging to nothing on screen. Switching panes drops any open diff: the
selection key means different things in the two modes (`staged:path` versus `sha:path`),
so carrying one across leaves the other pane showing a patch it cannot match to any row.
`requestSeq` is deliberately SHARED by both panes rather than split per pane — expanding
another commit while a patch is in flight has to invalidate that reply too, and two
counters would each believe their own reply was newest.

`pnpm run test:history` drives headless Chrome against the **built** stylesheet and pins
the invariants an expander can break: expanding a commit moves neither the CLICKED row nor
any row above it, and commit rows plus expanded file rows hold the same 32px budget the
icon probe pins for file rows. It was verified to fail on a taller line-height in the
sha/when column, which inflates rows to 42px.

`pnpm run test:commit` drives headless Chrome against a live harness, clicks the **first session row**, stages and commits, then asserts the repository on disk actually advanced. It provisions its own scratch tree at `%TEMP%\dsh-git-tree` (override with `DSH_REPO`), seeded from a template in the test itself. That path is stable rather than per-run because dsh-git acts on the workspace of the clicked session — add it as a workspace in dsh once, and make sure its session is the first row.

## Commit gate and message scope

Both halves answer the same question — *what would this commit record?* — and
they have to agree, or the tab drafts a message about work it is not about to
commit.

- **The Commit button requires STAGED content plus a message.** It used to fall
  back to `git commit -a` on an empty index, which silently widened the commit
  past the selection the user had just made in that very list. `canCommit` now
  returns false with an empty index, `GitStore.commit` no longer takes an `all`
  flag, and `commitBlocker` supplies the reason. The host still accepts `all` on
  the wire — it is an older client's contract, not dead code.
- **`commitBlocker` must mirror `canCommit` clause for clause.** A dead button
  with no stated reason is the failure mode here, and `title` alone does not fix
  it: browsers suppress tooltips on disabled controls, which is why the reason is
  also rendered as `.dshgit-hint` in the commit row. `smoke.mjs` pins the two
  functions against the same fixtures so they cannot drift apart.
- **The message scope is resolved on the HOST, from a fresh status read.**
  `collectChangeDiff` picks `staged` when anything is staged and `all` when the
  index is empty. The client deliberately omits `staged` from the request: its
  snapshot can be a poll interval behind the disk, and a message describing files
  the commit will not record is worse than a slow one. The reply carries `scope`
  back so the log strip can say which was used.
- **`git diff` alone is the wrong command for the `all` scope, twice over.** It
  drops anything already staged (so the `all` scope uses `git diff HEAD`, except
  on an unborn branch where there is no HEAD to name), and it shows untracked
  files *nothing* — they are in no tree and no index, so a brand-new file
  contributes zero bytes to the patch at any revision. `untrackedPatch` fills that
  hole with `--no-index` against `/dev/null`, the same trick the `diff` endpoint
  uses for a clicked new file. Note it exits **non-zero** whenever the sides
  differ, which is always: read stdout, never the code.
- The untracked sweep is budget-aware. Files that do not fit in
  `MAX_AI_DIFF_BYTES` are listed by name under "New files, contents not shown"
  rather than dropped, so the model never silently misses an addition.
- **This change needs a PROFILE RESTART, not just a browser refresh.** The two
  halves deploy at different speeds (see Dev loop), and the omitted `staged`
  flag inverts against a stale host: the old code read `request?.staged === true`,
  so a missing flag meant `false` and it diffed the UNSTAGED set. New client on
  old host therefore drafts a message about exactly the files the commit will
  not record. It self-corrects on restart, but it looks like the feature is
  backwards until then.

`host-ops.mjs` covers all of it against a real repository, including the unborn
branch and the partial-staging case (stage one of two files, assert the other
does NOT appear in the text).

## Branches, merge, stash and worktrees

Five endpoints, shaped as **noun + action** rather than one endpoint per verb.
That is not a new pattern — `stage({action})` and `sync({action})` already do it —
and it keeps the descriptor count low, which matters because `remote.ts`,
`typert.host.ts` and `smoke.mjs`'s count assertion must all move together. Three-place
drift is the recurring failure mode in this package.

**`status` gained three fields and did NOT gain a git process.** It runs on every
change-token move, so its cost is load-bearing:

- `repoRoot()` used to run `rev-parse --show-toplevel`; it now goes through
  `repoPaths()`, which asks for `--show-toplevel --git-dir --git-common-dir` in the
  SAME call. rev-parse prints one value per line, so three facts cost what one did.
- `merging` / `mergeHead` are an `fs` check on `MERGE_HEAD` and the first line of
  `MERGE_MSG`. `MERGE_HEAD` holds a bare sha, which tells a reader nothing.
- `stashCount` counts lines in `logs/refs/stash`. Git's stash IS the reflog of
  `refs/stash`, so this is exactly what `git stash list` prints, not an estimate.

**rev-parse returns those directories RELATIVE to the cwd.** Run at a repository root,
`--git-dir` prints `.git` (verified on git 2.50). Resolving them is not cosmetic: an
unresolved `.git` read from the host's own cwd finds nothing, and the merge probe then
reports `merging: false` on a repository that is mid-merge — failing OPEN, which hides
the Abort button exactly when it is needed. `branch-ops.mjs` pins the paths as absolute
and was verified to fail when the resolve is removed.

**gitDir and commonDir are not the same directory in a linked worktree**, and reading
from the wrong one is silently wrong rather than an error. A linked worktree's `.git` is
a FILE pointing into `<common>/worktrees/<name>`, where per-worktree state (HEAD, index,
MERGE_HEAD) lives; `refs/stash` stays in the common directory shared by every worktree.
The probe asserts they diverge and that the stash count agrees across both.

**`merging` is its own field, not inferred from conflicted files.** Once every conflict
is resolved and staged there are no conflicted files left and the merge is still
unconcluded — inferring it would drop the banner precisely when the user still has to
finish or back out. Pinned directly.

**Merge deliberately reverses `sync`'s stance.** `pull --ff-only` exists because the tab
had "no conflict-resolution surface"; that surface now exists — the Changes pane already
lists conflicts and already blocks Commit while any remain — so `merge` allows a conflict
and leaves the repository mid-merge, with a banner offering Abort and Continue.
`--no-edit` is on every path: with no TTY, an editor prompt hangs the request until the
timeout. `continue` uses `commit --no-edit` rather than `merge --continue` because it
reuses MERGE_MSG without involving an editor at all.

**Nothing is ever auto-stashed.** A refused switch is caught in `switchBranch`, matched
against git's own wording, and turned into `pendingSwitch` — which the tab renders as an
explicit "Stash changes and switch" button. An auto-stash whose later pop conflicts
strands work behind a state the user never chose to enter. The refusal itself is pinned:
if checkout ever stopped refusing, the second-click affordance would be dead UI.

**A stash index is a CURSOR, not an identifier.** Dropping or popping an earlier entry
renumbers everything after it, so the client re-reads `refs` after every mutation. The
index is validated because it is interpolated into `stash@{N}`.

**Branch classification reads the FULL refname, and the first version did not.**
`%(refname:short)` shortens `refs/remotes/origin/main` to `origin/main` — leaving no
`remotes/` prefix to test — and shortens `refs/remotes/origin/HEAD` all the way to a bare
`origin`. The original heuristic tested `startsWith('remotes/')` (never true under
`--format`) with a fallback on `upstream === undefined` (never true either, because
`split()` yields EMPTY STRINGS). Every branch therefore came back `remote: false`, and the
menu offered `origin` and `origin/main` as switch targets — checking one out detaches HEAD.

The format now emits `%(refname)` and `%(symref)` first: `remote` is
`full.startsWith('refs/remotes/')`, exact rather than heuristic, and any ref with a symref
value is skipped because it POINTS AT a branch instead of being one.

**The unit test passed the whole time, and that is the lesson.** Its fixture was written
from an assumption about git's output — `remotes/origin/HEAD` with a ` -> ` arrow, which
is the HUMAN `git branch` format, not what `--format` emits — so it tested the assumption
rather than git. It was only caught by reading real data off a running harness. The
fixture is now REAL captured output, and `branch-ops.mjs` additionally builds a repo with
a real remote and `remote set-head`, asserting that neither `origin` nor `origin/main`
appears as local. Both halves were verified to fail against the old code.

**`assertSafeRef` is the `assertSafeSha` of branch names.** Same risk, same reason: not a
shell, but git's argument grammar. A leading `-` is read as a FLAG (`--exec=...` as a
"branch name"), `..` forms a revision RANGE, `~`/`^` walk ancestry, `:` addresses the
index, `@{` opens reflog syntax. Slashes ARE allowed — `feature/x` is ordinary. Mirrored
in `remote.ts` so the browser refuses one before a round trip. Verified live against a
running harness: `--exec=calc`, `main..dev` and `a b` are all rejected at the gateway.

**Worktree paths are the one place this plugin writes OUTSIDE the workspace**, so they get
`resolveWorktreePath` rather than `assertSafePath` — which refuses absolute paths and
`..`, correct for repo files and wrong for a worktree by definition. A leading `-` is
refused; git itself refuses a non-empty target.

**Relative paths resolve against the repository ROOT, and the first version got this
wrong.** It resolved against the PARENT, which applies the `..` TWICE: with the repo at
`GitHub/dsh-plugins`, `../worktree-test` landed in `Documents/worktree-test` — two levels
up, silently. The form placeholder was `../feature-worktree`, so the suggested default
demonstrated the bug every time the form opened, and this file and the README both
asserted the parent behaviour was "what `../feature` means to a user", which is simply
false. Root-relative is the only spelling matching `git worktree add ../feature` typed
where the repository is. Pinned in `branch-ops.mjs`, verified to fail against the old
behaviour (`C:/feature` where `C:/proj/feature` was expected).

A target **inside** the working tree is refused. Git allows it, but the worktree then
appears as untracked content in the very tab being looked at; the error names the `../`
form to use instead, because a refusal that does not say what to do next is half an
answer. Containment compares case-insensitively — Windows paths differ in case
constantly, and a check that missed on a drive letter would wave through exactly the
nesting it exists to catch — while a sibling merely sharing the root's prefix
(`repo-two` beside `repo`) is correctly outside.

**The path arithmetic lives in `types.ts`, not in either half.** The host needs it to
build the git command and the browser needs it to show where the input will land; two
implementations of the same arithmetic drift. The host cannot own it (the browser has no
`node:path`) and the browser must not own it (the host is the security boundary), so
`resolveWorktreeTarget` sits in the dependency-free module and both import it. The form
renders its result live under the input, which is what stops "where does `../x` go?"
from being a question anyone answers by trying it.

**Worktrees go BESIDE the project, named `<project>-<branch>`.** `suggestWorktreePath`
auto-fills the path from the branch as the user types it, and stops the moment they type
a path themselves — auto-fill that keeps overwriting a hand-typed value is worse than
none. Three layouts were weighed: siblings (chosen), the bare-repo layout
(`project/.bare` + `project/main` + `project/feature`, tidier but impossible to retrofit
onto an ordinary clone, and a dsh workspace always points at one), and a central worktree
store (which loses the adjacency). The project prefix earns its place in dsh
specifically: workspaces are listed by TITLE, so `myproj-feature-login` sorts directly
beside `myproj` in the switcher.

**Flattening the branch into the directory name is not cosmetic.** Branch names contain
slashes, and `../myproj-feature/login` silently creates a directory called
`myproj-feature` with the worktree nested inside it — a layout nobody chose, noticed only
afterwards. `smoke.mjs` pins the flattening and also asserts the suggestion RESOLVES to a
real sibling, because a suggestion the host would then refuse is a broken suggestion.

**`.dsh/` was considered for worktrees and rejected.** It looks tidy — self-contained,
dies with the project — and git handles nesting better than expected: a nested worktree
shows as a single `?? .dsh/` entry rather than thousands of files, and `git clean -fdx`
reports `Would skip repository` rather than deleting it (both measured). But whether it
is CLEAN depends entirely on the project's `.gitignore`, and `.dsh/` is dsh's own
per-workspace state directory — `dsh-todo` keeps `todo.db` there. A project that tracks
that DB would get untracked worktree content dropped into a tracked directory. A rule
that depends on each project's ignore file is not a rule.

For the same reason `.dsh` is deliberately NOT in the watcher's `IGNORED_DIRS`: where a
project DOES track `todo.db`, ignoring it would stop the Changes tab live-updating as
tasks change.

**The worktree path is PREFILLED with a real value, not shown as a placeholder.** Opening
the form generates a readable `adjective-noun` name (`generateWorktreeName`) and fills the
path with `../<project>-<name>`, so the common case — "give me a worktree" — needs no
typing at all. Two words rather than hex because the name becomes both a directory you
will see in a file picker and a branch you will read in a list: `brave-otter` is sayable,
`wt-3f9a2c` is not. The RNG is a parameter so the generator is testable, and `smoke.mjs`
asserts every generated name passes `assertSafeRef` AND resolves to a path outside the
repo — a generator whose output the form would then refuse is worse than no prefill.
It is also pinned against a hostile RNG (`() => 1`, `NaN`) because an unclamped index
yields `undefined-undefined`, which looks like a valid ref.

**The generated name is held separately from the branch box, and that is the point.** The
branch box doubles as the hint for the AI button, so seeding it with a random word would
have the model dutifully name a branch about an otter. The box stays empty for a
description; the generated name is used as the branch only when nothing was typed. The
branch is then passed EXPLICITLY — left to itself git names a worktree's branch after the
directory basename, which would be the redundant `myproj-brave-otter` rather than
`brave-otter`.

Clearing the branch box falls back to the generated name rather than blanking the path.
Without that, emptying the field empties the path and disables the Add button, which reads
as the form breaking.

**The model names the BRANCH, never the path.** `suggestBranch` takes the rough text
already in the branch box — "fix login retry" — and returns `fix/login-retry`; the path
then derives from it deterministically. Naming is a creative problem with many good
answers; turning `feat/login` into `../myproj-feat-login` is arithmetic with exactly one
right answer, and a model there would buy nondeterminism and latency to compute what a
regex already gets right every time.

The hint is TYPED text, not the diff. `suggestMessage` describes the working tree because
a commit is about work already done, but a new worktree is usually for work that has not
started — there is often nothing in the tree to describe. The branch field doubles as the
hint input rather than adding a second box that would sit empty and unexplained the rest
of the time. Existing local branch names go into the prompt so the model does not propose
one that already exists, which would fail on create with an error the user did not cause.

**The model's answer is sanitized, not trusted.** `normalizeBranchName` takes the first
line, strips the `Branch:` labels and quotes models add despite instructions, lower-cases,
collapses separator runs, and removes the constructs git itself refuses (`..`, a trailing
`.lock`, leading or trailing separators). Slashes survive, because `feat/x` is the
conventional shape and a legal ref. The result then passes through `assertSafeRef` — the
same gate every other ref crosses — and `smoke.mjs` asserts that every normalized sample
survives it, because a name the normalizer produced but the validator refused would be a
failure the user can neither explain nor act on.

**It fails soft, by design.** `GitStore.suggestBranch` returns an EMPTY STRING on any
failure and the form leaves the user's text untouched; the reason goes to the log strip.
Verified live against a harness with no credentials: the endpoint mounts and answers
`no API key for provider route "deepseek-official"` rather than hanging or 404ing, and an
empty hint is refused before any model call at all. Typing a branch name by hand is
always the path of least resistance — this is an accelerator, never a dependency.

**Listing worktrees without a way to reach one made the feature read-only.** A worktree
is a directory, and in dsh a directory is reached by being a workspace — so each row
carries an Open button calling `ctx.workspaces.create({ path })` then
`startSession(id)`. `create` is documented idempotent, so ONE path serves both a
worktree dsh already knows and one made from a terminal it has never seen; there is no
"is it registered?" branch to get wrong.

**Registration happens on the CLIENT, not the host.** The host's `worktree` endpoint
still accepts `register` (an older client's contract, like `commit`'s `all`), but the
tab no longer sends it: a host-side `workspaceRegistry` write is not guaranteed to reach
the browser's own workspace list without a reload, and a workspace that exists but is not
listed is worse than one that does not. Going through `ctx.workspaces` keeps that list
coherent by construction. The id is read through `workspaceIdOf`, which accepts
`workspaceId`, `id`, or either nested under `workspace` — the shell spells it
differently across its own projections, and guessing wrong fails silently: the worktree
registers, nothing opens, and the button reads as dead.

**Removing a worktree offers to remove its workspace too, because registration was
one-way.** Opening a worktree registers a workspace; removing the worktree used to leave
that workspace pointing at a deleted directory. Found in a real registry, not by
reasoning about it.

Three details are load-bearing:

- **The workspace is looked up and the question asked BEFORE anything is removed.** A
  second prompt after the directory is already gone reads as an afterthought, and the
  user is deciding about one thing.
- **Unregistering happens only if the removal actually SUCCEEDED.** Git refuses to remove
  a worktree with uncommitted changes, and unregistering one that still exists on disk is
  the inverse of the bug being fixed — it would hide a live worktree from the list.
- **`findWorkspaceForPath` matches exactly, never by prefix.** The registry stores a
  host-side realpath canon while git reports its own spelling, so comparison normalizes
  separators, trailing slash and case. A prefix match would resolve
  `myproj-feature` to `myproj` and delete the PARENT PROJECT's workspace — verified by
  sabotage, which returned `w1` where `w2` was expected. It returns undefined rather than
  guessing when nothing matches: a realpath that resolved a symlink differently should
  mean "no offer", never "delete something that looked close".

The removal is best-effort and logged: the worktree is already gone by then, so a failed
unregister must not read as a failed removal. Sessions are kept — `workspaces.delete`
drops them to the unaccounted group rather than deleting them, which the prompt says.

**`refs` returns a discriminated outcome, never bare arrays** — the `commitFiles` lesson,
and it is not hypothetical here. Measured against the running Desktop with an old host
half and a fresh client bundle: `dshGit/status` answers 200 while `dshGit/refs` 404s.
Collapsing that into empty lists would render as "this repository has no branches" rather
than "restart the profile". `smoke.mjs` pins the failed, rejected and
empty-but-successful cases separately.

**`worktrees` had to join the watcher allowlist.** `refs` and `MERGE_HEAD` were already
there, so stash and merge state go live for free, but a worktree add/remove writes to
`.git/worktrees` and nowhere else the watch can see — without it the Repo pane's list
silently never updates, which looks like the feature working until you add one. It is
low-rate: nothing but an explicit worktree command touches it. Pinned directly in
`watch-probe.mjs` beside the other allowlist assertions.

**No browser-persisted preference is introduced, and that is deliberate.** The segment
choice and the menu's open state are React state. DSH Desktop serves the UI from a new
ephemeral port every launch, so an origin's `localStorage` is empty on each start —
anything parked there would work on the CLI and silently fail on the Desktop. Nothing
here needs to survive a restart, so nothing is stored.

`pnpm run test:menu` drives headless Chrome against the **built** stylesheet: the branch
menu must stack above the panes at both widths, stay inside the viewport, and Repo rows
must hold the same 32px budget the icon probe pins.

**That probe's first version proved nothing**, and it is worth saying why. The fixture had
no positioned elements to compete with and a menu too short to reach the pane below it, so
deleting the menu's `z-index` still passed. The real competitor is `.dshgit-diffhead`,
which is `position: sticky` with `z-index: 1` — a HIGHER paint layer than any positioned
element whose z-index is auto. The fixture now includes a diff pane and 20 branches (enough
to hit the 60vh cap and overlap it), and the hit test samples four points down the menu's
height rather than one near its top. Verified to fail with `covered by dshgit-diffhead@0.85`.

The menu's clamp is NOT tested there. `menuLeft()` is exported and asserted in
`smoke.mjs` instead: a browser probe that re-implements the arithmetic to position its own
fixture is only testing its copy of it. Geometry that depends on CSS belongs in the probe;
a clamp is arithmetic.

## Environment isolation (git's location variables)

**`runGit` scrubs GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE and friends from the
child environment, and that is load-bearing.** Git resolves WHICH repository a
command operates on from the environment *before* it looks at `cwd`, so a single
inherited variable silently redirects every call in this package — turning the
service's whole contract ("run git in the workspace directory resolved through
`workspaceRegistry`") into a confident answer about somebody else's repository.
Measured here: with `GIT_INDEX_FILE` leaked, `readStatus` on a 2-file throwaway
repo reported **190 changed files**.

This is not exotic. Git EXPORTS these variables to every hook it runs, so a
harness launched from a pre-commit hook, from `git rebase --exec`, or from a CI
step nested inside a git operation inherits them. That is exactly how it was
found: this repo's own pre-commit hook made `host-ops.mjs` report 5 files where
it expected 2.

The scrub is a **denylist**, deliberately — the inverse of the watcher's
allowlist reasoning. `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `GIT_CONFIG_GLOBAL` and
the proxy variables are how users configure push and pull; a blanket wipe of
`GIT_*` would trade one silent bug for another. `test/env-isolation.mjs` pins
both halves: five location variables must not redirect the repo, and a
non-location setting must survive.

**The tests need the same scrub, and for a worse reason.** They build fixtures
with `execFileSync('git', ...)` directly, which never passes through `runGit`.
Under a hook, `git init` in a fixture resolves `GIT_DIR` before `cwd` and
re-initializes the OUTER repository: observed setting `core.bare = true` on this
working repo and overwriting its user identity with a test fixture's, which
makes every subsequent git command fail with `fatal: this operation must be run
in a work tree`. `test/git-env.mjs` is a side-effecting import that scrubs the
variables once at process start; every test that spawns git imports it FIRST.
Removing that import makes `pnpm test` destructive rather than merely wrong.

## Verification

```bash
# 1. identity — must print the %APPDATA%\npm host path, never a .pnpm store path
# run from this package folder
node -e "const{createRequire}=require('module'),{resolve}=require('path');console.log(createRequire(resolve('lib/index.js')).resolve('@deepseek-ai/dsh-typert-protocol'))"

# 2. wire probe — 200 = mounted; 404 = the ./typert export is not registered
curl -s -X POST http://127.0.0.1:38111/api/dshGit/status -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"t1","method":"dshGit/status","payload":{"args":{"request":{"workspaceId":"<real-id>"}}}}'
```

### Fresh-install E2E (the check a running dev profile cannot give you)

A dev profile has junctions, prior installs and cached loader verdicts, so it proves
nothing about a new user. Point `DSH_HOME` at a scratch directory and build one from
nothing — this is what caught the `workspaceRegistry` trap above:

```powershell
$env:DSH_HOME = "$env:TEMP\dsh-e2e-home"
# name it `web`: only web/headless get a real template (see Mounting)
dsh plugin --profile web add "file:C:/path/to/dsh-plugins/plugins/dsh-git"
dsh --profile web --port 38222 --no-open
```

The fresh home starts with **no workspaces**, and the workspace service is not Typert-
remote, so there is no endpoint to create one. Seed `storages/workspace.json` by hand —
and note `createdAt`/`updatedAt` are **ISO strings**; a number fails schema validation and
the profile dies inside `dsh-storage-domain` before dsh-git ever loads.

Verified on a clean home: both endpoints mount, the client bundle serves, and the watcher
passes 11/11 (idle stable, no self-trigger across 23 reads, then create / modify / stage /
commit / `.gitignore` / branch-switch each detected, settling stable again).

Real workspace ids live in `~/.dsh/storages/workspace.json` under `tables.workspaces` — **but check `$env:DSH_HOME` first**. When it is set (DSH Desktop sets it to `%APPDATA%\dsh-desktop\harness`), the server reads THAT home's `storages/workspace.json` and an id from `~/.dsh` comes back as `dsh-git: unknown workspace <id>`. That error means the endpoint is mounted and reached your code — a genuinely unregistered endpoint 404s instead, so do not read it as a wire failure. A healthy reply is `{"type":"server-response","result":{"ok":true,"value":{"status":{"repo":true,...}}}}`. Boot a scratch server with captured output (`dsh --profile web --port 38111 --no-open`) — an `ERR_MODULE_NOT_FOUND` there is a broken junction that a running server would swallow.
