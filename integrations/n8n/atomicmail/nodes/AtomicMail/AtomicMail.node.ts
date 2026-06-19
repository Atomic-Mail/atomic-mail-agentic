import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	getHelp,
	HELP_TOPIC_LIST,
	postRegisterCronReminder,
	sharedError,
} from '../../vendor/agentic-core/index.js';
import { attachmentVarsFromBinaryProperty } from '../../lib/attachments';
import {
	executeOpsJson,
	executePreset,
	parseVarsJson,
	type JmapExecutionResult,
} from '../../lib/jmap';
import {
	credentialsFromData,
	resolveSessionForExecute,
} from '../../lib/session';
import { normalizeAccountId, optionalTrimmedString, requiredString } from '../../lib/props';

function unwrapJmapResult(
	context: IExecuteFunctions,
	itemIndex: number,
	result: JmapExecutionResult,
): { status: number; body: unknown } {
	if (!result.ok) {
		throw new NodeOperationError(context.getNode(), result.message, { itemIndex });
	}
	return { status: result.status, body: result.body };
}

export class AtomicMail implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Atomic Mail',
		name: 'atomicMail',
		icon: { light: 'file:atomicmail.svg', dark: 'file:atomicmail.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Programmable @atomicmail.ai inbox for agents — register, list inbox, send, reply, and raw JMAP.',
		defaults: {
			name: 'Atomic Mail',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'atomicMailApi',
				required: false,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Email', value: 'email' },
					{ name: 'Help', value: 'help' },
					{ name: 'Inbox', value: 'inbox' },
					{ name: 'JMAP', value: 'jmap' },
				],
				default: 'inbox',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['account'] },
				},
				options: [{ name: 'Register', value: 'register', action: 'Register an inbox' }],
				default: 'register',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['inbox'] },
				},
				options: [{ name: 'List', value: 'list', action: 'List inbox messages' }],
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['email'] },
				},
				options: [
					{ name: 'Reply', value: 'reply', action: 'Reply to an email' },
					{ name: 'Send', value: 'send', action: 'Send an email' },
				],
				default: 'send',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['jmap'] },
				},
				options: [{ name: 'Request', value: 'request', action: 'Send a JMAP request' }],
				default: 'request',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['help'] },
				},
				options: [{ name: 'Get Topic', value: 'get', action: 'Get a help topic' }],
				default: 'get',
			},
			{
				displayName: 'Account Namespace',
				name: 'accountId',
				type: 'string',
				default: 'default',
				description: 'Leave as `default` to match **Register**, or set a unique name for multiple inboxes in this workflow',
				displayOptions: {
					hide: { resource: ['help'] },
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
					hide: { resource: ['account', 'help'] },
				},
			},
			{
				displayName: 'Username',
				name: 'username',
				type: 'string',
				default: '',
				required: true,
				description: 'Desired inbox username (5–21 characters, before @atomicmail.ai)',
				displayOptions: {
					show: { resource: ['account'], operation: ['register'] },
				},
			},
			{
				displayName: 'Forced',
				name: 'forced',
				type: 'boolean',
				default: false,
				description: 'Whether to replace existing credentials in this account namespace after backing them up',
				displayOptions: {
					show: { resource: ['account'], operation: ['register'] },
				},
			},
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: { resource: ['email'], operation: ['send'] },
				},
			},
			{
				displayName: 'Subject',
				name: 'subject',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: { resource: ['email'], operation: ['send'] },
				},
			},
			{
				displayName: 'Body',
				name: 'body',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: {
					show: { resource: ['email'], operation: ['send', 'reply'] },
				},
			},
			{
				displayName: 'Binary Property',
				name: 'binaryProperty',
				type: 'string',
				default: '',
				description: 'Optional input binary field name to attach to the outgoing message',
				displayOptions: {
					show: { resource: ['email'], operation: ['send'] },
				},
			},
			{
				displayName: 'Mail ID',
				name: 'mailId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: { resource: ['email'], operation: ['reply'] },
				},
			},
			{
				displayName: 'Request Source',
				name: 'requestSource',
				type: 'options',
				options: [
					{ name: 'Inline Ops JSON', value: 'inline' },
					{ name: 'Preset File', value: 'preset' },
				],
				default: 'preset',
				displayOptions: {
					show: { resource: ['jmap'], operation: ['request'] },
				},
			},
			{
				displayName: 'Ops JSON',
				name: 'ops',
				type: 'json',
				default: '',
				description: 'Inline JMAP methodCalls JSON or envelope object',
				displayOptions: {
					show: {
						resource: ['jmap'],
						operation: ['request'],
						requestSource: ['inline'],
					},
				},
			},
			{
				displayName: 'Ops File',
				name: 'opsFile',
				type: 'options',
				options: [
					{ name: 'list_inbox.json', value: 'list_inbox.json' },
					{ name: 'reply.json', value: 'reply.json' },
					{ name: 'send_mail_attachment.json', value: 'send_mail_attachment.json' },
					{
						name: 'send_mail_blob_attachment.json',
						value: 'send_mail_blob_attachment.json',
					},
					{ name: 'send_mail.json', value: 'send_mail.json' },
				],
				default: 'list_inbox.json',
				description: 'Bundled preset filename from agentic-core',
				displayOptions: {
					show: {
						resource: ['jmap'],
						operation: ['request'],
						requestSource: ['preset'],
					},
				},
			},
			{
				displayName: 'Vars JSON',
				name: 'vars',
				type: 'json',
				default: '',
				description: 'Optional JSON object of $VAR placeholders (keys without $)',
				displayOptions: {
					show: { resource: ['jmap'], operation: ['request'] },
				},
			},
			{
				displayName: 'Dry Run',
				name: 'dryRun',
				type: 'boolean',
				default: false,
				description: 'Whether to validate the batch without sending (cannot be used with attachments)',
				displayOptions: {
					show: { resource: ['jmap'], operation: ['request'] },
				},
			},
			{
				displayName: 'Topic',
				name: 'topic',
				type: 'options',
				options: [
					{ name: 'Auth', value: 'auth' },
					{ name: 'Cron', value: 'cron' },
					{ name: 'Installation', value: 'installation' },
					{ name: 'JMAP Cheatsheet', value: 'jmap_cheatsheet' },
					{ name: 'Multi Account', value: 'multi_account' },
					{ name: 'Overview', value: 'overview' },
					{ name: 'Presets', value: 'presets' },
					{ name: 'Readme', value: 'readme' },
					{ name: 'Tools', value: 'tools' },
					{ name: 'Troubleshooting', value: 'troubleshooting' },
				],
				default: 'overview',
				description: `Built-in docs. Topics: ${HELP_TOPIC_LIST.join(', ')}, readme.`,
				displayOptions: {
					show: { resource: ['help'], operation: ['get'] },
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				// Workflow-global so Register credentials are visible to all Atomic Mail nodes.
				const staticData = this.getWorkflowStaticData('global');

				if (resource === 'help' && operation === 'get') {
					const topic = this.getNodeParameter('topic', itemIndex) as string;
					const text = await getHelp(topic, 'skill');
					returnData.push({
						json: { topic, text },
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				const accountId = normalizeAccountId(this.getNodeParameter('accountId', itemIndex));
				const credentials = credentialsFromData(
					await this.getCredentials('atomicMailApi').catch(() => undefined),
				);
				const inlineApiKey = this.getNodeParameter('apiKey', itemIndex, '') as string;

				if (resource === 'account' && operation === 'register') {
					const username = requiredString(
						this.getNodeParameter('username', itemIndex),
						'username',
					);
					const forced = this.getNodeParameter('forced', itemIndex, false) as boolean;
					const session = await resolveSessionForExecute(
						staticData,
						accountId,
						credentials,
						inlineApiKey,
						false,
					);
					const result = await session.register(username, { forced });
					returnData.push({
						json: {
							...result,
							_next: [postRegisterCronReminder],
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				const session = await resolveSessionForExecute(
					staticData,
					accountId,
					credentials,
					inlineApiKey,
					true,
				);

				if (resource === 'inbox' && operation === 'list') {
					const result = unwrapJmapResult(
						this,
						itemIndex,
						await executePreset(session, 'list_inbox.json'),
					);
					returnData.push({
						json: {
							ok: true,
							status: result.status,
							body: result.body as IDataObject,
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (resource === 'email' && operation === 'send') {
					const to = requiredString(this.getNodeParameter('to', itemIndex), 'to');
					const subject = requiredString(this.getNodeParameter('subject', itemIndex), 'subject');
					const body = requiredString(this.getNodeParameter('body', itemIndex), 'body');
					const binaryProperty = optionalTrimmedString(
						this.getNodeParameter('binaryProperty', itemIndex, ''),
					);
					const attachmentResult = await attachmentVarsFromBinaryProperty(
						this,
						session,
						itemIndex,
						binaryProperty,
					);
					if (!attachmentResult.ok) {
						throw new NodeOperationError(this.getNode(), attachmentResult.message, {
							itemIndex,
						});
					}
					const vars = {
						TO: to,
						SUBJECT: subject,
						BODY: body,
						...(attachmentResult.vars ?? {}),
					};
					const result = unwrapJmapResult(
						this,
						itemIndex,
						await executePreset(
							session,
							attachmentResult.vars
								? 'send_mail_blob_attachment.json'
								: 'send_mail.json',
							vars,
						),
					);
					returnData.push({
						json: {
							ok: true,
							status: result.status,
							body: result.body as IDataObject,
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (resource === 'email' && operation === 'reply') {
					const mailId = requiredString(this.getNodeParameter('mailId', itemIndex), 'mailId');
					const body = requiredString(this.getNodeParameter('body', itemIndex), 'body');
					const result = unwrapJmapResult(
						this,
						itemIndex,
						await executePreset(session, 'reply.json', {
							MAIL_ID: mailId,
							BODY: body,
						}),
					);
					returnData.push({
						json: {
							ok: true,
							status: result.status,
							body: result.body as IDataObject,
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (resource === 'jmap' && operation === 'request') {
					const requestSource = this.getNodeParameter(
						'requestSource',
						itemIndex,
						'preset',
					) as string;
					const dryRun = this.getNodeParameter('dryRun', itemIndex, false) as boolean;
					const parsedVars = parseVarsJson(this.getNodeParameter('vars', itemIndex, ''));
					if (!parsedVars.ok) {
						throw new NodeOperationError(this.getNode(), parsedVars.message, { itemIndex });
					}

					let jmapResult: JmapExecutionResult;
					if (requestSource === 'inline') {
						const opsParam = this.getNodeParameter('ops', itemIndex, '') as string | object;
						const opsJson =
							typeof opsParam === 'string'
								? optionalTrimmedString(opsParam)
								: opsParam && typeof opsParam === 'object'
									? JSON.stringify(opsParam)
									: undefined;
						if (!opsJson) {
							throw new NodeOperationError(this.getNode(), sharedError('mcp_ops_required'), {
								itemIndex,
							});
						}
						jmapResult = await executeOpsJson(session, opsJson, parsedVars.vars, dryRun);
					} else {
						const opsFile = requiredString(
							this.getNodeParameter('opsFile', itemIndex, ''),
							'opsFile',
						);
						jmapResult = await executePreset(session, opsFile, parsedVars.vars, { dryRun });
					}

					const result = unwrapJmapResult(this, itemIndex, jmapResult);
					returnData.push({
						json: {
							ok: true,
							status: result.status,
							body: result.body as IDataObject,
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				throw new NodeOperationError(
					this.getNode(),
					`Unsupported operation ${resource}/${operation}.`,
					{ itemIndex },
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
