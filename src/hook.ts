/**
 * tool_call hook — intercepts bash commands, checks against rules.
 *
 * Flow: parse → walkCommands → unwrap → checkCommand
 * Falls back to regex matching if AST parse fails.
 *
 * Override: agent must append `# shupervisor:allow:<token>` where token
 * is a HMAC of the command using a per-session secret. The token is
 * provided in the block reason so the agent must get blocked first.
 */

import { createHmac, randomBytes } from "node:crypto";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { parse } from "@aliou/sh";
import { configLoader } from "./config.js";
import { checkCommand, type Rule } from "./rules.js";
import { walkCommands, wordToString } from "./shell-utils.js";
import { unwrapCommand } from "./unwrap.js";

// ---------- Regex fallback ----------

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fallback matching when AST parse fails.
 * Uses word-boundary regex for prefer rules and string matching for flags.
 * Accepts false positives — a missed block is worse than a false block.
 */
export function checkCommandFallback(
  command: string,
  rules: Rule[],
): string | undefined {
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

      case "forbid-arg-pattern": {
        const cmdRe = new RegExp(`\\b${escapeRegex(rule.command)}\\b`);
        if (!cmdRe.test(command)) break;
        const re = new RegExp(rule.pattern);
        if (re.test(command)) return rule.reason;
        break;
      }

      case "require-context": {
        const cmdRe = new RegExp(`\\b${escapeRegex(rule.command)}\\b`);
        if (!cmdRe.test(command)) break;
        if (rule.subcommand && !command.includes(rule.subcommand)) break;
        if (rule.except?.some((e) => command.includes(e))) break;
        const allPresent = rule.requires.every((r) => command.includes(r));
        if (!allPresent) return rule.reason;
        break;
      }
    }
  }
  return undefined;
}

// ---------- Override tokens ----------

const TOKEN_LENGTH = 6;

/** Matches `# shupervisor:allow:<hex>` at the end of a command. */
const ALLOW_MARKER = /\s*#\s*shupervisor:allow:([0-9a-f]+)\s*$/;

/**
 * Per-session secret for HMAC tokens. Rotates on reload.
 * Exported for testing only.
 */
export let _secret = randomBytes(32);

/** Reset secret (called at extension init so /reload rotates it). */
export function _resetSecret(): void {
  _secret = randomBytes(32);
}

/** Compute override token for a command. */
export function computeToken(command: string): string {
  return createHmac("sha256", _secret)
    .update(command)
    .digest("hex")
    .slice(0, TOKEN_LENGTH);
}

/**
 * Check if a command has a valid override token.
 * Returns the command with the marker stripped if valid, or null if invalid/absent.
 */
export function checkAllowToken(command: string): string | null {
  const match = command.match(ALLOW_MARKER);
  if (!match) return null;

  const token = match[1]!;
  const stripped = command.slice(0, match.index!);
  const expected = computeToken(stripped);

  return token === expected ? stripped : null;
}

// ---------- AST-based lint ----------

/**
 * Lint a shell command string against rules.
 * Returns the block reason if a violation is found, undefined otherwise.
 * Returns undefined (allows) if the command has a valid override token.
 */
export function lint(
  command: string,
  rules: Rule[],
): string | undefined {
  // Check for valid override token
  if (checkAllowToken(command) !== null) return undefined;

  const activeRules = rules.filter((r) => r.enabled !== false);
  if (activeRules.length === 0) return undefined;

  // 1. Try AST-based matching
  try {
    const { ast } = parse(command);
    let violation: string | undefined;

    walkCommands(ast, (cmd) => {
      const words = (cmd.words ?? []).map(wordToString);
      if (words.length === 0) return;

      const allCommands = unwrapCommand(words);

      for (const cmdWords of allCommands) {
        const reason = checkCommand(cmdWords, activeRules, command);
        if (reason) {
          violation = reason;
          return true; // stop walking
        }
      }
    });

    return violation;
  } catch {
    // 2. Fallback: regex-based matching
    return checkCommandFallback(command, activeRules);
  }
}

/** Build override hint with the full ready-to-run command. */
function overrideHint(command: string): string {
  const bare = command.replace(ALLOW_MARKER, "");
  const token = computeToken(bare);
  return `\n\nTo override, run exactly:\n${bare} # shupervisor:allow:${token}`;
}

// ---------- Hook setup ----------

export function setupCommandLintHook(pi: ExtensionAPI): void {
  _resetSecret();

  pi.on("tool_call", async (event, ctx) => {
    const input = event.input as Record<string, unknown>;

    let commands: string[];

    if (event.toolName === "bash") {
      commands = [String(input.command ?? "")];
    } else if (
      event.toolName === "tmux" &&
      input.action === "run" &&
      Array.isArray(input.commands)
    ) {
      commands = input.commands.map(String);
    } else {
      return;
    }

    const config = configLoader.getConfig();

    for (const command of commands) {
      const violation = lint(command, config.rules);
      if (violation) {
        if (ctx.hasUI) {
          ctx.ui.notify("Command blocked by shupervisor", "warning");
        }
        return { block: true, reason: violation + overrideHint(command) };
      }
    }
  });
}
