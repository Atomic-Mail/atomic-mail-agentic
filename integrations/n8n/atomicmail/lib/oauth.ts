import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	IHttpRequestOptions,
	IPollFunctions,
} from 'n8n-workflow';

import type { JmapExecutionResult } from './jmap';
import { optionalTrimmedString } from './props';

export const OAUTH_CREDENTIAL_NAME = 'atomicMailOAuth2Api';

const AUTH_BASE_URL = 'https://auth.atomicmail.ai';
const JMAP_URL = 'https://api.atomicmail.ai/jmap';
const DEFAULT_INBOX_DOMAIN = 'atomicmail.ai';

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USING_MAIL = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'];
const USING_SUBMISSION = [...USING_MAIL, 'urn:ietf:params:jmap:submission'];

type OAuthRequestContext = IExecuteFunctions | IPollFunctions | ILoadOptionsFunctions;
type OAuthExecuteContext = IExecuteFunctions | IPollFunctions;

export interface OAuthInbox {
	accountId: string;
	inboxId: string;
	status?: string;
}

export interface OAuthInboxContext {
	/** Inbox mailbox id (JMAP Mailbox with role "inbox"). */
	mailboxId: string;
	/** Full sender address for this inbox (from /api/v1/agents). */
	address: string;
}

export async function hasOAuthCredential(ctx: OAuthRequestContext): Promise<boolean> {
	const credentials = await ctx.getCredentials(OAUTH_CREDENTIAL_NAME).catch(() => undefined);
	return Boolean(credentials);
}

/** Inboxes the connection's owner can act as (GET /api/v1/agents). */
export async function listOAuthInboxes(ctx: OAuthRequestContext): Promise<OAuthInbox[]> {
	const response = (await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		OAUTH_CREDENTIAL_NAME,
		{
			method: 'GET',
			url: `${AUTH_BASE_URL}/api/v1/agents`,
			json: true,
		},
	)) as { agents?: unknown };

	if (!Array.isArray(response.agents)) return [];
	const out: OAuthInbox[] = [];
	for (const entry of response.agents) {
		if (!entry || typeof entry !== 'object') continue;
		const row = entry as IDataObject;
		const accountId = optionalTrimmedString(row.accountId);
		const inboxId = optionalTrimmedString(row.inboxId);
		if (!accountId || !UUID_RE.test(accountId)) continue;
		out.push({
			accountId,
			inboxId: inboxId ?? '',
			status: optionalTrimmedString(row.status),
		});
	}
	return out;
}

/**
 * Resolve the X-Atomic-Account-Id value: use the configured inbox when set,
 * otherwise auto-select when the connection has exactly one inbox.
 */
export async function resolveOAuthAccountId(
	ctx: OAuthRequestContext,
	configured: unknown,
): Promise<string> {
	const value = optionalTrimmedString(configured);
	if (value) {
		if (!UUID_RE.test(value)) {
			throw new Error(
				`Inbox must be an account UUID (got "${value}"). Pick one from the Inbox dropdown.`,
			);
		}
		return value;
	}

	const inboxes = await listOAuthInboxes(ctx);
	if (inboxes.length === 1) return inboxes[0].accountId;
	if (inboxes.length === 0) {
		throw new Error(
			'This Atomic Mail connection has no inboxes. Reconnect the OAuth credential and create or pick an inbox at the consent screen.',
		);
	}
	throw new Error(
		'This Atomic Mail connection has multiple inboxes. Select one in the Inbox parameter.',
	);
}

function friendlyJmapError(status: number, body: unknown): string {
	let error: string | undefined;
	let description: string | undefined;
	if (body && typeof body === 'object') {
		const row = body as IDataObject;
		error = optionalTrimmedString(row.error);
		description =
			optionalTrimmedString(row.error_description) ??
			optionalTrimmedString((row.error as IDataObject | undefined)?.message);
	}

	if (status === 403 && error === 'insufficient_scope') {
		return (
			'This OAuth connection is read-only (scope mail.read). ' +
			'Reconnect the Atomic Mail OAuth2 credential with the "Read and Send" scope to send mail.'
		);
	}
	if (status === 403) {
		return (
			'The selected inbox is not owned by this OAuth connection (403). ' +
			'Re-select the Inbox parameter or reconnect the credential.'
		);
	}
	if (status === 400) {
		return (
			`Atomic Mail rejected the request (400${error ? `, ${error}` : ''}): ` +
			`${description ?? 'X-Atomic-Account-Id must be the UUID of an inbox you own.'}`
		);
	}
	if (status === 401) {
		return (
			'The OAuth access token was rejected (401 invalid_token). ' +
			'The grant may have been revoked — reconnect the Atomic Mail OAuth2 credential.'
		);
	}
	const detail = description ?? (typeof body === 'string' ? body : JSON.stringify(body));
	return `JMAP request failed (HTTP ${status}): ${detail}`;
}

