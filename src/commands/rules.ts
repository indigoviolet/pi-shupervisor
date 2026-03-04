/**
 * /shupervisor:rules — list configured rules by scope.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { configLoader, ruleKey } from "../config.js";
import type { Rule } from "../rules.js";

function formatRule(rule: Rule): string {
  const status = rule.enabled === false ? "  (disabled)" : "";
  switch (rule.type) {
    case "prefer":
      return `  prefer: ${rule.instead_of} → ${rule.use}${status}\n    ${rule.reason}`;
    case "forbid-flag":
      return `  forbid-flag: ${rule.command} ${rule.flags.join(", ")}${status}\n    ${rule.reason}`;
    case "forbid-pattern": {
      const sub = rule.subcommand ? ` ${rule.subcommand}` : "";
      const flags = rule.flags.length > 0 ? ` ${rule.flags.join(", ")}` : "";
      return `  forbid-pattern: ${rule.command}${sub}${flags}${status}\n    ${rule.reason}`;
    }
    case "forbid-arg-pattern":
      return `  forbid-arg-pattern: ${rule.command} /${rule.pattern}/${status}\n    ${rule.reason}`;
  }
}

export function registerRulesCommand(pi: ExtensionAPI): void {
  pi.registerCommand("shupervisor:rules", {
    description: "List configured shupervisor rules",
    handler: async (_args, ctx) => {
      const globalConfig = configLoader.getRawConfig("global");
      const localConfig = configLoader.getRawConfig("local");
      const globalRules = globalConfig?.rules ?? [];
      const localRules = localConfig?.rules ?? [];

      // Track which global rules are overridden by local
      const localKeys = new Set(localRules.map(ruleKey));

      const lines: string[] = [];

      if (globalRules.length === 0 && localRules.length === 0) {
        lines.push("No rules configured.");
        lines.push("");
        lines.push("Add rules to:");
        lines.push("  Global: ~/.pi/agent/extensions/shupervisor.json");
        lines.push("  Project: .pi/extensions/shupervisor.json");
      } else {
        if (globalRules.length > 0) {
          lines.push("Global (~/.pi/agent/extensions/shupervisor.json):");
          for (const rule of globalRules) {
            const overridden = localKeys.has(ruleKey(rule)) ? "  [overridden by local]" : "";
            lines.push(formatRule(rule) + overridden);
          }
        }

        if (localRules.length > 0) {
          if (globalRules.length > 0) lines.push("");
          lines.push("Project (.pi/extensions/shupervisor.json):");
          for (const rule of localRules) {
            lines.push(formatRule(rule));
          }
        }
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
