import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

import { getHelp, HELP_TOPIC_LIST } from "../../lib/mod.ts";

export function registerHelpTool(server: McpServer): void {
  server.registerTool(
    "help",
    {
      title: "Atomic Mail documentation",
      description:
        "Return in-depth documentation: JMAP cheatsheet, presets, auth flow, " +
        "troubleshooting. Optional topic. Topics: " +
        HELP_TOPIC_LIST.join(", ") + ".",
      inputSchema: z.object({
        topic: z
          .string()
          .optional()
          .describe(
            `Topic (e.g. ${
              HELP_TOPIC_LIST.slice(0, 4).join(", ")
            }, ...). Omit for overview.`,
          ),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    ({ topic }) => ({
      content: [{ type: "text" as const, text: getHelp(topic) }],
    }),
  );
}
