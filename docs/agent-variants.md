# Agent Variants

One machine often has the same agent CLI logged into more than one account —
a personal Codex and a work Codex. The CLIs express that as an environment
override (`CODEX_HOME`), which people usually wrap in a shell alias:

```zsh
codex-work () { CODEX_HOME="$HOME/.codex-work" command codex "$@" }
```

Plannotator spawns review jobs directly, with no shell, so an alias like that
is invisible to it. An **agent variant** declares the same thing in a form
Plannotator can spawn: a name, the base engine it re-points, and the
environment to run it in.

## Declare one

In `~/.plannotator/config.json`:

```json
{
  "agentVariants": [
    {
      "id": "codex-work",
      "base": "codex",
      "label": "Codex Work",
      "env": { "CODEX_HOME": "~/.codex-work" },
      "accent": "violet"
    }
  ]
}
```

Start a code review. The engine row under **Provider** now shows a second Codex
mark with a violet dot, captioned "Codex Work". Pick it and the review runs the
same `codex` binary with `CODEX_HOME` pointed at the other account.

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Provider id. Lowercase letters, digits and dashes, 1–32 chars. Must not be a built-in provider name. |
| `base` | yes | The engine it re-points: `claude`, `codex`, `cursor`, `opencode`, `pi`, or `copilot`. |
| `label` | no | Display name. Defaults to the id. |
| `env` | see below | Environment overlaid on the job's own. |
| `binary` | see below | Binary to run instead of the base engine's. `~` is expanded. |
| `accent` | no | `violet`, `amber`, `emerald`, `sky`, `rose`, or `slate`. Assigned automatically when omitted. |

At least one of `env` or `binary` is required — without either, the variant
would be an identical copy of its base and is dropped.

## What a variant shares with its base

Everything except the environment. A variant runs the base engine's prompt, its
argv, its output parser, and its model and effort settings, so `codex-work`
offers the same model list as `codex` and its findings come back the same way.
The one difference you see in the review is attribution: findings are labeled
with the variant's name ("Codex Work"), not the base engine's.

The review picker is the only place variants appear. Code Tour and Guided
Review keep the built-in engine set.

## Notes

- A variant is offered only when its binary is actually on `PATH` — its own
  when it sets `binary`, otherwise the base engine's.
- The env overlay cannot override `PLANNOTATOR_API_URL` or
  `PLANNOTATOR_AGENT_SOURCE`; those carry the loopback address the agent posts
  its findings back to, and are re-applied after the overlay.
- Invalid entries are dropped with a warning on stderr, and the rest still
  load. A typo in this key never stops a review server from starting.
- The list is read once when the server starts. Edit the config and start a new
  review to pick up a change.
- Caps: 12 variants, 16 env entries each.
