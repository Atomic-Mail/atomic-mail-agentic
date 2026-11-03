import { type InviteState, type OutgoingEvent, type Response } from "./invites.js";
export interface JmapCallResult {
    ok: boolean;
    status: number;
    bodyText: string;
}
export interface CalendarRunner {
    /** The agent's own address, lower-cased (custom-domain aware). */
    self: string;
    /** Run one JMAP batch; `vars` fill $VAR tokens ($ACCOUNT_ID etc. auto). */
    run(opsJson: string, vars: Record<string, string> | undefined, label: string): Promise<JmapCallResult>;
}
/** A refusal or failure to show the caller as is. */
export declare class CalendarError extends Error {
}
/** Split "a@x, b@y" / arrays into trimmed entries. */
export declare function asList(v: string | string[] | undefined): string[];
/** Zone for the human-readable date: the caller's, else the offset given, else UTC. */
export declare function displayZone(timeZone?: string, raw?: string): string;
export interface InviteResult {
    status: "sent" | "updated" | "cancelled";
    invite_id: string;
    version: number;
    title: string;
    /** ISO instants; for an all-day event UTC midnights, `end` exclusive. */
    start: string;
    end: string;
    all_day?: true;
    when: string;
    meeting_url?: string;
    attendees: string[];
    removed_attendees?: string[];
    message_id: string | null;
}
export interface SendInviteInput {
    title: string;
    /** Date-time; a date (YYYY-MM-DD) when `allDay`. */
    start: string;
    /** Date-time; with `allDay`, the LAST day (inclusive), default `start`. */
    end?: string;
    durationMinutes?: number;
    timeZone?: string;
    attendees: string | string[];
    location?: string;
    description?: string;
    /** https video-call link; "" means none. */
    meetingUrl?: string;
    allDay?: boolean;
}
/** Validate a send before any network call (throws CalendarError). */
export declare function prepareSend(input: SendInviteInput, self: string): {
    ev: OutgoingEvent;
    when: string;
};
export declare function sendInvite(runner: CalendarRunner, input: SendInviteInput): Promise<InviteResult>;
export interface UpdateInviteInput {
    inviteId: string;
    title?: string;
    start?: string;
    end?: string;
    durationMinutes?: number;
    timeZone?: string;
    /** The full new guest list; omit to keep it. */
    attendees?: string | string[];
    location?: string;
    description?: string;
    /** New link; "" removes it; omit to keep it. */
    meetingUrl?: string;
    /** true: make it all-day (needs `start` as a date unless it already is);
     * false: give it times again (needs `start`); omit to keep the kind. */
    allDay?: boolean;
}
export declare function updateInvite(runner: CalendarRunner, input: UpdateInviteInput): Promise<InviteResult>;
export declare function cancelInvite(runner: CalendarRunner, input: {
    inviteId: string;
    note?: string;
    timeZone?: string;
}): Promise<InviteResult>;
export interface ListResult extends InviteState {
    scanned: {
        sent: number;
        inbox: number;
    };
}
export declare function listInvites(runner: CalendarRunner, input: {
    inviteId?: string;
    limit?: number;
}): Promise<ListResult>;
export interface RespondResult {
    status: "sent";
    invite_id: string;
    response: Response;
    organizer: string;
    title: string;
    message_id: string | null;
}
export declare function respondToInvite(runner: CalendarRunner, input: {
    messageId: string;
    response: Response;
    note?: string;
}): Promise<RespondResult>;
//# sourceMappingURL=flows.d.ts.map