import type {
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * OAuth 2.0 authorization-code + PKCE (S256) against auth.atomicmail.ai.
 * Public client — no client secret. n8n's `pkce` grant type generates the
 * verifier/S256 challenge and rotates the refresh token automatically.
 * The access token is used directly as the JMAP bearer (see docs/oauth.md).
 */
export class AtomicMailOAuth2Api implements ICredentialType {
	name = 'atomicMailOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Atomic Mail OAuth2 API';

	icon: Icon = {
		light: 'file:../icons/atomicmail.svg',
		dark: 'file:../icons/atomicmail.dark.svg',
	};

	documentationUrl =
		'https://github.com/Atomic-Mail/atomic-mail-agentic/blob/develop/docs/n8n.md';

	properties: INodeProperties[] = [
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
			// TODO: replace the empty default with the published public client_id
			// once one is registered for n8n (see PR description). Until then users
			// register their own via RFC 7591 dynamic client registration.
			displayName: 'Client ID',
			name: 'clientId',
			type: 'string',
			default: '',
			required: true,
			description:
				'Public OAuth client ID. Register one with POST https://auth.atomicmail.ai/oauth/register (RFC 7591), listing this credential\'s OAuth callback URL in redirect_uris.',
		},
		{
			// Public client — the auth server accepts token_endpoint_auth_method
			// "none"; no secret exists.
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
			description:
				'Sending requires mail.send. The consent screen may still narrow the grant to read-only; a read-only connection gets a clear insufficient_scope error on send.',
		},
		{
			// `resource` (RFC 8707) must match https://api.atomicmail.ai/jmap byte
			// for byte after URL-decoding; n8n appends this string to the authorize
			// URL as-is, so it is pre-encoded here.
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

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://auth.atomicmail.ai',
			url: '/api/v1/agents',
			method: 'GET',
		},
	};
}
