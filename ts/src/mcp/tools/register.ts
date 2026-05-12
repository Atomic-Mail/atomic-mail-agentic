import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

import type { AgentSession } from "../../lib/mod.ts";

export function registerRegisterTool(
  server: McpServer,
  session: AgentSession,
): void {
  server.registerTool(
    "register",
    {
      title: "Register an Atomic Mail inbox",
      description:
        "PoW signup; writes credentials. Idempotent for the same username " +
        "and stored inbox; a different username registers a new inbox. " +
        "Returns inbox, accountId, apiKey (first signup only).",
      inputSchema: z.object({
        username: z
          .string()
          .min(1)
          .describe(
            "Desired username (local-part of your @atomicmail.ai address).",
          ),
      }),
      annotations: {
        idempotentHint: true,
        destructiveHint: false,
      },
    },
    async ({ username }) => {
      try {
        const result = await session.register(username);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Registration failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
