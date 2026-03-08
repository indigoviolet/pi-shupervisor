/**
 * Rule DSL — type definitions, matching logic, and validation.
 *
 * Five rule types:
 * - prefer: block command X, suggest command Y
 * - forbid-flag: block specific flags on a command
 * - forbid-pattern: block command + subcommand + flag combinations
 * - forbid-arg-pattern: block when any argument matches a regex
 * - require-context: block unless required strings are present
 */

/**
 * Rule: prefer command X over command Y.
 * Matches when words[0] === instead_of (the command name).
 */
export interface PreferRule {
  type: "prefer";
  instead_of: string;
  use: string;
  reason: string;
  enabled?: boolean;
}

/**
 * Rule: forbid specific flags on a command.
 * Matches when words[0] === command AND any word matches a forbidden flag.
 */
export interface ForbidFlagRule {
  type: "forbid-flag";
  command: string;
  flags: string[];
  reason: string;
  enabled?: boolean;
}

/**
 * Rule: forbid a command+subcommand+flag combination.
 * Matches when words[0] === command AND words[1] === subcommand (if set)
 * AND any word matches a forbidden flag.
 */
export interface ForbidPatternRule {
  type: "forbid-pattern";
  command: string;
  subcommand?: string;
  flags: string[];
  reason: string;
  enabled?: boolean;
}

/**
 * Rule: forbid arguments matching a regex pattern.
 * Matches when words[0] === command AND any argument (words[1:]) matches
 * the given regex pattern.
 *
 * Example: rg with grep-style escaped alternation (foo\|bar)
 */
export interface ForbidArgPatternRule {
  type: "forbid-arg-pattern";
  command: string;
  subcommand?: string;
  pattern: string; // regex pattern to test against arguments
  reason: string;
  enabled?: boolean;
}

/**
 * Rule: require certain strings in a command.
 * Matches (blocks) when words[0] === command AND words[1] === subcommand (if set)
 * AND NOT all `requires` strings appear in the full raw command.
 *
 * Example: git rebase must include GIT_EDITOR=true and GIT_SEQUENCE_EDITOR=:
 */
export interface RequireContextRule {
  type: "require-context";
  command: string;
  subcommand?: string;
  requires: string[];
  /** If any of these strings appear in the command, the rule is skipped. */
  except?: string[];
  reason: string;
  enabled?: boolean;
}

export type Rule =
  | PreferRule
  | ForbidFlagRule
  | ForbidPatternRule
  | ForbidArgPatternRule
  | RequireContextRule;

/**
 * Check a single command (as string[] words) against a single rule.
 * Returns the block reason if matched, undefined otherwise.
 *
 * @param rawCommand - the full raw command string, needed for require-context
 *   checks (env var assignments aren't in words).
 */
export function matchRule(
  words: string[],
  rule: Rule,
  rawCommand?: string,
): string | undefined {
  if (words.length === 0) return undefined;
  if (rule.enabled === false) return undefined;

  switch (rule.type) {
    case "prefer": {
      if (words[0] === rule.instead_of) return rule.reason;
      return undefined;
    }

    case "forbid-flag": {
      if (words[0] !== rule.command) return undefined;
      if (words.some((w) => rule.flags.includes(w))) return rule.reason;
      return undefined;
    }

    case "forbid-pattern": {
      if (words[0] !== rule.command) return undefined;
      if (rule.subcommand && words[1] !== rule.subcommand) return undefined;
      if (rule.flags.length === 0) return rule.reason;
      if (words.some((w) => rule.flags.includes(w))) return rule.reason;
      return undefined;
    }

    case "forbid-arg-pattern": {
      if (words[0] !== rule.command) return undefined;
      if (rule.subcommand && words[1] !== rule.subcommand) return undefined;
      const startIdx = rule.subcommand ? 2 : 1;
      const re = new RegExp(rule.pattern);
      if (words.slice(startIdx).some((w) => re.test(w))) return rule.reason;
      return undefined;
    }

    case "require-context": {
      if (words[0] !== rule.command) return undefined;
      if (rule.subcommand && words[1] !== rule.subcommand) return undefined;
      const text = rawCommand ?? words.join(" ");
      // Skip if any except string is present
      if (rule.except?.some((e) => text.includes(e))) return undefined;
      const allPresent = rule.requires.every((r) => text.includes(r));
      if (!allPresent) return rule.reason;
      return undefined;
    }
  }
}

/**
 * Check a single command against ALL rules.
 * Returns the first matching rule's reason, or undefined.
 */
export function checkCommand(
  words: string[],
  rules: Rule[],
  rawCommand?: string,
): string | undefined {
  for (const rule of rules) {
    const reason = matchRule(words, rule, rawCommand);
    if (reason) return reason;
  }
  return undefined;
}

// ---------- Validation ----------

/** Known fields per rule type. */
const KNOWN_FIELDS: Record<string, Set<string>> = {
  prefer: new Set(["type", "instead_of", "use", "reason", "enabled"]),
  "forbid-flag": new Set(["type", "command", "flags", "reason", "enabled"]),
  "forbid-pattern": new Set([
    "type",
    "command",
    "subcommand",
    "flags",
    "reason",
    "enabled",
  ]),
  "forbid-arg-pattern": new Set([
    "type",
    "command",
    "subcommand",
    "pattern",
    "reason",
    "enabled",
  ]),
  "require-context": new Set([
    "type",
    "command",
    "subcommand",
    "requires",
    "except",
    "reason",
    "enabled",
  ]),
};

/** Required fields per rule type (beyond `type` and `reason`). */
const REQUIRED_FIELDS: Record<string, string[]> = {
  prefer: ["instead_of", "use"],
  "forbid-flag": ["command", "flags"],
  "forbid-pattern": ["command", "flags"],
  "forbid-arg-pattern": ["command", "pattern"],
  "require-context": ["command", "requires"],
};

export interface RuleWarning {
  index: number;
  message: string;
}

/**
 * Validate an array of rules. Returns warnings for unknown fields,
 * missing required fields, and unrecognized types.
 */
export function validateRules(rules: unknown[]): RuleWarning[] {
  const warnings: RuleWarning[] = [];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as Record<string, unknown>;

    if (!rule || typeof rule !== "object") {
      warnings.push({ index: i, message: "Rule is not an object" });
      continue;
    }

    const type = rule.type as string | undefined;
    if (!type) {
      warnings.push({ index: i, message: "Missing 'type' field" });
      continue;
    }

    const known = KNOWN_FIELDS[type];
    if (!known) {
      warnings.push({ index: i, message: `Unknown rule type '${type}'` });
      continue;
    }

    // Check for unknown fields
    for (const key of Object.keys(rule)) {
      if (!known.has(key)) {
        warnings.push({
          index: i,
          message: `Unknown field '${key}' on ${type} rule (ignored)`,
        });
      }
    }

    // Check required fields
    if (!rule.reason) {
      warnings.push({ index: i, message: "Missing 'reason' field" });
    }
    for (const field of REQUIRED_FIELDS[type] ?? []) {
      if (rule[field] === undefined || rule[field] === null) {
        warnings.push({ index: i, message: `Missing required field '${field}'` });
      }
    }
  }

  return warnings;
}
