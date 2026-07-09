#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { drop } from '../lib/index.js';

const HELP = `cf-drop — upload a folder or zip to Cloudflare Drop (no account, live for 60 min)

Usage:
  cf-drop <folder-or-zip> [--json]

Options:
  --json         machine-readable output (progress logs suppressed)
  -v, --version  print version
  -h, --help     show this help

Notes:
  · deployments are PUBLIC and expire after 60 minutes unless claimed
  · dotfiles and node_modules are skipped when uploading a folder
  · limits: 100MB total, static assets only, index.html expected at root`;

const args = process.argv.slice(2);

if (args.includes('-h') || args.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}
if (args.includes('-v') || args.includes('--version')) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

const asJson = args.includes('--json');
const target = args.find((a) => !a.startsWith('-'));
if (!target) {
  console.error(HELP);
  process.exit(1);
}

const onLog = asJson ? () => {} : (msg) => console.error(`· ${msg}`);

try {
  const result = await drop(target, { onLog });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n✅ deployed (${result.files} files, ${(result.totalBytes / 1024).toFixed(1)} KiB)`);
    console.log(`   site:    ${result.url}`);
    console.log(`   claim:   ${result.claimUrl}`);
    console.log(`   expires: ${result.expiresAt} (claim within 60 min to keep it)`);
  }
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
