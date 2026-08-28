# Troubleshooting

Failure modes hit while running these plugins across the two supported surfaces — the `dsh`
CLI and [DSH Desktop](https://dshdesktop.com/). Most are silent: the harness keeps running
and something is quietly missing. Each entry gives the symptom, the cause, and the fix.

Build- and mounting-level problems (`duplicate loader entry id`, a missing `./typert`
export, the pruned `zod`) are in [AGENTS.md](AGENTS.md#rules-that-are-not-obvious).

## `dsh plugin add` fails on a pnpm-major mismatch

**Symptom.** Installing into an existing profile aborts without installing anything:

```
pnpm now wants to use the store at "…\pnpm\store\v10" to link dependencies.
If you want to use the new store location, reinstall your dependencies with "pnpm install".
dsh: pnpm failed in profile directory …\profiles\web
```

**Cause.** That profile's `node_modules` was created by a **different pnpm major** than the
one `dsh plugin` shells out to. Check the mismatch directly:

```powershell
pnpm --version                                              # what dsh will use
Select-String -Path <profile>\node_modules\.modules.yaml -Pattern 'packageManager|storeDir'
```

**Fix — do NOT just run `pnpm install`.** The suggested reinstall works, but it rebuilds the
whole tree with the new major and **replaces every `dev-link.ps1` junction with a frozen
copy**, silently detaching the profile from this repo. Instead install with the major the
profile already uses:

```powershell
cd <profile>
corepack pnpm@11.24.0 add "file:<repo>/plugins/dsh-superpowers"   # match .modules.yaml
```

Two things that bypasses, which you must then do by hand:

- **`pnpm add` does not write the bundle row.** `dsh plugin` reconciles
  `dsh.profile.bundles` after pnpm returns; calling pnpm directly skips that, so the
  package installs and simply never mounts. Add the package name to that array yourself.
- **The new package lands as a copy, not a junction.** Re-run
  `scripts/dev-link.ps1 -Profiles web -DesktopProfiles web` to relink it *and* anchor its
  `@deepseek-ai/*` peers — a junctioned plugin resolves through its real path, so without
  the anchors it dies at boot with `ERR_MODULE_NOT_FOUND`.

## Two `DSH_HOME`s

The surfaces do not share state. The CLI uses `$DSH_HOME`, defaulting to `~/.dsh`. DSH
Desktop sets its own unconditionally — `%APPDATA%\dsh-desktop\harness` on Windows — and
**ignores an inherited `DSH_HOME`**. Separate workspaces, separate session history,
separate `settings.yaml` and credentials.

The CLI does honour `DSH_HOME`, so it can be pointed at the Desktop's home to serve the same
data on a fixed port:

```bash
DSH_HOME='<desktop-harness-home>' dsh web --no-open --port 3080
```

**Only with the Desktop quit.** Read the next section before running that — doing it while
the app is open silently corrupts whatever sessions the app has open, and you will not find
out until a later restart. To read from the Desktop's home while it runs, query the app's own
endpoint instead of starting a second harness.

## Never run two harnesses against one home

**Symptom.** A session refuses to load:

```
Failed to load history: history unavailable for session "session-<uuid>":
Error: corrupt session log: seq gap in committed region at line <n> (expected 7433, got 7429)
```

**Cause.** Every event carries a `seq`, and the reader requires the *decoded* event stream to
be dense — `event.seq !== this.events.length` is the whole check in
`dsh-session-persistence-jsonl` (0.1.1-rc.2) — so one duplicated number invalidates
everything after it. A second harness on the same home adopts sessions merely by loading it,
and writes lifecycle records into them: a `session/end-seed`, plus a synthetic `interrupted`
branch when a tool call is in flight. The process that actually owns the session keeps
appending from a counter that never saw those writes, and the numbers collide.

Three things make this worse than it sounds:

- **It is a race, not a rule.** One home took six second-harness launches over two days; five
  were harmless and the sixth corrupted two sessions. "It worked last time" is not evidence.
- **It surfaces late.** The bad bytes are written silently and the owning writer carries on —
  those two sessions absorbed another 1118 and 1362 records after the collision. The reader
  only validates on load, so the failure appears at the *next* restart, long after the cause.
- **The blast radius is every session the other process has open**, across workspaces. A
  single event sealed four sessions in two different workspaces within 225 ms.

**Profiles do not isolate this.** `sessions/` is a sibling of `profiles/` in a home, not a
child, so every profile shares one session store. Only a separate `DSH_HOME` separates them.

**Nothing upstream prevents it.** As of `@deepseek-ai/dsh` 0.1.1-rc.2 there is no lock on a
home or a session — no `lockfile`, `acquireLock` or single-instance guard in any of the 197
`@deepseek-ai` packages — and this package's invariant companion registers nothing at
runtime, by design.

**Avoid it.** One harness per home. Quit DSH Desktop before pointing a CLI server at its
home, and quit any CLI server before reopening the app.

If you only need to *read* — probe an endpoint, check a workspace — ask the running harness
instead of booting a second one. It already serves the same RPCs, and its port is in the
Desktop's `logs/harness.log` as `[desktop] endpoint http://127.0.0.1:<port>`:

```bash
curl -s -X POST "http://127.0.0.1:<port>/api/dshGit/status" -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"t1","method":"dshGit/status","payload":{"args":{"request":{"workspaceId":"<id>"}}}}'
```

If you need a harness of your own, give it a throwaway `DSH_HOME` and `dsh plugin add` the
packages into it — never the Desktop's home.

**Diagnose it.** The log is `$DSH_HOME/sessions/<slug>/session-<uuid>/session.jsonl.zstd`,
stored as *concatenated zstd frames* — one per append. `zstdDecompressSync` returns only the
first frame (typically just the header line), so split on the zstd magic `28 b5 2f fd` and
decode frame by frame. Then walk the records tracking the expected next `seq`, noting that a
`text-chunks` record carries `seq0` and covers a span rather than one event. That span is why
a forward jump between *records* is normal even though the reader's decoded stream is dense —
only a **backwards** jump is corruption.

**Repair it.** The file is not garbled bytes — it is a clean prefix plus the other process's
writes, and dropping exactly those restores it. The spurious records are a lone
`session/end-seed`, or an `interrupted` `tool/result` and a `turn/end` with
`reason.kind: interrupted` followed by one; keep the branch that continues. Each append is
its own frame, so those records usually occupy whole frames — delete the frames from the byte
stream and every surviving frame stays byte-identical with nothing recompressed. Back up
first, and verify zero backwards jumps before installing. Two real repairs came to five
records across three frames and recovered ~2,480 stranded ones.

The app appends a fresh `session/end-seed` at `lastSeq + 1` when it next opens a session, so
that record showing up after a restart is the cheapest confirmation the log reads clean.

## A workspace with a missing directory shows no sessions

**Symptom.** A workspace is listed but has zero sessions under it. No error, no warning.

**Cause.** dsh does not list a workspace's history when the workspace directory is gone from
disk. Deleting a finished project therefore hides every conversation about it.

**Fix.** Recreate the directory — an empty stub is enough to make the history reachable
again. Confirm with a controlled test: create the directory, restart, and the sessions
reappear.

## Session directories can be copied but never renamed

**Symptom.** After moving or repointing a workspace, the harness will not boot:

```
dsh: plugin tree failed to load: failed to apply loader entry workspace
(@deepseek-ai/dsh-workspace): corrupt session log "<path>": header id "session-<uuid>"
and cwd identify "<other path>"
```

**Cause.** The session directory name is the workspace path with `\`, `/` and `:` collapsed
to `-` and wrapped in `--`. `assertStoredIdentity` in `dsh-session-persistence-jsonl`
compares the path recorded in the log header against the path it was loaded from and rejects
a mismatch.

**Consequence.** A workspace cannot be repointed to a new path and keep its history, and
syncing two homes means copying slug directories **verbatim**. Renaming one to match a new
path breaks the profile at boot.

## `global.workspaceIds` is the registry order

**Symptom.** After editing `$DSH_HOME/storages/workspace.json` by hand:

```
workspace domain is inconsistent: workspace '<uuid>' is absent from registry order
```

**Cause.** `tables.workspaces` holds the workspaces; `global.workspaceIds` holds their order,
and every id must appear in both.

Also in `global`: `archivedSessionIds` hides sessions from the sidebar, which is why a
workspace can show fewer rows than its `sessionIds` length. The sidebar additionally caps at
five rows per workspace with a "Show N more" control — a short list is not missing data.

## A running harness overwrites edits to its registry

**Symptom.** An edit to `workspace.json` reverts on its own.

**Cause.** The harness holds the registry in memory and flushes on change, so a live process
last-writer-wins over anything written underneath it.

**Fix.** Stop the process before editing, and check the file's mtime afterwards to confirm
the edit survived.

## Diagnostics

`scripts/verify.mjs` covers resolution, dependencies, entry points and the live `/api`
surface — see [AGENTS.md](AGENTS.md#verifying-a-change).

For config questions, `dsh --profile web --dump-config` prints the composed profile tree.
Providers and models come from `settings.yaml` at runtime, so `llm-pi-ai` appearing with no
`config:` block is normal and not evidence of lost configuration. Diffing the dump between
two homes is a quick way to tell a real config difference from a runtime one.

On Windows, `kill` from a POSIX shell does not stop a native node process — use
`taskkill /PID <pid> /F`. And prefer writing diagnostic scripts to a file over here-documents
or `node -e`: both eat the backslashes in Windows paths and silently produce wrong answers.
