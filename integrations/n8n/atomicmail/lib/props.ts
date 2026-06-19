export const DEFAULT_ACCOUNT_ID = 'default';

export function normalizeAccountId(raw: unknown): string {
	if (typeof raw !== 'string' || raw.trim().length === 0) {
		return DEFAULT_ACCOUNT_ID;
	}
	return raw.trim();
}

export function optionalTrimmedString(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function requiredString(raw: unknown, fieldName: string): string {
	const value = optionalTrimmedString(raw);
	if (!value) {
		throw new Error(`${fieldName} is required.`);
	}
	return value;
}

export function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}
