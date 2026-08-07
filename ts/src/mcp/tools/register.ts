// MCP tool: register (PoW signup / credentials).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

import type { McpSessionContext } from "../mcp-session-context.ts";
import { resolveMcpToolSession } from "../mcp-session-context.ts";
import { mcpError, mcpText } from "../mcp-result.ts";
import { registerWatchRequiredError } from "../../lib/mod.ts";
import {
  detectRuntime,
  watchScheduledSetup,
} from "../../lib/agent/jmap/help-content/watch-schedule.ts";

const CREDENTIALS_DIR_DESC =
  "Credential directory for this call (default: ATOMIC_MAIL_CREDENTIALS_DIR " +
  "or ~/.atomicmail). Use separate paths per account; see help topic multi_account.";

// The address is permanent and public, so it is the operator's to pick. Unlike
// `watch` this is not enforced — a second blocking question would double the
// onboarding stop, and a bad guess here is recoverable by registering again.
// Nudge only: hosts that ask will ask, hurried ones still get through.
const USERNAME_DESC =
  "Permanent public address: the local-part of your @atomicmail.ai address, " +
  "5–21 characters. It appears on every message this inbox sends and cannot be " +
  "changed afterwards — if your operator has not named it, ask them rather than " +
  "inventing one.";

const WATCH_DESC =
  "Whether a recurring job is set up to read this inbox unattended. A standing " +
  "commitment on your operator's machine, so it is their decision — ask them; " +
  'do not choose or infer it. The two values are "scheduled" and "on-demand"; ' +
  "what each one means is in help topic cron. Omit it and the call returns the " +
  "requirement.";

// --forced is intentionally absent from this description — the same technique
// used to keep the watch values out of REGISTER_HELP (see the comment there).
// Advertising a ready-made replace flag is what let an agent overwrite another
// account's credentials without pausing; the field still exists, but the only
// place its danger is spelled out is the refusal error.
const FORCED_DESC =
  "Danger: replacing an account's credentials is irreversible and permanently " +
  "destroys access to the current inbox. Operator-authorised only; the refusal " +
  "error explains the safe path instead (a separate credential directory).";

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
        "Idempotent for the same username and stored inbox. To register " +
        "another account alongside an existing one, pass `credentials_dir` " +
        "with a separate path. " +
        "Returns inbox, accountId, apiKey (first signup only). " +
        "The `watch` value is your operator's decision, not the agent's — ask " +
        "them before calling.",
      inputSchema: z.object({
        username: z
          .string()
          .min(5)
          .max(21)
          .describe(USERNAME_DESC),
        credentials_dir: z
          .string()
          .optional()
          .describe(CREDENTIALS_DIR_DESC),
        forced: z
          .boolean()
          .optional()
          .describe(FORCED_DESC),
        watch: z
          .enum(["scheduled", "on-demand"], {
            error: registerWatchRequiredError(),
          })
          .describe(WATCH_DESC),
      }),
      annotations: {
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
    },
    async ({ username, credentials_dir, forced, watch }) => {
      try {
        const session = await resolveMcpToolSession(
          ctx,
          credentials_dir,
          "register",
        );
        // UTM install-attribution rides in from ATOMICMAIL_UTM (stdio MCP has
        // no CLI flag); applied on username signup only.
        // `watch` is a wrapper-only precondition — enforced by the schema above
        // and never threaded into session.register().
        const result = await session.register(username, {
          forced,
          utm: ctx.defaultConfig.utm,
        });
        // Measurement only: the chosen watch value and whether we could name the
        // calling runtime. No inbox names, addresses, or keys — this is how we
        // judge the feature without reading individual transcripts.
        const runtime = detectRuntime();
        ctx.capture?.("register", {
          watch,
          runtime_detected: runtime.detected,
          runtime: runtime.runtime ?? "none",
        });
        let text = JSON.stringify(result, null, 2);
        if (watch === "scheduled") {
          // The scheduled prompt must carry a literal credentials path:
          // scheduled sessions inherit no environment on any host.
          text += `\n\n${
            watchScheduledSetup({
              ...(credentials_dir ? { credentialsDir: credentials_dir } : {}),
              inboxId: result.inbox,
            })
          }`;
        }
        return mcpText(text);
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
