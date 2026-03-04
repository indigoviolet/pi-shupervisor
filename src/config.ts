/**
 * Configuration — rule types, ConfigLoader, rule merging.
 */

import { ConfigLoader } from "@aliou/pi-utils-settings";
import type { Rule } from "./rules.js";

// ---------- Config types ----------

export interface ShupervisorConfig {
  enabled?: boolean;
  rules?: Rule[];
}

export interface ResolvedConfig {
  enabled: boolean;
  rules: Rule[];
}

// ---------- Rule key (for override/disable between scopes) ----------

export function ruleKey(rule: Rule): string {
  switch (rule.type) {
    case "prefer":
      return `prefer:${rule.instead_of}`;
    case "forbid-flag":
      return `forbid-flag:${rule.command}:${[...rule.flags].sort().join(",")}`;
    case "forbid-pattern":
      return `forbid-pattern:${rule.command}:${rule.subcommand ?? ""}:${[...rule.flags].sort().join(",")}`;
    case "forbid-arg-pattern":
      return `forbid-arg-pattern:${rule.command}:${rule.pattern}`;
  }
}

// ---------- Rule merging ----------

/**
 * Merge two rule lists. Later list wins by ruleKey (override/disable).
 * New rules are appended.
 */
export function mergeRules(base: Rule[], overrides: Rule[]): Rule[] {
  const overrideMap = new Map<string, Rule>();
  for (const r of overrides) {
    overrideMap.set(ruleKey(r), r);
  }

  const result: Rule[] = [];
  const usedKeys = new Set<string>();

  for (const rule of base) {
    const key = ruleKey(rule);
    const override = overrideMap.get(key);
    if (override) {
      result.push(override);
      usedKeys.add(key);
    } else {
      result.push(rule);
    }
  }

  for (const [key, rule] of overrideMap) {
    if (!usedKeys.has(key)) {
      result.push(rule);
    }
  }

  return result;
}

// ---------- ConfigLoader ----------

export const configLoader = new ConfigLoader<
  ShupervisorConfig,
  ResolvedConfig
>(
  "shupervisor",
  { enabled: true, rules: [] },
  {
    scopes: ["global", "local"],
    afterMerge: (_resolved, global, local) => {
      // ConfigLoader deep merge replaces arrays, so we merge rules ourselves:
      // global rules + local rules (local overrides global by ruleKey)
      return {
        enabled: local?.enabled ?? global?.enabled ?? true,
        rules: mergeRules(global?.rules ?? [], local?.rules ?? []),
      };
    },
  },
);
