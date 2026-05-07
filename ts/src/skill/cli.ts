// Atomic Mail AgentSkill — register | jmap_request | help

import process from "node:process";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { homedir } from "node:os";

import {
  AgentSession,
  DEFAULT_JMAP_USING,
  DEFAULT_POW_SCRYPT_SALT_HEX,
  defaultFilesFromOutDir,
  getHelp,
  persistLoginWithApiKey,
  readCredentials,
  readOpsFile,
  runJmapRequest,
} from "../lib/mod.ts";

const USAGE = `Atomic Mail — AgentSkill

Usage:
  atomicmail <command> [options]

Commands:
  register       PoW signup or login with API key (writes credentials)
  jmap_request   Send a JMAP batch (inline --ops or --ops-file preset)
  help           Full documentation [--topic TOPIC]

Examples:
  atomicmail register --username alice
  atomicmail register --api-key UUID
  atomicmail jmap_request --credentials-dir ./.atomic-mail --ops-file fetch.json
  atomicmail jmap_request --credentials-dir ./.atomic-mail --ops-file send.json --vars '{"TO":"a@b.com","SUBJECT":"Hi"}'
  atomicmail help --topic presets

Run  atomicmail <command> --help  for command-specific flags.
`;

function exitUsage(code = 0): never {
  process.stdout.write(USAGE);
  process.exit(code);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(code);
}

