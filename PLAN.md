# pi-shupervisor — Implementation Plan

## Overview

A pi extension that intercepts bash tool calls, parses them via `@aliou/sh`, matches against a configurable rule DSL, and blocks with helpful guidance messages. The agent sees the block reason and self-corrects.

## File Structure

```
pi-shupervisor/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── AGENTS.md
├── README.md
├── src/
│   ├── index.ts              # Extension entry point
│   ├── config.ts             # Rule DSL types, defaults, ConfigLoader
│   ├── config.test.ts        # Rule merging, ruleKey
│   ├── rules.ts              # Rule type definitions and matching logic
│   ├── rules.test.ts         # matchRule, checkCommand
│   ├── unwrap.ts             # Wrapper-command unwrapping (xargs, sudo, etc.)
│   ├── unwrap.test.ts        # Wrapper unwrapping
│   ├── shell-utils.ts        # walkCommands, wordToString (from @aliou/sh)
│   ├── hook.ts               # tool_call handler + regex fallback
│   ├── hook.test.ts          # Full pipeline integration tests
│   ├── fallback.test.ts      # Regex fallback matching
│   └── commands/
│       ├── settings.ts       # /shupervisor:settings command
│       └── add-rule.ts       # /shupervisor:add command
```

---

## 1. package.json

```json
{
  "name": "pi-shupervisor",
  "version": "0.1.0",
  "description": "Shell command linter for pi — AST-based rule enforcement with natural language configuration",
  "license": "MIT",
  "type": "module",
  "keywords": ["pi-package", "pi-extension"],
  "repository": {
    "type": "git",
    "url": "https://github.com/indigoviolet/pi-shupervisor"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "files": ["src", "README.md"],
  "dependencies": {
    "@aliou/pi-utils-settings": "^0.4.0",
    "@aliou/sh": "^0.1.0"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": ">=0.51.0",
    "@mariozechner/pi-tui": ">=0.51.0"
  },
  "peerDependenciesMeta": {
    "@mariozechner/pi-coding-agent": { "optional": true },
    "@mariozechner/pi-tui": { "optional": true }
  },
  "devDependencies": {
    "@mariozechner/pi-coding-agent": "0.52.7",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

## 2. tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

---

## 3. Rule DSL — `src/rules.ts`

### Type definitions

```typescript
/**
 * Rule: prefer command X over command Y.
 * Matches when words[0] === instead_of (the command name).
 *
 * Example: grep → rg, find → fd
 */
interface PreferRule {
  type: "prefer";
  instead_of: string;      // command to block (e.g. "grep")
  use: string;             // preferred command (e.g. "rg")
  reason: string;          // shown to LLM as block reason
  enabled?: boolean;       // default true
}

/**
 * Rule: forbid specific flags on a command.
 * Matches when words[0] === command AND any word matches a forbidden flag.
 *
 * Flags are matched as exact string equality against individual words.
 * Combined short flags are expanded: "-rn" matches if any of the
 * individual characters match a single-char forbidden flag.
 *
 * Example: rg -rn → blocked (because -rn is in the forbidden list)
 */
interface ForbidFlagRule {
  type: "forbid-flag";
  command: string;          // command name (e.g. "rg")
  flags: string[];          // forbidden flags (e.g. ["-rn", "-r"])
  reason: string;
  enabled?: boolean;
}

/**
 * Rule: forbid a command+subcommand+flag combination.
 * Matches when words[0] === command AND words[1] === subcommand (if set)
 * AND any word matches a forbidden flag.
 *
 * Example: yadm add -u → blocked
 */
interface ForbidPatternRule {
  type: "forbid-pattern";
  command: string;          // command name (e.g. "yadm")
  subcommand?: string;      // optional subcommand (e.g. "add")
  flags: string[];          // forbidden flags (e.g. ["-u", "-A"])
  reason: string;
  enabled?: boolean;
}

type Rule = PreferRule | ForbidFlagRule | ForbidPatternRule;
```

### Matching logic

```typescript
/**
 * Check a single command (as string[] words) against a single rule.
 * Returns the block reason if matched, undefined otherwise.
 */
function matchRule(words: string[], rule: Rule): string | undefined;

/**
 * Check a single command against ALL rules.
 * Returns the first matching rule's reason, or undefined.
 */
function checkCommand(words: string[], rules: Rule[]): string | undefined;
```

#### Match logic per rule type:

**`prefer`**: `words[0] === rule.instead_of` → return reason

**`forbid-flag`**: `words[0] === rule.command` AND `words.some(w => rule.flags.includes(w))` → return reason

**`forbid-pattern`**:
- `words[0] === rule.command`
- If `rule.subcommand`: `words[1] === rule.subcommand`
- `words.some(w => rule.flags.includes(w))`
- All must match → return reason

---

## 4. Wrapper unwrapping — `src/unwrap.ts`

Semantic layer that knows certain commands delegate to sub-commands.

### Wrapper table

```typescript
type UnwrapMode =
  | "args-after-flags"     // skip flags, rest is sub-command (xargs, sudo, nice, nohup, strace, doas)
  | "skip-n"               // skip N positional args after flags (timeout N cmd...)
  | "args-after-assigns"   // skip FOO=bar assignments (env FOO=bar cmd...)
  | "dash-c"               // -c flag, next arg is shell string to re-parse (bash, sh, zsh)
  | "first-arg-is-shell"   // first non-flag arg is shell string (watch)

