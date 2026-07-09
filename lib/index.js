// cf-drop: upload a folder or zip to Cloudflare Drop (no account, live for 60 minutes).
// Protocol reverse-engineered from the https://www.cloudflare.com/drop/ frontend bundle.

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const API = 'https://api.cloudflare.com/client/v4';
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // official limit
const UPLOAD_CONCURRENCY = 4;

const MIME = {
  html: 'text/html', htm: 'text/html', css: 'text/css',
  js: 'application/javascript', mjs: 'application/javascript',
  json: 'application/json', xml: 'application/xml', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject', txt: 'text/plain', md: 'text/markdown',
  pdf: 'application/pdf', wasm: 'application/wasm', mp4: 'video/mp4',
  webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', map: 'application/json',
};

const ext = (name) => {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1);
};
const mime = (name) => MIME[ext(name).toLowerCase()] || 'application/octet-stream';

// ---------- collect files ----------

/** Walk a directory into [{ path: '/relative/posix/path', data: Buffer }].
 *  Skips dotfiles and node_modules — deployments are public. */
export function collectDir(dir, root = dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectDir(p, root, out);
    else if (st.isFile()) out.push({ path: '/' + relative(root, p).split(sep).join('/'), data: readFileSync(p) });
  }
  return out;
}

/** Parse a zip buffer into file entries. Supports store (0) and deflate (8). */
export function parseZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a valid zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || basename(name) === '.DS_Store') continue;
    const lnl = buf.readUInt16LE(localOff + 26);
    const lel = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lnl + lel;
    const raw = buf.subarray(start, start + compSize);
    if (method !== 0 && method !== 8) throw new Error(`unsupported zip compression method (${method}): ${name}`);
    files.push({ path: '/' + name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
  }
  return files;
}

/** Strip a single shared top-level directory so index.html lands at the site root. */
export function stripCommonRoot(files) {
  if (files.some((f) => f.path === '/index.html')) return files;
  const roots = new Set(files.map((f) => f.path.split('/')[1]));
  if (roots.size !== 1 || !files.every((f) => f.path.split('/').length > 2)) return files;
  const root = [...roots][0];
  return files.map((f) => ({ ...f, path: f.path.slice(root.length + 1) }));
}

// ---------- proof of work: chained SHA-256 over the seed, submit k+1 checkpoints ----------

function solvePow({ seed, k, g }) {
  const seedBytes = Buffer.from(seed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (seedBytes.length !== 32) throw new Error(`PoW seed must be 32 bytes, got ${seedBytes.length}`);
  let h = createHash('sha256').update(seedBytes).digest();
  const checkpoints = [h];
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < g; j++) h = createHash('sha256').update(h).digest();
    checkpoints.push(h);
  }
  return { checkpoints: Buffer.concat(checkpoints).toString('base64') };
}

// ---------- HTTP ----------

async function req(url, opts = {}, timeout = 30_000) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${opts.method || 'GET'} ${url} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return res.json();
}

const authed = (path, token, opts = {}, timeout) =>
  req(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } }, timeout);

// ---------- deploy ----------

/**
 * Deploy files to Cloudflare Drop.
 * @param {{ path: string, data: Buffer }[]} files - paths must start with '/'
 * @param {{ onLog?: (msg: string) => void }} [options]
 * @returns {Promise<{ url: string, claimUrl: string, expiresAt: string, files: number, totalBytes: number }>}
 */
