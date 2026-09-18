/** How a host is told to schedule: run a command, or follow an instruction. */
export type SchedulerKind = "command" | "instruction";
interface SchedulerSpec {
    kind: SchedulerKind;
    label: string;
    /** Shell command lines (kind "command"). */
    command?: string[];
    /** Instruction lines for the agent's own scheduler (kind "instruction"). */
    instruction?: string[];
    verify: string;
    remove: string;
    /** Host-specific tool-restriction wording; falls back to the generic one. */
    least_privilege?: string;
}
/** One calling-runtime fingerprint: which env markers identify it, and how it schedules. */
interface RuntimeMarker {
    id: string;
    /** Key into `schedulers`, or "none" when the runtime has no durable scheduler. */
    scheduler: string;
    /** Display name, used when scheduler is "none". */
    label?: string;
    /** Env var names whose presence (non-empty) marks this runtime as the caller. */
    env: string[];
}
interface WatchScheduleData {
    interval: {
        cron: string;
        human: string;
        preset: string;
        time: string;
    };
    /** Base job name; the inbox is appended so several inboxes cannot collide. */
    job_name_prefix: string;
    runtimes: RuntimeMarker[];
    schedulers: Record<string, SchedulerSpec>;
    block: {
        command: string;
        instruction: string;
        /** Tool-allowlist requirement, spliced into both setup blocks. */
        least_privilege: string;
        no_scheduler: string;
        unknown: string;
    };
}
export interface ScheduleEnv {
    /** Environment variables, for calling-runtime marker lookup (default: process.env). */
    env: Record<string, string | undefined>;
    /**
     * Absolute credentials directory to bake into the scheduled prompt. Scheduled
     * sessions inherit no environment, so this must be a literal path, not a
     * variable reference.
     */
    credentialsDir: string;
    /**
     * Inbox this schedule watches. Appended to the job name so a second inbox
     * cannot silently overwrite the first one's job — multi-account is a
     * supported flow, and one fixed name across N inboxes loses N-1 of them.
     */
    inboxId?: string;
    /** File-existence probe, kept for callers that stub the environment. */
    exists: (p: string) => boolean;
}
export interface ScheduleDetection {
    /** Runtime id, or undefined when no marker matched. */
    runtime?: string;
    /** Key into `schedulers`, "none", or undefined when unidentified. */
    scheduler?: string;
    label?: string;
}
/** A fully-resolved, ready-to-follow setup step for the detected runtime. */
export interface SchedulePlan {
    kind: SchedulerKind;
    runtime: string;
    scheduler: string;
    label: string;
    /** The exact shell command to run (kind "command" only). */
    runCommand?: string;
    /** The setup instruction to follow (kind "instruction" only). */
    instruction?: string;
    verify: string;
    remove: string;
    /** Pre-rendered block for printing, whichever kind applies. */
    setupBlock: string;
}
export type ScheduleResolution = {
    status: "plan";
    plan: SchedulePlan;
} | {
    status: "unavailable";
    message: string;
};
/**
 * Resolve the calling runtime from env markers alone. PATH is never consulted:
 * an installed binary is not evidence that it invoked us — that mistake once made
 * a Claude Code session emit an OpenClaw command.
 */
export declare function detectSchedule(data: WatchScheduleData, env: ScheduleEnv): ScheduleDetection;
/**
 * Calling-runtime identity for telemetry, independent of `watch`: whether an env
 * marker matched and which runtime it was. Reads markers only — no PATH, no I/O
 * beyond the shared JSON — and carries no inbox identifiers.
 */
export declare function detectRuntime(partial?: Partial<ScheduleEnv>): {
    detected: boolean;
    runtime?: string;
};
/**
 * Resolve everything needed to schedule, or explain plainly why we cannot.
 * `status: "unavailable"` still carries the prompt so the operator has something
 * actionable — but never a command with an unfilled placeholder.
 */
export declare function resolveSchedule(partial?: Partial<ScheduleEnv>): ScheduleResolution;
/**
 * The watch="scheduled" text: the ready setup step for the detected runtime with
 * verify + removal, or a plain explanation of why none could be produced. Nothing
 * is executed here or by any caller — the agent drives its own scheduler, so the
 * host's permission gate stays in the loop.
 */
export declare function buildWatchScheduledBlock(env?: Partial<ScheduleEnv>): string;
/** Alias kept for existing call sites. */
export declare function watchScheduledSetup(env?: Partial<ScheduleEnv>): string;
export {};
//# sourceMappingURL=watch-schedule.d.ts.map