// Binds the friendly mail flows to an AgentSession: batches and attachment
// uploads go through the same runJmapRequest path as jmap_request.
import { sessionInboxAddress } from "../calendar/runner.js";
import { DEFAULT_JMAP_USING, runJmapRequest, } from "../jmap/agent-jmap.js";
export { composeFromInput, htmlToPlainText, parseAddressList, parseFromName, } from "./compose.js";
export { assertAgentId, listAgents, MailError, readInbox, readMessage, replyToMessage, searchMessages, sendEmail, } from "./flows.js";
export async function mailRunnerForSession(session, options = {}) {
    const email = await sessionInboxAddress(session);
    const accountId = await session.getPrimaryMailAccountId();
    return {
        accountId,
        inboxId: email.split("@")[0],
        email,
        run: ({ opsJson, vars, label, attachments }) => runJmapRequest({
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
