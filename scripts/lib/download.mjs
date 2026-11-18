// Checksum and download helpers shared by the toolchain scripts. Node built-ins only (global fetch, crypto, fs).

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';

export class VerifyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VerifyError';
  }
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Parse the output of `sha256sum`: "<64 hex>  <name>" (a "*" before the name marks binary mode). */
export function parseSha256Sums(text) {
  const map = new Map();
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue;
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!m) throw new VerifyError(`SHA256SUMS line ${i + 1} is not "<sha256>  <name>": ${JSON.stringify(line.slice(0, 80))}`);
    if (map.has(m[2])) throw new VerifyError(`SHA256SUMS lists ${m[2]} twice`);
    map.set(m[2], m[1]);
  }
  return map;
}

/** The sha256 and size of a file, checked against what we expect. Returns null when it matches, else a reason. */
export async function checkFile(path, { sha256, size }) {
  if (!existsSync(path)) return 'missing';
  const st = statSync(path);
  if (size !== undefined && st.size !== size) return `size ${st.size}, expected ${size}`;
  const got = await sha256File(path);
  if (got !== sha256) return `sha256 ${got}, expected ${sha256}`;
  return null;
}

export function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

/**
 * Download `url` into `dest`, verifying size and sha256 while streaming. Writes to "<dest>.part" and renames on
 * success. On a mismatch the partial file is DELETED and a VerifyError is thrown (never retried: a wrong digest
 * is not a network problem). Network errors are retried up to `attempts` times.
 * @param {{url: string, dest: string, sha256: string, size: number, fetchImpl?: typeof fetch,
 *          onProgress?: (received: number, total: number) => void, attempts?: number}} o
 */
export async function downloadVerified(o) {
  const { url, dest, sha256, size, fetchImpl = fetch, onProgress, attempts = 3 } = o;
  mkdirSync(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await downloadOnce({ url, part, sha256, size, fetchImpl, onProgress });
      renameSync(part, dest);
      return;
    } catch (e) {
      rmSync(part, { force: true });
      if (e instanceof VerifyError) throw e;
      lastError = e;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw new Error(`download failed after ${attempts} attempts: ${url}: ${lastError?.message ?? lastError}`);
}

async function downloadOnce({ url, part, sha256, size, fetchImpl, onProgress }) {
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  if (!res.body) throw new Error(`empty response body for ${url}`);
  const hash = createHash('sha256');
  const fh = await open(part, 'w');
  let received = 0;
  try {
    for await (const chunk of res.body) {
      received += chunk.length;
      // A replaced release asset may be huge: stop as soon as it is clearly not the pinned file.
      if (received > size) throw new VerifyError(`${url}: more than the expected ${size} bytes received (file replaced?)`);
      hash.update(chunk);
      await fh.write(chunk);
      onProgress?.(received, size);
    }
  } finally {
    await fh.close();
  }
  if (received !== size) throw new VerifyError(`${url}: got ${received} bytes, expected ${size}`);
  const got = hash.digest('hex');
  if (got !== sha256) throw new VerifyError(`${url}: sha256 mismatch: got ${got}, expected ${sha256}`);
}

/**
 * Make sure `dir/<asset.name>` exists and matches the pinned size and sha256. Skips the download when the file
 * is already there and verified (unless `force`). A present file that fails verification is deleted first.
 * @returns {Promise<'skipped'|'downloaded'>}
 */
export async function ensureAsset({ dir, asset, url, force = false, fetchImpl, onProgress, log = () => {} }) {
  const dest = `${dir}/${asset.name}`;
  if (!force) {
    const problem = await checkFile(dest, asset);
    if (problem === null) return 'skipped';
    if (problem !== 'missing') {
      log(`  ${asset.name}: present but wrong (${problem}); deleting and downloading again`);
      rmSync(dest, { force: true });
    }
  } else {
    rmSync(dest, { force: true });
  }
  await downloadVerified({ url, dest, sha256: asset.sha256, size: asset.size, fetchImpl, onProgress });
  return 'downloaded';
}
