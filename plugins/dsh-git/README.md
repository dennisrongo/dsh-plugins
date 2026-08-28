# @dennisrongo/dsh-git

A per-workspace **source-control tab** for the DeepSeek Harness web UI. It adds
a **Changes** tab beside Chat, Trajectory, and Todo that shows everything that
differs in the workspace's repository, and lets you stage, commit (with an
AI-written message), initialize, and sync — without leaving the session.

## What it does

- **View changes** — staged, unstaged, untracked, and conflicted files, each
  with a status letter and a click-to-open unified diff.
- **Stage / unstage / discard** — per file or per section. Discard is the one
  destructive action and always confirms first.
- **AI commit messages** — "✦ AI message" sends the diff to the model you
  already selected for new sessions and writes a Conventional Commits message.
- **Commit** — with an empty index it commits everything (`-a`); with a staged
  set it commits exactly that. `Ctrl`/`Cmd`+`Enter` commits from the box.
- **Initialize** — a directory that is not a repository shows an
  Initialize button with an editable initial branch name.
- **Sync** — Fetch, Pull (fast-forward only), Push / Publish, and a combined
  pull-then-push, with ahead/behind counts on the buttons.

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

## Architecture

The plugin ships **two halves** that never share a process:

| File | Half | Role |
| --- | --- | --- |
| `src/index.ts` | host | The `dshGit` service. Resolves a workspace id to its directory via `workspaceRegistry`, runs git, and calls `llm` for messages. |
| `src/git.ts` | host | The git engine: `execFile` wrapper and porcelain parsers. |
| `src/remote.ts` | both | Strict zod Typert descriptors — the wire contract. |
| `src/client.tsx` | browser | The Changes tab, registered into the `conversation.view` slot at `order: 30`. |
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
- **Git is invoked with an argument array, never a shell.** Paths, branch names,
  and commit messages are untrusted text.

## Install

```jsonc
// ~/.dsh/profiles/<profile>/package.json
{ "dependencies": { "@dennisrongo/dsh-git": "file:/path/to/dsh-git" } }
```

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- insert:
    - id: dsh-git
      name: '@dennisrongo/dsh-git'
```

Then `pnpm install` in the profile and restart `dsh`.

## Develop

```bash
pnpm install
pnpm build        # emits lib/index.js + lib/client.js
pnpm typecheck
pnpm test         # parsers, contract, and real-git operations
```

The offline suite runs git against throwaway repositories. Four probes drive
headless Chrome against the **built** `lib/client.js` and need no running
harness:

```bash
pnpm test:layout     # the diff sits beside the list at 1200px, below it at 560px
pnpm test:stability  # opening a diff moves no row, and never covers the list
pnpm test:skeleton   # the loading placeholder matches the real diff line's rhythm
pnpm test:icons      # icon geometry and the 32px row budget
```

Three further checks drive a real headless Chrome against a running server:

```bash
pnpm test:ui      # the tab registers, mounts, and renders
pnpm test:ai      # the AI button produces a Conventional Commits message
pnpm test:commit  # staging + committing changes real bytes on disk
```

`test:layout` and `test:stability` both slice the CSS out of the built bundle,
which is also why **a backtick must never appear in the stylesheet's comments**:
it is a template literal, so a stray one closes it early and silently truncates
every rule after it.
