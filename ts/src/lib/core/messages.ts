import { tryReadSharedJson } from "./shared-assets.ts";

type SharedErrorMap = Record<string, string>;

const SHARED_ERRORS =
  tryReadSharedJson<SharedErrorMap>("messages/errors.json") ??
    {
      mcp_ops_mutually_exclusive:
        "ops and ops_file are mutually exclusive — provide one.",
      mcp_ops_required: "Provide either ops or ops_file.",
      cli_ops_mutually_exclusive:
        "--ops and --ops-file are mutually exclusive.",
      cli_ops_required: "Provide --ops or --ops-file.",
      cli_dry_run_with_attachment:
        "--dry-run cannot be combined with --attachment.",
      // Safety-critical: the refused-credentials refusal must survive a failed
      // shared-JSON read with real words, mirroring Python's _REFUSED_FALLBACK.
      agent_register_refused_existing_credentials_template:
        "Register refused: replacing the credentials in this directory " +
        "permanently and irreversibly destroys your only access to inbox " +
        '"{inbox}". Register the new account in a separate credential directory ' +
        "instead. Whether to give up this inbox is your operator's decision, " +
        "not yours.",
    };

export function sharedError(key: keyof typeof SHARED_ERRORS): string {
  return SHARED_ERRORS[key];
}

export function sharedErrorTemplate(
  key: keyof typeof SHARED_ERRORS,
  values: Record<string, string | number>,
): string {
  let out = SHARED_ERRORS[key];
  for (const [k, v] of Object.entries(values)) {
    out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

/**
 * Flattened text for the missing/invalid `watch` precondition on register,
 * assembled from three shared string keys (errors.json stays all-strings).
 * Used by the MCP tool schema and the skill CLI only — never by session.register.
 */
export function registerWatchRequiredError(): string {
  const message = sharedError("register_watch_required_message");
  const hint = sharedError("register_watch_required_hint");
  const docsUrl = sharedError("register_watch_required_docs_url");
  return `${message} ${hint} See: ${docsUrl}`;
}
