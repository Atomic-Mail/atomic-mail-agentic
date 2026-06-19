#!/usr/bin/env node
/**
 * Copy n8n credential/node entry files to repo-root paths expected by the
 * Creator Portal vetting process (which reads GitHub raw content at the
 * repository root and does not follow symlinks).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageDir, '../../..');

const vettingPaths = [
	'credentials/AtomicMailApi.credentials.ts',
	'dist/credentials/AtomicMailApi.credentials.js',
	'dist/nodes/AtomicMail/AtomicMail.node.js',
	'dist/nodes/AtomicMailTrigger/AtomicMailTrigger.node.js',
];

for (const relPath of vettingPaths) {
	const src = path.join(packageDir, relPath);
	const dest = path.join(repoRoot, relPath);

	if (!fs.existsSync(src)) {
		console.error(`Missing source file: ${src}`);
		process.exit(1);
	}

	fs.mkdirSync(path.dirname(dest), { recursive: true });

	if (fs.existsSync(dest)) {
		const stat = fs.lstatSync(dest);
		if (stat.isSymbolicLink()) {
			fs.unlinkSync(dest);
		}
	}

	fs.copyFileSync(src, dest);
	console.log(`Synced ${relPath}`);
}
