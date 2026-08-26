"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AtomicMailOAuth2Api = void 0;
class AtomicMailOAuth2Api {
    constructor() {
        this.name = 'atomicMailOAuth2Api';
        this.extends = ['oAuth2Api'];
        this.displayName = 'Atomic Mail OAuth2 API';
        this.icon = {
            light: 'file:../icons/atomicmail.svg',
            dark: 'file:../icons/atomicmail.dark.svg',
        };
        this.documentationUrl = 'https://github.com/Atomic-Mail/atomic-mail-agentic/blob/develop/docs/n8n.md';
        this.properties = [
            {
                displayName: 'Grant Type',
                name: 'grantType',
                type: 'hidden',
                default: 'pkce',
            },
            {
                displayName: 'Authorization URL',
                name: 'authUrl',
                type: 'hidden',
                default: 'https://auth.atomicmail.ai/oauth/authorize',
            },
            {
                displayName: 'Access Token URL',
                name: 'accessTokenUrl',
                type: 'hidden',
                default: 'https://auth.atomicmail.ai/oauth/token',
            },
            {
                displayName: 'Client ID',
                name: 'clientId',
                type: 'string',
                default: '',
                required: true,
                description: 'Public OAuth client ID. Register one with POST https://auth.atomicmail.ai/oauth/register (RFC 7591), listing this credential\'s OAuth callback URL in redirect_uris.',
            },
            {
                displayName: 'Client Secret',
                name: 'clientSecret',
                type: 'hidden',
                typeOptions: { password: true },
                default: '',
            },
            {
                displayName: 'Scope',
                name: 'scope',
                type: 'options',
                options: [
                    {
                        name: 'Read Only (mail.read)',
                        value: 'mail.read',
                    },
                    {
                        name: 'Read and Send (mail.read mail.send)',
                        value: 'mail.read mail.send',
                    },
                ],
                default: 'mail.read',
                description: 'Sending requires mail.send. The consent screen may still narrow the grant to read-only; a read-only connection gets a clear insufficient_scope error on send.',
            },
            {
                displayName: 'Auth URI Query Parameters',
                name: 'authQueryParameters',
                type: 'hidden',
                default: 'resource=https%3A%2F%2Fapi.atomicmail.ai%2Fjmap',
            },
            {
                displayName: 'Authentication',
                name: 'authentication',
                type: 'hidden',
                default: 'body',
            },
        ];
        this.test = {
            request: {
                baseURL: 'https://auth.atomicmail.ai',
                url: '/api/v1/agents',
                method: 'GET',
            },
        };
    }
}
exports.AtomicMailOAuth2Api = AtomicMailOAuth2Api;
//# sourceMappingURL=AtomicMailOAuth2Api.credentials.js.map