/**
 * POST a JMAP request body with the OAuth access token as bearer and the
 * mandatory X-Atomic-Account-Id header. No PoW, no capability minting —
 * n8n refreshes the token and persists the rotated refresh token itself.
 */
export async function jmapViaOAuth(
	ctx: OAuthExecuteContext,
	accountId: string,
	body: IDataObject,
): Promise<JmapExecutionResult> {
	const options: IHttpRequestOptions = {
		method: 'POST',
		url: JMAP_URL,
		headers: {
			'X-Atomic-Account-Id': accountId,
			'Content-Type': 'application/json',
		},
		body,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	const response = (await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		OAUTH_CREDENTIAL_NAME,
		options,
	)) as { statusCode?: number; body?: unknown };

	const status = response.statusCode ?? 0;
	const responseBody = response.body;
	if (status >= 200 && status < 300) {
		return { ok: true, status, body: responseBody };
	}
	return {
		ok: false,
		status,
		body: responseBody,
		message: friendlyJmapError(status, responseBody),
	};
}

function inboxContextCacheKey(accountId: string): string {
	return `atomicMailOAuthInboxContext:${accountId}`;
}

/**
 * Mailbox id + sender address for an inbox, cached in workflow static data
 * (both are stable for the lifetime of the inbox).
 */
export async function ensureOAuthInboxContext(
	ctx: OAuthExecuteContext,
	cache: IDataObject,
	accountId: string,
): Promise<OAuthInboxContext> {
	const cached = cache[inboxContextCacheKey(accountId)];
	if (cached && typeof cached === 'object') {
		const row = cached as IDataObject;
		const mailboxId = optionalTrimmedString(row.mailboxId);
		const address = optionalTrimmedString(row.address);
		if (mailboxId && address) return { mailboxId, address };
	}

	const inboxes = await listOAuthInboxes(ctx);
	const inbox = inboxes.find((row) => row.accountId === accountId);
	if (!inbox) {
		throw new Error(
			'The selected inbox is not available on this OAuth connection. Re-select the Inbox parameter.',
		);
	}
	const address = inbox.inboxId.includes('@')
		? inbox.inboxId
		: `${inbox.inboxId}@${DEFAULT_INBOX_DOMAIN}`;

	const mailboxResult = await jmapViaOAuth(ctx, accountId, {
		using: USING_MAIL,
		methodCalls: [['Mailbox/query', { filter: { role: 'inbox' } }, 'm0']],
	});
	if (!mailboxResult.ok) {
		throw new Error(mailboxResult.message);
	}
	const responses = (mailboxResult.body as { methodResponses?: unknown[] })?.methodResponses;
	const payload = Array.isArray(responses) && Array.isArray(responses[0]) ? responses[0][1] : undefined;
	const ids = (payload as { ids?: unknown } | undefined)?.ids;
	const mailboxId = Array.isArray(ids) ? optionalTrimmedString(ids[0]) : undefined;
	if (!mailboxId) {
		throw new Error('Could not resolve the inbox mailbox id over JMAP (Mailbox/query returned no ids).');
	}

	const context: OAuthInboxContext = { mailboxId, address };
	cache[inboxContextCacheKey(accountId)] = context as unknown as IDataObject;
	return context;
}

/**
 * JMAP bodies for the OAuth path. They mirror the bundled PoW presets, minus
 * `accountId` in method arguments — the account is pinned server-side from
 * the X-Atomic-Account-Id header and a body accountId cannot override it.
 */
export function listInboxBody(mailboxId: string): IDataObject {
	return {
		using: USING_MAIL,
		methodCalls: [
			[
				'Email/query',
				{
					filter: { inMailbox: mailboxId },
					sort: [{ property: 'receivedAt', isAscending: false }],
					limit: 50,
				},
				'q0',
			],
			[
				'Email/get',
				{
					'#ids': { resultOf: 'q0', name: 'Email/query', path: '/ids' },
					properties: ['id', 'threadId', 'receivedAt', 'from', 'to', 'subject', 'preview'],
				},
				'g0',
			],
		],
	};
}

