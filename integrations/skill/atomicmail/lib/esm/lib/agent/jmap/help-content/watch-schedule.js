// watch="scheduled" resolver.
//
// Detects the *calling runtime* from environment-variable markers (each runtime
// stamps its own vars — CLAUDECODE for Claude Code, OPENCLAW_HOME for OpenClaw,
// etc.) and produces ONE setup step instead of a menu. PATH says what is
// installed, not who invoked the CLI, so it is never used to pick the caller.
//
// Every supported runtime is scheduled by its *own* durable scheduler — OS-level
// jobs (launchd/systemd/crontab) are deliberately not generated: they run outside
// the host's permission model, are invisible to it, and AGENTS.md forbids them.
// A runtime whose only scheduler is session-scoped counts as having none.
//
// Two shapes come out of here: a shell command (hosts with a cron CLI) and an
// instruction (hosts whose scheduler is driven by the agent itself, e.g. Claude
// Code routines). Neither is executed here — the agent runs its own scheduler
// through its own tools, so the host's permission gate still fires. When no
// runtime can be identified we emit nothing runnable: never a placeholder.
//
// The scheduled prompt carries an explicit --credentials-dir. Scheduled sessions
// do not inherit the environment that ran register on any host, so relying on
// ATOMIC_MAIL_CREDENTIALS_DIR reaching them is a defect, not a shortcut.
//
// Templates and framing live in shared/help/watch_schedule.json; the prompt in
// the shared cron fragment. Wrapper-side composition — never threaded into
// session.register.
import { existsSync } from "node:fs";
import process from "node:process";
import { tryReadSharedJson, tryReadSharedText, } from "../../../core/shared-assets.js";
const SCHEDULE_FALLBACK = 'watch="scheduled": set up a recurring inbox agent job on your host\'s own ' +
    'scheduler — see help topic "cron".';
const DEFAULT_CREDENTIALS_DIR = "~/.atomicmail";
/** Fill in whatever the caller did not supply from the real environment. */
function resolveEnv(partial = {}) {
    const env = partial.env ?? process.env;
    return {
        env,
        credentialsDir: partial.credentialsDir ??
            env.ATOMIC_MAIL_CREDENTIALS_DIR ?? DEFAULT_CREDENTIALS_DIR,
        inboxId: partial.inboxId,
        exists: partial.exists ?? ((p) => existsSync(p)),
    };
}
/**
 * `atomicmail-inbox-alice` from `alice@atomicmail.ai`. Job names land in shell
 * commands and host job registries, so anything outside a safe slug is dropped
 * rather than quoted.
 */
function jobName(prefix, inboxId) {
    const slug = (inboxId ?? "").split("@")[0].toLowerCase().replace(/[^a-z0-9-]/g, "");
    return slug ? `${prefix}-${slug}` : prefix;
}
/** True when at least one of the runtime's marker vars is set to a non-empty value. */
function markerPresent(rt, env) {
    return rt.env.some((name) => {
        const v = env.env[name];
        return v !== undefined && v !== "";
    });
}
/**
 * Resolve the calling runtime from env markers alone. PATH is never consulted:
 * an installed binary is not evidence that it invoked us — that mistake once made
 * a Claude Code session emit an OpenClaw command.
 */
export function detectSchedule(data, env) {
    for (const rt of data.runtimes) {
        if (!markerPresent(rt, env))
            continue;
        return { runtime: rt.id, scheduler: rt.scheduler, label: rt.label };
    }
    return {};
}
/**
 * Calling-runtime identity for telemetry, independent of `watch`: whether an env
 * marker matched and which runtime it was. Reads markers only — no PATH, no I/O
 * beyond the shared JSON — and carries no inbox identifiers.
 */
