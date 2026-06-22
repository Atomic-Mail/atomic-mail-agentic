#!/usr/bin/env node
/**
 * Copy n8n credential/node entry files for Creator Portal vetting.
 *
 * Canonical sources live under integrations/n8n/atomicmail/. Mirrors are
 * written to integrations/n8n/vetting/ and compiled dist/*.js files are
 * also copied to repo-root dist/ (Creator Portal resolves n8n.* paths from
 * the repository root, not repository.directory; GitHub raw does not follow
 * symlinks).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const n8nDir = path.resolve(packageDir, '..');
const vettingDir = path.join(n8nDir, 'vetting');
const repoRoot = path.resolve(n8nDir, '../..');

const vettingPaths = [
	'credentials/AtomicMailApi.credentials.ts',
	'dist/credentials/AtomicMailApi.credentials.js',
	'dist/nodes/AtomicMail/AtomicMail.node.js',
	'dist/nodes/AtomicMailTrigger/AtomicMailTrigger.node.js',
];

function copyFile(src, dest) {
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
}

for (const relPath of vettingPaths) {
	const src = path.join(packageDir, relPath);
	const vettingDest = path.join(vettingDir, relPath);
	copyFile(src, vettingDest);
	console.log(`Synced integrations/n8n/vetting/${relPath}`);
}

for (const relPath of vettingPaths) {
	if (!relPath.startsWith('dist/')) continue;
	const src = path.join(vettingDir, relPath);
	const repoDest = path.join(repoRoot, relPath);
	copyFile(src, repoDest);
	console.log(`Synced repo-root ${relPath}`);
}
