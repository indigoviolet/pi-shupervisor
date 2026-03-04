import { describe, expect, it } from "vitest";
import {
  checkCommand,
  matchRule,
  type ForbidArgPatternRule,
  type ForbidFlagRule,
  type ForbidPatternRule,
  type PreferRule,
  type Rule,
} from "./rules.js";

// Test rules (not shipped as defaults — used only for testing)
const TEST_RULES: Rule[] = [
  {
    type: "prefer",
    instead_of: "grep",
    use: "rg",
    reason: "Use rg instead of grep",
  },
  {
    type: "prefer",
    instead_of: "find",
    use: "fd",
    reason: "Use fd instead of find",
  },
  {
    type: "forbid-flag",
    command: "rg",
    flags: ["-rn"],
    reason: "-rn means --replace n",
  },
  {
    type: "forbid-pattern",
    command: "yadm",
    subcommand: "add",
    flags: ["-u", "-A"],
    reason: "Stage files explicitly",
  },
];

describe("matchRule", () => {
  describe("prefer rules", () => {
    const grepRule: PreferRule = {
      type: "prefer",
      instead_of: "grep",
      use: "rg",
      reason: "Use rg instead of grep",
    };

    it("matches when command is the blocked tool", () => {
      expect(matchRule(["grep", "-rn", "pattern", "src/"], grepRule)).toBe(
        grepRule.reason,
      );
    });

    it("does not match a different command", () => {
      expect(matchRule(["rg", "-n", "pattern"], grepRule)).toBeUndefined();
    });

    it("does not match when blocked tool appears as argument", () => {
      expect(matchRule(["man", "grep"], grepRule)).toBeUndefined();
    });

    it("does not match empty words", () => {
      expect(matchRule([], grepRule)).toBeUndefined();
    });

    it("respects enabled: false", () => {
      expect(
        matchRule(["grep", "pattern"], { ...grepRule, enabled: false }),
      ).toBeUndefined();
    });
  });

  describe("forbid-flag rules", () => {
    const rnRule: ForbidFlagRule = {
      type: "forbid-flag",
      command: "rg",
      flags: ["-rn"],
      reason: "-rn means --replace n",
    };

    it("matches when command + forbidden flag present", () => {
      expect(matchRule(["rg", "-rn", "pattern", "src/"], rnRule)).toBe(
        rnRule.reason,
      );
    });

    it("does not match when flag is absent", () => {
      expect(matchRule(["rg", "-n", "pattern"], rnRule)).toBeUndefined();
    });

    it("does not match when command is different", () => {
      expect(matchRule(["grep", "-rn", "pattern"], rnRule)).toBeUndefined();
    });

    it("matches flag even as non-flag argument (known trade-off)", () => {
      expect(matchRule(["rg", "-rn"], rnRule)).toBe(rnRule.reason);
    });
  });

  describe("forbid-pattern rules", () => {
    const yadmRule: ForbidPatternRule = {
      type: "forbid-pattern",
      command: "yadm",
      subcommand: "add",
      flags: ["-u", "-A"],
      reason: "Stage files explicitly",
    };

    it("matches command + subcommand + flag", () => {
      expect(matchRule(["yadm", "add", "-u"], yadmRule)).toBe(
        yadmRule.reason,
      );
    });

    it("matches with -A flag", () => {
      expect(matchRule(["yadm", "add", "-A"], yadmRule)).toBe(
        yadmRule.reason,
      );
    });

    it("does not match without subcommand", () => {
      expect(matchRule(["yadm", "status"], yadmRule)).toBeUndefined();
    });

    it("does not match without forbidden flag", () => {
      expect(matchRule(["yadm", "add", "file.txt"], yadmRule)).toBeUndefined();
    });

    it("does not match different command", () => {
      expect(matchRule(["git", "add", "-u"], yadmRule)).toBeUndefined();
    });

    it("works without subcommand in rule", () => {
      const noSub: ForbidPatternRule = {
        type: "forbid-pattern",
        command: "docker",
        flags: ["--privileged"],
        reason: "No privileged containers",
      };
      expect(matchRule(["docker", "run", "--privileged", "img"], noSub)).toBe(
        noSub.reason,
      );
    });
  });

  describe("forbid-arg-pattern rules", () => {
    const escapedPipeRule: ForbidArgPatternRule = {
      type: "forbid-arg-pattern",
      command: "rg",
      pattern: "\\\\\\|",
      reason: "rg uses Rust regex — use `foo|bar` not `foo\\|bar`",
    };

    it("matches when an argument contains escaped pipe", () => {
      expect(
        matchRule(["rg", "foo\\|bar", "src/"], escapedPipeRule),
      ).toBe(escapedPipeRule.reason);
    });

    it("does not match when no argument matches pattern", () => {
      expect(
        matchRule(["rg", "foo|bar", "src/"], escapedPipeRule),
      ).toBeUndefined();
    });

    it("does not match different command", () => {
      expect(
        matchRule(["grep", "foo\\|bar"], escapedPipeRule),
      ).toBeUndefined();
    });

    it("does not match command name itself against pattern", () => {
      // Only args (words[1:]) are tested, not the command name
      expect(
        matchRule(["rg"], escapedPipeRule),
      ).toBeUndefined();
    });

    it("respects enabled: false", () => {
      expect(
        matchRule(["rg", "foo\\|bar"], { ...escapedPipeRule, enabled: false }),
      ).toBeUndefined();
    });

    it("works with other regex patterns", () => {
      const dotStarRule: ForbidArgPatternRule = {
        type: "forbid-arg-pattern",
        command: "rm",
        pattern: "^\\*$",
        reason: "Don't rm *",
      };
      expect(matchRule(["rm", "*"], dotStarRule)).toBe(dotStarRule.reason);
      expect(matchRule(["rm", "file.txt"], dotStarRule)).toBeUndefined();
    });
  });
});

describe("checkCommand", () => {
  it("returns first matching rule's reason", () => {
    expect(checkCommand(["grep", "pattern"], TEST_RULES)).toContain("rg");
  });

  it("returns undefined when no rule matches", () => {
    expect(checkCommand(["echo", "hello"], TEST_RULES)).toBeUndefined();
  });

  it("skips disabled rules", () => {
    const withDisabled = TEST_RULES.map((r) =>
      r.type === "prefer" && r.instead_of === "grep"
        ? { ...r, enabled: false }
        : r,
    );
    expect(checkCommand(["grep", "pattern"], withDisabled)).toBeUndefined();
  });
});
