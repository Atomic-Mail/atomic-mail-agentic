import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import {
  buildWatchScheduledBlock,
  detectSchedule,
  type ScheduleEnv,
} from "./watch-schedule.ts";

import {
  tryReadSharedJson,
  tryReadSharedText,
} from "../../../core/shared-assets.ts";

// deno-lint-ignore no-explicit-any
const DATA = tryReadSharedJson<any>("help/watch_schedule.json");
const PROMPT = tryReadSharedText("help/fragments/inbox_cron_agent_prompt.md")!
  .trim();

const DIR = "/tmp/creds";

/** Detection reads env markers only — PATH is never consulted. */
function envWith(markers: Record<string, string>): ScheduleEnv {
  return { env: markers, credentialsDir: DIR, exists: () => false };
}

const COMMAND_HOSTS = [
  "openclaw cron add",
  "hermes cron create",
  "atomic-agent task create",
];

// Every block must constrain what the scheduled job may do. Hosts with their own
// flag name it; the rest get the generic wording.
const PRIVILEGE_MARKERS = [
  "--tools exec", // OpenClaw
  "enabled_toolsets", // Hermes
  "connector", // Claude Code routines
  "tool allowlist", // generic
];

// OS-level scheduling is deliberately not generated: it runs outside the host's
// permission model, and AGENTS.md forbids it. These are the *recipes* — the
// blocks may still name launchd or crontab in order to forbid them.
const OS_RECIPES = [
  "launchctl load",
  "launchctl unload",
  "systemctl --user",
  "| crontab -",
  "crontab -l",
  "LaunchAgents",
  "<plist",
];

const ALL_ENVS: Record<string, string>[] = [
  { CLAUDECODE: "1" },
  { OPENCLAW_HOME: "/x" },
  { HERMES_SESSION: "1" },
  { ATOMIC_AGENT: "1" },
  { CURSOR_AGENT: "1" },
  {},
];

// A fill-me placeholder like <your-agent-command>.
const ANGLE_PLACEHOLDER =
  /<[^>\n]*(your|agent|command|placeholder|todo)[^>\n]*>/i;
// An unfilled template token that leaked through, e.g. {PROMPT}.
const CURLY_TOKEN = /\{[A-Z_]+\}/;

Deno.test("shared JSON: every runtime points at a scheduler that exists", () => {
  for (const rt of DATA.runtimes) {
    if (rt.scheduler === "none") continue;
    assert(
      DATA.schedulers[rt.scheduler],
      `runtime ${rt.id} points at missing scheduler ${rt.scheduler}`,
    );
  }
});

Deno.test("detect: the caller's own marker picks the runtime", () => {
  assertEquals(detectSchedule(DATA, envWith({ OPENCLAW_HOME: "/x" })), {
    runtime: "openclaw",
    scheduler: "openclaw",
    label: undefined,
  });
  assertEquals(
    detectSchedule(DATA, envWith({ CLAUDECODE: "1" })).scheduler,
    "claude-code",
  );
});

Deno.test("detect: what is merely installed is ignored", () => {
  // An empty marker is not a marker: OpenClaw installed but Claude Code calling.
  assertEquals(
    detectSchedule(DATA, envWith({ CLAUDECODE: "1", OPENCLAW_HOME: "" }))
      .scheduler,
    "claude-code",
  );
  assertEquals(detectSchedule(DATA, envWith({})), {});
});

Deno.test("command host: exactly one command, daily cron, verify step", () => {
  const block = buildWatchScheduledBlock(envWith({ OPENCLAW_HOME: "/x" }));
  assertStringIncludes(block, 'watch="scheduled"');
  assertStringIncludes(block, "openclaw cron add");
  assertStringIncludes(block, "0 9 * * *");
  assertStringIncludes(block, "--tools exec");
  assertStringIncludes(block, "openclaw cron list");
  assert(!block.includes("hermes cron create"));
  assert(!block.includes("atomic-agent task create"));
});

Deno.test("claude: a routine instruction, not a shell command", () => {
  const block = buildWatchScheduledBlock(envWith({ CLAUDECODE: "1" }));
  assertStringIncludes(block, "atomicmail-inbox");
  assertStringIncludes(block, "Routines");
  // /loop is session-scoped and expires after seven days — warn against it.
  assertStringIncludes(block, "/loop");
  for (const cmd of COMMAND_HOSTS) assert(!block.includes(cmd));
});

Deno.test("no OS-level scheduling recipe is ever emitted", () => {
  for (const markers of ALL_ENVS) {
    const block = buildWatchScheduledBlock(envWith(markers));
    for (const token of OS_RECIPES) {
      assert(
        !block.includes(token),
        `${token} leaked for ${JSON.stringify(markers)}`,
      );
    }
  }
});