export async function deploy(files, { onLog = () => {} } = {}) {
  // manifest: path -> { hash, size }; hash = first 32 hex chars of sha256(base64(content) + extension)
  const manifest = {};
  const hashedFiles = {}; // hash -> { b64, type }
  for (const f of files) {
    const b64 = f.data.toString('base64');
    const hash = createHash('sha256').update(b64 + ext(basename(f.path))).digest('hex').slice(0, 32);
    manifest[f.path] = { hash, size: f.data.length };
    hashedFiles[hash] ??= { b64, type: mime(f.path) };
  }

  onLog('requesting deployment credentials (includes proof-of-work)...');
  const challenge = (await req(`${API}/provisioning/previews/challenge`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })).result;
  const solution = solvePow(challenge);
  const provision = (await req(`${API}/provisioning/previews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client: 'web', source: 'drop',
      termsOfService: 'https://www.cloudflare.com/terms/',
      privacyPolicy: 'https://www.cloudflare.com/privacypolicy/',
      acceptTermsOfService: 'yes',
      challengeToken: challenge.challengeToken, solution,
    }),
  })).result;

  const { id: accountId, apiToken, expiresAt } = provision.account;
  const claim = provision.claim;
  const scriptName = `drop-${randomUUID().slice(0, 12)}`;

  onLog(`uploading ${files.length} files...`);
  const session = (await authed(
    `/accounts/${accountId}/workers/scripts/${scriptName}/assets-upload-session`,
    apiToken,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifest }) },
  )).result;

  let completionJwt = session.jwt;
  const buckets = session.buckets ?? [];
  if (buckets.length > 0) {
    completionJwt = '';
    let next = 0;
    const worker = async () => {
      for (;;) {
        const bucket = buckets[next++];
        if (!bucket) return;
        const fd = new FormData();
        for (const hash of bucket) {
          const f = hashedFiles[hash];
          if (f) fd.set(hash, new Blob([f.b64], { type: f.type }), hash);
        }
        const r = await authed(`/accounts/${accountId}/workers/assets/upload?base64=true`, session.jwt,
          { method: 'POST', body: fd }, 120_000);
        if (r.result?.jwt) completionJwt = r.result.jwt;
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, buckets.length) }, worker));
    if (!completionJwt) throw new Error('asset upload finished without a completion token');
  }

  onLog('deploying worker...');
  const metadata = JSON.stringify({
    compatibility_date: '2025-05-19',
    assets: { jwt: completionJwt, config: { not_found_handling: 'single-page-application' } },
    bindings: [{ name: 'ASSETS', type: 'assets' }],
  });

  const finalForm = new FormData();
  finalForm.set('metadata', metadata);
  finalForm.set('manifest', JSON.stringify(manifest));
  for (const [hash, f] of Object.entries(hashedFiles)) finalForm.set(hash, new Blob([f.b64], { type: f.type }), hash);
  await req(`${API}/provisioning/previews/accounts/${accountId}/scripts/${scriptName}/assets?base64=true`,
    { method: 'POST', headers: { 'X-Claim-Token': claim.token }, body: finalForm }, 120_000);

  const scriptForm = new FormData();
  scriptForm.set('metadata', metadata);
  await authed(`/accounts/${accountId}/workers/scripts/${scriptName}`, apiToken, { method: 'PUT', body: scriptForm }, 120_000);
  await authed(`/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`, apiToken,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"enabled":true}' });
  const { subdomain } = (await authed(`/accounts/${accountId}/workers/subdomain`, apiToken)).result;

  return {
    url: `https://${scriptName}.${subdomain}.workers.dev`,
    claimUrl: claim.url,
    expiresAt: new Date(expiresAt).toISOString(),
    files: files.length,
    totalBytes: files.reduce((n, f) => n + f.data.length, 0),
  };
}

/**
 * Deploy a folder or .zip file to Cloudflare Drop.
 * @param {string} target - path to a directory or a .zip file
 * @param {{ onLog?: (msg: string) => void }} [options]
 */
export async function drop(target, { onLog = () => {} } = {}) {
  const st = statSync(target);
  const files = st.isDirectory()
    ? collectDir(target)
    : stripCommonRoot(parseZip(readFileSync(target)));

  if (files.length === 0) throw new Error('no files to upload');
  const total = files.reduce((n, f) => n + f.data.length, 0);
  if (total > MAX_TOTAL_BYTES) {
    throw new Error(`total size ${(total / 1048576).toFixed(1)}MB exceeds the 100MB limit`);
  }
  if (!files.some((f) => f.path === '/index.html')) {
    onLog('warning: no index.html at the root — the site may 404');
  }
  return deploy(files, { onLog });
}
