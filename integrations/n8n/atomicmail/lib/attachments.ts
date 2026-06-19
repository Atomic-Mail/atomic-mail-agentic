import type { IExecuteFunctions } from 'n8n-workflow';

import type { AgentSession } from '../vendor/agentic-core/index.js';
import {
	assertAttachmentBytesWithinBlobLimit,
	expandUploadUrl,
	guessMimeTypeFromFilename,
	postBinaryBlobUpload,
} from '../vendor/agentic-core/index.js';

function sanitizeFilename(name: string): string {
	const normalized = name.replace(/\\/g, '/');
	const base = normalized.split('/').pop()?.trim() || 'attachment.bin';
	const safe = base.replace(/\.\./g, '').replace(/[/\\]/g, '');
	return safe || 'attachment.bin';
}

async function resolveUploadUrl(
	session: AgentSession,
	accountId: string,
): Promise<string | undefined> {
	const template = session.currentUploadUrl;
	if (!template) {
		return undefined;
	}
	return expandUploadUrl(template, accountId);
}

export type AttachmentVarsResult =
	| { ok: true; vars?: Record<string, string> }
	| { ok: false; message: string };

/**
 * Upload n8n binary input to JMAP blob storage (no filesystem temp files).
 * Returns preset vars for send_mail_blob_attachment.json.
 */
export async function attachmentVarsFromBinaryProperty(
	context: IExecuteFunctions,
	session: AgentSession,
	itemIndex: number,
	binaryPropertyName: string | undefined,
): Promise<AttachmentVarsResult> {
	const propertyName = binaryPropertyName?.trim();
	if (!propertyName) {
		return { ok: true, vars: undefined };
	}

	const item = context.getInputData()[itemIndex];
	const binaryData = item.binary?.[propertyName];
	if (!binaryData) {
		return { ok: true, vars: undefined };
	}

	const buffer = await context.helpers.getBinaryDataBuffer(itemIndex, propertyName);
	const filename = sanitizeFilename(binaryData.fileName || `${propertyName}.bin`);
	const contentType =
		(typeof binaryData.mimeType === 'string' && binaryData.mimeType.trim()) ||
		guessMimeTypeFromFilename(filename);

	const accountId = await session.getPrimaryMailAccountId();
	const limits = await session.getBlobUploadLimitsForAccount(accountId);
	assertAttachmentBytesWithinBlobLimit(
		[{ label: filename, byteLength: buffer.byteLength }],
		limits,
	);

	const uploadUrl = await resolveUploadUrl(session, accountId);
	if (!uploadUrl) {
		return { ok: false, message: 'JMAP session missing uploadUrl.' };
	}
	const capabilityJwt = await session.getCapabilityToken();
	const bytes = new Uint8Array(buffer);
	const { blobId, size } = await postBinaryBlobUpload(
		uploadUrl,
		capabilityJwt,
		bytes,
		contentType,
	);

	return {
		ok: true,
		vars: {
			ATTACHMENT_0_BLOB_ID: blobId,
			ATTACHMENT_0_NAME: filename,
			ATTACHMENT_0_TYPE: contentType,
			ATTACHMENT_0_SIZE: String(size),
			ATTACHMENT_COUNT: '1',
		},
	};
}
