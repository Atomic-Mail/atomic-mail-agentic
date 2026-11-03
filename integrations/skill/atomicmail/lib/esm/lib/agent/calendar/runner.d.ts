import { type JmapSessionPort } from "../jmap/agent-jmap.js";
import type { CalendarRunner } from "./flows.js";
export { CalendarError, type CalendarRunner, cancelInvite, type InviteResult, listInvites, type ListResult, type RespondResult, respondToInvite, sendInvite, type SendInviteInput, updateInvite, type UpdateInviteInput, } from "./flows.js";
/** The address `$INBOX` expands to for this session (lower-cased). */
export declare function sessionInboxAddress(session: JmapSessionPort): Promise<string>;
export declare function calendarRunnerForSession(session: JmapSessionPort): Promise<CalendarRunner>;
//# sourceMappingURL=runner.d.ts.map