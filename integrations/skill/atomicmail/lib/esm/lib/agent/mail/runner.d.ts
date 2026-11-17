import { type JmapSessionPort } from "../jmap/agent-jmap.js";
import type { MailRunner } from "./flows.js";
export { composeFromInput, htmlToPlainText, type MailAddress, parseAddressList, parseFromName, } from "./compose.js";
export { type MessageDocument, type MessageSummary } from "./envelopes.js";
export { type AgentRow, assertAgentId, listAgents, MailError, type MailRunner, readInbox, readMessage, replyToMessage, type ReplyToMessageInput, searchMessages, sendEmail, type SendEmailInput, type SendResult, } from "./flows.js";
export declare function mailRunnerForSession(session: JmapSessionPort, options?: {
    attachmentPathBase?: string;
}): Promise<MailRunner>;
//# sourceMappingURL=runner.d.ts.map