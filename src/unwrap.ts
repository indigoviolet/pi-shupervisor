/**
 * Wrapper-command unwrapping.
 *
 * Extracts effective sub-commands from wrapper commands like sudo, xargs,
 * env, bash -c, etc. Used to apply rules to the actual command being run
 * regardless of how it's wrapped.
 */

import { parse } from "@aliou/sh";
import { walkCommands, wordToString } from "./shell-utils.js";

// ---------- Wrapper definitions ----------

type UnwrapMode =
  | "args-after-flags"
  | "skip-n"
  | "args-after-assigns"
  | "dash-c"
  | "first-arg-is-shell";

interface WrapperDef {
  mode: UnwrapMode;
  n?: number;
}

const WRAPPERS: Record<string, WrapperDef> = {
  xargs: { mode: "args-after-flags" },
  nice: { mode: "args-after-flags" },
  nohup: { mode: "args-after-flags" },
  sudo: { mode: "args-after-flags" },
  doas: { mode: "args-after-flags" },
  strace: { mode: "args-after-flags" },
  ltrace: { mode: "args-after-flags" },
  timeout: { mode: "skip-n", n: 1 },
  env: { mode: "args-after-assigns" },
  bash: { mode: "dash-c" },
  sh: { mode: "dash-c" },
  zsh: { mode: "dash-c" },
  watch: { mode: "first-arg-is-shell" },
};

// ---------- Parse a shell string into word arrays ----------

function parseShellString(shellStr: string): string[][] {
  try {
    const { ast } = parse(shellStr);
    const commands: string[][] = [];
    walkCommands(ast, (cmd) => {
      const words = (cmd.words ?? []).map(wordToString);
      if (words.length > 0) {
        commands.push(words);
      }
      return undefined;
    });
    return commands;
  } catch {
    return [];
  }
}

// ---------- Extraction per mode ----------

function extractArgsAfterFlags(args: string[]): string[] | null {
  for (let i = 0; i < args.length; i++) {
    if (!args[i]!.startsWith("-")) {
      return args.slice(i);
    }
  }
  return null;
}

function extractSkipN(args: string[], n: number): string[] | null {
  let positionalsSeen = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith("-")) continue;
    positionalsSeen++;
    if (positionalsSeen > n) {
      return args.slice(i);
    }
  }
  return null;
}

function extractArgsAfterAssigns(args: string[]): string[] | null {
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!;
    if (w.startsWith("-") || w.includes("=")) continue;
    return args.slice(i);
  }
  return null;
}

function extractDashC(args: string[]): string[][] {
  const cIdx = args.indexOf("-c");
  if (cIdx === -1 || cIdx + 1 >= args.length) return [];
  return parseShellString(args[cIdx + 1]!);
}

function extractFirstArgIsShell(args: string[]): string[][] {
  for (let i = 0; i < args.length; i++) {
    if (!args[i]!.startsWith("-")) {
      return parseShellString(args[i]!);
    }
  }
  return [];
}

// ---------- Main unwrap function ----------

/**
 * Given a SimpleCommand's words (as strings), extract all effective
 * sub-commands. Returns an array of word arrays.
 *
 * Always includes the original words as the first element.
 * Recursively unwraps nested wrappers.
 * For dash-c/first-arg-is-shell, re-parses the string via @aliou/sh.
 */
export function unwrapCommand(words: string[]): string[][] {
  if (words.length === 0) return [];

  const result: string[][] = [words];
  const cmdName = words[0]!;
  const wrapper = WRAPPERS[cmdName];

  if (!wrapper) return result;

  const args = words.slice(1);

  switch (wrapper.mode) {
    case "args-after-flags": {
      const sub = extractArgsAfterFlags(args);
      if (sub && sub.length > 0) {
        result.push(...unwrapCommand(sub));
      }
      break;
    }

    case "skip-n": {
      const sub = extractSkipN(args, wrapper.n ?? 1);
      if (sub && sub.length > 0) {
        result.push(...unwrapCommand(sub));
      }
      break;
    }

    case "args-after-assigns": {
      const sub = extractArgsAfterAssigns(args);
      if (sub && sub.length > 0) {
        result.push(...unwrapCommand(sub));
      }
      break;
    }

    case "dash-c": {
      const subs = extractDashC(args);
      for (const sub of subs) {
        result.push(...unwrapCommand(sub));
      }
      break;
    }

    case "first-arg-is-shell": {
      const subs = extractFirstArgIsShell(args);
      for (const sub of subs) {
        result.push(...unwrapCommand(sub));
      }
      break;
    }
  }

  return result;
}
