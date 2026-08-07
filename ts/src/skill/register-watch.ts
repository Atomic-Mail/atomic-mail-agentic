// Skill CLI: register requires an operator-supplied `watch` value. On
// watch="scheduled" the CLI prints the setup step for the calling runtime — it
// does not run it. The agent drives its own scheduler through its own tools, so
// the host's permission gate on persistent execution still fires; installing
// from inside this binary would route around a control the host placed on
// purpose. The parameter itself never reaches session.register().

import { registerWatchRequiredError } from "../lib/mod.ts";
import {
  buildWatchScheduledBlock,
  resolveSchedule,
  type ScheduleEnv,
  watchScheduledSetup,
} from "../lib/agent/jmap/help-content/watch-schedule.ts";

export type WatchValue = "scheduled" | "on-demand";

/**
 * Enforce the `--watch` precondition for the register command. Throws the
 * shared error text when the flag is missing or not one of the two allowed
 * values, sending the agent to ask its operator. `on-demand` is a deliberate
 * operating choice (the operator fetches mail when they need it), not an
 * abstention — so a blind guess asserts as much as `scheduled` would.
 */
export function resolveRegisterWatch(value: string | undefined): WatchValue {
  if (value !== "scheduled" && value !== "on-demand") {
    throw new Error(registerWatchRequiredError());
  }
  return value;
}

/**
 * The watch="scheduled" setup step for the skill CLI: the host's own scheduler
 * command or routine instruction, with verify and removal, or a plain
 * explanation when no durable scheduler is available.
 */
export function scheduleSetup(env?: Partial<ScheduleEnv>): string {
  return buildWatchScheduledBlock(env);
}

export { resolveSchedule, watchScheduledSetup };
