import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";

import {
  resolveRegisterWatch,
  scheduleSetup,
  watchScheduledSetup,
} from "./register-watch.ts";
import type { ScheduleEnv } from "../lib/agent/jmap/help-content/watch-schedule.ts";
import { REGISTER_HELP } from "./cli.ts";

function envWith(markers: Record<string, string>): ScheduleEnv {
  return { env: markers, credentialsDir: "/tmp/creds", exists: () => false };
}

const ANGLE_PLACEHOLDER =
  /<[^>\n]*(your|agent|command|placeholder|todo)[^>\n]*>/i;

Deno.test("resolveRegisterWatch rejects a missing flag with the shared error", () => {
  const err = assertThrows(
    () => resolveRegisterWatch(undefined),
    Error,
  );
  assertStringIncludes(err.message, "register requires 'watch'");
  assertStringIncludes(err.message, "operator's decision");
  assertStringIncludes(err.message, "theirs, not yours");
});

Deno.test("the required-watch error opens with the requirement, not an explanation", () => {
  const err = assertThrows(() => resolveRegisterWatch(undefined), Error);
  // First sentence is the requirement, not a description of the flag.
  assert(err.message.startsWith("register requires 'watch'"));
  // What each value means is deferred to help topic cron; if the error explained
  // it, an agent would decide from the text instead of asking.
  assertStringIncludes(err.message, "help topic cron");
  for (
    const leak of [
      "recurring job",
      "once a day",
      "sits unread",
      "nobody is told",
      "silently loses",
    ]
  ) {
    if (err.message.includes(leak)) {
      throw new Error(
        `watch error must not explain the values; leaked: "${leak}"`,
      );
    }
  }
});

Deno.test("resolveRegisterWatch rejects an unknown value", () => {
  assertThrows(
    () => resolveRegisterWatch("weekly"),
    Error,
    "register requires 'watch'",
  );
  // `none` is no longer accepted — it was renamed to `on-demand`.
  assertThrows(
    () => resolveRegisterWatch("none"),
    Error,
    "register requires 'watch'",
  );
});

Deno.test("resolveRegisterWatch accepts the two allowed values", () => {
  assertEquals(resolveRegisterWatch("scheduled"), "scheduled");
  assertEquals(resolveRegisterWatch("on-demand"), "on-demand");
});

Deno.test("register --help does not enumerate the accepted watch values", () => {
  // Values off --help let an agent fill the flag without reading the error's
  // "operator's decision" wording. They must appear only in the error.
  assertStringIncludes(REGISTER_HELP, "--watch");
  for (const value of ["scheduled", "on-demand"]) {
    if (REGISTER_HELP.includes(value)) {
      throw new Error(`--help must not enumerate watch value "${value}"`);
    }
  }
});

Deno.test("register --help does not list --forced", () => {
  // A ready-made replace flag in --help is what an agent reaches for; overwriting
  // an inbox is irreversible, so --forced is documented only in the refusal error.
  if (REGISTER_HELP.includes("--forced")) {
    throw new Error("--help must not list --forced");
  }
});

Deno.test("the required-watch error names both accepted values", () => {
  const err = assertThrows(() => resolveRegisterWatch(undefined), Error);
  assertStringIncludes(err.message, "scheduled");
  assertStringIncludes(err.message, "on-demand");
});

Deno.test("scheduleSetup emits an authorised, non-empty scheduled block", () => {
  // Host-specific detection is covered in watch-schedule.test.ts; here we only
  // assert the skill re-export resolves and carries the imperative anchor.
  const block = scheduleSetup(envWith({ OPENCLAW_HOME: "/x" }));
  assertStringIncludes(block, 'watch="scheduled"');
  assertStringIncludes(block, "openclaw cron add");
  assertStringIncludes(block, "atomicmail-inbox");
});

Deno.test("the skill surface is the same as the MCP one: both print", () => {
  // The CLI once executed the install itself, which routed around the host's
  // permission gate on persistent execution. It now only prints; the agent runs
  // its own scheduler through its own tools, so the gate still fires.
  const env = envWith({ OPENCLAW_HOME: "/x" });
  assertEquals(scheduleSetup(env), watchScheduledSetup(env));
});

Deno.test("skill setup never claims to have installed anything", () => {
  for (
    const markers of [
      { OPENCLAW_HOME: "/x" },
      { CLAUDECODE: "1" },
      { CURSOR_AGENT: "1" },
      {},
    ] as Record<string, string>[]
  ) {
    const out = scheduleSetup(envWith(markers));
    assert(!out.includes("I scheduled"), JSON.stringify(markers));
    assert(!out.includes("done:"), JSON.stringify(markers));
    assert(!ANGLE_PLACEHOLDER.test(out), JSON.stringify(markers));
  }
});
