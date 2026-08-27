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

The offline suite runs git against throwaway repositories. Three further checks
drive a real headless Chrome against a running server:

```bash
pnpm test:ui      # the tab registers, mounts, and renders
pnpm test:ai      # the AI button produces a Conventional Commits message
pnpm test:commit  # staging + committing changes real bytes on disk
```
