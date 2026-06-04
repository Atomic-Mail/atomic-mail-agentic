// Assembled help topics for MCP `help` and AgentSkill `help`.

import { helpTopicAuth } from "./auth.ts";
import { helpTopicCron } from "./cron.ts";
import { helpTopicInstallation } from "./installation.ts";
import { helpTopicJmapCheatsheet } from "./jmap-cheatsheet.ts";
import { helpTopicOverview } from "./overview.ts";
import { helpTopicPresets } from "./presets.ts";
import { helpTopicTools } from "./tools.ts";
import { helpTopicTroubleshooting } from "./troubleshooting.ts";

export const HELP_TOPICS: Record<string, string> = {
  overview: helpTopicOverview,
  installation: helpTopicInstallation,
  auth: helpTopicAuth,
  jmap_cheatsheet: helpTopicJmapCheatsheet,
  tools: helpTopicTools,
  presets: helpTopicPresets,
  cron: helpTopicCron,
  troubleshooting: helpTopicTroubleshooting,
};

export const HELP_TOPIC_LIST = Object.keys(HELP_TOPICS);

export function normalizeHelpTopic(topic: string): string {
  return topic.toLowerCase().replace(/[\s-]/g, "_");
}

export function getHelp(topic?: string): string {
  if (!topic) {
    return HELP_TOPICS["overview"];
  }
  const key = normalizeHelpTopic(topic);
  if (key === "readme") {
    return (
      'Topic "readme" prints the package README.md from the npm install. ' +
      'From MCP use {"topic":"readme"}; from the CLI: ' +
      "`atomicmail help --topic readme`."
    );
  }
  return (
    HELP_TOPICS[key] ??
      `Unknown topic "${topic}". Available topics: ${
        HELP_TOPIC_LIST.join(", ")
      }, readme`
  );
}
