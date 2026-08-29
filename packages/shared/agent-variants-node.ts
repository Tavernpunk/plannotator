/**
 * Agent Variants — node-side loader.
 *
 * Re-exports the pure contract from @plannotator/core/agent-variants and adds
 * the one thing a browser cannot do: read `agentVariants` out of config.json
 * and expand `~` in the paths it declares (`CODEX_HOME`, a binary override).
 *
 * Named `-node` like its siblings (live-proxy-node, source-save-node): Pi
 * vendors both halves into one flat directory, where a shared module sharing a
 * core module's basename would import itself.
 *
 * Vendored to Pi.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import {
  normalizeAgentVariants,
  type AgentVariant,
} from "@plannotator/core/agent-variants";

export * from "@plannotator/core/agent-variants";

/**
 * Expand a leading `~` against the user's home. Prefers $HOME (what the user's
 * own shell aliases key off, and what makes this testable) over the cached
 * homedir(), matching resolveGlobalSkillRoots in review-skill-loader.ts.
 */
export function expandHome(value: string): string {
  const home = process.env.HOME?.trim() || homedir();
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  return value;
}

/**
 * Read and validate the declared variants. Warnings go to stderr and the bad
 * entry is dropped — a typo in config.json must not stop a review server from
 * starting.
 */
export function loadAgentVariants(): AgentVariant[] {
  return normalizeAgentVariants(loadConfig().agentVariants, {
    expandPath: expandHome,
    warn: (message) => process.stderr.write(`[plannotator] ${message}\n`),
  });
}
