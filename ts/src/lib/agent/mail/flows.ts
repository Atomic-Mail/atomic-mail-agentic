// The friendly mail operations behind the stdio MCP tools and the CLI commands:
// read_inbox, read_message, search_messages, send_email, reply_to_message,
// list_agents. Same names and arguments as the hosted MCP server's tools.

import type { JmapAttachmentInput } from "../jmap/agent-jmap-blob-upload.ts";
import {
  composeFromInput,
  type ComposeInput,
  parseAddressList,
} from "./compose.ts";
import {
  buildReadInboxOps,
  buildReadMessageOps,
  buildReplyLookupOps,
  buildReplyOps,
  buildSearchOps,
  buildSendEmailOps,
  computeReplyHeaders,
  findJmapSetFailure,
  type MessageDocument,
  type MessageSummary,
  sentMessageIds,
  toMessageDocument,
  toMessageSummaries,
} from "./envelopes.ts";

/** A refusal or failure worth showing the agent as is. */
export class MailError extends Error {}

export interface MailRunResult {
  ok: boolean;
  status: number;
  bodyText: string;
}

/** One inbox, and how to run JMAP batches against it. */
export interface MailRunner {
  accountId: string;
  inboxId: string;
  /** The inbox's full address. */
  email: string;
  run(input: {
    opsJson: string;
    vars?: Record<string, string>;
    label: string;
    attachments?: JmapAttachmentInput[];
  }): Promise<MailRunResult>;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

function checkLimit(limit: number | undefined): number {
  const n = limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new MailError(`limit must be a whole number from 1 to ${MAX_LIMIT}.`);
  }
  return n;
}

/** Turn a parse or validation failure into a MailError. */
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw new MailError((err as Error).message);
  }
}

async function runOk(
  runner: MailRunner,
  input: Parameters<MailRunner["run"]>[0],
): Promise<string> {
  const { ok, status, bodyText } = await runner.run(input);
  if (!ok) {
    throw new MailError(`${input.label} failed (HTTP ${status}): ${bodyText}`);
  }
  return bodyText;
}

export async function readInbox(
  runner: MailRunner,
  input: { limit?: number } = {},
): Promise<{ messages: MessageSummary[] }> {
  const bodyText = await runOk(runner, {
    opsJson: buildReadInboxOps(checkLimit(input.limit)),
    label: "read_inbox",
  });
  return guard(() => toMessageSummaries(bodyText));
}

export async function searchMessages(
  runner: MailRunner,
  input: { query: string; limit?: number },
): Promise<{ messages: MessageSummary[] }> {
  const bodyText = await runOk(runner, {
    opsJson: buildSearchOps(checkLimit(input.limit)),
    vars: { QUERY: input.query },
    label: "search_messages",
  });
  return guard(() => toMessageSummaries(bodyText));
}

export async function readMessage(
  runner: MailRunner,
  input: { messageId: string },
): Promise<MessageDocument> {
  const bodyText = await runOk(runner, {
    opsJson: buildReadMessageOps(),
    vars: { MESSAGE_ID: input.messageId },
    label: "read_message",
  });
  return guard(() => toMessageDocument(bodyText, input.messageId));
}

export interface SendResult {
  sent: true;
  id: string | null;
  threadId: string | null;
  to: string[];
  subject: string;
}

export interface SendEmailInput extends ComposeInput {
  to: string | string[];
  subject: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: JmapAttachmentInput[];
}

export async function sendEmail(
  runner: MailRunner,
  input: SendEmailInput,
): Promise<SendResult> {
  const prepared = guard(() => {
    const to = parseAddressList(input.to, "to");
    if (to.length === 0) {
      throw new Error("send_email requires at least one `to` recipient.");
    }
    return {
      to,
      cc: parseAddressList(input.cc, "cc"),
      bcc: parseAddressList(input.bcc, "bcc"),
      composed: composeFromInput(input),
    };
  });
  const { opsJson, vars } = buildSendEmailOps({
    to: prepared.to,
    cc: prepared.cc,
    bcc: prepared.bcc,
    attachmentCount: input.attachments?.length ?? 0,
    compose: prepared.composed.options,
  });
  const bodyText = await runOk(runner, {
    opsJson,
    vars: { ...vars, SUBJECT: input.subject, BODY: prepared.composed.text },
    attachments: input.attachments,
    label: "send_email",
  });
  const failure = findJmapSetFailure(bodyText);
  if (failure) throw new MailError(`send_email failed: ${failure}`);
  return {
    sent: true,
    ...sentMessageIds(bodyText),
    to: prepared.to.map((a) => a.email),
    subject: input.subject,
  };
}

export interface ReplyToMessageInput extends ComposeInput {
  messageId: string;
  attachments?: JmapAttachmentInput[];
}

/** Look the original up, then send a threaded reply with concrete headers. */
export async function replyToMessage(
  runner: MailRunner,
  input: ReplyToMessageInput,
): Promise<SendResult> {
  const composed = guard(() => composeFromInput(input));
  const lookup = await runOk(runner, {
    opsJson: buildReplyLookupOps(),
    vars: { MAIL_ID: input.messageId },
    label: "reply_to_message (lookup)",
  });
  const headers = guard(() => computeReplyHeaders(lookup, input.messageId));
  const { opsJson, vars } = buildReplyOps(
    headers,
    input.attachments?.length ?? 0,
    composed.options,
  );
  const bodyText = await runOk(runner, {
    opsJson,
    vars: { ...vars, BODY: composed.text },
    attachments: input.attachments,
    label: "reply_to_message",
  });
  const failure = findJmapSetFailure(bodyText);
  if (failure) throw new MailError(`reply_to_message failed: ${failure}`);
  return {
    sent: true,
    ...sentMessageIds(bodyText),
    to: headers.to.map((a) => a.email),
    subject: headers.subject,
  };
}

export interface AgentRow {
  accountId: string;
  inboxId: string;
  email: string;
}

/** A credential directory holds one inbox, so this is always one row. */
export function listAgents(runner: MailRunner): { agents: AgentRow[] } {
  const { accountId, inboxId, email } = runner;
  return { agents: [{ accountId, inboxId, email }] };
}

/**
 * `agent_id` keeps prompts written for the hosted server working: its own inbox
 * passes, any other is refused rather than silently acting on this one.
 */
export function assertAgentId(
  runner: MailRunner,
  agentId: string | undefined,
): void {
  if (!agentId) return;
  const wanted = agentId.trim().toLowerCase();
  const known = [runner.accountId, runner.inboxId, runner.email];
  if (known.some((v) => v.toLowerCase() === wanted)) return;
  throw new MailError(
    `This credential directory holds one inbox (${runner.email}); it cannot ` +
      `act as agent_id '${agentId}'. Omit agent_id, or pass that inbox's ` +
      "credentials_dir.",
  );
}
