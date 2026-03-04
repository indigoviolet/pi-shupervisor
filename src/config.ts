/**
 * Configuration — rule DSL types, defaults, ConfigLoader setup, rule merging.
 */

import { ConfigLoader } from "@aliou/pi-utils-settings";
import type { Rule } from "./rules.js";

// ---------- User-facing config (all optional) ----------

export interface ShupervisorConfig {
  enabled?: boolean;
  rules?: Rule[];
  replaceDefaults?: boolean;
}

// ---------- Resolved config (all required) ----------

export interface ResolvedConfig {
  enabled: boolean;
  rules: Rule[];
  useDefaults: boolean;
}

// ---------- Default rules ----------

export const DEFAULT_RULES: Rule[] = [
  {
    type: "prefer",
    instead_of: "grep",
    use: "rg",
    reason:
      "Use `rg` instead of `grep` — it's faster, respects .gitignore, and uses Rust regex syntax. Recursive search is the default.",
  },
  {
    type: "prefer",
    instead_of: "find",
    use: "fd",
    reason:
      "Use `fd` instead of `find` — simpler syntax, respects .gitignore, smart case by default.",
  },
  {
    type: "forbid-flag",
    command: "rg",
    flags: ["-rn"],
    reason:
      "`rg -rn` means `--replace n`, replacing every match with the letter 'n'. Recursive is the default in rg. Use `rg -n` for line numbers (also default in terminals).",
  },
  {
    type: "forbid-pattern",
    command: "yadm",
    subcommand: "add",
    flags: ["-u", "-A"],
    reason:
      "Never use `yadm add -u` or `yadm add -A` — the home directory has too many tracked files. Always stage files explicitly: `yadm add <file> ...`",
  },
];

// ---------- Rule key for merge/override ----------

export function ruleKey(rule: Rule): string {
  switch (rule.type) {
    case "prefer":
      return `prefer:${rule.instead_of}`;
    case "forbid-flag":
      return `forbid-flag:${rule.command}:${[...rule.flags].sort().join(",")}`;
    case "forbid-pattern":
      return `forbid-pattern:${rule.command}:${rule.subcommand ?? ""}:${[...rule.flags].sort().join(",")}`;
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
  useDefaults: true,
};

export const configLoader = new ConfigLoader<
  ShupervisorConfig,
  ResolvedConfig
>("shupervisor", DEFAULT_CONFIG, {
  scopes: ["global", "local", "memory"],
  afterMerge: (resolved, global, local, memory) => {
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
      resolved.rules = mergeRules(DEFAULT_RULES, resolved.rules);
    }

    return resolved;
  },
});
