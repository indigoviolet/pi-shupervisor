/**
 * /shupervisor:add command — add or edit a rule from natural language.
 *
 * Injects DSL docs + current config file contents into the conversation.
 * The agent then uses standard read/edit/write tools to modify the JSON file.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

// ---------- Config path resolution ----------

function getConfigPath(scope: "local" | "global"): string | null {
  if (scope === "global") {
    return resolve(homedir(), ".pi/agent/extensions/shupervisor.json");
  }

  // Walk up from cwd to find .pi directory
  let dir = process.cwd();
  const home = homedir();
  while (true) {
    const piDir = resolve(dir, ".pi");
    if (existsSync(piDir)) {
      return resolve(piDir, "extensions/shupervisor.json");
    }
    if (dir === home) break;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ---------- Prompt builder ----------

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

### 4. \`forbid-arg-pattern\` — Block arguments matching a regex
\`\`\`json
{
  "type": "forbid-arg-pattern",
  "command": "rg",           // command name
  "pattern": "\\\\\\\\\\\\|",  // regex pattern tested against each argument
  "reason": "rg uses Rust regex — use foo|bar not foo\\\\|bar",
  "enabled": true
}
\`\`\`
Matches when command name equals \`command\` AND any argument (after command name) matches \`pattern\` as a regex.

To disable a rule defined in a higher scope (e.g. global), add it with \`"enabled": false\`.

## Instructions
- Edit or create \`${filePath}\` with the appropriate rule added/modified in the \`rules\` array.
- Preserve any existing rules in the file.
- Use the \`write\` or \`edit\` tool to make the change.
- Tell me what you did.
- Remind the user to run \`/reload\` for changes to take effect.`;
}

// ---------- Command registration ----------

export function registerAddRuleCommand(pi: ExtensionAPI): void {
  pi.registerCommand("shupervisor:add", {
    description: "Add or edit a shupervisor rule (natural language)",
    handler: async (args, ctx) => {
      if (!args?.trim()) {
        ctx.ui.notify(
          "Usage: /shupervisor:add <describe the rule>",
          "warning",
        );
        return;
      }

      // Ask which scope
      const scope = await ctx.ui.select("Save rule to:", [
        "local (.pi/extensions/shupervisor.json)",
        "global (~/.pi/agent/extensions/shupervisor.json)",
      ]);
      if (!scope) return;
      const targetScope: "local" | "global" = scope.startsWith("local")
        ? "local"
        : "global";

      const filePath = getConfigPath(targetScope);
      if (!filePath) {
        ctx.ui.notify(
          "Could not resolve config path (no .pi directory found)",
          "error",
        );
        return;
      }

      // Read current file contents
      let currentContents = "";
      try {
        currentContents = await readFile(filePath, "utf-8");
      } catch {
        currentContents = "";
      }

      const prompt = buildRulePrompt(args, filePath, currentContents);
      pi.sendUserMessage(prompt);
    },
  });
}
