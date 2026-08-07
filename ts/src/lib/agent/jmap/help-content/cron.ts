// Help topic: who reads the inbox after register.
//
// The text lives in shared/ so there is exactly one copy: the topic in
// help/topics/cron.md, the short reminder in
// help/fragments/post_register_cron_reminder.md, and the scheduled-run prompt in
// help/fragments/inbox_cron_agent_prompt.md. The inline constants below are
// last-resort fallbacks for builds where the shared assets are not on disk —
// keep them short and never let them contradict the shared text. Duplicating the
// scheduled prompt here is how it once drifted into fifteen copies, half of them
// still granting reply and forward authority.

import { tryReadSharedText } from "../../../core/shared-assets.ts";

const FALLBACK_REMINDER = `\
AFTER REGISTER — WHO READS THE INBOX
  register takes a required \`watch\` value. It is your operator's decision, not yours — ask them.
  • scheduled — a recurring job on this machine wakes an agent once a day to read the inbox and report what arrived.
  • on-demand — no such job; mail is read only when a human asks, and anything arriving in between sits unread with nobody told.
  On "scheduled", register prints the exact setup step for your runtime — use your host's OWN scheduler (openclaw cron, hermes cron, atomic-agent task, a Claude Code routine, …).
  Never schedule at the OS level: no crontab, launchd, systemd or wrapper scripts.
  See help topic "cron".`;

const FALLBACK_TOPIC = `\
# Inbox checks after register

Registration only creates credentials. Nothing reads the inbox until something
wakes an agent to do it — that is what \`watch\` decides, and it is your
operator's call.

On \`watch="scheduled"\`, \`register\` prints the exact setup step for the runtime
that called it, with the credentials directory already filled in. Use that text
verbatim: it is generated for your host.

Schedule on your host's **own** scheduler — \`openclaw cron add\`,
\`hermes cron create\`, \`atomic-agent task create\`, a Claude Code local routine.
Never at the OS level (crontab, launchd, systemd, wrapper scripts): those run
outside the host's permission model and break in practice, because a scheduler
has no terminal.

Give the job the least it needs — it reads mail written by strangers. Set the
per-job tool allowlist explicitly instead of accepting the host default.

Verify with the host's own listing, trigger one run by hand, then leave it.`;

/** Short block — embedded in MCP instructions, register tool text, overview workflow. */
export const postRegisterCronReminder =
  tryReadSharedText("help/fragments/post_register_cron_reminder.md")?.trim() ??
    FALLBACK_REMINDER;

export const helpTopicCron = tryReadSharedText("help/topics/cron.md")?.trim() ??
  FALLBACK_TOPIC;
