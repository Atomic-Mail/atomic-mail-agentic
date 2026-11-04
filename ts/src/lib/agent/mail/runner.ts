// Binds the friendly mail flows to an AgentSession: batches and attachment
// uploads go through the same runJmapRequest path as jmap_request.

import { sessionInboxAddress } from "../calendar/runner.ts";
import {
  DEFAULT_JMAP_USING,
  type JmapSessionPort,
  runJmapRequest,
} from "../jmap/agent-jmap.ts";
import type { MailRunner } from "./flows.ts";

export {
  composeFromInput,
  htmlToPlainText,
  type MailAddress,
  parseAddressList,
  parseFromName,
} from "./compose.ts";
export { type MessageDocument, type MessageSummary } from "./envelopes.ts";
export {
  type AgentRow,
  assertAgentId,
  listAgents,
  MailError,
  type MailRunner,
  readInbox,
  readMessage,
  replyToMessage,
  type ReplyToMessageInput,
  searchMessages,
  sendEmail,
  type SendEmailInput,
  type SendResult,
} from "./flows.ts";

export async function mailRunnerForSession(
  session: JmapSessionPort,
  options: { attachmentPathBase?: string } = {},
): Promise<MailRunner> {
  const email = await sessionInboxAddress(session);
  const accountId = await session.getPrimaryMailAccountId();
  return {
    accountId,
    inboxId: email.split("@")[0],
    email,
    run: ({ opsJson, vars, label, attachments }) =>
      runJmapRequest({
        session,
        opsJson,
        defaultUsing: [...DEFAULT_JMAP_USING],
        sourceLabel: label,
        vars,
        attachments,
        attachmentPathBase: options.attachmentPathBase,
      }),
  };
}