function resolveCredentialDir(dir?: string): string {
  const raw = dir ?? process.env.ATOMIC_MAIL_CREDENTIALS_DIR ?? "~/.atomicmail";
  if (raw === "~") return homedir();
  return resolve(raw.replace(/^~\//, `${homedir()}/`));
}

async function cmdRegister(argv: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        "auth-url": { type: "string" },
        "api-url": { type: "string" },
        "scrypt-salt": { type: "string" },
        username: { type: "string" },
        "api-key": { type: "string" },
        "credentials-dir": { type: "string" },
        quiet: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    fail((err as Error).message, 2);
  }

  if (parsed.values.help) {
    process.stdout.write(`Usage: atomicmail register [OPTIONS]

Register a new inbox (--username) or log in with an existing API key (--api-key).

Options:
  --auth-url URL       Auth-service base URL [env: ATOMIC_MAIL_AUTH_URL, default: https://auth.atomicmail.ai]
  --api-url URL        API / JMAP base URL [env: ATOMIC_MAIL_API_URL, default: https://api.atomicmail.ai]
  --scrypt-salt SALT   PoW salt override [env: ATOMIC_MAIL_SCRYPT_SALT]
  --username NAME      New account (mutually exclusive with --api-key)
  --api-key KEY        Existing API key (mutually exclusive with --username)
  --credentials-dir DIR  Credential directory (default: ~/.atomicmail)
  --quiet              Less stderr output
  --help, -h           This message
`);
    process.exit(0);
  }

  const env = process.env;
  const authUrl = (parsed.values["auth-url"] as string | undefined) ??
    env.ATOMIC_MAIL_AUTH_URL ?? "https://auth.atomicmail.ai";
  const apiUrl = (parsed.values["api-url"] as string | undefined) ??
    env.ATOMIC_MAIL_API_URL ?? "https://api.atomicmail.ai";
  const scryptSalt = (parsed.values["scrypt-salt"] as string | undefined) ??
    env.ATOMIC_MAIL_SCRYPT_SALT ?? DEFAULT_POW_SCRYPT_SALT_HEX;
  const dir = parsed.values["credentials-dir"] as string | undefined;
  const credentialDir = resolveCredentialDir(dir);

  const username = parsed.values.username as string | undefined;
  const apiKey = parsed.values["api-key"] as string | undefined;
  if (!!username === !!apiKey) {
    fail(
      "Provide exactly one of --username (new account) or --api-key (login).",
      2,
    );
  }

  const files = defaultFilesFromOutDir(credentialDir);
  const log = (msg: string) => {
    if (!parsed.values.quiet) process.stderr.write(msg + "\n");
  };

  if (username) {
    log(`Registering "${username}"...`);
    const session = await AgentSession.create({
      authUrl,
      apiUrl,
      scryptSalt,
      credentialDir,
      files,
    });
    const result = await session.register(username);
    log(`Wrote credentials under ${credentialDir}`);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  log("Logging in with API key...");
  const { inboxId } = await persistLoginWithApiKey({
    authUrl,
    apiUrl,
    scryptSalt,
    apiKey: apiKey!,
    files,
  });
  log(`Wrote ${files.credentialsFile}`);
  process.stdout.write(JSON.stringify({ inboxId }, null, 2) + "\n");
}

async function cmdJmapRequest(argv: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        "credentials-dir": { type: "string" },
        "credentials-file": { type: "string" },
        "session-file": { type: "string" },
        "capability-file": { type: "string" },
        ops: { type: "string" },
        "ops-file": { type: "string" },
        using: { type: "string" },
        "dry-run": { type: "boolean" },
        vars: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    fail((err as Error).message, 2);
  }

  if (parsed.values.help) {
    process.stdout.write(`Usage: atomicmail jmap_request [OPTIONS]

Send a JMAP request using saved credentials.

Options:
  --credentials-dir DIR      Directory with credentials.json + JWTs (default: ~/.atomicmail)
  --credentials-file PATH    Override credentials.json path
  --session-file PATH        Override session.jwt path
  --capability-file PATH     Override capability.jwt path
  --ops JSON                 Inline JMAP JSON (methodCalls or envelope)
  --ops-file PATH            Preset file ($VAR_NAME placeholders supported)
  --vars JSON                JSON object { VAR_NAME: string } for $VAR_NAME in ops / ops-file
  --using LIST               Comma-separated capability URNs (optional)
  --dry-run                  Print resolved request only
  --help, -h                 This message
`);
    process.exit(0);
  }

  const dir = parsed.values["credentials-dir"] as string | undefined;
  const credentialDir = resolveCredentialDir(dir);
  const defaults = defaultFilesFromOutDir(credentialDir);
  const credentialsFile =
    (parsed.values["credentials-file"] as string | undefined) ??
      defaults.credentialsFile;
  const sessionFile = (parsed.values["session-file"] as string | undefined) ??
    defaults.sessionFile;
  const capabilityFile =
    (parsed.values["capability-file"] as string | undefined) ??
      defaults.capabilityFile;

  const ops = parsed.values.ops as string | undefined;
  const opsFile = parsed.values["ops-file"] as string | undefined;
  if (ops && opsFile) {
    fail("--ops and --ops-file are mutually exclusive.", 2);
  }
  if (!ops && !opsFile) {
    fail("Provide --ops or --ops-file.", 2);
  }

  const usingFlag = parsed.values.using as string | undefined;
  const defaultUsing = usingFlag
    ? usingFlag.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    : [...DEFAULT_JMAP_USING];

  let userVars: Record<string, string> | undefined;
  const varsFlag = parsed.values.vars as string | undefined;
  if (varsFlag !== undefined) {
    let obj: unknown;
    try {
      obj = JSON.parse(varsFlag);
    } catch (err) {
      fail(`--vars is not valid JSON: ${(err as Error).message}`, 2);
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      fail("--vars must be a JSON object of { VAR_NAME: string }.", 2);
    }
    for (
      const [k, v] of Object.entries(obj as Record<string, unknown>)
    ) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(k)) {
        fail(
          `--vars key '${k}' must match /^[A-Z][A-Z0-9_]*$/.`,
          2,
        );
      }
      if (typeof v !== "string") {
        fail(`--vars value for '${k}' must be a string.`, 2);
      }
    }
    userVars = obj as Record<string, string>;
  }

  const creds = await readCredentials(credentialsFile);
  const files = {
    credentialsFile,
    sessionFile,
    capabilityFile,
  };
  const session = await AgentSession.create({
    authUrl: creds.authUrl,
    apiUrl: creds.apiUrl,
    scryptSalt: creds.scryptSalt,
    apiKey: creds.apiKey,
    inboxId: creds.inboxId,
    credentialDir,
    files,
  });

  let raw: string;
  let sourceLabel: string;
  if (opsFile) {
    try {
      raw = await readOpsFile(credentialDir, opsFile);
    } catch (err) {
      fail(`Could not read --ops-file: ${(err as Error).message}`, 2);
    }
    sourceLabel = opsFile;
  } else {
    raw = ops!;
    sourceLabel = "ops";
  }

  const { ok, status, bodyText } = await runJmapRequest({
    session,
    opsJson: raw,
    defaultUsing,
    sourceLabel,
    dryRun: parsed.values["dry-run"] === true,
    vars: userVars,
  });

  if (!ok) {
    fail(`JMAP request failed (HTTP ${status}): ${bodyText}`, 1);
  }
  process.stdout.write(bodyText.endsWith("\n") ? bodyText : bodyText + "\n");
}

function cmdHelp(argv: string[]): void {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        topic: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    fail((err as Error).message, 2);
  }

  if (parsed.values.help) {
    process.stdout.write(`Usage: atomicmail help [--topic TOPIC]

Topics include: overview, installation, auth, jmap_cheatsheet, tools, presets, troubleshooting.
`);
    process.exit(0);
  }

  const topic = parsed.values.topic as string | undefined;
  process.stdout.write(getHelp(topic) + "\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    exitUsage(0);
  }

  const cmd = argv[0];
  const rest = argv.slice(1);

  switch (cmd) {
    case "register":
      await cmdRegister(rest);
      break;
    case "jmap_request":
      await cmdJmapRequest(rest);
      break;
    case "help":
      cmdHelp(rest);
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n`);
      process.stdout.write(USAGE);
      process.exit(2);
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
