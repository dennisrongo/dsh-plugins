# AGENTS.md — @dennisrongo/dsh-git

Source-control ("Changes") tab for DeepSeek Harness. Two halves in one package:

- **Host** (`src/index.ts` → `lib/index.js`) — `GitService extends TypertRemoteService`, cordis service key `dshGit`. Runs git in the workspace directory resolved through `workspaceRegistry`, serialises writes per repo root, and drafts commit messages through `llm`. A directory that is not a repository reports `repo: false`, never an error.
- **Client** (`src/client.tsx` → `lib/client.js`) — the Changes tab, CSS prefix `dshgit-`, calling the host over the Typert bridge as `ctx.remote.dshGit.*`.

## Endpoints

`POST /api/dshGit/<method>`, each taking one parameter named `request`:

- `status` — `{ workspaceId }` → branch, head, unborn, upstream, hasRemote, files, recent
- `diff` — `{ workspaceId, path?, staged? }` → `{ patch, binary }`; untracked files are synthesized into a `/dev/null` patch so a new file never renders a blank pane
- `stage` — `{ workspaceId, paths, ... }`, `commit` — `{ workspaceId, message, all? }`, `init` / `sync` — `{ workspaceId, ... }`, all → `{ ok, output }`
- `suggestMessage` — AI-drafted commit message

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

Works on both surfaces: the dsh CLI (`~/.dsh/profiles/<name>`) and DSH Desktop (`%APPDATA%\dsh-desktop\harness\profiles\<name>` — the desktop keeps its own DSH_HOME). Install per profile with `pnpm add "file:<repo>/plugins/dsh-git"`, using a native forward-slash absolute Windows path; the MSYS `/c/...` form fails `LINKED_PKG_DIR_NOT_FOUND`.

## Dev loop

`pnpm install` at the monorepo root, then `pnpm run build` here (emits `lib/index.js`, `lib/client.js`, `lib/typert.host.js`, plus the gitignored `client.body.cjs` and `client.test.mjs`). The three real artifacts are **committed** so a GitHub subdirectory install works — rebuild and commit them when you change `src/`. `pnpm test` runs build + `smoke.mjs` + `host-ops.mjs`.

Profiles materialise `file:` deps as copies **frozen at install time**, so a rebuild does not reach them. `scripts/dev-link.ps1` at the repo root replaces those copies with junctions: client-half edits then deploy on **browser refresh**, host-half edits need a **profile restart**.

**Re-run `scripts/dev-link.ps1` after any `pnpm install`.** It restores both the profile junctions and this package's `node_modules\@deepseek-ai\*` junctions to the CLI host copies. DSH Desktop's profile-repair install additionally empties this package's `node_modules`, taking `zod` with it, after which the harness refuses to boot with `Cannot find package 'zod' imported from ...\lib\index.js`. Fix: `pnpm install` at the monorepo root, then the script.

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

`pnpm run test:commit` drives headless Chrome against a live harness, clicks the **first session row**, stages and commits, then asserts the repository on disk actually advanced. It provisions its own scratch tree at `%TEMP%\dsh-git-tree` (override with `DSH_REPO`), seeded from a template in the test itself. That path is stable rather than per-run because dsh-git acts on the workspace of the clicked session — add it as a workspace in dsh once, and make sure its session is the first row.

## Verification

```bash
# 1. identity — must print the %APPDATA%\npm host path, never a .pnpm store path
# run from this package folder
node -e "const{createRequire}=require('module'),{resolve}=require('path');console.log(createRequire(resolve('lib/index.js')).resolve('@deepseek-ai/dsh-typert-protocol'))"

# 2. wire probe — 200 = mounted; 404 = the ./typert export is not registered
curl -s -X POST http://127.0.0.1:38111/api/dshGit/status -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"t1","method":"dshGit/status","payload":{"args":{"request":{"workspaceId":"<real-id>"}}}}'
```

Real workspace ids live in `~/.dsh/storages/workspace.json` under `tables.workspaces`. A healthy reply is `{"type":"server-response","result":{"ok":true,"value":{"status":{"repo":true,...}}}}`. Boot a scratch server with captured output (`dsh --profile web --port 38111 --no-open`) — an `ERR_MODULE_NOT_FOUND` there is a broken junction that a running server would swallow.
