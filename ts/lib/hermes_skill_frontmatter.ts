export const HERMES_CLI_INVOCATION = "${HERMES_SKILL_DIR}/scripts/atomicmail";
export const HERMES_CREDENTIALS_DIR = "~/.hermes/atomicmail";

const SKILL_DESCRIPTION =
  "Read and write email through the Atomic Mail ESP from an AI agent. Handles proof-of-work authentication and JMAP so the agent thinks in JMAP method calls. Use when the user asks to register an email inbox, list mailboxes, fetch or send email.";

const BLUEPRINT_PROMPT =
  `Use ${HERMES_CLI_INVOCATION} jmap_request --ops-file list_inbox.json to fetch my inbox. Summarize new messages, highlight what needs a reply, and stay available — I may ask you to reply, forward, search, or dig into something important.`;

export function buildHermesFrontmatter(version: string): string {
  const lines = [
    "name: atomicmail",
    `description: ${SKILL_DESCRIPTION}`,
    `version: ${version}`,
    "author: Atomic Mail",
    "license: MIT",
    "platforms: [macos, linux, windows]",
    "metadata:",
    "  hermes:",
    "    tags: [Productivity, Email, Communication, blueprint]",
    "    config:",
    "      - key: atomicmail.credentials_dir",
    "        description: Directory for Atomic Mail credentials and JWT files",
    `        default: ${HERMES_CREDENTIALS_DIR}`,
    "        prompt: Atomic Mail credentials directory",
    "    blueprint:",
    '      schedule: "0 * * * *"',
    "      deliver: origin",
    "      no_agent: false",
    "      prompt: |",
    ...BLUEPRINT_PROMPT.split("\n").map((line) => `        ${line}`),
    "required_environment_variables:",
    "  - name: ATOMIC_MAIL_CREDENTIALS_DIR",
    "    prompt: Atomic Mail credentials directory",
    `    help: Default on Hermes is ${HERMES_CREDENTIALS_DIR} (not ~/.atomicmail). Override only for multi-account setups.`,
    "    required_for: register and jmap_request credential paths",
    "  - name: ATOMIC_MAIL_AUTH_URL",
    "    prompt: Atomic Mail auth service URL",
    "    help: Override default https://auth.atomicmail.ai",
    "    required_for: custom auth endpoint",
    "  - name: ATOMIC_MAIL_API_URL",
    "    prompt: Atomic Mail JMAP API URL",
    "    help: Override default https://api.atomicmail.ai",
    "    required_for: custom API endpoint",
    "  - name: ATOMIC_MAIL_SCRYPT_SALT",
    "    prompt: Atomic Mail PoW scrypt salt override",
    "    help: Only override when directed by Atomic Mail support",
    "    required_for: PoW registration salt override",
    "  - name: ATOMIC_MAIL_API_KEY",
    "    prompt: Atomic Mail API key",
    "    help: Optional — use register with --api-key or store in credentials.json",
    "    required_for: existing-account login without credentials.json",
    "required_credential_files:",
    "  - path: atomicmail/credentials.json",
    "    description: Atomic Mail API key and account metadata (created by register)",
    "  - path: atomicmail/session.jwt",
    "    description: JMAP session JWT (created by register)",
    "  - path: atomicmail/capability.jwt",
    "    description: JMAP capability JWT (created by register)",
  ];
  return lines.join("\n");
}
