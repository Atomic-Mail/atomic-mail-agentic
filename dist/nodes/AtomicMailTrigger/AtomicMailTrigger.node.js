"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AtomicMailTrigger = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const jmap_1 = require("../../lib/jmap");
const oauth_1 = require("../../lib/oauth");
const session_1 = require("../../lib/session");
const props_1 = require("../../lib/props");
function extractEmails(body) {
    if (!body || typeof body !== 'object')
        return [];
    const methodResponses = body.methodResponses;
    if (!Array.isArray(methodResponses))
        return [];
    for (const entry of methodResponses) {
        if (!Array.isArray(entry) || entry.length < 2)
            continue;
        const payload = entry[1];
        if (payload &&
            typeof payload === 'object' &&
            Array.isArray(payload.list)) {
            return payload.list;
        }
    }
    return [];
}
function receivedMs(value) {
    if (!value)
        return 0;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
}
class AtomicMailTrigger {
    constructor() {
        this.description = {
            displayName: 'Atomic Mail Trigger',
            name: 'atomicMailTrigger',
            icon: {
                light: 'file:../../icons/atomicmail.svg',
                dark: 'file:../../icons/atomicmail.dark.svg',
            },
            group: ['trigger'],
            version: 1,
            subtitle: '={{$parameter["accountId"] || "default"}}',
            description: 'Polls your Atomic Mail inbox on a schedule (default ~5 minutes) and starts the workflow when new mail arrives',
            defaults: {
                name: 'Atomic Mail Trigger',
            },
            inputs: [],
            outputs: [n8n_workflow_1.NodeConnectionTypes.Main],
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
                    description: 'Which inbox to poll. Leave empty to auto-select when the connection has exactly one inbox. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
                    description: 'Paste an existing key or an expression from **Register**. Leave empty to use saved credentials or the connected credential.',
                    displayOptions: {
                        show: { authentication: ['apiKey'] },
                    },
                },
            ],
            usableAsTool: true,
        };
        this.methods = {
            loadOptions: {
                async getInboxes() {
                    const inboxes = await (0, oauth_1.listOAuthInboxes)(this);
                    return inboxes.map((inbox) => ({
                        name: inbox.inboxId ? `${inbox.inboxId} (${inbox.accountId})` : inbox.accountId,
                        value: inbox.accountId,
                    }));
                },
            },
        };
    }
    async poll() {
        const nodeStaticData = this.getWorkflowStaticData('node');
        const credentialStaticData = this.getWorkflowStaticData('global');
        let lastPollMs = nodeStaticData.lastPollMs;
        if (typeof lastPollMs !== 'number' || !Number.isFinite(lastPollMs)) {
            lastPollMs = Date.now();
            nodeStaticData.lastPollMs = lastPollMs;
        }
        const authentication = this.getNodeParameter('authentication', 'oAuth2');
        const useOAuth = authentication === 'oAuth2' && (await (0, oauth_1.hasOAuthCredential)(this));
        let emails;
        if (useOAuth) {
            const accountId = await (0, oauth_1.resolveOAuthAccountId)(this, this.getNodeParameter('inbox', '')).catch((error) => {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), error.message);
            });
            const inboxContext = await (0, oauth_1.ensureOAuthInboxContext)(this, credentialStaticData, accountId);
            const result = await (0, oauth_1.jmapViaOAuth)(this, accountId, (0, oauth_1.listInboxBody)(inboxContext.mailboxId));
            if (!result.ok) {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), result.message);
            }
            emails = extractEmails(result.body);
        }
        else {
            const accountId = (0, props_1.normalizeAccountId)(this.getNodeParameter('accountId', 'default'));
            const inlineApiKey = this.getNodeParameter('apiKey', '');
            const credentials = (0, session_1.credentialsFromData)(await this.getCredentials('atomicMailApi').catch(() => undefined));
            try {
                const session = await (0, session_1.resolveSessionForExecute)(credentialStaticData, accountId, credentials, inlineApiKey, true);
                const result = await (0, jmap_1.executePreset)(session, 'list_inbox.json');
                if (!result.ok) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), result.message);
                }
                emails = extractEmails(result.body);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if ((0, props_1.optionalTrimmedString)(inlineApiKey) || (credentials === null || credentials === void 0 ? void 0 : credentials.apiKey)) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), message);
                }
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `${message} Connect the Atomic Mail OAuth2 credential (recommended), connect an API key credential, paste an API key, or run **Register** first.`);
            }
        }
        const newLast = emails.reduce((acc, row) => Math.max(acc, receivedMs(row.receivedAt)), lastPollMs);
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
                json: row,
            })),
        ];
    }
}
exports.AtomicMailTrigger = AtomicMailTrigger;
//# sourceMappingURL=AtomicMailTrigger.node.js.map