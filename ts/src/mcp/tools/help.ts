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
        "Return in-depth documentation: JMAP cheatsheet, presets, auth flow, " +
        "troubleshooting; or the published package README when topic is readme. " +
        "Optional topic. Topics: " +
        HELP_TOPIC_LIST.join(", ") +
        ", readme.",
      inputSchema: z.object({
        topic: z
          .string()
          .optional()
          .describe(
            `Topic (e.g. ${
              HELP_TOPIC_LIST.slice(0, 4).join(", ")
            }, ..., readme). Use readme for the npm package README.md. Omit for overview.`,
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