export function sendMailBody(input: {
	context: OAuthInboxContext;
	to: string;
	subject: string;
	body: string;
}): IDataObject {
	const { context, to, subject, body } = input;
	return {
		using: USING_SUBMISSION,
		methodCalls: [
			[
				'Email/set',
				{
					create: {
						d1: {
							mailboxIds: { [context.mailboxId]: true },
							from: [{ email: context.address }],
							to: [{ email: to }],
							subject,
							textBody: [{ partId: 'b', type: 'text/plain' }],
							bodyValues: { b: { value: body } },
							keywords: { $draft: true },
						},
					},
				},
				'c0',
			],
			[
				'EmailSubmission/set',
				{
					create: {
						s1: {
							emailId: '#d1',
							envelope: {
								mailFrom: { email: context.address },
								rcptTo: [{ email: to }],
							},
						},
					},
				},
				'c1',
			],
		],
	};
}

export function replyBody(input: {
	context: OAuthInboxContext;
	mailId: string;
	body: string;
}): IDataObject {
	const { context, mailId, body } = input;
	return {
		using: USING_SUBMISSION,
		methodCalls: [
			[
				'Email/get',
				{
					ids: [mailId],
					properties: ['id', 'threadId', 'from', 'replyTo', 'subject', 'messageId'],
				},
				'g0',
			],
			[
				'Email/set',
				{
					create: {
						d1: {
							mailboxIds: { [context.mailboxId]: true },
							from: [{ email: context.address }],
							'#to': { resultOf: 'g0', name: 'Email/get', path: '/list/0/replyTo' },
							'#subject': { resultOf: 'g0', name: 'Email/get', path: '/list/0/subject' },
							'#inReplyTo': { resultOf: 'g0', name: 'Email/get', path: '/list/0/messageId' },
							textBody: [{ partId: 'b', type: 'text/plain' }],
							bodyValues: { b: { value: body } },
							keywords: { $draft: true },
						},
					},
				},
				'c0',
			],
			[
				'EmailSubmission/set',
				{
					create: {
						s1: {
							emailId: '#d1',
							envelope: {
								mailFrom: { email: context.address },
								'#rcptTo': { resultOf: 'g0', name: 'Email/get', path: '/list/0/replyTo' },
							},
						},
					},
				},
				'c1',
			],
		],
	};
}

/**
 * JMAP reports set failures inside an HTTP 200 — a rejected send arrives as a
 * populated notCreated/notSubmitted rather than an HTTP error. Returns a
 * message when the response contains one.
 */
export function jmapSetErrorMessage(body: unknown): string | undefined {
	const methodResponses = (body as { methodResponses?: unknown[] } | undefined)?.methodResponses;
	if (!Array.isArray(methodResponses)) return undefined;
	for (const entry of methodResponses) {
		if (!Array.isArray(entry) || entry.length < 2) continue;
		const payload = entry[1] as IDataObject | undefined;
		if (!payload || typeof payload !== 'object') continue;
		for (const key of ['notCreated', 'notSubmitted', 'notUpdated']) {
			const failures = payload[key];
			if (failures && typeof failures === 'object' && Object.keys(failures).length > 0) {
				return `JMAP ${String(entry[0])} reported ${key}: ${JSON.stringify(failures)}`;
			}
		}
	}
	return undefined;
}

/**
 * Substitute $VAR tokens in raw ops JSON text for the OAuth path (session
 * placeholders plus user vars), escaping values for JSON string context.
 * Longer names are replaced first so $INBOX_MAILBOX_ID wins over $INBOX.
 */
export function substituteOpsVars(
	opsJson: string,
	vars: Record<string, string>,
): string {
	const names = Object.keys(vars).sort((a, b) => b.length - a.length);
	let out = opsJson;
	for (const name of names) {
		const escaped = JSON.stringify(vars[name]).slice(1, -1);
		out = out.split(`$${name}`).join(escaped);
	}
	return out;
}

/** Parse raw ops JSON (methodCalls array or full envelope) into a request body. */
export function opsJsonToBody(opsJson: string): IDataObject {
	let parsed: unknown;
	let parseError: string | undefined;
	try {
		parsed = JSON.parse(opsJson);
	} catch (err) {
		parseError = err instanceof Error ? err.message : String(err);
	}
	if (parseError !== undefined) {
		throw new Error(`ops must be valid JSON: ${parseError}`);
	}
	if (Array.isArray(parsed)) {
		return { using: USING_SUBMISSION, methodCalls: parsed };
	}
	if (parsed && typeof parsed === 'object') {
		const envelope = parsed as IDataObject;
		if (!Array.isArray(envelope.methodCalls)) {
			throw new Error('ops envelope must contain a methodCalls array.');
		}
		if (!Array.isArray(envelope.using)) {
			envelope.using = USING_SUBMISSION;
		}
		return envelope;
	}
	throw new Error('ops must be a JMAP methodCalls array or envelope object.');
}
