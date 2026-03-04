/**
 * Full pipeline integration tests.
 * Tests: shell string → parse → walk → unwrap → match.
 */

import { describe, expect, it } from "vitest";
import { lint } from "./hook.js";
import type { Rule } from "./rules.js";

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
  {
    type: "forbid-arg-pattern",
    command: "rg",
    pattern: "\\\\\\|",
    reason: "rg uses Rust regex — use foo|bar not foo\\|bar",
  },
];

describe("lint (full pipeline)", () => {
  const rules = TEST_RULES;

  describe("prefer rules — should block", () => {
    it.each([
      ["grep direct", "grep -rn pattern src/"],
      ["grep in pipeline", "echo hello | grep pattern"],
      ["grep after &&", "cd src && grep -rn TODO ."],
      ["grep in subshell", "(cd /tmp && grep pattern file)"],
      ["find direct", "find . -name '*.ts' -type f"],
      ["find piped", "find . -name '*.log' | xargs rm"],
    ])("%s: %s", (_label, cmd) => {
      expect(lint(cmd, rules)).toBeDefined();
    });
  });

  describe("prefer rules — should NOT block", () => {
    it.each([
      ["grep in double quotes", 'echo "use grep to search"'],
      ["grep in single quotes", "echo 'grep is slow'"],
      ["grep in commit message", 'git commit -m "replaced grep with rg"'],
      ["find in echo", 'echo "use find to locate"'],
      ["rg (correct tool)", "rg -n pattern src/"],
      ["fd (correct tool)", "fd -e ts"],
      ["grep as man argument", "man grep"],
    ])("%s: %s", (_label, cmd) => {
      expect(lint(cmd, rules)).toBeUndefined();
    });
  });

  describe("forbid-flag rules", () => {
    it("blocks rg -rn", () => {
      expect(lint("rg -rn pattern src/", rules)).toBeDefined();
    });

    it("allows rg -n", () => {
      expect(lint("rg -n pattern src/", rules)).toBeUndefined();
    });

    it("allows rg --replace", () => {
      expect(lint("rg --replace foo pattern src/", rules)).toBeUndefined();
    });
  });

  describe("forbid-pattern rules", () => {
    it("blocks yadm add -u", () => {
      expect(lint("yadm add -u", rules)).toBeDefined();
    });

    it("blocks yadm add -A", () => {
      expect(lint("yadm add -A", rules)).toBeDefined();
    });

    it("allows yadm add with explicit files", () => {
      expect(lint("yadm add file1.txt file2.txt", rules)).toBeUndefined();
    });

    it("allows yadm status", () => {
      expect(lint("yadm status", rules)).toBeUndefined();
    });
  });

  describe("forbid-arg-pattern rules", () => {
    it("blocks rg with escaped pipe alternation", () => {
      expect(lint("rg 'foo\\|bar' src/", rules)).toBeDefined();
    });

    it("allows rg with proper alternation", () => {
      expect(lint("rg 'foo|bar' src/", rules)).toBeUndefined();
    });

    it("blocks rg with escaped pipe in pipeline", () => {
      expect(lint("rg 'foo\\|bar' src/ | head", rules)).toBeDefined();
    });

    it("blocks rg with escaped pipe through wrapper", () => {
      expect(lint("sudo rg 'foo\\|bar' src/", rules)).toBeDefined();
    });
  });

  describe("wrapper unwrapping", () => {
    it.each([
      ["xargs grep", "cat files | xargs grep pattern"],
      ["xargs -0 grep", "find . -print0 | xargs -0 grep pattern"],
      ["sudo find", "sudo find /var -name '*.conf'"],
      ["nohup find", "nohup find . -name '*.log' &"],
      ["timeout grep", "timeout 30 grep -rn pattern src/"],
      ["env grep", "env LANG=C grep -rn pattern src/"],
      ["bash -c grep", "bash -c 'grep -rn pattern src/'"],
      ["sh -c find", "sh -c 'find . -name *.ts'"],
      ["watch grep", "watch 'grep -c error /var/log/syslog'"],
      ["sudo xargs grep", "echo foo | sudo xargs grep bar"],
      ["nice timeout grep", "nice timeout 10 grep pattern file"],
    ])("%s: %s", (_label, cmd) => {
      expect(lint(cmd, rules)).toBeDefined();
    });
  });

  describe("wrapper with clean commands — should NOT block", () => {
    it.each([
      ["xargs rg", "cat files | xargs rg pattern"],
      ["sudo fd", "sudo fd -e conf /etc"],
      ["bash -c rg", "bash -c 'rg -n pattern src/'"],
      ["watch rg", "watch 'rg -c error log'"],
    ])("%s: %s", (_label, cmd) => {
      expect(lint(cmd, rules)).toBeUndefined();
    });
  });

  describe("complex real-world commands", () => {
    it("pipeline with unwrap violation", () => {
      expect(
        lint("fd -e ts | xargs grep TODO | sort -u", rules),
      ).toBeDefined();
    });

    it("pipeline all clean", () => {
      expect(
        lint("fd -e ts | xargs rg TODO | sort -u", rules),
      ).toBeUndefined();
    });

    it("multiline with backslash", () => {
      expect(lint("grep pattern \\\n  src/", rules)).toBeDefined();
    });

    it("heredoc body is not matched", () => {
      expect(lint("cat <<EOF\ngrep is great\nEOF", rules)).toBeUndefined();
    });

    it("for loop with violation", () => {
      expect(
        lint("for f in *.ts; do grep pattern $f; done", rules),
      ).toBeDefined();
    });

    it("if statement with violation", () => {
      expect(
        lint("if grep -q pattern file; then echo found; fi", rules),
      ).toBeDefined();
    });

    it("clean for loop", () => {
      expect(
        lint("for f in *.ts; do rg pattern $f; done", rules),
      ).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("empty command", () => {
      expect(lint("", rules)).toBeUndefined();
    });

    it("comment only", () => {
      expect(lint("# grep pattern", rules)).toBeUndefined();
    });

    it("variable as command name", () => {
      expect(lint("$CMD pattern", rules)).toBeUndefined();
    });

    it("no rules configured", () => {
      expect(lint("grep pattern", [])).toBeUndefined();
    });
  });
});
