/**
 * Configuration — rule DSL types, defaults, ConfigLoader setup, rule merging.
 */

import { ConfigLoader } from "@aliou/pi-utils-settings";
import type { Rule } from "./rules.js";

// ---------- User-facing config (all optional) ----------

export interface ShupervisorConfig {
  enabled?: boolean;
  rules?: Rule[];
}

// ---------- Resolved config (all required) ----------

export interface ResolvedConfig {
  enabled: boolean;
  rules: Rule[];
}

// ---------- Default rules (empty — configure via global/project config files) ----------

export const DEFAULT_RULES: Rule[] = [];

// ---------- Rule key for merge/override ----------

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
 * Merge default rules with user rules.
 * User rules with the same ruleKey override the default.
 * User rules with new keys are appended.
 * A user rule with enabled: false disables a default rule.
 */
export function mergeRules(defaults: Rule[], overrides: Rule[]): Rule[] {
  const overrideMap = new Map<string, Rule>();
  for (const r of overrides) {
    overrideMap.set(ruleKey(r), r);
  }

  // Start with defaults, applying overrides where keys match
  const result: Rule[] = [];
  const usedKeys = new Set<string>();

  for (const def of defaults) {
    const key = ruleKey(def);
    const override = overrideMap.get(key);
    if (override) {
      result.push(override);
      usedKeys.add(key);
    } else {
      result.push(def);
    }
  }

  // Append user rules that don't match any default
  for (const [key, rule] of overrideMap) {
    if (!usedKeys.has(key)) {
      result.push(rule);
    }
  }

  return result;
}

// ---------- ConfigLoader ----------

const DEFAULT_CONFIG: ResolvedConfig = {
  enabled: true,
  rules: [],
};

export const configLoader = new ConfigLoader<
  ShupervisorConfig,
  ResolvedConfig
>("shupervisor", DEFAULT_CONFIG, {
  scopes: ["global", "local"],
  afterMerge: (resolved, global, local) => {
    // ConfigLoader's deep merge replaces arrays, so local rules clobber global.
    // We need to explicitly merge: defaults → global → local by ruleKey.
    const base = mergeRules(DEFAULT_RULES, global?.rules ?? []);
    resolved.rules = mergeRules(base, local?.rules ?? []);
    return resolved;
  },
});
