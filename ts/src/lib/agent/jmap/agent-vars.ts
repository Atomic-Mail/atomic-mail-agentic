// Variable substitution for JMAP presets / inline ops ($VAR_NAME tokens).

/** Matches `$FOO_BAR`; excludes JMAP keywords like `$draft` (lowercase). */
export const VAR_PATTERN = /\$([A-Z][A-Z0-9_]*)/g;

function varPattern(): RegExp {
  return new RegExp(VAR_PATTERN.source, VAR_PATTERN.flags);
}

/** Names substituted from JMAP session / credentials when not overridden in `vars`. */
export const SESSION_VAR_NAMES = new Set<string>(["ACCOUNT_ID", "INBOX"]);

export interface SubstituteVarsInput {
  raw: string;
  /** Caller-supplied values; keys are names without `$` (e.g. `TO`, `SUBJECT`). */
  vars?: Record<string, string>;
  /** Invoked only when the name appears in `raw`, is absent from `vars`, and a resolver exists. */
  autoResolvers?: Record<string, () => Promise<string> | string>;
}

export interface SubstituteVarsResult {
  text: string;
}

/** Unique variable names in order of first occurrence (without leading `$`). */
export function findVarReferences(raw: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const m of raw.matchAll(varPattern())) {
    const name = m[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  }
  return order;
}

function formatMissingError(missing: string[]): Error {
  const tokens = missing.map((n) => `$${n}`);
  const hasSession = missing.some((n) => SESSION_VAR_NAMES.has(n));
  let msg = `Missing values for variables: ${tokens.join(", ")}. ` +
    "Pass custom placeholders in vars (MCP) or --vars (skill).";
  if (hasSession) {
    msg +=
      " For $ACCOUNT_ID and $INBOX, ensure register completed and credentials are valid, " +
      "or pass overrides in vars.";
  }
  return new Error(msg);
}

/**
 * Replaces every `$VAR_NAME` in `raw` with the corresponding string.
 * Single pass — values are not scanned for further `$` tokens.
 * Throws if any referenced variable has no value (after vars + autoResolvers).
 */
export async function substituteVars(
  input: SubstituteVarsInput,
): Promise<SubstituteVarsResult> {
  const names = findVarReferences(input.raw);
  if (names.length === 0) {
    return { text: input.raw };
  }

  const userVars = input.vars ?? {};
  const resolved = new Map<string, string>();

  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(userVars, name)) {
      resolved.set(name, userVars[name]!);
      continue;
    }
    const resolver = input.autoResolvers?.[name];
    if (resolver) {
      resolved.set(name, await resolver());
      continue;
    }
  }

  const missing = names.filter((n) => !resolved.has(n));
  if (missing.length > 0) {
    throw formatMissingError(missing);
  }

  const text = input.raw.replace(varPattern(), (_full, name: string) => {
    return resolved.get(name)!;
  });

  return { text };
}
