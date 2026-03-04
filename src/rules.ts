/**
 * Rule DSL — type definitions and matching logic.
 *
 * Four rule types:
 * - prefer: block command X, suggest command Y
 * - forbid-flag: block specific flags on a command
 * - forbid-pattern: block command + subcommand + flag combinations
 * - forbid-arg-pattern: block when any argument matches a regex
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
  pattern: string; // regex pattern to test against arguments
  reason: string;
  enabled?: boolean;
}

export type Rule =
  | PreferRule
  | ForbidFlagRule
  | ForbidPatternRule
  | ForbidArgPatternRule;

/**
 * Check a single command (as string[] words) against a single rule.
 * Returns the block reason if matched, undefined otherwise.
 */
export function matchRule(words: string[], rule: Rule): string | undefined {
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
      // Empty flags = match on command+subcommand alone
      if (rule.flags.length === 0) return rule.reason;
      if (words.some((w) => rule.flags.includes(w))) return rule.reason;
      return undefined;
    }

    case "forbid-arg-pattern": {
      if (words[0] !== rule.command) return undefined;
      const re = new RegExp(rule.pattern);
      if (words.slice(1).some((w) => re.test(w))) return rule.reason;
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
): string | undefined {
  for (const rule of rules) {
    const reason = matchRule(words, rule);
    if (reason) return reason;
  }
  return undefined;
}