interface WrapperDef {
  mode: UnwrapMode;
  n?: number;              // for skip-n
}

const WRAPPERS: Record<string, WrapperDef> = {
  xargs:    { mode: "args-after-flags" },
  nice:     { mode: "args-after-flags" },
  nohup:    { mode: "args-after-flags" },
  sudo:     { mode: "args-after-flags" },
  doas:     { mode: "args-after-flags" },
  strace:   { mode: "args-after-flags" },
  ltrace:   { mode: "args-after-flags" },
  timeout:  { mode: "skip-n", n: 1 },
  env:      { mode: "args-after-assigns" },
  bash:     { mode: "dash-c" },
  sh:       { mode: "dash-c" },
  zsh:      { mode: "dash-c" },
  watch:    { mode: "first-arg-is-shell" },
};
```

### Function

```typescript
/**
 * Given a SimpleCommand's words (as strings), extract all effective
 * sub-commands. Returns an array of word arrays.
 *
 * Always includes the original words as the first element.
 * Recursively unwraps nested wrappers (e.g. sudo xargs grep → [sudo...], [xargs...], [grep...]).
 * For dash-c/first-arg-is-shell, re-parses the string via @aliou/sh parse().
 */
function unwrapCommand(words: string[]): string[][];
```

#### Extraction per mode:

**`args-after-flags`**: Skip words starting with `-`, first non-flag word starts the sub-command. Recurse into that sub-command.

**`skip-n`**: Skip flags AND `n` positional args, rest is sub-command. Recurse.

**`args-after-assigns`**: Skip words containing `=` or starting with `-`, rest is sub-command. Recurse.

**`dash-c`**: Find `-c` in the args, next arg is a shell string. `parse()` that string and extract all SimpleCommands from it.

**`first-arg-is-shell`**: First non-flag arg is a shell string. `parse()` it.

---

## 5. Shell utils — `src/shell-utils.ts`

Copy from guardrails/toolchain (they both duplicate this). Provides:

```typescript
function wordToString(word: Word): string;

function walkCommands(
  node: Program,
  callback: (cmd: SimpleCommand) => boolean | undefined,
): void;
```

Same implementation as in guardrails — walks all AST node types (Pipeline, Logical, IfClause, ForClause, etc.), calls callback for each SimpleCommand.

---

## 6. Config — `src/config.ts`

### User-facing config (all optional)

```typescript
interface ShupervisorConfig {
  enabled?: boolean;
  rules?: Rule[];           // user rules (merged with defaults)
  replaceDefaults?: boolean; // if true, user rules REPLACE defaults instead of extending
}
```

### Resolved config (all required)

```typescript
interface ResolvedConfig {
  enabled: boolean;
  rules: Rule[];
  useDefaults: boolean;     // internal: whether default rules are active
}
```

### Default rules

```typescript
const DEFAULT_RULES: Rule[] = [
  {
    type: "prefer",
    instead_of: "grep",
    use: "rg",
    reason: "Use `rg` instead of `grep` — it's faster, respects .gitignore, and uses Rust regex syntax. Recursive search is the default.",
  },
  {
    type: "prefer",
    instead_of: "find",
    use: "fd",
    reason: "Use `fd` instead of `find` — simpler syntax, respects .gitignore, smart case by default.",
  },
  {
    type: "forbid-flag",
    command: "rg",
    flags: ["-rn"],
    reason: "`rg -rn` means `--replace n`, replacing every match with the letter 'n'. Recursive is the default in rg. Use `rg -n` for line numbers (also default in terminals).",
  },
  {
    type: "forbid-pattern",
    command: "yadm",
    subcommand: "add",
    flags: ["-u", "-A"],
    reason: "Never use `yadm add -u` or `yadm add -A` — the home directory has too many tracked files. Always stage files explicitly: `yadm add <file> ...`",
  },
];
```

### ConfigLoader setup

```typescript
const configLoader = new ConfigLoader<ShupervisorConfig, ResolvedConfig>(
  "shupervisor",
  DEFAULT_CONFIG,
  {
    scopes: ["global", "local", "memory"],
    afterMerge: (resolved, global, local, memory) => {
      // If any scope sets replaceDefaults: true, use only user rules
      const replace =
        memory?.replaceDefaults ??
        local?.replaceDefaults ??
        global?.replaceDefaults ??
        false;

      if (replace) {
        resolved.useDefaults = false;
        // rules already contains only user rules from merge
      } else {
        resolved.useDefaults = true;
        // Prepend defaults, then user rules override by matching type+command
        resolved.rules = mergeRules(DEFAULT_RULES, resolved.rules);
      }
      return resolved;
    },
  },
);
```

### Rule merging strategy

```typescript
/**
 * Merge default rules with user rules.
 * User rules with the same (type, command/instead_of) override the default.
 * User rules with new commands are appended.
 * A user rule with enabled: false disables a default rule.
 */
