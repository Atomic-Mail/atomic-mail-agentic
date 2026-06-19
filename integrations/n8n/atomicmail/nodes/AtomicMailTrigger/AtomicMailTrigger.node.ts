import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { executePreset } from '../../lib/jmap';
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
		icon: { light: 'file:atomicmail.svg', dark: 'file:atomicmail.dark.svg' },
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
				name: 'atomicMailApi',
				required: false,
			},
		],
		properties: [
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
			},
			{
				displayName: 'API Key (Optional Override)',
				name: 'apiKey',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description:
					'Paste an existing key or an expression from **Register**. Leave empty to use saved credentials or the connected credential.',
			},
		],
		usableAsTool: true,
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const nodeStaticData = this.getWorkflowStaticData('node') as IDataObject;
		const credentialStaticData = this.getWorkflowStaticData('global') as IDataObject;
		let lastPollMs = nodeStaticData.lastPollMs as number | undefined;
		if (typeof lastPollMs !== 'number' || !Number.isFinite(lastPollMs)) {
			lastPollMs = Date.now();
			nodeStaticData.lastPollMs = lastPollMs;
		}

		const accountId = normalizeAccountId(this.getNodeParameter('accountId'));
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
			const emails = extractEmails(result.body);

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
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (optionalTrimmedString(inlineApiKey) || credentials?.apiKey) {
				throw new NodeOperationError(this.getNode(), message);
			}
			throw new NodeOperationError(
				this.getNode(),
				`${message} Connect an API key credential, paste an API key, or run **Register** first.`,
			);
		}
	}
}
