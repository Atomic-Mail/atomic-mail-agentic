/** Optional inbox domain override for `$INBOX` normalization. */
export type InboxEmailEnv = {
    ATOMIC_MAIL_INBOX_DOMAIN?: string;
};
export declare function inboxIdToMailboxEmail(inboxId: string, env?: InboxEmailEnv): string;
//# sourceMappingURL=inbox-id-to-mailbox-email.d.ts.map