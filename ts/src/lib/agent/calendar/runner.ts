// Binds the shared calendar flows (flows.ts — carried byte-for-byte from the
// server's mcp-server/src/calendar/) to an AgentSession: JMAP batches go
// through the same runJmapRequest path as jmap_request, and the agent's own
// address resolves exactly like `$INBOX` does.

import { env } from "node:process";

import {
  DEFAULT_JMAP_USING,
  type JmapSessionPort,
  runJmapRequest,
} from "../jmap/agent-jmap.ts";
import { readCredentials } from "../session/agent-credentials-store.ts";
import { resolveInboxMailboxEmail } from "../session/inbox-id-to-mailbox-email.ts";
import type { CalendarRunner } from "./flows.ts";

export {
  CalendarError,
  type CalendarRunner,
  cancelInvite,
  type InviteResult,
  listInvites,
  type ListResult,
  type RespondResult,
  respondToInvite,
  sendInvite,
  type SendInviteInput,
  updateInvite,
  type UpdateInviteInput,
} from "./flows.ts";

/** The address `$INBOX` expands to for this session (lower-cased). */
export async function sessionInboxAddress(
  session: JmapSessionPort,
): Promise<string> {
  const inboxId = session.currentInboxId ??
    (session.files
      ? (await readCredentials(session.files.credentialsFile)).inboxId
      : undefined);
  let accountId: string | undefined;
  try {
    accountId = await session.getPrimaryMailAccountId();
  } catch {
    accountId = undefined;
  }
  const email = resolveInboxMailboxEmail({
    inboxId,
    accountId,
    inboxDomain: env.ATOMIC_MAIL_INBOX_DOMAIN,
  });
  if (!email) throw new Error("No inbox in session; run register first.");
  return email.toLowerCase();
}

export async function calendarRunnerForSession(
  session: JmapSessionPort,
): Promise<CalendarRunner> {
  const self = await sessionInboxAddress(session);
  return {
    self,
    run: (opsJson, vars, label) =>
      runJmapRequest({
        session,
        opsJson,
        defaultUsing: [...DEFAULT_JMAP_USING],
        sourceLabel: label,
        vars,
      }),
  };
}
