# dsh-memory

**npm:** `@dennisrongo/dsh-memory` — *not published yet; install from the repo subdirectory.*

A `/remember` command that writes a fact into the instruction hierarchy dsh already reads, and a **Memory** tab that shows which of those files the loader actually kept.

## Why this is small

dsh already has the read half of a memory system, and it is more capable than it looks. `@deepseek-ai/dsh-agent-instructions` — its own manifest calls it a *"Workspace context loader for AGENTS.md/CLAUDE.md instruction files"* — loads the user-global `$DSH_HOME/AGENTS.md`, then every `AGENTS.md` and `CLAUDE.md` from the project root down to the session's directory, plus `AGENTS.local.md` / `CLAUDE.local.md` overlays, deduplicated per directory, budgeted by bytes, and it pulls in nested files as the agent touches them. Sessions are already bound to workspaces by canonical path through `workspaceRegistry`.

Two things were missing:

**Nothing writes.** There is no `#`-style capture and no `/remember`, so a fact learned mid-session is a fact you retype into a file by hand, later, if you remember to.

**Nothing shows what loaded.** The byte budget silently omits files. A file that exists, is discovered, and is dropped for budget looks exactly like a file the agent is ignoring for no reason — and the shipped `code` preset's budget is 64 KiB, which a real monorepo reaches.

So this plugin is those two things and deliberately nothing else. There is no parallel fact database: a second store beside the instruction files would mean two things to keep in sync, two precedence orders, and a place for facts to hide from a loader that already works.

## Capture

```
/remember the build needs pnpm 11 — package.json pnpm blocks are ignored
/remember --local the staging token lives in ~/.config/acme
/remember --user I prefer conventional commits with no Claude co-author trailer
```

| Flag | File | Reach |
|---|---|---|
| *(default)* `--project` | `<projectRoot>/AGENTS.md` | travels with the repository |
| `--local` | `<projectRoot>/AGENTS.local.md` | this checkout only, usually gitignored |
| `--user` | `$DSH_HOME/AGENTS.md` | every project on this machine |

The reply always names the exact path it wrote. "Saved" would leave you guessing which of four candidate files in the hierarchy it landed in.

Facts are filed under a `## Memories` heading rather than appended to the end of the file, and a second fact joins the existing list instead of starting a new one. Nothing a human wrote is ever moved: a file with no memories section gets one appended (with the blank line guarded, so the heading cannot end up glued to the last line of prose), and a file with one gets the new item at the end of *that section*, not after whatever heading happens to be last.

The Memory tab has the same capture box, with a scope chooser; Enter saves, Shift+Enter is a newline.

## Inspection

The tab lists every instruction file discovered for the workspace, in **model precedence order**, with its size and whether the budget kept it:

```
AGENTS.md                                    5.1 KB   not loaded
packages/app/AGENTS.md      cut to 96 B      5.1 KB
```

Click a row to read the file. `not loaded` and `cut to …` are the two facts you cannot get anywhere else, and they are the reason the tab exists.

Both come from the loader's own exports — `discoverBaselineInstructionFiles` for the candidate list and `loadBaselineInstructions` for the `omitted` / `truncated` accounting. Nothing here reimplements the walk. An inspector that reimplemented it would eventually disagree with the loader, and an inspector you cannot trust when it disagrees is worse than none: the entire point is to answer "is the agent reading this file?" authoritatively.

`read` serves a path only when the loader discovered it for that workspace. Without that check the endpoint reads any file on the host.

## Configuration

```yaml
- id: dsh-memory
  config:
    maxBytes: 65536
```

`maxBytes` **must match** the `agent-instructions` row's own `maxBytes`, or the inspector reports omissions against the wrong budget. The shipped `code` preset uses `65536`, which is this plugin's default; a plugin cannot read another plugin's entry config, so if you change one, change both.

## Endpoints

| Method | Takes | Returns |
|---|---|---|
| `dshMemory/inspect` | `{ workspaceId }` | `{ report }` — every discovered file, sized, with `included` / `truncatedTo` |
| `dshMemory/remember` | `{ workspaceId, fact, scope }` | `{ ok, path, line }` or `{ ok: false, reason }` |
| `dshMemory/read` | `{ workspaceId, absolutePath }` | `{ text? }` — discovered files only |

All take a single parameter named `request`.

## Install

```bash
dsh plugin add @dennisrongo/dsh-memory
```

Restart the profile afterwards — the Typert loader caches its per-package verdict for the process lifetime, so a newly added service is not picked up by a browser refresh.

## Requires

`ctx.workspaceRegistry` and `@deepseek-ai/dsh-agent-instructions`, both composed by the shipped presets. `ctx.commands` is picked up through a child fiber rather than injected, so a deployment that composes no command registry still gets the tab and the endpoints — it just has no `/remember`.
