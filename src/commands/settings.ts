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
  }
}

export function registerShupervisorSettings(pi: ExtensionAPI): void {
  const options: SettingsCommandOptions<ShupervisorConfig, ReturnType<typeof configLoader.getConfig>> = {
    commandName: "shupervisor:settings",
    commandDescription: "Configure shupervisor rules and settings",
    title: "Shupervisor Settings",
    configStore: configLoader,
    buildSections: (tabConfig, resolved, ctx) => {
      const sections = [];

      // General section
      sections.push({
        label: "General",
        items: [
          {
            id: "enabled",
            label: "Enabled",
            description: "Enable or disable the shupervisor extension",
            values: ["enabled", "disabled"],
            currentValue: resolved.enabled ? "enabled" : "disabled",
          },
        ],
      });

      // Rules section
      const ruleItems = resolved.rules.map((rule) => {
        const key = ruleKey(rule);
        return {
          id: `rule:${key}`,
          label: ruleLabel(rule),
          description: rule.reason,
          values: ["enabled", "disabled"],
          currentValue: rule.enabled !== false ? "enabled" : "disabled",
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
