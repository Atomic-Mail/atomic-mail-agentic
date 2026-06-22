"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AtomicMailApi = void 0;
class AtomicMailApi {
    constructor() {
        this.name = 'atomicMailApi';
        this.displayName = 'Atomic Mail API';
        this.icon = {
            light: 'file:../icons/atomicmail.svg',
            dark: 'file:../icons/atomicmail.dark.svg',
        };
        this.documentationUrl = 'https://github.com/Atomic-Mail/atomic-mail-agentic/blob/develop/docs/n8n.md';
        this.properties = [
            {
                displayName: 'API Key',
                name: 'apiKey',
                type: 'string',
                typeOptions: {
                    password: true,
                },
                default: '',
                description: 'Optional. Leave empty after **Register** (credentials are saved in workflow static data), or paste an existing Atomic Mail API key.',
            },
            {
                displayName: 'Auth URL',
                name: 'authUrl',
                type: 'string',
                default: 'https://auth.atomicmail.ai',
                description: 'Auth service base URL (default https://auth.atomicmail.ai).',
            },
            {
                displayName: 'API URL',
                name: 'apiUrl',
                type: 'string',
                default: 'https://api.atomicmail.ai',
                description: 'JMAP API base URL (default https://api.atomicmail.ai).',
            },
        ];
        this.test = {
            request: {
                baseURL: '={{$credentials.authUrl || "https://auth.atomicmail.ai"}}',
                url: '/api/v1/challenge',
                method: 'POST',
            },
            rules: [
                {
                    type: 'responseCode',
                    properties: {
                        value: 200,
                        message: 'Could not reach the Atomic Mail auth service. Check Auth URL and API URL.',
                    },
                },
            ],
        };
    }
}
exports.AtomicMailApi = AtomicMailApi;
//# sourceMappingURL=AtomicMailApi.credentials.js.map