function mergeRules(defaults: Rule[], overrides: Rule[]): Rule[];
```

The key function for uniquely identifying a rule for override purposes:

```typescript
function ruleKey(rule: Rule): string {
  switch (rule.type) {
    case "prefer":
      return `prefer:${rule.instead_of}`;
    case "forbid-flag":
      return `forbid-flag:${rule.command}:${rule.flags.sort().join(",")}`;
    case "forbid-pattern":
      return `forbid-pattern:${rule.command}:${rule.subcommand ?? ""}:${rule.flags.sort().join(",")}`;
  }
}
```

### Config files

- **Global**: `~/.pi/agent/extensions/shupervisor.json`
- **Project**: `.pi/extensions/shupervisor.json`

Example project config:

```json
{
  "rules": [
    {
      "type": "prefer",
      "instead_of": "npm",
      "use": "pnpm",
      "reason": "This project uses pnpm. Use `pnpm` instead of `npm`."
    },
    {
      "type": "prefer",
      "instead_of": "grep",
      "use": "rg",
      "enabled": false
    }
  ]
}
```

^ This adds an npm→pnpm rule and disables the default grep→rg rule.

---

## 7. Hook — `src/hook.ts`

### Main function

```typescript
function setupCommandLintHook(pi: ExtensionAPI, config: ResolvedConfig): void;
```

### Flow

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;

  const command = String(event.input.command ?? "");
  const rules = config.rules.filter(r => r.enabled !== false);

  // 1. Try AST-based matching
  let violation: string | undefined;
  try {
    const { ast } = parse(command);

    walkCommands(ast, (cmd) => {
      const words = (cmd.words ?? []).map(wordToString);
      if (words.length === 0) return;

      // Get all effective commands (including unwrapped sub-commands)
      const allCommands = unwrapCommand(words);

      for (const cmdWords of allCommands) {
        const reason = checkCommand(cmdWords, rules);
        if (reason) {
          violation = reason;
          return true; // stop walking
        }
      }
    });
  } catch {
    // 2. Fallback: regex-based matching on raw command string
    violation = checkCommandFallback(command, rules);
  }

  if (violation) {
    ctx.ui.notify("Command blocked by shupervisor", "warning");
    return { block: true, reason: violation };
  }
});
```

### Regex fallback

```typescript
/**
 * Fallback matching when AST parse fails.
 * Only checks prefer rules (command name as word boundary regex)
 * and forbid-flag rules (flag as word boundary).
 * Accepts false positives — a missed block is worse than a false block
 * for "prefer" rules (unlike rewrite, where false positives corrupt).
 */
function checkCommandFallback(command: string, rules: Rule[]): string | undefined {
  for (const rule of rules) {
    if (rule.enabled === false) continue;

    switch (rule.type) {
      case "prefer": {
        const re = new RegExp(`\\b${escapeRegex(rule.instead_of)}\\b`);
        if (re.test(command)) return rule.reason;
        break;
      }
      case "forbid-flag": {
        const cmdRe = new RegExp(`\\b${escapeRegex(rule.command)}\\b`);
        if (!cmdRe.test(command)) break;
        for (const flag of rule.flags) {
          if (command.includes(flag)) return rule.reason;
        }
        break;
      }
      case "forbid-pattern": {
        const cmdRe = new RegExp(`\\b${escapeRegex(rule.command)}\\b`);
        if (!cmdRe.test(command)) break;
        if (rule.subcommand && !command.includes(rule.subcommand)) break;
        for (const flag of rule.flags) {
          if (command.includes(flag)) return rule.reason;
        }
        break;
      }
    }
  }
  return undefined;
}
```

---

## 8. Extension entry — `src/index.ts`

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { configLoader } from "./config";
import { setupCommandLintHook } from "./hook";
import { registerShupervisorSettings } from "./commands/settings";

export default async function (pi: ExtensionAPI) {
  await configLoader.load();
  const config = configLoader.getConfig();

  if (!config.enabled) return;

  setupCommandLintHook(pi, config);
  registerShupervisorSettings(pi);
}
```

---

## 9. Settings command — `src/commands/settings.ts`

Uses `registerSettingsCommand` from `@aliou/pi-utils-settings`.

Two sections:
1. **General** — `enabled` toggle
2. **Rules** — list of rules with enabled/disabled toggle per rule

Each rule is rendered as a settings item with:
- label: e.g. "prefer: grep → rg"
- description: the rule's reason
- values: ["enabled", "disabled"]

For now, adding/editing/removing rules requires editing the JSON config file directly. The settings UI only toggles existing rules on/off.

---

## 10. Add/edit rule command — `src/commands/add-rule.ts`

### Mechanism

`/shupervisor:add <natural language>` — a command the user types. It injects DSL docs, the config file path, and current contents into the conversation. The agent then uses the standard `read`/`edit`/`write` tools to modify the JSON file directly.

No custom tool needed.

### Flow

```
User types:  /shupervisor:add don't use cat to read files, use bat instead
     │
     ▼
