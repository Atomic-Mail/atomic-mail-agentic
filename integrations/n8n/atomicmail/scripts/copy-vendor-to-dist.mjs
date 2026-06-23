#!/usr/bin/env node
/**
 * Copy vendor/agentic-core into dist/vendor/agentic-core so compiled JS
 * require("../../vendor/...") from dist/nodes/ and require("../vendor/...")
 * from dist/lib/ resolve at runtime (npm install layout).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(packageDir, 'vendor', 'agentic-core');
const destDir = path.join(packageDir, 'dist', 'vendor', 'agentic-core');

if (!fs.existsSync(path.join(srcDir, 'index.js'))) {
	console.error(
		`Missing vendor bundle at ${srcDir}/index.js — run "npm run build:n8n" from repo root first`,
	);
	process.exit(1);
}

fs.rmSync(path.join(packageDir, 'dist', 'vendor'), { recursive: true, force: true });
fs.mkdirSync(destDir, { recursive: true });

for (const name of ['index.js', 'index.d.ts']) {
	fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
}

console.log('Copied vendor/agentic-core -> dist/vendor/agentic-core');
