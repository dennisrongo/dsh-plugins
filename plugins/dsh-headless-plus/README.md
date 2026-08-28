# @dennisrongo/dsh-headless-plus

[![npm](https://img.shields.io/npm/v/@dennisrongo/dsh-headless-plus)](https://www.npmjs.com/package/@dennisrongo/dsh-headless-plus)

**npm:** [`@dennisrongo/dsh-headless-plus`](https://www.npmjs.com/package/@dennisrongo/dsh-headless-plus) ·
**source:** [dennisrongo/dsh-plugins](https://github.com/dennisrongo/dsh-plugins/tree/main/plugins/dsh-headless-plus)

Claude Code parity for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
headless app: **pick a model** and **continue a conversation** from the command line.

The stock headless app runs one task with the default model and forgets it. This replaces it
with one that takes `--model`, `--resume` and `--continue`, so a shell script or an agent can
hold a real conversation across invocations.

## Flags

| Flag | Meaning |
|---|---|
| `--model provider/model` | Override the model for this run. Malformed values fail fast at startup rather than silently falling back. |
| `--resume <session-id\|latest>` | Continue an existing session. |
| `-c`, `--continue` | Alias for `--resume latest` — the most recent session for this directory. |
| `--session-info` | Print the session id to **stderr** at exit, so stdout stays clean for piping. |

```bash
dsh --profile headless-plus --session-info "reply with the single word ok"
dsh --profile headless-plus --continue "and again"
dsh --profile headless-plus --model deepseek/deepseek-chat "summarise README.md"
```

## Install

```bash
dsh plugin --profile headless add @dennisrongo/dsh-headless-plus
```

Needs a profile built on `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`. The package
**mounts itself**: its own `cordis.patch.yml` disables the two stock headless rows and inserts
its replacements. Do **not** repeat any of that in your profile — a duplicate id is fatal
(`duplicate loader entry id: headless-plus-startup`).

This is a *replacement* app, not an addition, which is why it disables another bundle's rows.

## Update

```bash
dsh plugin --profile headless outdated
dsh plugin --profile headless update @dennisrongo/dsh-headless-plus
```

`dsh plugin` forwards to pnpm, so `outdated`, `update` and `remove` all behave normally. A
caret range only moves within its major; cross one with
`add @dennisrongo/dsh-headless-plus@latest`. There is no build step — `lib/` is hand-written
and committed — but the app is a CLI, so changes apply on the **next run**, not a refresh.

## How it works

Two plugins, two rows. `lib/startup.js` owns the flag family via commander and publishes a
`headlessPlusStartup` service carrying the parsed task and options; `lib/index.js` resolves the
session target, applies any model override, runs the agent and prints the result. Each dsh app
owns its own flags, so these do not collide with the launcher's.

Resuming goes through the public `ctx.agents.resume()`. `--resume latest` maps the cwd to its
session directory using the same slug rule as `dsh-session-persistence-jsonl` (separators → `-`,
wrapped in `--`); if that upstream convention changes this breaks, and `test/smoke.mjs` is what
catches it.

`commander` is a real dependency; every `@deepseek-ai/*` is a peer supplied by your dsh install.

See [AGENTS.md](AGENTS.md) for the mount rows, dev loop and verification recipe.
