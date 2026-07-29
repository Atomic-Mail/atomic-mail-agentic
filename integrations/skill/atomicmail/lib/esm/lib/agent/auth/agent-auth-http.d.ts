import type { UtmParams } from "./agent-utm.js";
export declare function fetchChallenge(authUrl: string): Promise<{
    challengeJWT: string;
    challenge: string;
    difficulty: number;
}>;
export interface SessionResponse {
    sessionJWT: string;
    apiKey?: string;
}
export declare function exchangeSession(authUrl: string, body: {
    challengeJWT: string;
    powHex: string;
    nonce: string;
    apiKey?: string;
    username?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
}): Promise<SessionResponse>;
export declare function fetchCapability(authUrl: string, sessionJWT: string): Promise<string>;
export interface PerformPoWInput {
    authUrl: string;
    scryptSalt: string;
    apiKey?: string;
    username?: string;
    /** Parsed UTM install-attribution; forwarded on the username signup path. */
    utm?: UtmParams;
    onPowProgress?: (nonce: bigint) => void;
}
export declare function performPoWAndSession(input: PerformPoWInput): Promise<SessionResponse>;
//# sourceMappingURL=agent-auth-http.d.ts.map