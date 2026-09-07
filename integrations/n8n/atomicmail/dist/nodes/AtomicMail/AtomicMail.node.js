"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AtomicMail = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const index_js_1 = require("../../vendor/agentic-core/index.js");
const attachments_1 = require("../../lib/attachments");
const jmap_1 = require("../../lib/jmap");
const oauth_1 = require("../../lib/oauth");
const session_1 = require("../../lib/session");
const props_1 = require("../../lib/props");
function unwrapJmapResult(context, itemIndex, result) {
    if (!result.ok) {
        throw new n8n_workflow_1.NodeOperationError(context.getNode(), result.message, { itemIndex });
    }
    return { status: result.status, body: result.body };
}
class AtomicMail {
    constructor() {
        this.description = {
            displayName: 'Atomic Mail',
            name: 'atomicMail',
            icon: {
                light: 'file:../../icons/atomicmail.svg',
                dark: 'file:../../icons/atomicmail.dark.svg',
            },
            group: ['transform'],
            version: 1,
            subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
            description: 'Programmable @atomicmail.ai inbox for agents — register, list inbox, send, reply, and raw JMAP.',
            defaults: {
                name: 'Atomic Mail',
            },
            inputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            outputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            usableAsTool: true,
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
                    noDataExpression: true,
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
                    displayOptions: {
                        hide: { resource: ['help'] },
                    },
                },
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
                    options: [
                        { name: 'Ensure Registered', value: 'ensureRegistered', action: 'Register only if no session is stored' },
                        { name: 'Register', value: 'register', action: 'Register an inbox' },
                    ],
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
                    displayName: 'Inbox Name or ID',
                    name: 'inbox',
                    type: 'options',
                    typeOptions: {
                        loadOptionsMethod: 'getInboxes',
                    },
                    default: '',
                    description: 'Which inbox to act as. Leave empty to auto-select when the connection has exactly one inbox. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
                    displayOptions: {
                        show: { authentication: ['oAuth2'] },
                        hide: { resource: ['account', 'help'] },
                    },
                },
                {
                    displayName: 'Account Namespace',
                    name: 'accountId',
                    type: 'string',
                    default: 'default',
                    description: 'Leave as `default` to match **Register**, or set a unique name for multiple inboxes in this workflow',
                    displayOptions: {
                        show: { authentication: ['apiKey'] },
                        hide: { resource: ['help'] },
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
                        show: { resource: ['account'], operation: ['register', 'ensureRegistered'] },
                    },
                },
                {
                    displayName: 'Forced',
                    name: 'forced',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to replace existing credentials in this account namespace after backing them up',
                    displayOptions: {
                        show: { resource: ['account'], operation: ['register', 'ensureRegistered'] },
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
                    description: `Built-in docs. Topics: ${index_js_1.HELP_TOPIC_LIST.join(', ')}, readme.`,
                    displayOptions: {
                        show: { resource: ['help'], operation: ['get'] },
                    },
                },
            ],
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
    async execute() {
        var _a, _b, _c, _d, _e;
        const items = this.getInputData();
        const returnData = [];
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                const resource = this.getNodeParameter('resource', itemIndex);
                const operation = this.getNodeParameter('operation', itemIndex);
                const staticData = this.getWorkflowStaticData('global');
                if (resource === 'help' && operation === 'get') {
                    const topic = this.getNodeParameter('topic', itemIndex);
                    const text = await (0, index_js_1.getHelp)(topic, 'skill');
                    returnData.push({
                        json: { topic, text },
                        pairedItem: { item: itemIndex },
                    });
                    continue;
                }
                const itemJson = (_a = items[itemIndex]) === null || _a === void 0 ? void 0 : _a.json;
                const authentication = this.getNodeParameter('authentication', itemIndex, 'oAuth2');
                if (authentication === 'oAuth2' && (await (0, oauth_1.hasOAuthCredential)(this))) {
                    if (resource === 'account') {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Register applies to the legacy API-key (proof-of-work) path. With OAuth the inbox is created when you connect the Atomic Mail OAuth2 credential — switch Authentication to "API Key (Legacy)" to use Register.', { itemIndex });
                    }
                    const oauthAccountId = await (0, oauth_1.resolveOAuthAccountId)(this, this.getNodeParameter('inbox', itemIndex, ''));
                    const inboxContext = await (0, oauth_1.ensureOAuthInboxContext)(this, staticData, oauthAccountId);
                    if (resource === 'inbox' && operation === 'list') {
                        const result = unwrapJmapResult(this, itemIndex, await (0, oauth_1.jmapViaOAuth)(this, oauthAccountId, (0, oauth_1.listInboxBody)(inboxContext.mailboxId)));
                        returnData.push({
                            json: {
                                ...(0, session_1.authPassthrough)(itemJson),
                                ok: true,
                                status: result.status,
                                body: result.body,
                            },
                            pairedItem: { item: itemIndex },
                        });
                        continue;
                    }
                    if (resource === 'email' && operation === 'send') {
                        const to = (0, props_1.requiredString)(this.getNodeParameter('to', itemIndex), 'to');
                        const subject = (0, props_1.requiredString)(this.getNodeParameter('subject', itemIndex), 'subject');
                        const body = (0, props_1.requiredString)(this.getNodeParameter('body', itemIndex), 'body');
                        const binaryProperty = (0, props_1.optionalTrimmedString)(this.getNodeParameter('binaryProperty', itemIndex, ''));
                        if (binaryProperty) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Binary attachments are not yet supported on the OAuth path. Switch Authentication to "API Key (Legacy)" to send attachments.', { itemIndex });
                        }
                        const result = unwrapJmapResult(this, itemIndex, await (0, oauth_1.jmapViaOAuth)(this, oauthAccountId, (0, oauth_1.sendMailBody)({ context: inboxContext, to, subject, body })));
                        const setError = (0, oauth_1.jmapSetErrorMessage)(result.body);
                        if (setError) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), setError, { itemIndex });
                        }
                        returnData.push({
                            json: {
                                ...(0, session_1.authPassthrough)(itemJson),
                                ok: true,
                                status: result.status,
                                body: result.body,
                            },
                            pairedItem: { item: itemIndex },
                        });
                        continue;
                    }
                    if (resource === 'email' && operation === 'reply') {
                        const mailId = (0, props_1.requiredString)(this.getNodeParameter('mailId', itemIndex), 'mailId');
                        const body = (0, props_1.requiredString)(this.getNodeParameter('body', itemIndex), 'body');
                        const result = unwrapJmapResult(this, itemIndex, await (0, oauth_1.jmapViaOAuth)(this, oauthAccountId, (0, oauth_1.replyBody)({ context: inboxContext, mailId, body })));
                        const setError = (0, oauth_1.jmapSetErrorMessage)(result.body);
                        if (setError) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), setError, { itemIndex });
                        }
                        returnData.push({
                            json: {
                                ...(0, session_1.authPassthrough)(itemJson),
                                ok: true,
                                status: result.status,
                                body: result.body,
                            },
                            pairedItem: { item: itemIndex },
                        });
                        continue;
                    }
                    if (resource === 'jmap' && operation === 'request') {
                        const requestSource = this.getNodeParameter('requestSource', itemIndex, 'preset');
                        const dryRun = this.getNodeParameter('dryRun', itemIndex, false);
                        if (dryRun) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Dry run is only supported with the API-key (legacy) credential.', { itemIndex });
                        }
                        const parsedVars = (0, jmap_1.parseVarsJson)(this.getNodeParameter('vars', itemIndex, ''));
                        if (!parsedVars.ok) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), parsedVars.message, { itemIndex });
                        }
                        let opsJson;
                        if (requestSource === 'inline') {
                            const opsParam = this.getNodeParameter('ops', itemIndex, '');
                            opsJson =
                                typeof opsParam === 'string'
                                    ? (0, props_1.optionalTrimmedString)(opsParam)
                                    : opsParam && typeof opsParam === 'object'
                                        ? JSON.stringify(opsParam)
                                        : undefined;
                            if (!opsJson) {
                                throw new n8n_workflow_1.NodeOperationError(this.getNode(), (0, index_js_1.sharedError)('mcp_ops_required'), {
                                    itemIndex,
                                });
                            }
                        }
                        else {
                            const opsFile = (0, props_1.requiredString)(this.getNodeParameter('opsFile', itemIndex, ''), 'opsFile');
                            opsJson = await (0, index_js_1.readOpsFile)('n8n://oauth', opsFile);
                        }
                        const substituted = (0, oauth_1.substituteOpsVars)(opsJson, {
                            ACCOUNT_ID: oauthAccountId,
                            INBOX: inboxContext.address,
                            INBOX_MAILBOX_ID: inboxContext.mailboxId,
                            ...((_b = parsedVars.vars) !== null && _b !== void 0 ? _b : {}),
                        });
                        const result = unwrapJmapResult(this, itemIndex, await (0, oauth_1.jmapViaOAuth)(this, oauthAccountId, (0, oauth_1.opsJsonToBody)(substituted)));
                        returnData.push({
                            json: {
                                ...(0, session_1.authPassthrough)(itemJson),
                                ok: true,
                                status: result.status,
                                body: result.body,
                            },
                            pairedItem: { item: itemIndex },
                        });
                        continue;
                    }
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Unsupported operation ${resource}/${operation}.`, { itemIndex });
                }
                const accountId = (0, props_1.normalizeAccountId)(this.getNodeParameter('accountId', itemIndex, 'default'));
                const credentials = (0, session_1.credentialsFromData)(await this.getCredentials('atomicMailApi').catch(() => undefined));
                const inlineApiKey = this.getNodeParameter('apiKey', itemIndex, '');
                if (resource === 'account' && operation === 'ensureRegistered') {
                    if (await (0, session_1.hasStoredCredentials)(staticData, accountId)) {
                        const stored = await (0, session_1.loadStoredAuthSummary)(staticData, accountId);
                        const session = await (0, session_1.resolveSessionForExecute)(staticData, accountId, credentials, inlineApiKey, false, itemJson);
                        const accountIdResolved = await session.getPrimaryMailAccountId();
                        returnData.push({
                            json: {
                                ...(0, session_1.authPassthrough)(itemJson),
                                skipped: true,
                                idempotent: true,
                                inbox: (_d = (_c = stored === null || stored === void 0 ? void 0 : stored.inbox) !== null && _c !== void 0 ? _c : session.currentInboxId) !== null && _d !== void 0 ? _d : '',
                                accountId: accountIdResolved,
                                ...((stored === null || stored === void 0 ? void 0 : stored.apiKey) ? { apiKey: stored.apiKey } : {}),
                            },
                            pairedItem: { item: itemIndex },
                        });
                        continue;
                    }
                }
                if (resource === 'account' &&
                    (operation === 'register' || operation === 'ensureRegistered')) {
                    const username = (0, props_1.requiredString)(this.getNodeParameter('username', itemIndex), 'username');
                    const forced = this.getNodeParameter('forced', itemIndex, false);
                    const session = await (0, session_1.resolveSessionForExecute)(staticData, accountId, credentials, inlineApiKey, false, itemJson);
                    const result = await session.register(username, { forced });
                    const merged = {
                        ...(0, session_1.authPassthrough)(itemJson),
                        ...result,
                    };
                    if (!merged.apiKey) {
                        const stored = await (0, session_1.loadStoredAuthSummary)(staticData, accountId);
                        if (stored === null || stored === void 0 ? void 0 : stored.apiKey)
                            merged.apiKey = stored.apiKey;
                        if ((stored === null || stored === void 0 ? void 0 : stored.inbox) && !merged.inbox)
                            merged.inbox = stored.inbox;
                    }
                    returnData.push({
                        json: {
                            ...merged,
                            _next: [index_js_1.postRegisterCronReminder],
                        },
                        pairedItem: { item: itemIndex },
                    });
                    continue;
                }
                const session = await (0, session_1.resolveSessionForExecute)(staticData, accountId, credentials, inlineApiKey, true, itemJson);
                if (resource === 'inbox' && operation === 'list') {
                    const result = unwrapJmapResult(this, itemIndex, await (0, jmap_1.executePreset)(session, 'list_inbox.json'));
                    returnData.push({
                        json: {
                            ...(0, session_1.authPassthrough)(itemJson),
                            ok: true,
                            status: result.status,
                            body: result.body,
                        },
                        pairedItem: { item: itemIndex },
                    });
                    continue;
                }
                if (resource === 'email' && operation === 'send') {
                    const to = (0, props_1.requiredString)(this.getNodeParameter('to', itemIndex), 'to');
                    const subject = (0, props_1.requiredString)(this.getNodeParameter('subject', itemIndex), 'subject');
                    const body = (0, props_1.requiredString)(this.getNodeParameter('body', itemIndex), 'body');
                    const binaryProperty = (0, props_1.optionalTrimmedString)(this.getNodeParameter('binaryProperty', itemIndex, ''));
                    const attachmentResult = await (0, attachments_1.attachmentVarsFromBinaryProperty)(this, session, itemIndex, binaryProperty);
                    if (!attachmentResult.ok) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), attachmentResult.message, {
                            itemIndex,
                        });
                    }
                    const vars = {
                        TO: to,
                        SUBJECT: subject,
                        BODY: body,
                        ...((_e = attachmentResult.vars) !== null && _e !== void 0 ? _e : {}),
                    };
                    const result = unwrapJmapResult(this, itemIndex, await (0, jmap_1.executePreset)(session, attachmentResult.vars
                        ? 'send_mail_blob_attachment.json'
                        : 'send_mail.json', vars));
                    returnData.push({
                        json: {
                            ...(0, session_1.authPassthrough)(itemJson),
                            ok: true,
                            status: result.status,
                            body: result.body,
                        },
                        pairedItem: { item: itemIndex },
                    });
                    continue;
                }
                if (resource === 'email' && operation === 'reply') {
                    const mailId = (0, props_1.requiredString)(this.getNodeParameter('mailId', itemIndex), 'mailId');
                    const body = (0, props_1.requiredString)(this.getNodeParameter('body', itemIndex), 'body');
                    const result = unwrapJmapResult(this, itemIndex, await (0, jmap_1.executePreset)(session, 'reply.json', {
                        MAIL_ID: mailId,
                        BODY: body,
                    }));
                    returnData.push({
                        json: {
                            ...(0, session_1.authPassthrough)(itemJson),
                            ok: true,
                            status: result.status,
                            body: result.body,
                        },
                        pairedItem: { item: itemIndex },
                    });
                    continue;
                }
                if (resource === 'jmap' && operation === 'request') {
                    const requestSource = this.getNodeParameter('requestSource', itemIndex, 'preset');
                    const dryRun = this.getNodeParameter('dryRun', itemIndex, false);
                    const parsedVars = (0, jmap_1.parseVarsJson)(this.getNodeParameter('vars', itemIndex, ''));
                    if (!parsedVars.ok) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), parsedVars.message, { itemIndex });
                    }
                    let jmapResult;
                    if (requestSource === 'inline') {
                        const opsParam = this.getNodeParameter('ops', itemIndex, '');
                        const opsJson = typeof opsParam === 'string'
                            ? (0, props_1.optionalTrimmedString)(opsParam)
                            : opsParam && typeof opsParam === 'object'
                                ? JSON.stringify(opsParam)
                                : undefined;
                        if (!opsJson) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), (0, index_js_1.sharedError)('mcp_ops_required'), {
                                itemIndex,
                            });
                        }
                        jmapResult = await (0, jmap_1.executeOpsJson)(session, opsJson, parsedVars.vars, dryRun);
                    }
                    else {
                        const opsFile = (0, props_1.requiredString)(this.getNodeParameter('opsFile', itemIndex, ''), 'opsFile');
                        jmapResult = await (0, jmap_1.executePreset)(session, opsFile, parsedVars.vars, { dryRun });
                    }
                    const result = unwrapJmapResult(this, itemIndex, jmapResult);
                    returnData.push({
                        json: {
                            ...(0, session_1.authPassthrough)(itemJson),
                            ok: true,
                            status: result.status,
                            body: result.body,
                        },
                        pairedItem: { item: itemIndex },
                    });
                    continue;
                }
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Unsupported operation ${resource}/${operation}.`, { itemIndex });
            }
            catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: { error: error instanceof Error ? error.message : String(error) },
                        pairedItem: { item: itemIndex },
                    });
                    continue;
                }
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), error, { itemIndex });
            }
        }
        return [returnData];
    }
}
exports.AtomicMail = AtomicMail;
//# sourceMappingURL=AtomicMail.node.js.map