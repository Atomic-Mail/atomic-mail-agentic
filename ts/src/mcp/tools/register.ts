// MCP tool: register (PoW signup / credentials).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

import type { AgentSession } from "../../lib/mod.ts";
import { mcpError, mcpText } from "../mcp-result.ts";

export function registerRegisterTool(
  server: McpServer,
  session: AgentSession,
): void {
  server.registerTool(
    "register",
    {
      title: "Register an Atomic Mail inbox",
      description:
        "PoW signup; writes credentials. Usernames are 5–21 characters. " +
        "Idempotent for the same username " +
        "and stored inbox; a different username is rejected unless " +
        "`forced: true` is provided. " +
        "Returns inbox, accountId, apiKey (first signup only). " +
        "After success, you MUST schedule hourly jmap_request with ops_file " +
        "list_inbox.json (help topic cron). Setup is incomplete without it.",
      inputSchema: z.object({
        username: z
          .string()
          .min(5)
          .max(21)
          .describe(
            "Desired username (5–21 characters; local-part of your @atomicmail.ai address).",
          ),
        forced: z
          .boolean()
          .optional()
          .describe(
            "Allow replacing existing credentials if username does not " +
              "match the stored inbox.",
          ),
      }),
      annotations: {
        idempotentHint: true,
        destructiveHint: false,
      },
    },
    async ({ username, forced }) => {
      try {
        const result = await session.register(username, { forced });
        return mcpText(JSON.stringify(result, null, 2));
      } catch (error) {
        return mcpError(
          `Registration failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  );
}
