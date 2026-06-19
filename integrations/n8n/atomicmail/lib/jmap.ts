import type { AgentSession } from '../vendor/agentic-core/index.js';
import {
	DEFAULT_JMAP_USING,
	readOpsFile,
	runJmapRequest,
} from '../vendor/agentic-core/index.js';

export type JmapExecutionResult =
	| { ok: true; status: number; body: unknown }
	| { ok: false; status: number; body: unknown; message: string };

export type VarsParseResult =
	| { ok: true; vars?: Record<string, string> }
	| { ok: false; message: string };

export async function executePreset(
	session: AgentSession,
	opsFile: string,
	vars?: Record<string, string>,
	options: { dryRun?: boolean } = {},
): Promise<JmapExecutionResult> {
	const opsJson = await readOpsFile(session.credentialDir, opsFile);
	const { ok, status, bodyText } = await runJmapRequest({
		session,
		opsJson,
		defaultUsing: [...DEFAULT_JMAP_USING],
		sourceLabel: `ops_file '${opsFile}'`,
		vars,
		dryRun: options.dryRun,
	});

	let body: unknown = bodyText;
	try {
		body = JSON.parse(bodyText);
	} catch {
		// keep raw text
	}

	if (!ok) {
		return {
			ok: false,
			status,
			body,
			message: `JMAP request failed (HTTP ${status}): ${bodyText}`,
		};
	}

	return { ok: true, status, body };
}

export async function executeOpsJson(
	session: AgentSession,
	opsJson: string,
	vars?: Record<string, string>,
	dryRun?: boolean,
): Promise<JmapExecutionResult> {
	const { ok, status, bodyText } = await runJmapRequest({
		session,
		opsJson,
		defaultUsing: [...DEFAULT_JMAP_USING],
		sourceLabel: 'ops',
		vars,
		dryRun,
	});

	let body: unknown = bodyText;
	try {
		body = JSON.parse(bodyText);
	} catch {
		// keep raw text
	}

	if (!ok) {
		return {
			ok: false,
			status,
			body,
			message: `JMAP request failed (HTTP ${status}): ${bodyText}`,
		};
	}

	return { ok: true, status, body };
}

export function parseVarsJson(raw: unknown): VarsParseResult {
	if (raw === undefined || raw === null || raw === '') {
		return { ok: true, vars: undefined };
	}
	let value: unknown = raw;
	if (typeof raw === 'string') {
		try {
			value = JSON.parse(raw);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { ok: false, message: `vars must be valid JSON object text: ${message}` };
		}
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { ok: false, message: 'vars must be a JSON object of string values.' };
	}
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== 'string') {
			return { ok: false, message: 'vars must be a JSON object of string values.' };
		}
		out[key] = entry;
	}
	return { ok: true, vars: out };
}
