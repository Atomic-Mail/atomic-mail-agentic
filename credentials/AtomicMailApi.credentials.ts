import type {
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class AtomicMailApi implements ICredentialType {
	name = 'atomicMailApi';

	displayName = 'Atomic Mail API';

	icon: Icon = {
		light: 'file:../icons/atomicmail.svg',
		dark: 'file:../icons/atomicmail.dark.svg',
	};

	documentationUrl =
		'https://github.com/Atomic-Mail/atomic-mail-agentic/blob/develop/docs/n8n.md';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description:
				'Optional. Leave empty after **Register** (credentials are saved in workflow static data), or paste an existing Atomic Mail API key.',
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

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.apiUrl || "https://api.atomicmail.ai"}}',
			url: '/.well-known/jmap',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 200,
					message: 'Could not reach the Atomic Mail JMAP endpoint.',
				},
			},
		],
	};
}
