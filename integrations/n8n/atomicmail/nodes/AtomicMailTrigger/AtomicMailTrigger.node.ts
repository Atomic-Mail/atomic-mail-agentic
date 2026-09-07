import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { executePreset } from '../../lib/jmap';
import {
	ensureOAuthInboxContext,
	hasOAuthCredential,
	jmapViaOAuth,
	listInboxBody,
	listOAuthInboxes,
	resolveOAuthAccountId,
} from '../../lib/oauth';
import {
	credentialsFromData,
	resolveSessionForExecute,
} from '../../lib/session';
import { normalizeAccountId, optionalTrimmedString } from '../../lib/props';

interface InboxEmailRow {
	id?: string;
	receivedAt?: string;
	subject?: string;
	from?: unknown;
	preview?: string;
}

function extractEmails(body: unknown): InboxEmailRow[] {
	if (!body || typeof body !== 'object') return [];
	const methodResponses = (body as { methodResponses?: unknown[] }).methodResponses;
	if (!Array.isArray(methodResponses)) return [];

	for (const entry of methodResponses) {
		if (!Array.isArray(entry) || entry.length < 2) continue;
		const payload = entry[1];
		if (
			payload &&
			typeof payload === 'object' &&
			Array.isArray((payload as { list?: unknown }).list)
		) {
			return (payload as { list: InboxEmailRow[] }).list;
		}
	}
	return [];
}

function receivedMs(value: string | undefined): number {
	if (!value) return 0;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : 0;
}

export class AtomicMailTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Atomic Mail Trigger',
		name: 'atomicMailTrigger',
		icon: {
			light: 'file:../../icons/atomicmail.svg',
			dark: 'file:../../icons/atomicmail.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["accountId"] || "default"}}',
		description:
			'Polls your Atomic Mail inbox on a schedule (default ~5 minutes) and starts the workflow when new mail arrives',
		defaults: {
			name: 'Atomic Mail Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		polling: true,
		credentials: [
			{
				name: 'atomicMailOAuth2Api',
				required: false,
				displayOptions: {
					show: { authentication: ['oAuth2'] },
				},
			},
			{
				name: 'atomicMailApi',
				required: false,
				displayOptions: {
					show: { authentication: ['apiKey'] },
				},
			},
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{
						name: 'API Key (Legacy)',
						value: 'apiKey',
						description: 'Agent-owned inbox via the proof-of-work path',
					},
					{
						name: 'OAuth2 (Recommended)',
						value: 'oAuth2',
						description: 'A person signs in once and authorizes n8n — no proof of work',
					},
				],
				default: 'oAuth2',
			},
			{
				displayName: 'Inbox Name or ID',
				name: 'inbox',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getInboxes',
				},
				default: '',
				description:
					'Which inbox to poll. Leave empty to auto-select when the connection has exactly one inbox. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: {
					show: { authentication: ['oAuth2'] },
				},
			},
			{
				displayName: 'Poll Interval (Minutes)',
				name: 'pollIntervalMinutes',
				type: 'number',
				default: 5,
				typeOptions: {
					minValue: 1,
					maxValue: 1440,
				},
				description: 'How often n8n should poll for new inbox messages when this workflow is active (default 5)',
			},
			{
				displayName: 'Account Namespace',
				name: 'accountId',
				type: 'string',
				default: 'default',
				description: 'Leave as `default` to match **Register**, or set a unique name for multiple inboxes',
				displayOptions: {
					show: { authentication: ['apiKey'] },
				},
			},
			{
				displayName: 'API Key (Optional Override)',
				name: 'apiKey',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description:
					'Paste an existing key or an expression from **Register**. Leave empty to use saved credentials or the connected credential.',
				displayOptions: {
					show: { authentication: ['apiKey'] },
				},
			},
		],
		usableAsTool: true,
	};

	methods = {
		loadOptions: {
			async getInboxes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const inboxes = await listOAuthInboxes(this);
				return inboxes.map((inbox) => ({
					name: inbox.inboxId ? `${inbox.inboxId} (${inbox.accountId})` : inbox.accountId,
					value: inbox.accountId,
				}));
			},
		},
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const nodeStaticData = this.getWorkflowStaticData('node') as IDataObject;
		const credentialStaticData = this.getWorkflowStaticData('global') as IDataObject;
		let lastPollMs = nodeStaticData.lastPollMs as number | undefined;
		if (typeof lastPollMs !== 'number' || !Number.isFinite(lastPollMs)) {
			lastPollMs = Date.now();
			nodeStaticData.lastPollMs = lastPollMs;
		}

		const authentication = this.getNodeParameter('authentication', 'oAuth2') as string;
		// Workflows saved before the OAuth migration have no `authentication`
		// parameter and resolve to the new default; fall back to the legacy PoW
		// path when no OAuth credential is actually connected.
		const useOAuth = authentication === 'oAuth2' && (await hasOAuthCredential(this));

		let emails: InboxEmailRow[];
		if (useOAuth) {
			const accountId = await resolveOAuthAccountId(
				this,
				this.getNodeParameter('inbox', ''),
			).catch((error: Error) => {
				throw new NodeOperationError(this.getNode(), error.message);
			});
			const inboxContext = await ensureOAuthInboxContext(
				this,
				credentialStaticData,
				accountId,
			);
			const result = await jmapViaOAuth(this, accountId, listInboxBody(inboxContext.mailboxId));
			if (!result.ok) {
				throw new NodeOperationError(this.getNode(), result.message);
			}
			emails = extractEmails(result.body);
		} else {
			const accountId = normalizeAccountId(this.getNodeParameter('accountId', 'default'));
			const inlineApiKey = this.getNodeParameter('apiKey', '') as string;
			const credentials = credentialsFromData(
				await this.getCredentials('atomicMailApi').catch(() => undefined),
			);

			try {
				const session = await resolveSessionForExecute(
					credentialStaticData,
					accountId,
					credentials,
					inlineApiKey,
					true,
				);
				const result = await executePreset(session, 'list_inbox.json');
				if (!result.ok) {
					throw new NodeOperationError(this.getNode(), result.message);
				}
				emails = extractEmails(result.body);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (optionalTrimmedString(inlineApiKey) || credentials?.apiKey) {
					throw new NodeOperationError(this.getNode(), message);
				}
				throw new NodeOperationError(
					this.getNode(),
					`${message} Connect the Atomic Mail OAuth2 credential (recommended), connect an API key credential, paste an API key, or run **Register** first.`,
				);
			}
		}

		const newLast = emails.reduce(
			(acc, row) => Math.max(acc, receivedMs(row.receivedAt)),
			lastPollMs,
		);
		nodeStaticData.lastPollMs = newLast;

		const fresh = emails
			.filter((row) => receivedMs(row.receivedAt) > lastPollMs)
			.map((row) => ({
				id: row.id,
				subject: row.subject,
				from: row.from,
				preview: row.preview,
				receivedAt: row.receivedAt,
			}));

		if (fresh.length === 0) {
			return null;
		}

		return [
			fresh.map((row) => ({
				json: row as IDataObject,
			})),
		];
	}
}