Deno.test("runtime with no durable scheduler asks the operator", () => {
  const block = buildWatchScheduledBlock(envWith({ CURSOR_AGENT: "1" }));
  assertStringIncludes(block, "Cursor");
  assertStringIncludes(block, "operator");
  // Still actionable: the prompt is handed over even with nothing to install.
  assertStringIncludes(block, "list_inbox.json");
  for (const cmd of COMMAND_HOSTS) assert(!block.includes(cmd));
});

Deno.test("unknown runtime: no command, and the operator is named", () => {
  const block = buildWatchScheduledBlock(envWith({}));
  assertStringIncludes(block, 'watch="scheduled"');
  assertStringIncludes(block, "operator");
  for (const cmd of COMMAND_HOSTS) assert(!block.includes(cmd));
});

Deno.test("never emits an unfilled placeholder", () => {
  for (const markers of ALL_ENVS) {
    const block = buildWatchScheduledBlock(envWith(markers));
    assert(!ANGLE_PLACEHOLDER.test(block), JSON.stringify(markers));
    assert(!CURLY_TOKEN.test(block), JSON.stringify(markers));
  }
});

Deno.test("credentials dir is baked in literally, not as a variable", () => {
  // Scheduled sessions inherit no environment on any host.
  for (const markers of ALL_ENVS) {
    const block = buildWatchScheduledBlock(envWith(markers));
    assertStringIncludes(block, `--credentials-dir ${DIR}`);
    assert(!block.includes("ATOMIC_MAIL_CREDENTIALS_DIR"));
  }
});

Deno.test("credentials dir falls back to the env, then the default", () => {
  const fromEnv = buildWatchScheduledBlock({
    env: { OPENCLAW_HOME: "/x", ATOMIC_MAIL_CREDENTIALS_DIR: "/from/env" },
  });
  assertStringIncludes(fromEnv, "--credentials-dir /from/env");
  const fallback = buildWatchScheduledBlock({ env: { OPENCLAW_HOME: "/x" } });
  assertStringIncludes(fallback, "--credentials-dir ~/.atomicmail");
});

Deno.test("every block demands a least-privilege tool allowlist", () => {
  // Prose cannot bind an unattended run that reads untrusted mail; the host's
  // per-job allowlist can. A real OpenClaw run granted exec/write/cron/spawn
  // with toolsAllowIsDefault — and it reached that state through the *unknown*
  // branch, where the agent improvises the job and needs this advice most.
  for (const markers of ALL_ENVS) {
    const block = buildWatchScheduledBlock(envWith(markers));
    assert(
      PRIVILEGE_MARKERS.some((m) => block.includes(m)),
      `no tool restriction for ${JSON.stringify(markers)}`,
    );
  }
});

Deno.test("the scheduled prompt carries no outbound authority", () => {
  const lowered = PROMPT.toLowerCase();
  assertStringIncludes(lowered, "read-only");
  assertStringIncludes(lowered, "do not reply");
  assert(!lowered.includes("stay available"));
});

Deno.test("the prompt has no double quotes, so shell embedding is safe", () => {
  assert(!PROMPT.includes('"'));
});

Deno.test("job name carries the inbox so two inboxes cannot collide", () => {
  // Multi-account is supported; one fixed name across N inboxes loses N-1.
  const a = buildWatchScheduledBlock({
    env: { OPENCLAW_HOME: "/x" },
    credentialsDir: DIR,
    inboxId: "alice@atomicmail.ai",
  });
  const b = buildWatchScheduledBlock({
    env: { OPENCLAW_HOME: "/x" },
    credentialsDir: DIR,
    inboxId: "bob@atomicmail.ai",
  });
  assertStringIncludes(a, "atomicmail-inbox-alice");
  assertStringIncludes(b, "atomicmail-inbox-bob");
  // And the block warns rather than silently overwriting someone else's job.
  assertStringIncludes(a, "do not overwrite it");
});

Deno.test("job name is slugged, not quoted", () => {
  // The name lands in a shell command, so unsafe characters are dropped.
  const out = buildWatchScheduledBlock({
    env: { OPENCLAW_HOME: "/x" },
    credentialsDir: DIR,
    inboxId: 'ali"ce; rm -rf /@atomicmail.ai',
  });
  assertStringIncludes(out, "atomicmail-inbox-alicerm-rf");
  assert(!out.includes("rm -rf /"));
});

Deno.test("job name falls back when the inbox is unknown", () => {
  const out = buildWatchScheduledBlock(envWith({ OPENCLAW_HOME: "/x" }));
  assertStringIncludes(out, "atomicmail-inbox");
});
