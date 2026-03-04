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

  const globalRaw = configLoader.getRawConfig("global");
  const localRaw = configLoader.getRawConfig("local");
  const config = configLoader.getConfig();
  const ruleCount = config.rules.filter((r) => r.enabled !== false).length;

  console.error(
    `[shupervisor] global: ${globalRaw?.rules?.length ?? 0} rules, local: ${localRaw?.rules?.length ?? 0} rules, merged: ${config.rules.length} rules (${ruleCount} active)`,
  );

  if (!config.enabled) {
    console.error("[shupervisor] Disabled by config");
    return;
  }

  setupCommandLintHook(pi);
  registerRulesCommand(pi);
}
