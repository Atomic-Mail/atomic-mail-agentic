import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

import {
  type AgentSession,
  DEFAULT_JMAP_USING,
  readOpsFile,
  runJmapRequest,
} from "../../lib/mod.ts";

export function registerJmapTool(
  server: McpServer,
  session: AgentSession,
): void {
  server.registerTool(
    "jmap_request",
    {
      title: "Send a JMAP request",
      description:
        "Send a JMAP method-call batch. Auth and JWT rotation are automatic. " +
        "Provide exactly one of: `ops` (JSON string — methodCalls array or full " +
        "envelope) or `ops_file` (preset path; relative paths resolve against " +
        "the credential directory). Tokens `$VAR_NAME` (uppercase `$FOO_BAR`) in " +
        "either input are replaced: `$ACCOUNT_ID`, `$INBOX`, `$INBOX_MAILBOX_ID`, " +
        "`$UPLOAD_URL`, and `$DOWNLOAD_URL` come from the JMAP session/credentials; " +
        "pass other names via `vars`. Optional `attachments`: each file is " +
        "RFC 8620–uploaded first, then `$ATTACHMENT_0_BLOB_ID`, `$ATTACHMENT_0_NAME`, " +
        "`$ATTACHMENT_0_TYPE`, … are substituted (see bundled `send_mail_blob_attachment.json`).",
      inputSchema: z.object({
        using: z
          .array(z.string())
          .default([...DEFAULT_JMAP_USING])
          .describe(
            "JMAP capability URNs when `ops` omits `using`. Ignored if the " +
              "JSON body already sets `using`.",
          ),
        ops: z
          .string()
          .optional()
          .describe(
            "Inline JSON: methodCalls array or { using, methodCalls }. " +
              "Mutually exclusive with ops_file.",
          ),
        ops_file: z
          .string()
          .optional()
          .describe(
            "Path to a preset JSON file. Mutually exclusive with ops.",
          ),
        vars: z
          .record(
            z.string().regex(/^[A-Z][A-Z0-9_]*$/),
            z.string(),
          )
          .optional()
          .describe(
            "Map of placeholder names (no `$`) to string values, e.g. " +
              '{ "TO": "a@b.com", "SUBJECT": "Hi" } for `$TO` and `$SUBJECT` in ' +
              "ops or ops_file. Overrides session values for `ACCOUNT_ID`, `INBOX`, " +
              "`INBOX_MAILBOX_ID`, `UPLOAD_URL`, or `DOWNLOAD_URL` if set. Also " +
              "overrides auto-injected `ATTACHMENT_*` keys when `attachments` is set.",
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
            "Optional local files: each is POSTed to JMAP `uploadUrl` (RFC 8620) " +
              "before substitution, injecting `$ATTACHMENT_N_BLOB_ID`, `$ATTACHMENT_N_NAME`, " +
              "`$ATTACHMENT_N_TYPE`, `$ATTACHMENT_N_SIZE`, and `$ATTACHMENT_COUNT`.",
          ),
      }),
    },
    async ({ using, ops, ops_file, vars, attachments }) => {
      try {
        if (ops && ops_file) {
          return {
            content: [
              {
                type: "text" as const,
                text: "ops and ops_file are mutually exclusive — provide one.",
              },
            ],
            isError: true,
          };
        }
        if (!ops && !ops_file) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Provide either ops or ops_file.",
              },
            ],
            isError: true,
          };
        }

        let raw: string;
        let sourceLabel: string;
        if (ops_file) {
          try {
            raw = await readOpsFile(session.credentialDir, ops_file);
          } catch (err) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Could not read ops_file: ${(err as Error).message}`,
                },
              ],
              isError: true,
            };
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
          attachments: attachments?.map((a) => ({
            path: a.path,
            filename: a.filename,
            contentType: a.content_type,
          })),
        });

        if (!ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `JMAP request failed (HTTP ${status}): ${bodyText}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: bodyText }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `JMAP request error: ${
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
