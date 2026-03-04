/**
 * /shupervisor:settings command — interactive settings UI.
 *
 * Two sections:
 * 1. General — enabled toggle
 * 2. Rules — list of rules with enabled/disabled toggle per rule
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  registerSettingsCommand,
  type SettingsCommandOptions,
} from "@aliou/pi-utils-settings";
import { configLoader, ruleKey, type ShupervisorConfig } from "../config.js";
import type { Rule } from "../rules.js";

function ruleLabel(rule: Rule): string {
  switch (rule.type) {
    case "prefer":
      return `prefer: ${rule.instead_of} → ${rule.use}`;
    case "forbid-flag":
      return `forbid-flag: ${rule.command} ${rule.flags.join(", ")}`;
    case "forbid-pattern": {
      const sub = rule.subcommand ? ` ${rule.subcommand}` : "";
      return `forbid-pattern: ${rule.command}${sub} ${rule.flags.join(", ")}`;
    }
    case "forbid-arg-pattern":
      return `forbid-arg-pattern: ${rule.command} /${rule.pattern}/`;
  }
}

export function registerShupervisorSettings(pi: ExtensionAPI): void {
  const options: SettingsCommandOptions<ShupervisorConfig, ReturnType<typeof configLoader.getConfig>> = {
    commandName: "shupervisor:settings",
    commandDescription: "Configure shupervisor rules and settings",
    title: "Shupervisor Settings",
    configStore: configLoader,
    buildSections: (tabConfig, resolved, _ctx) => {
      const sections = [];

      // Read from draft (tabConfig) when available, fall back to resolved
      const enabled = tabConfig?.enabled ?? resolved.enabled;

      // General section
      sections.push({
        label: "General",
        items: [
          {
            id: "enabled",
            label: "Enabled",
            description: "Enable or disable the shupervisor extension",
            values: ["enabled", "disabled"],
            currentValue: enabled ? "enabled" : "disabled",
          },
        ],
      });

      // Build a map of draft rule overrides for quick lookup
      const draftRuleMap = new Map<string, Rule>();
      if (tabConfig?.rules) {
        for (const r of tabConfig.rules) {
          draftRuleMap.set(ruleKey(r), r);
        }
      }

      // Rules section — use resolved rules as the list, but check draft for current values
      const ruleItems = resolved.rules.map((rule) => {
        const key = ruleKey(rule);
        const draftRule = draftRuleMap.get(key);
        const isEnabled = draftRule
          ? draftRule.enabled !== false
          : rule.enabled !== false;
        return {
          id: `rule:${key}`,
          label: ruleLabel(rule),
          description: rule.reason,
          values: ["enabled", "disabled"],
          currentValue: isEnabled ? "enabled" : "disabled",
        };
      });

      if (ruleItems.length > 0) {
        sections.push({
          label: "Rules",
          items: ruleItems,
        });
      }

      return sections;
    },
    onSettingChange: (id, newValue, config) => {
      const updated = structuredClone(config);

      if (id === "enabled") {
        updated.enabled = newValue === "enabled";
        return updated;
      }

      if (id.startsWith("rule:")) {
        const targetKey = id.slice(5); // strip "rule:"
        if (!updated.rules) updated.rules = [];

        // Find existing rule override or get from resolved config
        const resolved = configLoader.getConfig();
        const resolvedRule = resolved.rules.find((r) => ruleKey(r) === targetKey);
        if (!resolvedRule) return null;

        const existingIdx = updated.rules.findIndex(
          (r) => ruleKey(r) === targetKey,
        );

        const ruleOverride = structuredClone(resolvedRule);
        ruleOverride.enabled = newValue === "enabled";

        if (existingIdx >= 0) {
          updated.rules[existingIdx] = ruleOverride;
        } else {
          updated.rules.push(ruleOverride);
        }

        return updated;
      }

      return null;
    },
  };

  registerSettingsCommand(pi, options);
}
