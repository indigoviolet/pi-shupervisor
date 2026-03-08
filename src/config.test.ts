import { describe, expect, it } from "vitest";
import { mergeRules, ruleKey } from "./config.js";
import type { PreferRule, Rule } from "./rules.js";

// Base rules for merge tests (simulating what a user might configure globally)
const BASE_RULES: Rule[] = [
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
];

describe("mergeRules", () => {
  it("returns defaults when no overrides", () => {
    const result = mergeRules(BASE_RULES, []);
    expect(result).toEqual(BASE_RULES);
  });

  it("overrides a rule by key", () => {
    const override: PreferRule = {
      type: "prefer",
      instead_of: "grep",
      use: "ag",
      reason: "Use ag in this project",
    };
    const result = mergeRules(BASE_RULES, [override]);
    const grepRule = result.find(
      (r) => r.type === "prefer" && r.instead_of === "grep",
    ) as PreferRule | undefined;
    expect(grepRule?.reason).toBe("Use ag in this project");
  });

  it("disables a rule via enabled: false", () => {
    const disable: PreferRule = {
      type: "prefer",
      instead_of: "grep",
      use: "rg",
      reason: "",
      enabled: false,
    };
    const result = mergeRules(BASE_RULES, [disable]);
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
    const result = mergeRules(BASE_RULES, [custom]);
    expect(result.length).toBe(BASE_RULES.length + 1);
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
    const result = mergeRules(BASE_RULES, [override]);
    const grepRules = result.filter(
      (r) => r.type === "prefer" && r.instead_of === "grep",
    );
    expect(grepRules.length).toBe(1);
  });

  it("works with empty defaults", () => {
    const rules: Rule[] = [
      { type: "prefer", instead_of: "npm", use: "pnpm", reason: "Use pnpm" },
    ];
    const result = mergeRules([], rules);
    expect(result).toEqual(rules);
  });
});

describe("mergeRules — global + local scoping", () => {
  const globalRules: Rule[] = [
    { type: "prefer", instead_of: "grep", use: "rg", reason: "Use rg" },
    { type: "prefer", instead_of: "find", use: "fd", reason: "Use fd" },
    { type: "forbid-flag", command: "rg", flags: ["-rn"], reason: "-rn is bad" },
    { type: "forbid-pattern", command: "git", subcommand: "stash", flags: [], reason: "No stash" },
    { type: "forbid-pattern", command: "git", subcommand: "reset", flags: ["--hard"], reason: "No hard reset" },
  ];

  it("local rules add to global without clobbering", () => {
    const localRules: Rule[] = [
      { type: "prefer", instead_of: "npm", use: "pnpm", reason: "Use pnpm" },
    ];
    const result = mergeRules(globalRules, localRules);
    expect(result.length).toBe(6);
    expect(result.find(r => r.type === "prefer" && (r as PreferRule).instead_of === "npm")).toBeDefined();
    expect(result.find(r => r.type === "prefer" && (r as PreferRule).instead_of === "grep")).toBeDefined();
  });

  it("local rules override global by key", () => {
    const localRules: Rule[] = [
      { type: "prefer", instead_of: "grep", use: "ag", reason: "Use ag here" },
    ];
    const result = mergeRules(globalRules, localRules);
    expect(result.length).toBe(5);
    const grepRule = result.find(r => r.type === "prefer" && (r as PreferRule).instead_of === "grep") as PreferRule;
    expect(grepRule.use).toBe("ag");
  });

  it("local rules can disable a global rule", () => {
    const localRules: Rule[] = [
      { type: "prefer", instead_of: "grep", use: "rg", reason: "", enabled: false },
    ];
    const result = mergeRules(globalRules, localRules);
    expect(result.length).toBe(5);
    const grepRule = result.find(r => r.type === "prefer" && (r as PreferRule).instead_of === "grep");
    expect(grepRule?.enabled).toBe(false);
  });

  it("all global rules survive when local adds new ones", () => {
    const localRules: Rule[] = [
      { type: "prefer", instead_of: "npm", use: "pnpm", reason: "Use pnpm" },
      { type: "forbid-pattern", command: "docker", subcommand: "run", flags: ["--privileged"], reason: "No privileged" },
    ];
    const result = mergeRules(globalRules, localRules);
    expect(result.length).toBe(7);
    // All 5 global rules present
    for (const rule of globalRules) {
      expect(result.find(r => ruleKey(r) === ruleKey(rule))).toBeDefined();
    }
  });

  it("empty local does not affect global", () => {
    const result = mergeRules(globalRules, []);
    expect(result).toEqual(globalRules);
  });

  it("empty global returns local as-is", () => {
    const localRules: Rule[] = [
      { type: "prefer", instead_of: "npm", use: "pnpm", reason: "Use pnpm" },
    ];
    const result = mergeRules([], localRules);
    expect(result).toEqual(localRules);
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

  it("forbid-arg-pattern rules key on command + pattern", () => {
    expect(
      ruleKey({
        type: "forbid-arg-pattern",
        command: "rg",
        pattern: "\\\\\\|",
        reason: "",
      }),
    ).toBe("forbid-arg-pattern:rg::\\\\\\|");
  });

  it("forbid-arg-pattern rules key includes subcommand", () => {
    expect(
      ruleKey({
        type: "forbid-arg-pattern",
        command: "git",
        subcommand: "rebase",
        pattern: "sed",
        reason: "",
      }),
    ).toBe("forbid-arg-pattern:git:rebase:sed");
  });
});
