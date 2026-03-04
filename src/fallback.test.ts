/**
 * Regex fallback matching tests.
 * Tests checkCommandFallback() which is used when @aliou/sh parse fails.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "./config.js";
import { checkCommandFallback } from "./hook.js";

describe("checkCommandFallback", () => {
  const rules = DEFAULT_RULES;

  it("catches grep via word boundary", () => {
    expect(checkCommandFallback("grep -rn pattern", rules)).toBeDefined();
  });

  it("catches find via word boundary", () => {
    expect(checkCommandFallback("find . -name '*.ts'", rules)).toBeDefined();
  });

  it("does not match grep inside a word", () => {
    expect(checkCommandFallback("autogrep pattern", rules)).toBeUndefined();
  });

  it("catches yadm add -u", () => {
    expect(checkCommandFallback("yadm add -u", rules)).toBeDefined();
  });

  it("does not catch yadm add file.txt", () => {
    expect(
      checkCommandFallback("yadm add file.txt", rules),
    ).toBeUndefined();
  });

  it("false-positives on grep in quotes (known limitation)", () => {
    // Regex can't distinguish quoted context — this WILL match
    expect(checkCommandFallback('echo "use grep"', rules)).toBeDefined();
  });

  it("catches rg -rn via forbid-flag", () => {
    expect(
      checkCommandFallback("rg -rn pattern src/", rules),
    ).toBeDefined();
  });

  it("does not match yadm without add subcommand", () => {
    expect(
      checkCommandFallback("yadm status -u", rules),
    ).toBeUndefined();
  });
});
