// Static help topics for n8n vendor bundle (no shared/ filesystem reads).

import { helpTopicAuth } from "../../agent/jmap/help-content/auth.ts";
import { helpTopicCron } from "../../agent/jmap/help-content/cron.ts";
import { helpTopicInstallation } from "../../agent/jmap/help-content/installation.ts";
import { helpTopicJmapCheatsheet } from "../../agent/jmap/help-content/jmap-cheatsheet.ts";
import { helpTopicMultiAccount } from "../../agent/jmap/help-content/multi-account.ts";
import { helpTopicOverview } from "../../agent/jmap/help-content/overview.ts";
import { helpTopicPresets } from "../../agent/jmap/help-content/presets.ts";
import { helpTopicTools } from "../../agent/jmap/help-content/tools.ts";
import { helpTopicTroubleshooting } from "../../agent/jmap/help-content/troubleshooting.ts";

const DEFAULT_UNKNOWN_TOPIC =
  'Unknown topic "{topic}". Available topics: {topics}, readme';

export const HELP_TOPICS: Record<string, string> = {
  overview: helpTopicOverview,
  installation: helpTopicInstallation,
  auth: helpTopicAuth,
  jmap_cheatsheet: helpTopicJmapCheatsheet,
  tools: helpTopicTools,
  presets: helpTopicPresets,
  cron: helpTopicCron,
  multi_account: helpTopicMultiAccount,
  troubleshooting: helpTopicTroubleshooting,
};

export const HELP_TOPIC_LIST = Object.keys(HELP_TOPICS);

export function normalizeHelpTopic(topic: string): string {
  return topic.toLowerCase().replace(/[\s-]/g, "_");
}

export type HelpRuntime = "mcp" | "skill";

export async function getHelp(
  topic?: string,
  _runtime: HelpRuntime = "skill",
): Promise<string> {
  if (!topic) {
    return HELP_TOPICS["overview"];
  }
  const key = normalizeHelpTopic(topic);
  if (key === "readme") {
    return HELP_TOPICS["overview"];
  }
  return (HELP_TOPICS[key] ?? DEFAULT_UNKNOWN_TOPIC)
    .replace("{topic}", topic)
    .replace("{topics}", HELP_TOPIC_LIST.join(", "));
}
