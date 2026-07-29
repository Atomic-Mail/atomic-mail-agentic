import { type JmapBlobUploadLimits } from "./agent-jmap-blob-limits.js";
export type { JmapBlobUploadLimits } from "./agent-jmap-blob-limits.js";
export declare const DEFAULT_JMAP_USING: readonly ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"];
export declare const BUNDLED_OPS_PRESET_NAMES: readonly ["list_inbox.json", "reply.json", "send_mail.json", "send_mail_attachment.json", "send_mail_blob_attachment.json"];
export declare const JMAP_MAIL_URN: "urn:ietf:params:jmap:mail";
export declare const JMAP_BLOB_URN: "urn:ietf:params:jmap:blob";
export interface JmapEnvelope {
    using: string[];
    methodCalls: unknown[];
}
export declare function parseJmapEnvelope(raw: string, defaultUsing: string[], source: string): JmapEnvelope;
export declare function extractPrimaryMailAccountId(session: Record<string, unknown>): string;
export interface JmapBlobEndpoints {
    uploadUrl: string;
    downloadUrl: string;
}
export declare function extractBlobEndpoints(session: Record<string, unknown>): JmapBlobEndpoints;
export declare function extractJmapApiUrl(session: Record<string, unknown>): string;
export declare function extractBlobUploadLimits(session: Record<string, unknown>, accountId: string): JmapBlobUploadLimits | null;
export declare function fetchJmapWellKnown(apiUrl: string, capabilityJwt: string): Promise<Record<string, unknown>>;
/** Integration JMAP session port (KeyValue-backed AgentSession). */
export interface IntegrationJmapSessionPort {
    readonly apiUrl: string;
    getJmapPostUrl(): Promise<string>;
    getPrimaryMailAccountId(): Promise<string>;
    getCapabilityToken(): Promise<string>;
    readonly currentInboxId?: string;
    readonly currentUploadUrl?: string;
    readonly currentDownloadUrl?: string;
    getBlobUploadLimitsForAccount(accountId: string): Promise<JmapBlobUploadLimits | null>;
}
export interface RunJmapRequestInput {
    session: IntegrationJmapSessionPort;
    opsJson: string;
    defaultUsing: string[];
    sourceLabel: string;
    dryRun?: boolean;
    vars?: Record<string, string>;
}
export declare function runJmapRequest(input: RunJmapRequestInput): Promise<{
    ok: boolean;
    status: number;
    bodyText: string;
}>;
export declare function fetchInboxMailboxId(port: IntegrationJmapSessionPort): Promise<string>;
export declare function postJmap(jmapPostUrl: string, capabilityJwt: string, envelope: JmapEnvelope): Promise<{
    ok: boolean;
    status: number;
    bodyText: string;
}>;
export declare function attachJmapNextHints(bodyText: string): string;
//# sourceMappingURL=agent-jmap-run.d.ts.map