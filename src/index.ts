/**
 * pi-shupervisor — Shell command linter extension for pi.
 *
 * Intercepts bash tool calls, parses via @aliou/sh, matches against
 * configurable rules, and blocks with helpful guidance messages.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { configLoader } from "./config.js";

export default async function (pi: ExtensionAPI) {
  await configLoader.load();
  const config = configLoader.getConfig();

  if (!config.enabled) return;

  // Phases 3-4: hook + commands will be wired here
}
