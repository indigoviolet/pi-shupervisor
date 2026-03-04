/**
 * tool_call hook — intercepts bash commands, checks against rules.
 *
 * Flow: parse → walkCommands → unwrap → checkCommand
 * Falls back to regex matching if AST parse fails.
 */

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
    }
  }
  return undefined;
}

// ---------- AST-based lint ----------

/**
 * Lint a shell command string against rules.
 * Returns the block reason if a violation is found, undefined otherwise.
 */
export function lint(command: string, rules: Rule[]): string | undefined {
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
        const reason = checkCommand(cmdWords, activeRules);
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

// ---------- Hook setup ----------

export function setupCommandLintHook(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;

    const command = String(
      (event.input as Record<string, unknown>).command ?? "",
    );
    const config = configLoader.getConfig();
    const violation = lint(command, config.rules);

    if (violation) {
      if (ctx.hasUI) {
        ctx.ui.notify("Command blocked by shupervisor", "warning");
      }
      return { block: true, reason: violation };
    }
  });
}
