# dsh-superpowers

Injects the [Superpowers](https://github.com/obra/superpowers) methodology
bootstrap (`skills/using-superpowers/SKILL.md`) into every dsh agent's system
prompt as an ordered, persistent section.

Upstream harnesses deliver this via a SessionStart hook that must re-fire on
`startup|clear|compact`. dsh reassembles its layered system prompt after
compaction, so a single registered section covers all three cases for the life
of the session — no hook shell, no post-compaction gap.

The section body is read at startup from the cloned superpowers repo (default
`~/Documents/Experimental Projects/superpowers`), so updates are
`git pull` + restart dsh.

## Install (profile-level)

```yaml
# ~/.dsh/profiles/<name>/cordis.patch.yml — add one row
- id: superpowers
  name: dsh-superpowers
  config:
    superpowersRoot: /absolute/path/to/superpowers
```

with `pnpm add "file:/absolute/path/to/dsh-plugins/plugins/dsh-superpowers"`
in the profile workspace.

## Config

| key | default | meaning |
|---|---|---|
| `superpowersRoot` | `~/Documents/Experimental Projects/superpowers` | repo root containing `skills/using-superpowers/SKILL.md` |
| `order` | `-50` | prompt section order (persona is 0; we sit before it) |
| `enabled` | `true` | set false for a clean-baseline profile |

Skills themselves live in `~/.agents/skills/` (see repo README) and are
discovered natively by dsh's skill filesystem provider.