Command handler:
  1. Asks user: save to "local" or "global"? (ctx.ui.select)
  2. Resolves the file path for that scope
  3. Reads current file contents (or notes it doesn't exist yet)
  4. Sends a user message (via pi.sendUserMessage) containing:
     - The config file path
     - The DSL schema documentation (rule types, fields, examples)
     - Current file contents (or empty template)
     - The user's natural language request
     - Instruction: edit/write the file, then tell the user what was done
     │
     ▼
Agent (LLM):
  - Sees the DSL docs, file path, current contents, and user intent
  - Formulates the correct Rule JSON
  - Uses write/edit to update the config file
  - Reports what it did
```

### Command registration

```typescript
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";

// Resolve config file paths (mirrors ConfigLoader internals)
function getConfigPath(scope: "local" | "global"): string | null {
  if (scope === "global") {
    return resolve(getAgentDir(), "extensions/shupervisor.json");
  }
  // Walk up from cwd to find .pi directory
  let dir = process.cwd();
  while (true) {
    const piDir = resolve(dir, ".pi");
    if (existsSync(piDir)) {
      return resolve(piDir, "extensions/shupervisor.json");
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

pi.registerCommand("shupervisor:add", {
  description: "Add or edit a shupervisor rule (natural language)",
  handler: async (args, ctx) => {
    if (!args?.trim()) {
      ctx.ui.notify("Usage: /shupervisor:add <describe the rule>", "warning");
      return;
    }

    // Ask which scope
    const scope = await ctx.ui.select(
      "Save rule to:",
      ["local (.pi/extensions/shupervisor.json)", "global (~/.pi/agent/extensions/shupervisor.json)"]
    );
    if (!scope) return;
    const targetScope: "local" | "global" = scope.startsWith("local") ? "local" : "global";

    const filePath = getConfigPath(targetScope);
    if (!filePath) {
      ctx.ui.notify("Could not resolve config path (no .pi directory found)", "error");
      return;
    }

    // Read current file contents
    let currentContents = "";
    try {
      currentContents = await readFile(filePath, "utf-8");
    } catch {
      currentContents = ""; // file doesn't exist yet
    }

    const prompt = buildRulePrompt(args, filePath, currentContents);
    pi.sendUserMessage(prompt);
  },
});
```

### Prompt builder

```typescript
function buildRulePrompt(
  userRequest: string,
  filePath: string,
  currentContents: string,
): string {
  const fileStatus = currentContents
    ? `Current contents of \`${filePath}\`:\n\`\`\`json\n${currentContents}\`\`\``
    : `The file \`${filePath}\` does not exist yet. Create it with this template:\n\`\`\`json\n{\n  "rules": []\n}\n\`\`\``;

  return `Add or edit a shupervisor rule based on this request:

> ${userRequest}

## Config file
${fileStatus}

## Rule DSL Reference

The config file is JSON with a top-level \`rules\` array. Each rule is an object with a \`type\` discriminator:

### 1. \`prefer\` — Use tool X instead of tool Y
\`\`\`json
{
  "type": "prefer",
  "instead_of": "grep",     // command name to block
  "use": "rg",              // preferred command to suggest
  "reason": "Use rg instead of grep — faster, respects .gitignore",
  "enabled": true            // optional, default true
}
\`\`\`
Matches when the command name (first word) equals \`instead_of\`.

### 2. \`forbid-flag\` — Block specific flags on a command
\`\`\`json
{
  "type": "forbid-flag",
  "command": "rg",           // command name
  "flags": ["-rn"],          // exact flag strings to block
  "reason": "rg -rn means --replace n, not recursive + line numbers",
  "enabled": true
}
\`\`\`
Matches when command name equals \`command\` AND any argument matches a flag in \`flags\`.

### 3. \`forbid-pattern\` — Block a command + subcommand + flag combination
\`\`\`json
{
  "type": "forbid-pattern",
  "command": "yadm",         // command name
  "subcommand": "add",       // optional subcommand (second word)
  "flags": ["-u", "-A"],     // flags to block
  "reason": "Never yadm add -u/-A, stage files explicitly",
  "enabled": true
}
\`\`\`
Matches when command + subcommand + any forbidden flag all present.

To disable a built-in default rule, add it with \`"enabled": false\`.

## Instructions
- Edit or create \`${filePath}\` with the appropriate rule added/modified in the \`rules\` array.
- Preserve any existing rules in the file.
- Use the \`write\` or \`edit\` tool to make the change.
- Tell me what you did.`;
}
```

### Why this approach?

- **No custom tool** — the agent already has `read`/`edit`/`write`
- **DSL docs injected on demand** — not wasting system prompt context permanently
- **Scope selection via UI** — the command handles this before the agent sees anything
- **Agent sees the actual file** — can make intelligent edits (add to existing array, avoid duplicates, fix formatting)
- **Agent can handle edge cases** — e.g. "change the reason on the grep rule" — it reads the file, finds the rule, edits the reason field. A custom tool would need explicit update-by-key logic.

### Hot reload consideration

After the agent writes the file, the rules won't take effect until the config is reloaded. Options:

1. **Tell the user to `/reload`** — simplest, included in the agent's response naturally
2. **`configLoader.load()` in a `tool_result` handler** — watch for writes to `shupervisor.json` and auto-reload. More complex but seamless.
3. **The hook reads from `configLoader.getConfig()` per invocation + auto-reload on file change** — best UX

For v1: option 1 (tell user to `/reload`). The prompt can include this instruction.

The `tool_call` hook should still read rules from `configLoader.getConfig()` per invocation (not capture at init) so that `/reload` works correctly:

```typescript
// In hook.ts — use a getter, not a captured value
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  const rules = configLoader.getConfig().rules.filter(r => r.enabled !== false);
  // ... rest of matching logic
});
```

---

## 11. README.md

Should cover:
- What it does (one paragraph)
- Installation (`pi install git:github.com/indigoviolet/pi-shupervisor`)
- Default rules (table)
- Config file locations and schema
- Rule types with examples
- How to add project-specific rules
- How to disable a default rule
- How wrapper unwrapping works (brief)
- `/shupervisor:settings` command

---

## Edge cases to handle

1. **Empty command**: `words.length === 0` → skip
2. **Command in variable**: `$CMD arg` → `words[0]` will be `$CMD`, won't match any rule → safe miss
3. **Aliased commands**: `alias g=grep; g pattern` → parser sees `g`, not `grep` → safe miss (can't resolve aliases)
4. **grep as argument to non-wrapper**: `man grep` → `words[0]` is `man`, `words[1]` is `grep` → prefer rule only checks `words[0]` → correct non-match
5. **grep in quoted string**: `echo "use grep"` → parser puts `use grep` in a DblQuoted WordPart, not in `words[0]` → correct non-match
6. **Parse failure**: falls back to regex, which may false-positive on quoted strings → acceptable trade-off (brief block is better than letting bad commands through)

---

## 11. Tests

Use vitest. Add to package.json:

```json
{
  "devDependencies": {
    "vitest": "^3.0.0"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### File structure

```
src/
├── rules.test.ts          # Rule matching logic
├── unwrap.test.ts         # Wrapper unwrapping
├── hook.test.ts           # Full pipeline: parse → unwrap → match
└── config.test.ts         # Rule merging, defaults
```

### `src/rules.test.ts` — Rule matching

Tests `matchRule()` and `checkCommand()` directly with pre-built word arrays (no parsing).

```typescript
describe("matchRule", () => {

  describe("prefer rules", () => {
    const grepRule: PreferRule = {
      type: "prefer", instead_of: "grep", use: "rg",
      reason: "Use rg instead of grep",
    };

    it("matches when command is the blocked tool", () => {
      expect(matchRule(["grep", "-rn", "pattern", "src/"], grepRule)).toBe(grepRule.reason);
    });

    it("does not match a different command", () => {
      expect(matchRule(["rg", "-n", "pattern"], grepRule)).toBeUndefined();
    });

    it("does not match when blocked tool appears as argument", () => {
      expect(matchRule(["man", "grep"], grepRule)).toBeUndefined();
    });

    it("does not match empty words", () => {
      expect(matchRule([], grepRule)).toBeUndefined();
    });

    it("respects enabled: false", () => {
      expect(matchRule(["grep", "pattern"], { ...grepRule, enabled: false })).toBeUndefined();
    });
  });

  describe("forbid-flag rules", () => {
    const rnRule: ForbidFlagRule = {
      type: "forbid-flag", command: "rg", flags: ["-rn"],
      reason: "-rn means --replace n",
    };

    it("matches when command + forbidden flag present", () => {
      expect(matchRule(["rg", "-rn", "pattern", "src/"], rnRule)).toBe(rnRule.reason);
    });

    it("does not match when flag is absent", () => {
      expect(matchRule(["rg", "-n", "pattern"], rnRule)).toBeUndefined();
    });

    it("does not match when command is different", () => {
      expect(matchRule(["grep", "-rn", "pattern"], rnRule)).toBeUndefined();
    });

    it("does not match when flag appears as non-flag argument", () => {
      // rg searching for the literal string "-rn" — still matches because
      // we do simple string equality on words. This is a known trade-off;
      // the AST parser doesn't distinguish flag vs positional.
      // Documenting that this IS a match (minor false positive, acceptable).
      expect(matchRule(["rg", "-rn"], rnRule)).toBe(rnRule.reason);
    });
  });

  describe("forbid-pattern rules", () => {
    const yadmRule: ForbidPatternRule = {
      type: "forbid-pattern", command: "yadm", subcommand: "add",
      flags: ["-u", "-A"],
      reason: "Stage files explicitly",
    };

    it("matches command + subcommand + flag", () => {
      expect(matchRule(["yadm", "add", "-u"], yadmRule)).toBe(yadmRule.reason);
    });

    it("matches with -A flag", () => {
      expect(matchRule(["yadm", "add", "-A"], yadmRule)).toBe(yadmRule.reason);
    });

    it("does not match without subcommand", () => {
      expect(matchRule(["yadm", "status"], yadmRule)).toBeUndefined();
    });

    it("does not match without forbidden flag", () => {
      expect(matchRule(["yadm", "add", "file.txt"], yadmRule)).toBeUndefined();
    });

    it("does not match different command", () => {
      expect(matchRule(["git", "add", "-u"], yadmRule)).toBeUndefined();
    });

    it("works without subcommand in rule", () => {
      const noSub: ForbidPatternRule = {
        type: "forbid-pattern", command: "docker", flags: ["--privileged"],
        reason: "No privileged containers",
      };
      expect(matchRule(["docker", "run", "--privileged", "img"], noSub)).toBe(noSub.reason);
    });
  });
});

describe("checkCommand", () => {
  const rules: Rule[] = [DEFAULT_RULES...]; // use the actual defaults

  it("returns first matching rule's reason", () => {
    expect(checkCommand(["grep", "pattern"], rules)).toContain("rg");
  });

  it("returns undefined when no rule matches", () => {
    expect(checkCommand(["echo", "hello"], rules)).toBeUndefined();
  });

  it("skips disabled rules", () => {
    const withDisabled = rules.map(r =>
      r.type === "prefer" && r.instead_of === "grep"
        ? { ...r, enabled: false }
        : r
    );
    expect(checkCommand(["grep", "pattern"], withDisabled)).toBeUndefined();
  });
});
```

### `src/unwrap.test.ts` — Wrapper unwrapping

Tests `unwrapCommand()` with pre-built word arrays.

```typescript
describe("unwrapCommand", () => {

  describe("non-wrapper commands", () => {
    it("returns original words only", () => {
      expect(unwrapCommand(["echo", "hello"])).toEqual([["echo", "hello"]]);
    });

    it("handles empty input", () => {
      expect(unwrapCommand([])).toEqual([]);
    });
  });

  describe("args-after-flags wrappers", () => {
    it("xargs: extracts sub-command after flags", () => {
      const result = unwrapCommand(["xargs", "grep", "pattern"]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });

    it("xargs -0: skips flags", () => {
      const result = unwrapCommand(["xargs", "-0", "grep", "pattern"]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });

    it("sudo: extracts sub-command", () => {
      const result = unwrapCommand(["sudo", "find", ".", "-name", "*.ts"]);
      expect(result).toContainEqual(["find", ".", "-name", "*.ts"]);
    });

    it("sudo with flags: skips -u etc", () => {
      const result = unwrapCommand(["sudo", "-u", "root", "find", "."]);
      // -u takes an argument, but our simple "skip flags" approach
      // treats "root" as the sub-command. This is a known limitation.
      // Document: sudo -u <user> is imprecise; the important case
      // (plain sudo cmd) works.
    });

    it("nice: extracts sub-command", () => {
      const result = unwrapCommand(["nice", "-n", "10", "grep", "pattern"]);
      // -n is a flag, 10 looks like a non-flag... this depends on implementation.
      // If "skip flags" stops at first non-flag, "10" becomes the sub-command.
      // This is a known edge case. nice is rare enough that it's acceptable.
    });

    it("nohup: extracts sub-command", () => {
      const result = unwrapCommand(["nohup", "find", ".", "-name", "*.log"]);
      expect(result).toContainEqual(["find", ".", "-name", "*.log"]);
    });
  });

  describe("skip-n wrappers", () => {
    it("timeout: skips duration, extracts command", () => {
      const result = unwrapCommand(["timeout", "30", "grep", "pattern"]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });

    it("timeout with flags: skips flags + duration", () => {
      const result = unwrapCommand(["timeout", "--signal=KILL", "30", "grep", "pattern"]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });
  });

  describe("args-after-assigns wrappers", () => {
    it("env: skips assignments, extracts command", () => {
      const result = unwrapCommand(["env", "LANG=C", "grep", "pattern"]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });

    it("env with flags: skips -i and assignments", () => {
      const result = unwrapCommand(["env", "-i", "FOO=bar", "grep", "pattern"]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });
  });

  describe("dash-c wrappers", () => {
    it("bash -c: re-parses shell string", () => {
      const result = unwrapCommand(["bash", "-c", "grep -rn pattern src/"]);
      expect(result).toContainEqual(["grep", "-rn", "pattern", "src/"]);
    });

    it("sh -c: re-parses shell string", () => {
      const result = unwrapCommand(["sh", "-c", "find . -name '*.ts'"]);
      expect(result).toContainEqual(["find", ".", "-name", "*.ts"]);
    });

    it("bash -c with pipeline: extracts all commands", () => {
      const result = unwrapCommand(["bash", "-c", "grep pattern | sort"]);
      expect(result).toContainEqual(["grep", "pattern"]);
      expect(result).toContainEqual(["sort"]);
    });

    it("bash without -c: no unwrapping", () => {
      const result = unwrapCommand(["bash", "script.sh"]);
      expect(result).toEqual([["bash", "script.sh"]]);
    });
  });

  describe("first-arg-is-shell wrappers", () => {
    it("watch: re-parses first arg as shell", () => {
      const result = unwrapCommand(["watch", "grep -c error /var/log/syslog"]);
      expect(result).toContainEqual(["grep", "-c", "error", "/var/log/syslog"]);
    });

    it("watch with flags: skips flags, re-parses first non-flag arg", () => {
      const result = unwrapCommand(["watch", "-n", "5", "grep error log"]);
      // -n is a flag, 5 is its value (non-flag but numeric)...
      // Simple implementation: first non-flag = "5" which won't parse usefully.
      // Better: skip known watch flags (-n takes an arg, -d, -t, etc.)
      // For v1: accept this limitation, document it.
    });
  });

  describe("nested wrappers", () => {
    it("sudo xargs grep: recursively unwraps", () => {
      const result = unwrapCommand(["sudo", "xargs", "grep", "pattern"]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });

    it("nice timeout grep: recursively unwraps", () => {
      const result = unwrapCommand(["nice", "timeout", "10", "grep", "pattern"]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });
  });

  describe("non-wrapper with tool name as argument", () => {
    it("man grep: does NOT unwrap", () => {
      const result = unwrapCommand(["man", "grep"]);
      expect(result).toEqual([["man", "grep"]]);
    });

    it("echo grep: does NOT unwrap", () => {
      const result = unwrapCommand(["echo", "grep"]);
      expect(result).toEqual([["echo", "grep"]]);
    });
  });
});
```

### `src/hook.test.ts` — Full pipeline integration

Tests the complete flow: shell string → parse → walk → unwrap → match.
This is the main integration test. Uses a helper that replicates the hook logic
but returns the violation reason instead of calling pi APIs.

```typescript
/**
 * Simulate the hook: given a shell string and rules, return the block reason or undefined.
 */
function lint(command: string, rules: Rule[]): string | undefined;
```

```typescript
describe("lint (full pipeline)", () => {

  const rules = DEFAULT_RULES;

  describe("prefer rules — should block", () => {
    it.each([
      ["grep direct",             "grep -rn pattern src/"],
      ["grep in pipeline",        "echo hello | grep pattern"],
      ["grep after &&",           "cd src && grep -rn TODO ."],
      ["grep in subshell",        "(cd /tmp && grep pattern file)"],
      ["find direct",             "find . -name '*.ts' -type f"],
      ["find piped",              "find . -name '*.log' | xargs rm"],
      ["find in process subst",   "diff <(find . -name a) <(find . -name b)"],
    ])("%s: %s", (_label, cmd) => {
      expect(lint(cmd, rules)).toBeDefined();
    });
  });

  describe("prefer rules — should NOT block (false positive resistance)", () => {
    it.each([
      ["grep in double quotes",   'echo "use grep to search"'],
      ["grep in single quotes",   "echo 'grep is slow'"],
      ["grep in commit message",  'git commit -m "replaced grep with rg"'],
      ["find in echo",            'echo "use find to locate"'],
      ["rg (correct tool)",       "rg -n pattern src/"],
      ["fd (correct tool)",       "fd -e ts"],
      ["grep as man argument",    "man grep"],
    ])("%s: %s", (_label, cmd) => {
      expect(lint(cmd, rules)).toBeUndefined();
    });
  });

  describe("forbid-flag rules", () => {
    it("blocks rg -rn", () => {
      expect(lint("rg -rn pattern src/", rules)).toBeDefined();
    });

    it("allows rg -n", () => {
      expect(lint("rg -n pattern src/", rules)).toBeUndefined();
    });

    it("allows rg --replace", () => {
      expect(lint("rg --replace foo pattern src/", rules)).toBeUndefined();
    });
  });

  describe("forbid-pattern rules", () => {
    it("blocks yadm add -u", () => {
      expect(lint("yadm add -u", rules)).toBeDefined();
    });

    it("blocks yadm add -A", () => {
      expect(lint("yadm add -A", rules)).toBeDefined();
    });

    it("allows yadm add with explicit files", () => {
      expect(lint("yadm add file1.txt file2.txt", rules)).toBeUndefined();
    });

    it("allows yadm status", () => {
      expect(lint("yadm status", rules)).toBeUndefined();
    });
  });

  describe("wrapper unwrapping", () => {
    it.each([
      ["xargs grep",             "cat files | xargs grep pattern"],
      ["xargs -0 grep",          "find . -print0 | xargs -0 grep pattern"],
      ["sudo find",              "sudo find /var -name '*.conf'"],
      ["nohup find",             "nohup find . -name '*.log' &"],
      ["timeout grep",           "timeout 30 grep -rn pattern src/"],
      ["env grep",               "env LANG=C grep -rn pattern src/"],
      ["bash -c grep",           "bash -c 'grep -rn pattern src/'"],
      ["sh -c find",             "sh -c 'find . -name *.ts'"],
      ["watch grep",             "watch 'grep -c error /var/log/syslog'"],
      ["sudo xargs grep",        "echo foo | sudo xargs grep bar"],
      ["nice timeout grep",      "nice timeout 10 grep pattern file"],
    ])("%s: %s", (_label, cmd) => {
      expect(lint(cmd, rules)).toBeDefined();
    });
  });

  describe("wrapper with clean commands — should NOT block", () => {
    it.each([
      ["xargs rg",    "cat files | xargs rg pattern"],
      ["sudo fd",     "sudo fd -e conf /etc"],
      ["bash -c rg",  "bash -c 'rg -n pattern src/'"],
      ["watch rg",    "watch 'rg -c error log'"],
    ])("%s: %s", (_label, cmd) => {
      expect(lint(cmd, rules)).toBeUndefined();
    });
  });

  describe("complex real-world commands", () => {
    it("pipeline with unwrap violation", () => {
      expect(lint("fd -e ts | xargs grep TODO | sort -u", rules)).toBeDefined();
    });

    it("pipeline all clean", () => {
      expect(lint("fd -e ts | xargs rg TODO | sort -u", rules)).toBeUndefined();
    });

    it("multiline with backslash", () => {
      expect(lint("grep pattern \\\n  src/", rules)).toBeDefined();
    });

    it("heredoc body is not matched", () => {
      // grep inside heredoc is text, not a command
      expect(lint("cat <<EOF\ngrep is great\nEOF", rules)).toBeUndefined();
    });

    it("for loop with violation", () => {
      expect(lint("for f in *.ts; do grep pattern $f; done", rules)).toBeDefined();
    });

    it("if statement with violation", () => {
      expect(lint("if grep -q pattern file; then echo found; fi", rules)).toBeDefined();
    });

    it("clean for loop", () => {
      expect(lint("for f in *.ts; do rg pattern $f; done", rules)).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("empty command", () => {
      expect(lint("", rules)).toBeUndefined();
    });

    it("comment only", () => {
      expect(lint("# grep pattern", rules)).toBeUndefined();
    });

    it("variable as command name", () => {
      expect(lint("$CMD pattern", rules)).toBeUndefined();
    });
  });
});
```

### `src/config.test.ts` — Rule merging

```typescript
describe("mergeRules", () => {
  it("returns defaults when no overrides", () => {
    const result = mergeRules(DEFAULT_RULES, []);
    expect(result).toEqual(DEFAULT_RULES);
  });

  it("overrides a default rule by key", () => {
    const override: PreferRule = {
      type: "prefer", instead_of: "grep", use: "ag",
      reason: "Use ag in this project",
    };
    const result = mergeRules(DEFAULT_RULES, [override]);
    const grepRule = result.find(r => r.type === "prefer" && r.instead_of === "grep");
    expect(grepRule?.reason).toBe("Use ag in this project");
  });

  it("disables a default rule via enabled: false", () => {
    const disable: PreferRule = {
      type: "prefer", instead_of: "grep", use: "rg",
      reason: "", enabled: false,
    };
    const result = mergeRules(DEFAULT_RULES, [disable]);
    const grepRule = result.find(r => r.type === "prefer" && r.instead_of === "grep");
    expect(grepRule?.enabled).toBe(false);
  });

  it("appends new user rules", () => {
    const custom: PreferRule = {
      type: "prefer", instead_of: "npm", use: "pnpm",
      reason: "Use pnpm",
    };
    const result = mergeRules(DEFAULT_RULES, [custom]);
    expect(result.length).toBe(DEFAULT_RULES.length + 1);
    expect(result.find(r => r.type === "prefer" && r.instead_of === "npm")).toBeDefined();
  });

  it("does not duplicate when override matches existing", () => {
    const override: PreferRule = {
      type: "prefer", instead_of: "grep", use: "rg",
      reason: "Custom reason",
    };
    const result = mergeRules(DEFAULT_RULES, [override]);
    const grepRules = result.filter(r => r.type === "prefer" && r.instead_of === "grep");
    expect(grepRules.length).toBe(1);
  });
});

describe("ruleKey", () => {
  it("prefer rules key on instead_of", () => {
    expect(ruleKey({ type: "prefer", instead_of: "grep", use: "rg", reason: "" }))
      .toBe("prefer:grep");
  });

  it("forbid-flag rules key on command + sorted flags", () => {
    expect(ruleKey({ type: "forbid-flag", command: "rg", flags: ["-rn", "-r"], reason: "" }))
      .toBe("forbid-flag:rg:-r,-rn");
  });

  it("forbid-pattern rules key on command + subcommand + sorted flags", () => {
    expect(ruleKey({
      type: "forbid-pattern", command: "yadm", subcommand: "add",
      flags: ["-A", "-u"], reason: "",
    })).toBe("forbid-pattern:yadm:add:-A,-u");
  });
});
```

### `src/fallback.test.ts` — Regex fallback matching

Tests `checkCommandFallback()` which is used when `@aliou/sh` parse fails.

```typescript
describe("checkCommandFallback", () => {
  const rules = DEFAULT_RULES;

  it("catches grep via word boundary", () => {
    expect(checkCommandFallback("grep -rn pattern", rules)).toBeDefined();
  });

  it("catches find via word boundary", () => {
    expect(checkCommandFallback("find . -name '*.ts'", rules)).toBeDefined();
  });

  it("does not match grep inside a word", () => {
    // "autogrep" should not match
    expect(checkCommandFallback("autogrep pattern", rules)).toBeUndefined();
  });

  it("catches yadm add -u", () => {
    expect(checkCommandFallback("yadm add -u", rules)).toBeDefined();
  });

  it("does not catch yadm add file.txt", () => {
    expect(checkCommandFallback("yadm add file.txt", rules)).toBeUndefined();
  });

  // Known limitation: false positive on quoted strings in fallback mode
  it("false-positives on grep in quotes (known limitation)", () => {
    // This WILL match in fallback mode — regex can't distinguish quoted context
    expect(checkCommandFallback('echo "use grep"', rules)).toBeDefined();
  });
});
```

### vitest config

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```
