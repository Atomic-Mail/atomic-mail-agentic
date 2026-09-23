type SharedErrorMap = Record<string, string>;
declare const SHARED_ERRORS: SharedErrorMap;
export declare function sharedError(key: keyof typeof SHARED_ERRORS): string;
export declare function sharedErrorTemplate(key: keyof typeof SHARED_ERRORS, values: Record<string, string | number>): string;
/**
 * Flattened text for the missing/invalid `watch` precondition on register,
 * assembled from three shared string keys (errors.json stays all-strings).
 * Used by the MCP tool schema and the skill CLI only — never by session.register.
 */
export declare function registerWatchRequiredError(): string;
export {};
//# sourceMappingURL=messages.d.ts.map