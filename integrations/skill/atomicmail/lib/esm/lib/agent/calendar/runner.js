// Binds the shared calendar flows (flows.ts — carried byte-for-byte from the
// hosted MCP server) to an AgentSession: JMAP batches go
// through the same runJmapRequest path as jmap_request, and the agent's own
// address resolves exactly like `$INBOX` does.
import { env } from "node:process";
import { DEFAULT_JMAP_USING, runJmapRequest, } from "../jmap/agent-jmap.js";
import { readCredentials } from "../session/agent-credentials-store.js";
import { resolveInboxMailboxEmail } from "../session/inbox-id-to-mailbox-email.js";
export { CalendarError, cancelInvite, listInvites, respondToInvite, sendInvite, updateInvite, } from "./flows.js";
/** The address `$INBOX` expands to for this session (lower-cased). */
export async function sessionInboxAddress(session) {
    const inboxId = session.currentInboxId ??
        (session.files
            ? (await readCredentials(session.files.credentialsFile)).inboxId
            : undefined);
    let accountId;
    try {
        accountId = await session.getPrimaryMailAccountId();
    }
    catch {
        accountId = undefined;
    }
    const email = resolveInboxMailboxEmail({
        inboxId,
        accountId,
        inboxDomain: env.ATOMIC_MAIL_INBOX_DOMAIN,
    });
    if (!email)
        throw new Error("No inbox in session; run register first.");
    return email.toLowerCase();
}
export async function calendarRunnerForSession(session) {
    const self = await sessionInboxAddress(session);
    return {
        self,
        run: (opsJson, vars, label) => runJmapRequest({
            session,
            opsJson,
            defaultUsing: [...DEFAULT_JMAP_USING],
            sourceLabel: label,
            vars,
        }),
    };
}
