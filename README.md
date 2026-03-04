# pi-shupervisor

Shell command linter for [pi](https://github.com/mariozechner/pi-coding-agent) — intercepts bash tool calls, parses them with an AST-based engine, matches against configurable rules, and blocks with helpful guidance messages. The agent sees the block reason and self-corrects.

## Installation

```bash
pi install git:github.com/indigoviolet/pi-shupervisor
```

## How it works

When the agent calls the `bash` tool, shupervisor:

1. **Parses** the command into an AST via [@aliou/sh](https://www.npmjs.com/package/@aliou/sh)
2. **Walks** all commands in the AST (pipelines, subshells, if/for/while, etc.)
3. **Unwraps** wrapper commands (sudo, xargs, env, bash -c, etc.) to find the actual command
4. **Matches** each command against the configured rules
5. **Blocks** the tool call if a rule matches, returning the reason to the agent

If the AST parse fails, a regex fallback catches common violations.

## Rule types

### `prefer` — Use command X instead of Y

Blocks a command and suggests a preferred alternative.

```json
{
  "type": "prefer",
  "instead_of": "grep",
  "use": "rg",
  "reason": "Use rg instead of grep — faster, respects .gitignore"
}
```

Matches when the command name (first word) equals `instead_of`.

### `forbid-flag` — Block specific flags

Blocks specific flag combinations on a command.

```json
{
  "type": "forbid-flag",
  "command": "rg",
  "flags": ["-rn"],
  "reason": "rg -rn means --replace n, not recursive + line numbers"
}
```

Matches when the command name equals `command` AND any argument matches a flag in `flags`.

### `forbid-pattern` — Block command + subcommand + flag

Blocks a specific combination of command, optional subcommand, and flags.

```json
{
  "type": "forbid-pattern",
  "command": "yadm",
  "subcommand": "add",
  "flags": ["-u", "-A"],
  "reason": "Never yadm add -u/-A, stage files explicitly"
}
```

Matches when command + subcommand + any forbidden flag are all present.

### `forbid-arg-pattern` — Block arguments matching a regex

Blocks a command when any of its arguments match a regex pattern.

```json
{
  "type": "forbid-arg-pattern",
  "command": "rg",
  "pattern": "\\\\\\|",
  "reason": "rg uses Rust regex syntax — use `foo|bar` for alternation, not `foo\\|bar`"
}
```

Matches when the command name equals `command` AND any argument (after the command name) matches `pattern` as a regex.

## Configuration

No rules are shipped by default — configure your own via global or project config files. Config files are JSON with optional `enabled` and `rules` fields.

### File locations

| Scope | Path |
|-------|------|
| Global | `~/.pi/agent/extensions/shupervisor.json` |
| Project | `<project>/.pi/extensions/shupervisor.json` |

Merge priority: defaults → global → project → memory (highest wins).

### Adding project-specific rules

Create `.pi/extensions/shupervisor.json` in your project:

```json
{
  "rules": [
    {
      "type": "prefer",
      "instead_of": "npm",
      "use": "pnpm",
      "reason": "This project uses pnpm. Use `pnpm` instead of `npm`."
    }
  ]
}
```

### Disabling a rule

If a global rule is defined and you want to disable it in a project, add the same rule with `"enabled": false` in the project config.

### Disabling the extension

```json
{
  "enabled": false
}
```

## Wrapper unwrapping

Shupervisor sees through wrapper commands to check the actual command being run:

| Wrapper | Mode | Example |
|---------|------|---------|
| `sudo`, `xargs`, `nice`, `nohup`, `doas`, `strace`, `ltrace` | Skip flags, rest is sub-command | `sudo grep pattern` → checks `grep` |
| `timeout` | Skip flags + 1 positional arg | `timeout 30 grep pattern` → checks `grep` |
| `env` | Skip flags + `KEY=val` assignments | `env LANG=C grep pattern` → checks `grep` |
| `bash`, `sh`, `zsh` | `-c` flag, re-parse next arg | `bash -c 'grep pattern'` → checks `grep` |
| `watch` | First non-flag arg is shell string | `watch 'grep -c error log'` → checks `grep` |

Unwrapping is recursive: `sudo xargs grep pattern` checks all three levels.

## Commands

### `/shupervisor:settings`

Interactive settings UI. Toggle the extension on/off and enable/disable individual rules. Changes are saved with Ctrl+S.

### `/shupervisor:add <description>`

Add or edit a rule using natural language. The command injects the rule DSL documentation and current config file contents into the conversation, and the agent edits the config file directly.

```
/shupervisor:add don't use cat to read files, use bat instead
/shupervisor:add block docker run with --privileged flag
```

After adding a rule, run `/reload` for changes to take effect.

## Development

```bash
npm install
npm test           # run tests
npm run test:watch # watch mode
npm run typecheck  # TypeScript check
```

## License

MIT
