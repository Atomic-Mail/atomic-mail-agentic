import type { IDataObject } from 'n8n-workflow';

import {
	createAgentSession,
	createN8nCredentialStore,
	n8nStaticDataBackend,
	type AgentSession,
	type IntegrationEnv,
} from '../vendor/agentic-core/index.js';

import { isHttpUrl, optionalTrimmedString } from './props';

/** Auth fields forwarded through multi-step workflows (Register → List → Send). */
export function authPassthrough(itemJson: IDataObject | undefined): IDataObject {
	if (!itemJson) return {};
	const out: IDataObject = {};
	const apiKey = optionalTrimmedString(itemJson.apiKey);
	const inbox = optionalTrimmedString(itemJson.inbox);
	const accountId = optionalTrimmedString(itemJson.accountId);
	if (apiKey) out.apiKey = apiKey;
	if (inbox) out.inbox = inbox;
	if (accountId) out.accountId = accountId;
	return out;
}

export function apiKeyFromItemJson(itemJson: IDataObject | undefined): string | undefined {
	return optionalTrimmedString(itemJson?.apiKey);
}

export async function hasStoredCredentials(
	staticData: IDataObject,
	accountId: string,
): Promise<boolean> {
	const store = createN8nCredentialStore(n8nStaticDataBackend(staticData), accountId);
	const loaded = await store.load();
	return Boolean(loaded.credentials?.apiKey);
}

export async function loadStoredAuthSummary(
	staticData: IDataObject,
	accountId: string,
): Promise<{ apiKey: string; inbox: string } | undefined> {
	const store = createN8nCredentialStore(n8nStaticDataBackend(staticData), accountId);
	const loaded = await store.load();
	const apiKey = optionalTrimmedString(loaded.credentials?.apiKey);
	const inbox = optionalTrimmedString(loaded.credentials?.inboxId);
	if (!apiKey || !inbox) return undefined;
	return { apiKey, inbox };
}

export interface AtomicMailCredentialFields {
	apiKey?: string;
	authUrl?: string;
	apiUrl?: string;
}

export function authEnvFromCredentials(
	credentials?: AtomicMailCredentialFields,
): IntegrationEnv {
	const env: IntegrationEnv = {};
	const authUrl = optionalTrimmedString(credentials?.authUrl);
	const apiUrl = optionalTrimmedString(credentials?.apiUrl);
	if (authUrl) env.authUrl = authUrl;
	if (apiUrl) env.apiUrl = apiUrl;
	return env;
}

export function apiKeyFromCredentials(
	credentials?: AtomicMailCredentialFields,
): string | undefined {
	return optionalTrimmedString(credentials?.apiKey);
}

export function credentialsFromData(
	data: IDataObject | undefined,
): AtomicMailCredentialFields | undefined {
	if (!data) return undefined;
	return {
		apiKey: optionalTrimmedString(data.apiKey),
		authUrl: optionalTrimmedString(data.authUrl),
		apiUrl: optionalTrimmedString(data.apiUrl),
	};
}

export function validateCredentialUrls(
	credentials: AtomicMailCredentialFields,
): string | undefined {
	const authUrl = optionalTrimmedString(credentials.authUrl);
	if (authUrl && !isHttpUrl(authUrl)) {
		return 'Auth URL must be a valid http(s) URL.';
	}
	const apiUrl = optionalTrimmedString(credentials.apiUrl);
	if (apiUrl && !isHttpUrl(apiUrl)) {
		return 'API URL must be a valid http(s) URL.';
	}
	return undefined;
}

/**
 * Skip stored-credential lookup when an API key is available from the
 * n8n credential connection or an inline operation field (Activepieces parity).
 */
export async function assertStoredCredentials(
	staticData: IDataObject,
	accountId: string,
	apiKey?: string,
): Promise<void> {
	if (optionalTrimmedString(apiKey)) {
		return;
	}

	const store = createN8nCredentialStore(n8nStaticDataBackend(staticData), accountId);
	const loaded = await store.load();
	if (loaded.credentials?.apiKey) {
		return;
	}

	throw new Error(
		`No Atomic Mail credentials for account "${accountId}". ` +
			'Run **Register** first (Account ID `default`), connect an API key credential, ' +
			'or paste an API key on this step.',
	);
}

export async function createSession(
	staticData: IDataObject,
	accountId: string,
	options: {
		credentials?: AtomicMailCredentialFields;
		inlineApiKey?: string;
	} = {},
): Promise<AgentSession> {
	const backend = n8nStaticDataBackend(staticData);
	const store = createN8nCredentialStore(backend, accountId);
	const env = authEnvFromCredentials(options.credentials);
	const apiKey =
		optionalTrimmedString(options.inlineApiKey) ??
		apiKeyFromCredentials(options.credentials);

	return createAgentSession({
		store,
		env,
		apiKey,
		credentialDir: `n8n://account/${accountId}`,
	});
}

export async function resolveSessionForExecute(
	staticData: IDataObject,
	accountId: string,
	credentials: AtomicMailCredentialFields | undefined,
	inlineApiKey: unknown,
	requireStored = true,
	itemJson?: IDataObject,
): Promise<AgentSession> {
	const mergedApiKey =
		optionalTrimmedString(inlineApiKey) ??
		apiKeyFromItemJson(itemJson) ??
		apiKeyFromCredentials(credentials);

	if (requireStored) {
		await assertStoredCredentials(staticData, accountId, mergedApiKey);
	}

	return createSession(staticData, accountId, {
		credentials,
		inlineApiKey: mergedApiKey,
	});
}
