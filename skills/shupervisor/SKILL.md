---
name: shupervisor
description: Manage shupervisor shell command linting rules. Use when adding, editing, or reviewing command enforcement rules for the pi-shupervisor extension.
---

# Shupervisor

Shell command linter for pi. Intercepts bash tool calls and blocks violations with helpful guidance.

## How it works

When you call the `bash` tool, shupervisor parses the command, walks the AST, unwraps wrappers (sudo, xargs, env, bash -c, etc.), and checks each command against configured rules. If a rule matches, the call is blocked and you see the reason.

## Override

When a command is blocked, the block reason includes a one-time token. To override, re-run the command with that exact token appended:

```bash
grep -P 'complex-pattern' file # shupervisor:allow:<token>
```

The token is specific to the exact command text and changes each session. You must get blocked first to receive the token — you cannot precompute it.

## Rule types

### `prefer` — Use command X instead of Y

```json
{
  "type": "prefer",
  "instead_of": "grep",
  "use": "rg",
  "reason": "Use rg instead of grep"
}
```

### `forbid-flag` — Block specific flags

```json
{
  "type": "forbid-flag",
  "command": "rg",
  "flags": ["-rn"],
  "reason": "rg -rn means --replace n"
}
```

### `forbid-pattern` — Block command + subcommand + flag combination

```json
{
  "type": "forbid-pattern",
  "command": "yadm",
  "subcommand": "add",
  "flags": ["-u", "-A"],
  "reason": "Stage files explicitly"
}
```

With empty `flags`, blocks the subcommand outright:

```json
{
  "type": "forbid-pattern",
  "command": "git",
  "subcommand": "stash",
  "flags": [],
  "reason": "Don't use git stash"
}
```

### `forbid-arg-pattern` — Block arguments matching a regex

```json
{
  "type": "forbid-arg-pattern",
  "command": "rg",
  "pattern": "\\\\\\|",
  "reason": "rg uses Rust regex — use foo|bar not foo\\|bar"
}
```

### `require-context` — Require certain strings in a command

```json
{
  "type": "require-context",
  "command": "git",
  "subcommand": "rebase",
  "requires": ["GIT_EDITOR=true", "GIT_SEQUENCE_EDITOR=:"],
  "reason": "git rebase must set GIT_EDITOR=true and GIT_SEQUENCE_EDITOR=:"
}
```

Blocks when command (+ optional subcommand) matches but NOT all `requires` strings appear in the full command.

## Config files

| Scope | Path |
|-------|------|
| Global | `~/.pi/agent/extensions/shupervisor.json` |
| Project | `<project>/.pi/extensions/shupervisor.json` |

Config is JSON with `enabled` (boolean) and `rules` (array). No rules ship by default.

## Adding rules

Edit the config JSON file directly. Run `/reload` after editing for changes to take effect.
