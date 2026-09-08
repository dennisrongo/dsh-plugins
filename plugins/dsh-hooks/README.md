# dsh-hooks

**npm:** [`@dennisrongo/dsh-hooks`](https://www.npmjs.com/package/@dennisrongo/dsh-hooks)

A Claude Code-compatible hook lifecycle for [dsh](https://github.com/deepseek-ai/deepseek-harness). Attach a shell command to a lifecycle point and it runs there — to block a tool call, feed the model context, format a file after an edit, or notify you when the agent stops. It also reads those same signals to suggest a skill beside the composer — see [Skill hints](#skill-hints).

dsh already had the lifecycle. `tools/pre-execute` is a waterfall returning `allow | deny | ask`, `tools/post-execute` can block a settled result or attach model-facing context, `agent/pre-step` can reject or rewrite the messages entering a step, and `agent/turn-stopping` can steer an agent back into work. What it had no way to do was attach a **command** to any of that from configuration. This plugin is that runner and nothing else: it owns no policy, and with an empty config it is inert.

## The eight events

| Config name | dsh event | What a hook can do |
|---|---|---|
| `PreToolUse` | `tools/pre-execute` | **allow / deny / ask** before the tool runs |
| `PostToolUse` | `tools/post-execute` | **block** with feedback the model reads, or attach context |
| `UserPromptSubmit` | `agent/pre-step` | **reject** the step, or attach context to the prompt |
| `SessionStart` | `agent/session-start` | attach context (`source` is `startup`/`resume`/`clear`/`compact`) |
| `SessionEnd` | `agent/disposed` | effect only |
| `Stop` | `agent/turn-stopping` | **continue** — steer the agent into another step |
| `SubagentStop` | `subagent/end` | effect only |
| `Notification` | `approval/request` | effect only |

`UserPromptSubmit` is gated to steps that actually claimed a user-sourced message, because `agent/pre-step` fires on *every* step — without the gate a prompt hook would run once per tool round-trip.

## Configuration

Two layers, and they are **additive**: every matching hook from both documents runs. A checked-out repository cannot silently disable your global guard by declaring an empty list.

**User layer** — the `dsh-hooks` settings namespace, so it lives in `$DSH_HOME/settings.yaml`, is schema-validated, and reloads live when you edit it:

```yaml
dsh-hooks:
  enabled: true
  hooks:
    PreToolUse:
      - matcher: bash
        hooks:
          - type: command
            command: node ~/.dsh/hooks/no-force-push.mjs
            timeout: 10
            failClosed: true
    PostToolUse:
      - matcher: str_replace_editor|create_file
        hooks:
          - type: command
            command: pnpm exec prettier --write "$DSH_PROJECT_DIR"
```

**Project layer** — `<workspace>/.dsh/hooks.json`, same shape, committed with the repo:

```json
{
  "PostToolUse": [
    { "matcher": "str_replace_editor", "hooks": [{ "type": "command", "command": "pnpm run lint --fix" }] }
  ]
}
```

Read on every dispatch and cached against the file's `mtime+size`, so an edit takes effect with no restart and no watcher held open per workspace. Set `projectHooks: false` to trust only your own settings.

`matcher` is a **regular expression** over the tool name — `bash|str_replace_editor` works. Absent, empty and `*` all mean every tool. An invalid pattern matches **nothing** and warns once: one typo must not turn into a hook that fires on every call in the session.

## The command protocol

Identical to Claude Code, so an existing hook script runs here unchanged.

- The JSON payload arrives on **stdin** (`hook_event_name`, `session_id`, `cwd`, `workspace_id`, `tool_name`, `tool_input`, `tool_response`, `prompt`, `source`, `stop_hook_active`).
- **Exit 0** — success. stdout is parsed as JSON when it is JSON; anything else is ordinary log output.
- **Exit 2** — blocking. stderr becomes the reason handed to the model.
- **Any other code** — non-blocking error. Recorded and logged.

Structured stdout:

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "deny",
    "permissionDecisionReason": "force-push to main is not allowed",
    "additionalContext": "the repo uses squash merges"
  }
}
```

`decision: "block" | "approve"` is honoured too; where the two fields disagree the **more restrictive** one wins, because a hook that says `deny` in one field and `approve` in another has a bug and denying is the safe reading of a buggy security hook.

Every hook is handed `DSH_PROJECT_DIR`, `DSH_SESSION_ID` and `DSH_HOOK_EVENT` — plus `CLAUDE_PROJECT_DIR` as the same value, so a ported script finds its project without edits. These names are supplied explicitly because the subprocess seam scrubs *all* `DSH_*` and credential-shaped variables from a child's ambient environment; the spec's explicit `env` is the documented opt-in.

## Two things Claude Code does that dsh cannot

Both are **reported, never silently dropped** — a hook that believes it did something it did not is worse than one that cannot do it at all.

- **Rewriting tool arguments.** `PreToolDecision` is `allow | deny | ask`; the tool registry's own documentation says input rewriting is excluded because arguments are already logged and presented. A hook returning `updatedInput` gets a warning naming the alternative: deny the call.
- **Blocking session teardown.** `agent/disposed` is emit-mode, so `SessionEnd` runs for effect and cannot object.

One timing caveat: `agent/session-start` is emit-mode too, so cordis does not await the listener and a slow `SessionStart` hook races the first model request. Its `additionalContext` goes in through `agent.inject()`, which a running driver claims at its nearest step boundary — so the context lands a step later rather than being lost.

## Failure is fail-open by default

`tools/pre-execute` is awaited by the tool registry before **every** dispatch. A hook that hangs would stall the session, so:

- the deadline is owned by the runner, never delegated to the hook (default 60s, `timeout` per entry, 600s ceiling);
- expiry escalates through the seam's tree-scoped `terminate`, so a helper process cannot outlive it;
- a crash, a timeout, or an unparseable reply is **not** a denial unless the entry sets `failClosed: true`.

That default is deliberate. One broken hook bricking every tool call is the failure mode that makes people delete their hooks entirely. A hook that exists to *enforce* something sets `failClosed` and accepts that breaking it stops the work — the right trade for a security gate and the wrong one for a formatter.

`Stop` gets a second guard. The protocol's own loop-breaker is `stop_hook_active`, which this plugin passes faithfully; the cap of **five consecutive continuations** exists for the hook that ignores it, because `{"decision":"block"}` on `Stop` is otherwise an infinite loop that burns tokens until you notice.

## Skill hints

The same lifecycle signals the hooks run on also describe what you are doing, and this plugin uses them for a second thing: small chips above the chat input naming a **skill you could run next**. Clicking one writes `/skill-name ` into the composer — exactly what picking it from the slash menu does — and you still confirm with Enter. `▶` (or shift-click) runs it immediately. `×` dismisses it for the rest of the session.

Every chip names a skill that is **actually installed and user-invocable in this deployment**. Rules carry patterns, not names; the pattern is resolved against `ctx.skills.list()` for your agent's scope, so no installed match means no chip. A skill you have already used this session is never suggested again.

| Rule id | Fires when | Suggests |
|---|---|---|
| `prompt:phrase` | your prompt contains a phrase a skill quotes in its own description (`"review my code"`, `"debug this"`) | that skill |
| `prompt:bug` | your prompt mentions a bug / crash / failure and no phrase matched | a diagnosis skill |
| `prompt:plan` | your prompt is about planning, design or architecture | a planning skill |
| `turn:feature-done` | the turn made ≥ 3 source edits with no tool errors and loaded no skill | a code-review skill, then a tests skill |
| `turn:tests-missing` | ≥ 3 source edits and nothing ran a test command | a tests skill |
| `turn:ready-to-ship` | the turn ran `git add`/`git commit`, or the work was already reviewed | a commit-message skill, then a PR skill |
| `project:dotnet` | a `.csproj` / `.sln` / `.slnx` / `global.json` in the workspace | a .NET skill |
| `project:nextjs` | `package.json` depends on `next` | a Next.js skill |
| `project:tauri` | a Tauri config or `@tauri-apps/*` dependency | a Tauri skill |
| `project:remotion` | `package.json` depends on `remotion` | a Remotion skill |
| `project:shadcn` | `components.json` whose `$schema` names shadcn | a shadcn skill |
| `session:long` | 25 or more prompts in the session | a hand-off skill |

Turn rules outrank project rules, so a chip about what just happened beats a standing fact about the workspace. The workspace scan reads the top level plus one level of subdirectories (skipping `node_modules`, `bin`, `obj`, `dist` and friends, bounded to 400 entries) and is cached for 30 seconds — a `.csproj` at `src/Web/Web.csproj` is found, which a root-only scan would miss.

The rules are deliberately cheap regexes and quoted-phrase matches, not a classifier. A false positive costs you one ignorable chip, so paying model latency to sharpen it would be the wrong trade — and a rule you can predict is one you can turn off:

```yaml
dsh-hooks:
  hints:
    enabled: true          # master switch for the strip and the engine
    max: 3                 # 1..6 chips at once
    disableRules:          # silence rules by id
      - session:long
      - prompt:plan
```

`enabled: false` leaves the hook runner completely untouched. There is **no project layer for hints** — `.dsh/hints.json` is not a thing yet, and neither are user-defined rules; both are on the list, not in the box.

The strip renders nothing at all when there are no hints, so it costs no vertical space in a session it has nothing to say about.

## Endpoints

`POST /api/dshHooks/describe` → `{ enabled, shell, userOrigin?, projectOrigin?, hooks: [...] }` — every hook in force across both layers, with the document each came from. Takes `{ workspaceId? }`.

`POST /api/dshHooks/recent` → `{ runs: [...] }` — the last 200 settled runs with exit codes, durations, stdout/stderr tails and parsed output. Takes `{ limit? }`.

`POST /api/dshHooks/hints` → `{ hints: [...], token }` — the chips computed for one session. Takes `{ sessionId }`.

`POST /api/dshHooks/hintsToken` → `{ token }` — an in-memory counter that moves **only** when the computed list actually changes. This is what the strip polls (every 1.5s while the tab is visible), so it does no work at all; an idle session polls a constant and never refetches. Takes `{ sessionId }`.

`POST /api/dshHooks/dismissHint` → `{ ok, token }` — silence one hint id for the session. Takes `{ sessionId, id }`.

An unknown session is an empty list and token `0` on all three, never an error. Every endpoint takes a single parameter named `request`.

## Install

```bash
dsh plugin add @dennisrongo/dsh-hooks
```

Then restart the profile — the Typert loader caches its per-package verdict for the process lifetime, so a newly added service is not picked up by a refresh.

## Requires

`ctx.tools` and `ctx.subprocess`, both composed by `@deepseek-ai/dsh-web-app` by default. `ctx.settings`, `ctx.workspaceRegistry` and `ctx.skills` are used when present and are **not** injected: a deployment composing none of them still gets project-layer hooks and a working cwd-derived payload, rather than a service that never becomes injectable. With no skill registry composed, the hint strip simply stays empty.

---

## About the author

Plugins and walkthroughs on [YouTube @codingmenace](https://www.youtube.com/@codingmenace) —
I build AI coding tools in public, including DeepSeek Harness itself. More at
[dennisrongo.com](https://dennisrongo.com/).
