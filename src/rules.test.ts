import { describe, expect, it } from "vitest";
import {
  checkCommand,
  matchRule,
  type ForbidFlagRule,
  type ForbidPatternRule,
  type PreferRule,
} from "./rules.js";
import { DEFAULT_RULES } from "./config.js";

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
      // rg searching for the literal string "-rn" — still matches because
      // we do simple string equality on words. Acceptable false positive.
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
});

describe("checkCommand", () => {
  it("returns first matching rule's reason", () => {
    expect(checkCommand(["grep", "pattern"], DEFAULT_RULES)).toContain("rg");
  });

  it("returns undefined when no rule matches", () => {
    expect(checkCommand(["echo", "hello"], DEFAULT_RULES)).toBeUndefined();
  });

  it("skips disabled rules", () => {
    const withDisabled = DEFAULT_RULES.map((r) =>
      r.type === "prefer" && r.instead_of === "grep"
        ? { ...r, enabled: false }
        : r,
    );
    expect(checkCommand(["grep", "pattern"], withDisabled)).toBeUndefined();
  });
});
