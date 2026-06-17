// Assembled help topics for MCP `help` and AgentSkill `help`.

import { readNpmPackageReadme } from "../../../core/read-npm-package-readme.ts";
import {
  tryReadSharedJson,
  tryReadSharedText,
} from "../../../core/shared-assets.ts";
import { helpTopicAuth } from "./auth.ts";
import { helpTopicCron } from "./cron.ts";
import { helpTopicInstallation } from "./installation.ts";
import { helpTopicJmapCheatsheet } from "./jmap-cheatsheet.ts";
import { helpTopicMultiAccount } from "./multi-account.ts";
import { helpTopicOverview } from "./overview.ts";
import { helpTopicPresets } from "./presets.ts";
import { helpTopicTools } from "./tools.ts";
import { helpTopicTroubleshooting } from "./troubleshooting.ts";

interface SharedManifest {
  help: {
    topic_order: string[];
    topics_dir: string;
    readme_stub_path: string;
  };
}

interface SharedErrors {
  help_unknown_topic_template: string;
}

const manifest = tryReadSharedJson<SharedManifest>("manifest.json");
const errors = tryReadSharedJson<SharedErrors>("messages/errors.json");

const fallbackTopics: Record<string, string> = {
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

const DEFAULT_README_STUB =
  'Topic "readme" returns a built-in stub in AgentSkill runtimes. From MCP, topic "readme" returns the package README.md.';
const DEFAULT_UNKNOWN_TOPIC =
  "Unknown topic \"{topic}\". Available topics: {topics}, readme";

export const HELP_TOPICS: Record<string, string> = manifest
  ? Object.fromEntries(
    manifest.help.topic_order.map((topic) => {
      const text = tryReadSharedText(`${manifest.help.topics_dir}/${topic}.md`) ??
        fallbackTopics[topic];
      return [topic, text];
    }),
  )
  : fallbackTopics;

export const HELP_TOPIC_LIST = manifest
  ? [...manifest.help.topic_order]
  : Object.keys(fallbackTopics);
const HELP_README_STUB = manifest
  ? (tryReadSharedText(manifest.help.readme_stub_path) ?? DEFAULT_README_STUB)
    .trim()
  : DEFAULT_README_STUB;

export function normalizeHelpTopic(topic: string): string {
  return topic.toLowerCase().replace(/[\s-]/g, "_");
}

export type HelpRuntime = "mcp" | "skill";

export async function getHelp(
  topic?: string,
  runtime: HelpRuntime = "skill",
): Promise<string> {
  if (!topic) {
    return HELP_TOPICS["overview"];
  }
  const key = normalizeHelpTopic(topic);
  if (key === "readme") {
    if (runtime === "mcp") {
      return await readNpmPackageReadme();
    }
    return HELP_README_STUB;
  }
  const unknownTemplate = errors?.help_unknown_topic_template ??
    DEFAULT_UNKNOWN_TOPIC;
  return (HELP_TOPICS[key] ?? unknownTemplate)
    .replace("{topic}", topic)
    .replace("{topics}", HELP_TOPIC_LIST.join(", "));
}
