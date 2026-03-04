/**
 * /shupervisor:rules — list active rules (what the hook actually checks).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { configLoader, ruleKey } from "../config.js";
import type { Rule } from "../rules.js";

function formatRule(rule: Rule): string {
  const status = rule.enabled === false ? " (disabled)" : "";
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

function ruleSource(
  rule: Rule,
  globalKeys: Set<string>,
  localKeys: Set<string>,
): string {
  const key = ruleKey(rule);
  const inGlobal = globalKeys.has(key);
  const inLocal = localKeys.has(key);
  if (inGlobal && inLocal) return " [local override]";
  if (inLocal) return " [local]";
  if (inGlobal) return " [global]";
  return "";
}

export function registerRulesCommand(pi: ExtensionAPI): void {
  pi.registerCommand("shupervisor:rules", {
    description: "List active shupervisor rules",
    handler: async (_args, ctx) => {
      const config = configLoader.getConfig();
      const globalRaw = configLoader.getRawConfig("global");
      const localRaw = configLoader.getRawConfig("local");

      const globalKeys = new Set((globalRaw?.rules ?? []).map(ruleKey));
      const localKeys = new Set((localRaw?.rules ?? []).map(ruleKey));

      const lines: string[] = [];

      const globalCount = globalRaw?.rules?.length ?? 0;
      const localCount = localRaw?.rules?.length ?? 0;
      const activeCount = config.rules.filter((r) => r.enabled !== false).length;

      lines.push(`global: ${globalCount}, local: ${localCount}, merged: ${config.rules.length} (${activeCount} active)`);
      lines.push("");

      if (config.rules.length === 0) {
        lines.push("No rules configured.");
        lines.push("");
        lines.push("Add rules to:");
        lines.push("  Global: ~/.pi/agent/extensions/shupervisor.json");
        lines.push("  Project: .pi/extensions/shupervisor.json");
      } else {
        for (const rule of config.rules) {
          const source = ruleSource(rule, globalKeys, localKeys);
          lines.push(formatRule(rule) + source);
        }
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
