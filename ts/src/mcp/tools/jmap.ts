// MCP tool: jmap_request (JMAP batch + optional attachments).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

import {
  DEFAULT_JMAP_USING,
  readOpsFile,
  runJmapRequest,
  sharedError,
  USER_VAR_KEY_RE,
} from "../../lib/mod.ts";
import type { McpSessionContext } from "../mcp-session-context.ts";
import { resolveMcpToolSession } from "../mcp-session-context.ts";
import { mcpError, mcpText } from "../mcp-result.ts";

const CREDENTIALS_DIR_DESC =
  "Credential directory for this call (default: ATOMIC_MAIL_CREDENTIALS_DIR " +
  "or ~/.atomicmail). Use separate paths per account; see help topic multi_account.";

export function registerJmapTool(
  server: McpServer,
  ctx: McpSessionContext,
): void {
  server.registerTool(
    "jmap_request",
    {
      title: "Send a JMAP request",
      description:
        "JMAP method-call batch with automatic auth. Exactly one of: `ops` " +
        "(JSON string: methodCalls array or full envelope) or `ops_file` " +
        "(preset path; relative to credential directory). `$VAR` substitution " +
        "and optional file `attachments`: see `help` topics presets and " +
        "jmap_cheatsheet.",
      annotations: {
        openWorldHint: true,
        destructiveHint: true,
        readOnlyHint: false,
        idempotentHint: false,
      },
      inputSchema: z.object({
        credentials_dir: z
          .string()
          .optional()
          .describe(CREDENTIALS_DIR_DESC),
        using: z
          .array(z.string())
          .default([...DEFAULT_JMAP_USING])
          .describe(
            "Capability URNs merged when `ops` has no `using` (ignored if ops sets `using`).",
          ),
        ops: z
          .string()
          .optional()
          .describe("Inline JSON. Mutually exclusive with ops_file."),
        ops_file: z
          .string()
          .optional()
          .describe("Preset path. Mutually exclusive with ops."),
        vars: z
          .record(
            z.string().regex(USER_VAR_KEY_RE),
            z.string(),
          )
          .optional()
          .describe(
            "String map for `$PLACEHOLDER` values (keys without `$`). " +
              "Overrides session keys and `ATTACHMENT_*` when attachments are set.",
          ),
        dry_run: z
          .boolean()
          .optional()
          .describe(
            "Resolve variables/envelope and return the request body without sending it.",
          ),
        attachments: z
          .array(
            z.object({
              path: z.string().describe(
                "Readable file path on the MCP host (absolute or relative to cwd).",
              ),
              filename: z.string().optional().describe(
                "Attachment filename in the message (default: basename of path).",
              ),
              content_type: z.string().optional().describe(
                "MIME type for upload `Content-Type` (default: guessed from filename).",
              ),
            }),
          )
          .optional()
          .describe(
            "Local files POSTed to session uploadUrl before ops; see help topic presets.",
          ),
      }),
    },
    async ({
      credentials_dir,
      using,
      ops,
      ops_file,
      vars,
      dry_run,
      attachments,
    }) => {
      try {
        if (ops && ops_file) {
          return mcpError(sharedError("mcp_ops_mutually_exclusive"));
        }
        if (!ops && !ops_file) {
          return mcpError(sharedError("mcp_ops_required"));
        }

        const session = await resolveMcpToolSession(
          ctx,
          credentials_dir,
          "jmap",
        );

        let raw: string;
        let sourceLabel: string;
        if (ops_file) {
          try {
            raw = await readOpsFile(session.credentialDir, ops_file);
          } catch (err) {
            return mcpError(
              `Could not read ops_file: ${(err as Error).message}`,
            );
          }
          sourceLabel = `ops_file '${ops_file}'`;
        } else {
          raw = ops!;
          sourceLabel = "ops";
        }

        const { ok, status, bodyText } = await runJmapRequest({
          session,
          opsJson: raw,
          defaultUsing: using,
          sourceLabel,
          vars,
          dryRun: dry_run,
          attachments: attachments?.map((a) => ({
            path: a.path,
            filename: a.filename,
            contentType: a.content_type,
          })),
        });

        if (!ok) {
          return mcpError(
            `JMAP request failed (HTTP ${status}): ${bodyText}`,
          );
        }

        return mcpText(bodyText);
      } catch (error) {
        return mcpError(
          `JMAP request error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  );
}
