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

export default async function (pi: ExtensionAPI) {
  try {
    await configLoader.load();
  } catch (e) {
    console.error("[shupervisor] Failed to load config:", e);
    return;
  }

  const config = configLoader.getConfig();
  const ruleCount = config.rules.filter((r) => r.enabled !== false).length;

  if (!config.enabled) {
    console.error("[shupervisor] Disabled by config");
    return;
  }

  if (ruleCount === 0) {
    console.error("[shupervisor] No rules configured");
  }

  setupCommandLintHook(pi);
  registerRulesCommand(pi);
  console.error(`[shupervisor] Active with ${ruleCount} rules`);
}
