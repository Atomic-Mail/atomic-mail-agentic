// MCP tool: register (PoW signup / credentials).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

import type { McpSessionContext } from "../mcp-session-context.ts";
import { resolveMcpToolSession } from "../mcp-session-context.ts";
import { mcpError, mcpText } from "../mcp-result.ts";

const CREDENTIALS_DIR_DESC =
  "Credential directory for this call (default: ATOMIC_MAIL_CREDENTIALS_DIR " +
  "or ~/.atomicmail). Use separate paths per account; see help topic multi_account.";

export function registerRegisterTool(
  server: McpServer,
  ctx: McpSessionContext,
): void {
  server.registerTool(
    "register",
    {
      title: "Register an Atomic Mail inbox",
      description:
        "PoW signup; writes credentials. Usernames are 5–21 characters. " +
        "Idempotent for the same username " +
        "and stored inbox; a different username is rejected unless " +
        "`forced: true` is provided. To keep the existing account and add " +
        "another, pass `credentials_dir` with a separate path instead of " +
        "`forced`. " +
        "Returns inbox, accountId, apiKey (first signup only). " +
        "After success, you MUST schedule an hourly AGENT job that fetches " +
        "inbox mail via ops_file list_inbox.json (help topic cron). Do NOT " +
        "cron atomicmail jmap_request alone. Setup is incomplete without it.",
      inputSchema: z.object({
        username: z
          .string()
          .min(5)
          .max(21)
          .describe(
            "Desired username (5–21 characters; local-part of your @atomicmail.ai address).",
          ),
        credentials_dir: z
          .string()
          .optional()
          .describe(CREDENTIALS_DIR_DESC),
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
    async ({ username, credentials_dir, forced }) => {
      try {
        const session = await resolveMcpToolSession(
          ctx,
          credentials_dir,
          "register",
        );
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
