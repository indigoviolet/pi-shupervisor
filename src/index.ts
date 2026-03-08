/**
 * pi-shupervisor — Shell command linter extension for pi.
 *
 * Intercepts bash tool calls, parses via @aliou/sh, matches against
 * configurable rules, and blocks with helpful guidance messages.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { configLoader } from "./config.js";
import { setupCommandLintHook } from "./hook.js";
import { registerRulesCommand } from "./commands/rules.js";
import { validateRules } from "./rules.js";

export default async function (pi: ExtensionAPI) {
  try {
    await configLoader.load();
  } catch (e) {
    console.error("[shupervisor] Failed to load config:", e);
    return;
  }

  const config = configLoader.getConfig();

  // Validate rules and warn about issues
  const warnings = validateRules(config.rules);
  for (const w of warnings) {
    console.error(`[shupervisor] Rule ${w.index}: ${w.message}`);
  }

  if (!config.enabled) return;

  setupCommandLintHook(pi);
  registerRulesCommand(pi);
}
