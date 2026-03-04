# pi-shupervisor — Agent Guidelines

## Overview

Shell command linter extension for pi. Intercepts bash tool calls, parses them via `@aliou/sh`, matches against configurable rules, and blocks with helpful guidance messages.

## Project structure

```
src/
├── index.ts              # Extension entry point
├── config.ts             # Rule DSL types, defaults, ConfigLoader
├── config.test.ts        # Rule merging, ruleKey
├── rules.ts              # Rule type definitions and matching logic
├── rules.test.ts         # matchRule, checkCommand
├── unwrap.ts             # Wrapper-command unwrapping (xargs, sudo, etc.)
├── unwrap.test.ts        # Wrapper unwrapping
├── shell-utils.ts        # walkCommands, wordToString (from @aliou/sh)
├── hook.ts               # tool_call handler + regex fallback + lint()
├── hook.test.ts          # Full pipeline integration tests
├── fallback.test.ts      # Regex fallback matching
└── commands/
    ├── settings.ts       # /shupervisor:settings command
    └── add-rule.ts       # /shupervisor:add command
```

## Key patterns

- **Rule types**: `PreferRule`, `ForbidFlagRule`, `ForbidPatternRule` (see `src/rules.ts`)
- **Config merging**: defaults → global → local → memory. User rules override by `ruleKey()` match. `enabled: false` disables a rule.
- **AST matching**: `parse()` → `walkCommands()` → `unwrapCommand()` → `checkCommand()`
- **Regex fallback**: `checkCommandFallback()` used when AST parse fails. Accepts false positives over missed blocks.
- **Hot reload**: Hook reads `configLoader.getConfig()` per invocation. `/reload` picks up config file changes.

## Testing

```bash
npm test          # vitest run
npm run typecheck # tsc --noEmit
```
