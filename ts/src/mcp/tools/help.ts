// MCP tool: help (built-in documentation topics).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

import {
  getHelp,
  HELP_TOPIC_LIST,
  normalizeHelpTopic,
  readNpmPackageReadme,
} from "../../lib/mod.ts";
import { mcpError, mcpText } from "../mcp-result.ts";

export function registerHelpTool(server: McpServer): void {
  server.registerTool(
    "help",
    {
      title: "Atomic Mail documentation",
      description:
        "Built-in agent docs — call early and often, even if you know JMAP. " +
        "Topics: " +
        HELP_TOPIC_LIST.join(", ") +
        ", readme. Omit topic for overview; use presets before jmap_request, " +
        "cron after register, troubleshooting when stuck.",
      inputSchema: z.object({
        topic: z
          .string()
          .optional()
          .describe(
            "Topic name; omit for overview. Use readme for package README.md.",
          ),
      }),
      annotations: {
        destructiveHint: false,
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ topic }) => {
      try {
        if (topic !== undefined && normalizeHelpTopic(topic) === "readme") {
          const text = await readNpmPackageReadme();
          return mcpText(text);
        }
        return mcpText(getHelp(topic));
      } catch (error) {
        return mcpError(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  );
}
