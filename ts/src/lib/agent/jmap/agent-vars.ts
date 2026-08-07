// Variable substitution for JMAP presets / inline ops ($VAR_NAME tokens).

/** Keys allowed in MCP `vars` / skill `--vars` (without leading `$`). */
export const USER_VAR_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Parses a JSON object of string values (skill `--vars` / MCP `vars`).
 * Throws `Error` with the same messages the CLI used to emit via `fail(...)`.
 */
export function parseUserVarsJson(jsonString: string): Record<string, string> {
  let obj: unknown;
  try {
    obj = JSON.parse(jsonString);
  } catch (err) {
    throw new Error(
      `--vars is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error(
      "--vars must be a JSON object of { VAR_NAME: string }.",
    );
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (!USER_VAR_KEY_RE.test(k)) {
      throw new Error(
        `--vars key '${k}' must match /^[A-Z][A-Z0-9_]*$/.`,
      );
    }
    if (typeof v !== "string") {
      throw new Error(`--vars value for '${k}' must be a string.`);
    }
  }
  return obj as Record<string, string>;
}

/** Matches `$FOO_BAR`; excludes JMAP keywords like `$draft` (lowercase). */
export const VAR_PATTERN = /\$([A-Z][A-Z0-9_]*)/g;

function varPattern(): RegExp {
  return new RegExp(VAR_PATTERN.source, VAR_PATTERN.flags);
}

/** Names substituted from JMAP session / credentials when not overridden in `vars`. */
export const SESSION_VAR_NAMES = new Set<string>([
  "ACCOUNT_ID",
  "INBOX",
  "INBOX_MAILBOX_ID",
]);

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
      " For $ACCOUNT_ID, $INBOX, and $INBOX_MAILBOX_ID, ensure register completed " +
      "and credentials are valid, or pass overrides in vars.";
  }
  return new Error(msg);
}

const VAR_START_RE = /[A-Z]/;
const VAR_CHAR_RE = /[A-Z0-9_]/;

/**
 * Replaces every `$VAR_NAME` in `raw` with its resolved value, JSON-context
 * aware: when a token sits inside a JSON string literal the value is escaped
 * for string context (so newlines, quotes, backslashes, tabs, and other control
 * characters round-trip and never break `JSON.parse`); bare tokens (outside a
 * string) are substituted verbatim, preserving numeric/structural placeholders.
 *
 * Single pass over the original text — resolved values are not rescanned for
 * further `$` tokens.
 */
export function substituteResolvedVars(
  raw: string,
  resolved: Map<string, string>,
): string {
  let out = "";
  let inString = false;
  let i = 0;
  const n = raw.length;

  while (i < n) {
    const ch = raw[i]!;

    if (inString) {
      // Copy escape pairs verbatim so an escaped quote doesn't close the string
      // and a `$` after a backslash stays correctly positioned.
      if (ch === "\\") {
        out += ch;
        if (i + 1 < n) {
          out += raw[i + 1];
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        i += 1;
        continue;
      }
    } else if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "$" && i + 1 < n && VAR_START_RE.test(raw[i + 1]!)) {
      let j = i + 1;
      while (j < n && VAR_CHAR_RE.test(raw[j]!)) j += 1;
      const name = raw.slice(i + 1, j);
      if (resolved.has(name)) {
        const value = resolved.get(name)!;
        // In string context, escape for a JSON string interior (strip the outer
        // quotes JSON.stringify adds); bare context keeps the raw value.
        out += inString ? JSON.stringify(value).slice(1, -1) : value;
        i = j;
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Resolves every `$VAR_NAME` referenced in `raw` and substitutes it JSON-safely.
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

  return { text: substituteResolvedVars(input.raw, resolved) };
}
