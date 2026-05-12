import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

import {
  getHelp,
  HELP_TOPIC_LIST,
  normalizeHelpTopic,
  readNpmPackageReadme,
} from "../../lib/mod.ts";

export function registerHelpTool(server: McpServer): void {
  server.registerTool(
    "help",
    {
      title: "Atomic Mail documentation",
      description:
        "Built-in docs (topics: " +
        HELP_TOPIC_LIST.join(", ") +
        ", readme). Omit topic for overview.",
      inputSchema: z.object({
        topic: z
          .string()
          .optional()
          .describe(
            "Topic name; omit for overview. Use readme for package README.md.",
          ),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ topic }) => {
      try {
        if (topic !== undefined && normalizeHelpTopic(topic) === "readme") {
          const text = await readNpmPackageReadme();
          return {
            content: [{ type: "text" as const, text }],
          };
        }
        return {
          content: [{ type: "text" as const, text: getHelp(topic) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