export function detectRuntime(partial = {}) {
    const env = resolveEnv(partial);
    const data = tryReadSharedJson("help/watch_schedule.json");
    if (!data)
        return { detected: false };
    const detection = detectSchedule(data, env);
    return {
        detected: detection.runtime !== undefined,
        runtime: detection.runtime,
    };
}
function fill(template, vars) {
    return template.replace(/\{(\w+)\}/g, (_m, key) => vars[key] ?? `{${key}}`);
}
/**
 * Resolve everything needed to schedule, or explain plainly why we cannot.
 * `status: "unavailable"` still carries the prompt so the operator has something
 * actionable — but never a command with an unfilled placeholder.
 */
export function resolveSchedule(partial = {}) {
    const env = resolveEnv(partial);
    const data = tryReadSharedJson("help/watch_schedule.json");
    const promptRaw = tryReadSharedText("help/fragments/inbox_cron_agent_prompt.md")?.trim();
    if (!data || !promptRaw) {
        return { status: "unavailable", message: SCHEDULE_FALLBACK };
    }
    const { interval, block } = data;
    const prompt = fill(promptRaw, { CREDENTIALS_DIR: env.credentialsDir });
    const base = {
        CRON: interval.cron,
        HUMAN: interval.human,
        PRESET: interval.preset,
        TIME: interval.time,
        PROMPT: prompt,
        JOB_NAME: jobName(data.job_name_prefix, env.inboxId),
        // The prompt's read-only wording is prose; the host's tool allowlist is what
        // actually binds an unattended run that reads untrusted mail.
        LEAST_PRIVILEGE: block.least_privilege,
    };
    const detection = detectSchedule(data, env);
    if (!detection.scheduler) {
        return { status: "unavailable", message: fill(block.unknown, base) };
    }
    if (detection.scheduler === "none") {
        return {
            status: "unavailable",
            message: fill(block.no_scheduler, {
                ...base,
                LABEL: detection.label ?? detection.runtime ?? "this runtime",
            }),
        };
    }
    const spec = data.schedulers[detection.scheduler];
    if (!spec) {
        return { status: "unavailable", message: fill(block.unknown, base) };
    }
    // A host that has its own flag for restricting a job (OpenClaw's --tools,
    // Hermes' enabled_toolsets) gets that named instead of the generic advice.
    const hostBase = {
        ...base,
        LEAST_PRIVILEGE: spec.least_privilege
            ? fill(spec.least_privilege, base)
            : base.LEAST_PRIVILEGE,
    };
    const verify = fill(spec.verify, hostBase);
    const remove = fill(spec.remove, hostBase);
    if (spec.kind === "command") {
        const runCommand = (spec.command ?? []).map((l) => fill(l, base)).join("\n");
        return {
            status: "plan",
            plan: {
                kind: "command",
                runtime: detection.runtime,
                scheduler: detection.scheduler,
                label: spec.label,
                runCommand,
                verify,
                remove,
                setupBlock: fill(block.command, {
                    ...hostBase,
                    LABEL: spec.label,
                    COMMAND: runCommand,
                    VERIFY: verify,
                    REMOVE: remove,
                }),
            },
        };
    }
    const instruction = (spec.instruction ?? []).map((l) => fill(l, base)).join("\n");
    return {
        status: "plan",
        plan: {
            kind: "instruction",
            runtime: detection.runtime,
            scheduler: detection.scheduler,
            label: spec.label,
            instruction,
            verify,
            remove,
            setupBlock: fill(block.instruction, {
                ...hostBase,
                LABEL: spec.label,
                INSTRUCTION: instruction,
                VERIFY: verify,
                REMOVE: remove,
            }),
        },
    };
}
/**
 * The watch="scheduled" text: the ready setup step for the detected runtime with
 * verify + removal, or a plain explanation of why none could be produced. Nothing
 * is executed here or by any caller — the agent drives its own scheduler, so the
 * host's permission gate stays in the loop.
 */
export function buildWatchScheduledBlock(env = {}) {
    const res = resolveSchedule(env);
    return res.status === "unavailable" ? res.message : res.plan.setupBlock;
}
/** Alias kept for existing call sites. */
export function watchScheduledSetup(env) {
    return buildWatchScheduledBlock(env);
}
