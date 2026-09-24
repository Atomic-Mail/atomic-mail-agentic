import { resolveSchedule, type ScheduleEnv, watchScheduledSetup } from "../lib/agent/jmap/help-content/watch-schedule.js";
export type WatchValue = "scheduled" | "on-demand";
/**
 * Enforce the `--watch` precondition for the register command. Throws the
 * shared error text when the flag is missing or not one of the two allowed
 * values, sending the agent to ask its operator. `on-demand` is a deliberate
 * operating choice (the operator fetches mail when they need it), not an
 * abstention — so a blind guess asserts as much as `scheduled` would.
 */
export declare function resolveRegisterWatch(value: string | undefined): WatchValue;
/**
 * The watch="scheduled" setup step for the skill CLI: the host's own scheduler
 * command or routine instruction, with verify and removal, or a plain
 * explanation when no durable scheduler is available.
 */
export declare function scheduleSetup(env?: Partial<ScheduleEnv>): string;
export { resolveSchedule, watchScheduledSetup };
//# sourceMappingURL=register-watch.d.ts.map