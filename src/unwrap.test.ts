import { describe, expect, it } from "vitest";
import { unwrapCommand } from "./unwrap.js";

describe("unwrapCommand", () => {
  describe("non-wrapper commands", () => {
    it("returns original words only", () => {
      expect(unwrapCommand(["echo", "hello"])).toEqual([["echo", "hello"]]);
    });

    it("handles empty input", () => {
      expect(unwrapCommand([])).toEqual([]);
    });
  });

  describe("args-after-flags wrappers", () => {
    it("xargs: extracts sub-command after flags", () => {
      const result = unwrapCommand(["xargs", "grep", "pattern"]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });

    it("xargs -0: skips flags", () => {
      const result = unwrapCommand(["xargs", "-0", "grep", "pattern"]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });

    it("sudo: extracts sub-command", () => {
      const result = unwrapCommand(["sudo", "find", ".", "-name", "*.ts"]);
      expect(result).toContainEqual(["find", ".", "-name", "*.ts"]);
    });

    it("nohup: extracts sub-command", () => {
      const result = unwrapCommand(["nohup", "find", ".", "-name", "*.log"]);
      expect(result).toContainEqual(["find", ".", "-name", "*.log"]);
    });
  });

  describe("skip-n wrappers", () => {
    it("timeout: skips duration, extracts command", () => {
      const result = unwrapCommand(["timeout", "30", "grep", "pattern"]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });

    it("timeout with flags: skips flags + duration", () => {
      const result = unwrapCommand([
        "timeout",
        "--signal=KILL",
        "30",
        "grep",
        "pattern",
      ]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });
  });

  describe("args-after-assigns wrappers", () => {
    it("env: skips assignments, extracts command", () => {
      const result = unwrapCommand(["env", "LANG=C", "grep", "pattern"]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });

    it("env with flags: skips -i and assignments", () => {
      const result = unwrapCommand([
        "env",
        "-i",
        "FOO=bar",
        "grep",
        "pattern",
      ]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });
  });

  describe("dash-c wrappers", () => {
    it("bash -c: re-parses shell string", () => {
      const result = unwrapCommand([
        "bash",
        "-c",
        "grep -rn pattern src/",
      ]);
      expect(result).toContainEqual(["grep", "-rn", "pattern", "src/"]);
    });

    it("sh -c: re-parses shell string", () => {
      const result = unwrapCommand(["sh", "-c", "find . -name '*.ts'"]);
      expect(result).toContainEqual(["find", ".", "-name", "*.ts"]);
    });

    it("bash -c with pipeline: extracts all commands", () => {
      const result = unwrapCommand(["bash", "-c", "grep pattern | sort"]);
      expect(result).toContainEqual(["grep", "pattern"]);
      expect(result).toContainEqual(["sort"]);
    });

    it("bash without -c: no unwrapping", () => {
      const result = unwrapCommand(["bash", "script.sh"]);
      expect(result).toEqual([["bash", "script.sh"]]);
    });
  });

  describe("first-arg-is-shell wrappers", () => {
    it("watch: re-parses first arg as shell", () => {
      const result = unwrapCommand([
        "watch",
        "grep -c error /var/log/syslog",
      ]);
      expect(result).toContainEqual([
        "grep",
        "-c",
        "error",
        "/var/log/syslog",
      ]);
    });
  });

  describe("nested wrappers", () => {
    it("sudo xargs grep: recursively unwraps", () => {
      const result = unwrapCommand(["sudo", "xargs", "grep", "pattern"]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });

    it("nice timeout grep: recursively unwraps", () => {
      const result = unwrapCommand([
        "nice",
        "timeout",
        "10",
        "grep",
        "pattern",
      ]);
      expect(result).toContainEqual(["grep", "pattern"]);
    });
  });

  describe("non-wrapper with tool name as argument", () => {
    it("man grep: does NOT unwrap", () => {
      const result = unwrapCommand(["man", "grep"]);
      expect(result).toEqual([["man", "grep"]]);
    });

    it("echo grep: does NOT unwrap", () => {
      const result = unwrapCommand(["echo", "grep"]);
      expect(result).toEqual([["echo", "grep"]]);
    });
  });

  describe("env var assignment prefixes", () => {
    it("strips VAR=value prefix to find real command", () => {
      const result = unwrapCommand(["FOO=bar", "git", "rebase", "-i"]);
      expect(result.some((r) => r[0] === "git")).toBe(true);
    });

    it("strips multiple env var prefixes", () => {
      const result = unwrapCommand([
        "GIT_EDITOR=true",
        "GIT_SEQUENCE_EDITOR=:",
        "git",
        "rebase",
        "-i",
      ]);
      expect(result.some((r) => r[0] === "git")).toBe(true);
    });

    it("strips env vars with complex values", () => {
      const result = unwrapCommand([
        "GIT_SEQUENCE_EDITOR=sed -i '' 's/^pick/reword/'",
        "git",
        "rebase",
        "-i",
        "main",
      ]);
      expect(result.some((r) => r[0] === "git")).toBe(true);
    });

    it("does not strip if no command follows env vars", () => {
      const result = unwrapCommand(["FOO=bar"]);
      expect(result).toEqual([["FOO=bar"]]);
    });

    it("does not treat regular arguments as env vars", () => {
      const result = unwrapCommand(["echo", "FOO=bar"]);
      expect(result).toEqual([["echo", "FOO=bar"]]);
    });
  });
});
