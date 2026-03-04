/**
 * Shell AST utilities — walkCommands and wordToString for @aliou/sh.
 */

import type {
  Command,
  Program,
  SimpleCommand,
  Statement,
  Word,
  WordPart,
} from "@aliou/sh";

/**
 * Convert a WordPart to its string representation.
 */
function wordPartToString(part: WordPart): string {
  switch (part.type) {
    case "Literal":
      return part.value;
    case "SglQuoted":
      return part.value;
    case "DblQuoted":
      return part.parts.map(wordPartToString).join("");
    case "ParamExp":
      // Return as $VAR — can't resolve at lint time
      return `$${part.param.value}`;
    case "CmdSubst":
      // Can't resolve command substitutions
      return "";
    case "ArithExp":
      return "";
    case "ProcSubst":
      return "";
  }
}

/**
 * Convert a Word AST node to its string representation.
 */
export function wordToString(word: Word): string {
  return word.parts.map(wordPartToString).join("");
}

/**
 * Walk all SimpleCommand nodes in a shell AST Program.
 * Calls callback for each SimpleCommand. If callback returns true, stops walking.
 */
export function walkCommands(
  node: Program,
  callback: (cmd: SimpleCommand) => boolean | undefined,
): void {
  for (const stmt of node.body) {
    if (walkStatement(stmt, callback)) return;
  }
}

function walkStatement(
  stmt: Statement,
  callback: (cmd: SimpleCommand) => boolean | undefined,
): boolean {
  return walkCommand(stmt.command, callback);
}

function walkStatements(
  stmts: Statement[],
  callback: (cmd: SimpleCommand) => boolean | undefined,
): boolean {
  for (const stmt of stmts) {
    if (walkStatement(stmt, callback)) return true;
  }
  return false;
}

function walkCommand(
  cmd: Command,
  callback: (cmd: SimpleCommand) => boolean | undefined,
): boolean {
  switch (cmd.type) {
    case "SimpleCommand":
      return callback(cmd) === true;

    case "Pipeline":
      return walkStatements(cmd.commands, callback);

    case "Logical":
      if (walkStatement(cmd.left, callback)) return true;
      return walkStatement(cmd.right, callback);

    case "Subshell":
      return walkStatements(cmd.body, callback);

    case "Block":
      return walkStatements(cmd.body, callback);

    case "IfClause":
      if (walkStatements(cmd.cond, callback)) return true;
      if (walkStatements(cmd.then, callback)) return true;
      if (cmd.else && walkStatements(cmd.else, callback)) return true;
      return false;

    case "WhileClause":
      if (walkStatements(cmd.cond, callback)) return true;
      return walkStatements(cmd.body, callback);

    case "ForClause":
      return walkStatements(cmd.body, callback);

    case "SelectClause":
      return walkStatements(cmd.body, callback);

    case "FunctionDecl":
      return walkStatements(cmd.body, callback);

    case "CaseClause":
      for (const item of cmd.items) {
        if (walkStatements(item.body, callback)) return true;
      }
      return false;

    case "TimeClause":
      return walkStatement(cmd.command, callback);

    case "CoprocClause":
      return walkStatement(cmd.body, callback);

    case "CStyleLoop":
      return walkStatements(cmd.body, callback);

    // These don't contain sub-commands
    case "TestClause":
    case "ArithCmd":
    case "DeclClause":
    case "LetClause":
      return false;
  }
}
