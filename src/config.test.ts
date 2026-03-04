import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, mergeRules, ruleKey } from "./config.js";
import type { PreferRule } from "./rules.js";

describe("mergeRules", () => {
  it("returns defaults when no overrides", () => {
    const result = mergeRules(DEFAULT_RULES, []);
    expect(result).toEqual(DEFAULT_RULES);
  });

  it("overrides a default rule by key", () => {
    const override: PreferRule = {
      type: "prefer",
      instead_of: "grep",
      use: "ag",
      reason: "Use ag in this project",
    };
    const result = mergeRules(DEFAULT_RULES, [override]);
    const grepRule = result.find(
      (r) => r.type === "prefer" && r.instead_of === "grep",
    ) as PreferRule | undefined;
    expect(grepRule?.reason).toBe("Use ag in this project");
  });

  it("disables a default rule via enabled: false", () => {
    const disable: PreferRule = {
      type: "prefer",
      instead_of: "grep",
      use: "rg",
      reason: "",
      enabled: false,
    };
    const result = mergeRules(DEFAULT_RULES, [disable]);
    const grepRule = result.find(
      (r) => r.type === "prefer" && r.instead_of === "grep",
    );
    expect(grepRule?.enabled).toBe(false);
  });

  it("appends new user rules", () => {
    const custom: PreferRule = {
      type: "prefer",
      instead_of: "npm",
      use: "pnpm",
      reason: "Use pnpm",
    };
    const result = mergeRules(DEFAULT_RULES, [custom]);
    expect(result.length).toBe(DEFAULT_RULES.length + 1);
    expect(
      result.find((r) => r.type === "prefer" && r.instead_of === "npm"),
    ).toBeDefined();
  });

  it("does not duplicate when override matches existing", () => {
    const override: PreferRule = {
      type: "prefer",
      instead_of: "grep",
      use: "rg",
      reason: "Custom reason",
    };
    const result = mergeRules(DEFAULT_RULES, [override]);
    const grepRules = result.filter(
      (r) => r.type === "prefer" && r.instead_of === "grep",
    );
    expect(grepRules.length).toBe(1);
  });
});

describe("ruleKey", () => {
  it("prefer rules key on instead_of", () => {
    expect(
      ruleKey({
        type: "prefer",
        instead_of: "grep",
        use: "rg",
        reason: "",
      }),
    ).toBe("prefer:grep");
  });

  it("forbid-flag rules key on command + sorted flags", () => {
    expect(
      ruleKey({
        type: "forbid-flag",
        command: "rg",
        flags: ["-rn", "-r"],
        reason: "",
      }),
    ).toBe("forbid-flag:rg:-r,-rn");
  });

  it("forbid-pattern rules key on command + subcommand + sorted flags", () => {
    expect(
      ruleKey({
        type: "forbid-pattern",
        command: "yadm",
        subcommand: "add",
        flags: ["-A", "-u"],
        reason: "",
      }),
    ).toBe("forbid-pattern:yadm:add:-A,-u");
  });
});
