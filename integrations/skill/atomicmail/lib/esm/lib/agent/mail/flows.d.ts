import type { JmapAttachmentInput } from "../jmap/agent-jmap-blob-upload.js";
import { type ComposeInput } from "./compose.js";
import { type MessageDocument, type MessageSummary } from "./envelopes.js";
/** A refusal or failure worth showing the agent as is. */
export declare class MailError extends Error {
}
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
export declare function readInbox(runner: MailRunner, input?: {
    limit?: number;
}): Promise<{
    messages: MessageSummary[];
}>;
export declare function searchMessages(runner: MailRunner, input: {
    query: string;
    limit?: number;
}): Promise<{
    messages: MessageSummary[];
}>;
export declare function readMessage(runner: MailRunner, input: {
    messageId: string;
}): Promise<MessageDocument>;
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
export declare function sendEmail(runner: MailRunner, input: SendEmailInput): Promise<SendResult>;
export interface ReplyToMessageInput extends ComposeInput {
    messageId: string;
    attachments?: JmapAttachmentInput[];
}
/** Look the original up, then send a threaded reply with concrete headers. */
export declare function replyToMessage(runner: MailRunner, input: ReplyToMessageInput): Promise<SendResult>;
export interface AgentRow {
    accountId: string;
    inboxId: string;
    email: string;
}
/** A credential directory holds one inbox, so this is always one row. */
export declare function listAgents(runner: MailRunner): {
    agents: AgentRow[];
};
/**
 * `agent_id` keeps prompts written for the hosted server working: its own inbox
 * passes, any other is refused rather than silently acting on this one.
 */
export declare function assertAgentId(runner: MailRunner, agentId: string | undefined): void;
//# sourceMappingURL=flows.d.ts.map