// Tests for the toolchain scripts (checksums, downloads, tar reader, sources list, packs). Run with
//   npx vitest run scripts          (vitest picks up *.test.mjs by default, so `npm test` runs it too)
// No network: downloads use a fake fetch. The last block round-trips the real packs when toolchain/packs/ exists
// (after `npm run toolchain:fetch` and `npm run toolchain:packs`) and is skipped otherwise.

import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { checkFile, downloadVerified, ensureAsset, parseSha256Sums, sha256Hex, VerifyError } from './lib/download.mjs';
import { extractEntries, readTar, safeRelPath, TarError } from './lib/tar.mjs';
import { EXCLUDED_ASSETS, RECIPE_FILES, RELEASE, RUNTIME_ASSETS, SOURCE_ASSETS } from './lib/toolchain-pins.mjs';
import { crossCheckSums, fetchToolchain } from './fetch-toolchain.mjs';
import { fetchSources, renderSourcesMd } from './fetch-toolchain-sources.mjs';
import { isSafePackPath, PackError, readPack, verifyPack } from './packreader.mjs';
import { buildPack, gzipDeterministic } from './make-packs.mjs';

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const enc = (s) => new TextEncoder().encode(s);
const quiet = () => {};
const silentOut = { isTTY: false, write: () => true };

function tmp() {
  return mkdtempSync(join(tmpdir(), 'gatehouse-test-'));
}

// ---- helpers: tar fixtures ----------------------------------------------------------------------------------
function octal(n, len) {
  return n.toString(8).padStart(len - 1, '0') + '\0';
}
function putStr(buf, off, s, len) {
  buf.set(enc(s).subarray(0, len), off);
}
function tarEntry({ name, data = new Uint8Array(0), type = '0', linkname = '', prefix = '', magic = 'ustar\0', breakChecksum = false }) {
  const h = new Uint8Array(512);
  putStr(h, 0, name, 100);
  putStr(h, 100, octal(0o644, 8), 8);
  putStr(h, 124, octal(data.length, 12), 12);
  putStr(h, 136, octal(0, 12), 12);
  h.fill(0x20, 148, 156);
  h[156] = type.charCodeAt(0);
  putStr(h, 157, linkname, 100);
  putStr(h, 257, magic, 6);
  putStr(h, 263, '00', 2);
  putStr(h, 345, prefix, 155);
  let sum = 0;
  for (const b of h) sum += b;
  putStr(h, 148, octal(sum, 7) + ' ', 8);
  if (breakChecksum) h[148] ^= 1;
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  const out = new Uint8Array(512 + padded.length);
  out.set(h);
  out.set(padded, 512);
  return out;
}
function paxData(records) {
  let s = '';
  for (const [k, v] of Object.entries(records)) {
    const body = ` ${k}=${v}\n`;
    let len = body.length + 1;
    while (String(len).length + body.length !== len) len = String(len).length + body.length;
    s += `${len}${body}`;
  }
  return enc(s);
}
function tarArchive(...entries) {
  const parts = [...entries, new Uint8Array(1024)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const e of parts) { out.set(e, p); p += e.length; }
  return out;
}
const text = (e) => new TextDecoder().decode(e.data);

// ---- checksums ----------------------------------------------------------------------------------------------
describe('checksums', () => {
  it('sha256Hex matches the known vector for "abc"', () => {
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('parses sha256sum output and rejects malformed or duplicate lines', () => {
    const h = 'a'.repeat(64);
    const m = parseSha256Sums(`${h}  one.bin\n${'b'.repeat(64)} *two.bin\n\n`);
    expect(m.get('one.bin')).toBe(h);
    expect(m.get('two.bin')).toBe('b'.repeat(64));
    expect(() => parseSha256Sums('nonsense\n')).toThrow(VerifyError);
    expect(() => parseSha256Sums(`${h}  x\n${h}  x\n`)).toThrow(/twice/);
    expect(() => parseSha256Sums(`${'A'.repeat(64)}  x\n`)).toThrow(VerifyError); // upper case is not sha256sum output
  });

  it('crossCheckSums detects a digest that differs from the pinned one and a missing file', () => {
    const assets = [{ name: 'SHA256SUMS' }, { name: 'a.bin', sha256: 'a'.repeat(64) }, { name: 'b.bin', sha256: 'b'.repeat(64) }];
    expect(() => crossCheckSums(`${'a'.repeat(64)}  a.bin\n${'b'.repeat(64)}  b.bin\n`, assets)).not.toThrow();
    expect(() => crossCheckSums(`${'a'.repeat(64)}  a.bin\n${'c'.repeat(64)}  b.bin\n`, assets)).toThrow(/disagrees/);
    expect(() => crossCheckSums(`${'a'.repeat(64)}  a.bin\n`, assets)).toThrow(/does not list b.bin/);
  });
});

// ---- pins ---------------------------------------------------------------------------------------------------
describe('pinned release data', () => {
  const release = JSON.parse(readFileSync(join(REPO, 'spikes/compiler-startabit/release.json'), 'utf8'));
  const api = new Map(release.assets.map((a) => [a.name, a]));

  it('every pinned size and digest equals the GitHub API snapshot of the release', () => {
    for (const a of [...RUNTIME_ASSETS, ...SOURCE_ASSETS, ...EXCLUDED_ASSETS]) {
      const r = api.get(a.name);
      expect(r, a.name).toBeDefined();
      expect(a.size, a.name).toBe(r.size);
      expect(`sha256:${a.sha256}`, a.name).toBe(r.digest);
    }
  });

  it('covers every asset of the release exactly once, and the native toolchain is excluded', () => {
    const all = [...RUNTIME_ASSETS, ...SOURCE_ASSETS, ...EXCLUDED_ASSETS].map((a) => a.name);
    expect(new Set(all).size).toBe(all.length);
    expect([...api.keys()].sort()).toEqual([...all].sort());
    expect(EXCLUDED_ASSETS.map((a) => a.name)).toEqual(['avr-gcc-7.3.0-atmel3.6.1-arduino7-x86_64-pc-linux-gnu.tar.bz2']);
    expect(RUNTIME_ASSETS.reduce((n, a) => n + a.size, 0)).toBeLessThan(7 * 1024 * 1024);
  });

  it('refuses to fetch an excluded asset', async () => {
    const x = EXCLUDED_ASSETS[0];
    await expect(fetchSources({ root: tmp(), sources: [{ ...SOURCE_ASSETS[0], name: x.name }], recipe: [], log: quiet, out: silentOut })).rejects.toThrow(/refusing/);
    await expect(fetchToolchain({ root: tmp(), assets: [x], log: quiet, out: silentOut })).rejects.toThrow(/refusing/);
  });
});

// ---- download -----------------------------------------------------------------------------------------------
function fakeFetch(files, calls = []) {
  return async (url) => {
    calls.push(url);
    const body = files[url.slice(url.lastIndexOf('/') + 1)];
    if (body === undefined) return new Response('nope', { status: 404, statusText: 'Not Found' });
    return new Response(body, { status: 200 });
  };
}

describe('downloadVerified / ensureAsset', () => {
  const data = enc('hello gatehouse');
  const good = { name: 'f.bin', size: data.length, sha256: sha256Hex(data) };

  it('writes a verified file and leaves no .part behind', async () => {
    const dir = tmp();
    const status = await ensureAsset({ dir, asset: good, url: 'https://x.test/f.bin', fetchImpl: fakeFetch({ 'f.bin': data }) });
    expect(status).toBe('downloaded');
    expect(readFileSync(join(dir, 'f.bin'))).toEqual(Buffer.from(data));
    expect(existsSync(join(dir, 'f.bin.part'))).toBe(false);
    rmSync(dir, { recursive: true });
  });

  it('skips a present verified file without touching the network, and replaces a wrong one', async () => {
    const dir = tmp();
    const calls = [];
    await ensureAsset({ dir, asset: good, url: 'https://x.test/f.bin', fetchImpl: fakeFetch({ 'f.bin': data }, calls) });
    expect(await ensureAsset({ dir, asset: good, url: 'https://x.test/f.bin', fetchImpl: fakeFetch({ 'f.bin': data }, calls) })).toBe('skipped');
    expect(calls).toHaveLength(1);
    writeFileSync(join(dir, 'f.bin'), 'corrupted');
    expect(await ensureAsset({ dir, asset: good, url: 'https://x.test/f.bin', fetchImpl: fakeFetch({ 'f.bin': data }, calls), log: quiet })).toBe('downloaded');
    expect(await checkFile(join(dir, 'f.bin'), good)).toBeNull();
    expect(await ensureAsset({ dir, asset: good, url: 'https://x.test/f.bin', fetchImpl: fakeFetch({ 'f.bin': data }, calls), force: true })).toBe('downloaded');
    expect(calls).toHaveLength(3);
    rmSync(dir, { recursive: true });
  });

  it('a tampered download is rejected, deleted and never retried', async () => {
    const dir = tmp();
    const calls = [];
    const evil = enc('hello gatehousE'); // same length, other content
    await expect(ensureAsset({ dir, asset: good, url: 'https://x.test/f.bin', fetchImpl: fakeFetch({ 'f.bin': evil }, calls) })).rejects.toThrow(/sha256 mismatch/);
    expect(calls).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([]); // neither f.bin nor f.bin.part
    rmSync(dir, { recursive: true });
  });

  it('rejects a file with the wrong size, including one that is much too big', async () => {
    const dir = tmp();
    await expect(ensureAsset({ dir, asset: good, url: 'https://x.test/f.bin', fetchImpl: fakeFetch({ 'f.bin': enc('short') }) })).rejects.toThrow(/expected/);
    await expect(ensureAsset({ dir, asset: good, url: 'https://x.test/f.bin', fetchImpl: fakeFetch({ 'f.bin': new Uint8Array(100000) }) })).rejects.toThrow(/more than the expected/);
    expect(readdirSync(dir)).toEqual([]);
    rmSync(dir, { recursive: true });
  });

  it('retries network errors but reports HTTP failures', async () => {
    const dir = tmp();
    let n = 0;
    const flaky = async () => {
      if (++n < 3) throw new Error('connection reset');
      return new Response(data, { status: 200 });
    };
    await downloadVerified({ url: 'https://x.test/f.bin', dest: join(dir, 'f.bin'), sha256: good.sha256, size: good.size, fetchImpl: flaky });
    expect(n).toBe(3);
    await expect(downloadVerified({ url: 'https://x.test/missing', dest: join(dir, 'm.bin'), sha256: good.sha256, size: good.size, fetchImpl: fakeFetch({}), attempts: 1 })).rejects.toThrow(/404/);
    rmSync(dir, { recursive: true });
  });
});

// ---- tar reader ---------------------------------------------------------------------------------------------
describe('tar reader', () => {
  it('reads files and directories, strips ./, joins the ustar prefix', () => {
    const tar = tarArchive(
      tarEntry({ name: './', type: '5' }),
      tarEntry({ name: 'dir/', type: '5' }),
      tarEntry({ name: 'dir/a.txt', data: enc('alpha') }),
      tarEntry({ name: 'b.txt', prefix: 'dir/sub', data: enc('beta') }),
      tarEntry({ name: './c.txt', data: enc('x'.repeat(1000)) }),
    );
    const entries = readTar(tar);
    expect(entries.map((e) => `${e.type}:${e.path}`)).toEqual(['dir:dir', 'file:dir/a.txt', 'file:dir/sub/b.txt', 'file:c.txt']);
    expect(text(entries[1])).toBe('alpha');
    expect(entries[3].data.length).toBe(1000);
  });

  it('understands pax paths, GNU long names and a global pax header', () => {
    const long = 'long/' + 'd'.repeat(150) + '/file.txt';
    const tar = tarArchive(
      tarEntry({ name: 'pax_global', type: 'g', data: paxData({ comment: 'hi' }) }),
      tarEntry({ name: 'PaxHeader', type: 'x', data: paxData({ path: long }) }),
      tarEntry({ name: 'short', data: enc('one') }),
      tarEntry({ name: '././@LongLink', type: 'L', data: enc(long.replace('file', 'gnu') + '\0') }),
      tarEntry({ name: 'short2', data: enc('two') }),
    );
    const entries = readTar(tar);
    expect(entries.map((e) => e.path)).toEqual([long, long.replace('file', 'gnu')]);
    expect(entries.map(text)).toEqual(['one', 'two']);
  });

  it('turns hardlinks and in-folder symlinks into copies of the target file', () => {
    const tar = tarArchive(
      tarEntry({ name: 'lib/real.a', data: enc('ARCHIVE') }),
      tarEntry({ name: 'lib/hard.a', type: '1', linkname: 'lib/real.a' }),
      tarEntry({ name: 'lib/soft.a', type: '2', linkname: 'real.a' }),
      tarEntry({ name: 'top/up.a', type: '2', linkname: '../lib/real.a' }),
      tarEntry({ name: 'lib/chain.a', type: '2', linkname: 'soft.a' }), // link to a link
    );
    const entries = readTar(tar);
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
    for (const p of ['lib/hard.a', 'lib/soft.a', 'top/up.a', 'lib/chain.a']) {
      expect(byPath[p].type).toBe('file');
      expect(text(byPath[p])).toBe('ARCHIVE');
    }
  });

  const E = (o) => [tarEntry(o)];
  it.each([
    ['dot-dot path', E({ name: '../evil.txt', data: enc('x') }), /"\.\."/],
    ['nested dot-dot', E({ name: 'a/../../evil.txt', data: enc('x') }), /"\.\."/],
    ['absolute path', E({ name: '/etc/passwd', data: enc('x') }), /absolute/],
    ['drive letter', E({ name: 'C:/Windows/x', data: enc('x') }), /drive letter/],
    ['backslash', E({ name: 'a\\..\\b', data: enc('x') }), /backslash/],
    ['alternate data stream', E({ name: 'a.txt:stream', data: enc('x') }), /":"/],
    ['symlink out of the folder', E({ name: 'l', type: '2', linkname: '../../outside' }), /escapes/],
    ['symlink to an absolute path', E({ name: 'l', type: '2', linkname: '/etc/passwd' }), /absolute/],
    ['hardlink to a missing file', E({ name: 'l', type: '1', linkname: 'nothing' }), /not a regular file/],
    ['hardlink out of the folder', E({ name: 'l', type: '1', linkname: '../x' }), /"\.\."/],
    ['symlink to a directory', [tarEntry({ name: 'd', type: '5' }), tarEntry({ name: 'l', type: '2', linkname: 'd' })], /not a regular file/],
    ['device node', E({ name: 'dev', type: '3' }), /unsupported entry type/],
    ['fifo', E({ name: 'fifo', type: '6' }), /unsupported entry type/],
    ['bad checksum', E({ name: 'a', data: enc('x'), breakChecksum: true }), /checksum/],
  ])('rejects %s', (_label, entries, pattern) => {
    const tar = tarArchive(...entries);
    expect(() => readTar(tar)).toThrow(TarError);
    expect(() => readTar(tar)).toThrow(pattern);
  });

  it('rejects a truncated archive and enforces the limits', () => {
    const tar = tarArchive(tarEntry({ name: 'a', data: enc('x'.repeat(2000)) }));
    expect(() => readTar(tar.subarray(0, 1000))).toThrow(/truncated/);
    expect(() => readTar(tar, { maxTotalBytes: 1000 })).toThrow(/exceeds/);
    const many = tarArchive(...Array.from({ length: 5 }, (_, i) => tarEntry({ name: `f${i}`, data: enc('x') })));
    expect(() => readTar(many, { maxEntries: 4 })).toThrow(/more than 4 entries/);
    expect(() => readTar(tarArchive(tarEntry({ name: 'a'.repeat(100) + '/' + 'b'.repeat(100), prefix: 'p'.repeat(150) })), { maxPathLength: 200 })).toThrow(/too long/);
    // a link that would multiply a big file many times counts against the cap
    const bomb = tarArchive(
      tarEntry({ name: 'big', data: enc('x'.repeat(600)) }),
      ...Array.from({ length: 5 }, (_, i) => tarEntry({ name: `l${i}`, type: '1', linkname: 'big' })),
    );
    expect(() => readTar(bomb, { maxTotalBytes: 2000 })).toThrow(/exceeds/);
  });

  it('safeRelPath normalises and rejects', () => {
    expect(safeRelPath('./a//b/./c/')).toBe('a/b/c');
    expect(safeRelPath('.')).toBe('');
    expect(() => safeRelPath('a/../b')).toThrow(TarError);
    expect(() => safeRelPath('a\0b')).toThrow(TarError);
  });

  it('extractEntries writes the files and refuses a path that escapes (defence in depth)', () => {
    const dir = tmp();
    const out = join(dir, 'out');
    const written = extractEntries(readTar(tarArchive(tarEntry({ name: 'd/', type: '5' }), tarEntry({ name: 'd/x.txt', data: enc('hi') }))), out);
    expect(written).toEqual([{ path: 'd/x.txt', size: 2, sha256: sha256Hex(enc('hi')) }]);
    expect(readFileSync(join(out, 'd', 'x.txt'), 'utf8')).toBe('hi');
    expect(() => extractEntries([{ path: '../escape.txt', type: 'file', data: enc('x'), mode: 0 }], out)).toThrow(/escapes/);
    expect(existsSync(join(dir, 'escape.txt'))).toBe(false);
    rmSync(dir, { recursive: true });
  });
});

// ---- fetchToolchain with a fake release ---------------------------------------------------------------------
describe('fetchToolchain (fake release)', () => {
  const sysroot = gzipSync(tarArchive(
    tarEntry({ name: 'sysroot/avr/include/stdio.h', data: enc('/* stdio */') }),
    tarEntry({ name: 'arduino/core.a', data: enc('!<arch>\n') }),
  ));
  const wasm = enc('\0asm\x01\0\0\0 fake wasm module');
  const raw = {
    'as.mjs': enc('export default 1;'),
    'as.wasm.gz': gzipSync(wasm),
    'sysroot.tar.gz': sysroot,
    'COPYING': enc('licence text'),
  };
  const names = Object.keys(raw);
  const sums = names.map((n) => `${sha256Hex(raw[n])}  ${n}`).join('\n') + '\n';
  const all = { ...raw, SHA256SUMS: enc(sums) };
  const assets = Object.entries(all).map(([name, d]) => ({ name, size: d.length, sha256: sha256Hex(d) }));
  const base = 'https://release.test/v1/';

  it('downloads, unpacks, writes toolchain.json, and is idempotent', async () => {
    const root = join(tmp(), 'toolchain');
    const calls = [];
    const opts = { root, assets, baseUrl: base, fetchImpl: fakeFetch(all, calls), log: quiet, out: silentOut };
    const doc = await fetchToolchain(opts);
    expect(calls).toHaveLength(5);
    expect(readFileSync(join(root, 'tools', 'as.wasm'))).toEqual(Buffer.from(wasm));
    expect(readFileSync(join(root, 'tools', 'as.mjs'), 'utf8')).toBe('export default 1;');
    expect(readFileSync(join(root, 'sysroot', 'sysroot', 'avr', 'include', 'stdio.h'), 'utf8')).toBe('/* stdio */');
    expect(doc.assets.map((a) => a.name).sort()).toEqual([...names, 'SHA256SUMS'].sort());
    expect(doc.release.tag).toBe(RELEASE.tag);
    expect(doc.sysroot.fileCount).toBe(2);
    const first = readFileSync(join(root, 'toolchain.json'), 'utf8');

    await fetchToolchain(opts);
    expect(calls).toHaveLength(5); // nothing downloaded again
    expect(readFileSync(join(root, 'toolchain.json'), 'utf8')).toBe(first); // same file, same fetchedAt

    // damage the unpacked output: the next run repairs it from the verified downloads
    writeFileSync(join(root, 'tools', 'as.wasm'), 'broken');
    writeFileSync(join(root, 'sysroot', 'arduino', 'core.a'), 'broken');
    await fetchToolchain(opts);
    expect(calls).toHaveLength(5);
    expect(readFileSync(join(root, 'tools', 'as.wasm'))).toEqual(Buffer.from(wasm));
    expect(readFileSync(join(root, 'sysroot', 'arduino', 'core.a'), 'utf8')).toBe('!<arch>\n');

    await fetchToolchain({ ...opts, force: true });
    expect(calls).toHaveLength(10);
    rmSync(join(root, '..'), { recursive: true });
  });

  it('stops with a VerifyError and deletes the file when the release was tampered with', async () => {
    const root = join(tmp(), 'toolchain');
    const tampered = { ...all, 'COPYING': enc('licence texT') };
    await expect(fetchToolchain({ root, assets, baseUrl: base, fetchImpl: fakeFetch(tampered), log: quiet, out: silentOut })).rejects.toThrow(VerifyError);
    expect(existsSync(join(root, 'dl', 'COPYING'))).toBe(false);
    expect(existsSync(join(root, 'dl', 'COPYING.part'))).toBe(false);
    expect(existsSync(join(root, 'toolchain.json'))).toBe(false);
    rmSync(join(root, '..'), { recursive: true });
  });

  it('fails when the release SHA256SUMS contradicts the pinned digests', async () => {
    const root = join(tmp(), 'toolchain');
    const otherSums = enc(sums.replace(sha256Hex(raw['COPYING']), 'f'.repeat(64)));
    const pinnedSums = { name: 'SHA256SUMS', size: otherSums.length, sha256: sha256Hex(otherSums) };
    const mixed = assets.map((a) => (a.name === 'SHA256SUMS' ? pinnedSums : a));
    await expect(fetchToolchain({ root, assets: mixed, baseUrl: base, fetchImpl: fakeFetch({ ...all, SHA256SUMS: otherSums }), log: quiet, out: silentOut })).rejects.toThrow(/disagrees/);
    rmSync(join(root, '..'), { recursive: true });
  });
});

// ---- sources ------------------------------------------------------------------------------------------------
describe('toolchain sources', () => {
  it('SOURCES.md lists every source and recipe file with its digest and keeps the native toolchain out', () => {
    const md = renderSourcesMd(SOURCE_ASSETS);
    for (const s of SOURCE_ASSETS) {
      expect(md).toContain(s.name);
      expect(md).toContain(s.sha256);
      expect(md).toContain(s.upstream);
    }
    for (const r of RECIPE_FILES) expect(md).toContain(r.sha256);
    const excluded = EXCLUDED_ASSETS[0];
    const table = md.slice(0, md.indexOf('## Not included'));
    expect(table).not.toContain(excluded.name);
    expect(table).not.toContain(excluded.sha256);
    expect(md.slice(md.indexOf('## Not included'))).toContain(excluded.name);
  });

  it('downloads sources and recipe files into one folder and writes SOURCES.md (fake release)', async () => {
    const a = enc('source archive');
    const r = enc('#!/bin/sh\n');
    const sources = [{ ...SOURCE_ASSETS[0], name: 'tiny-1.0.tar.gz', size: a.length, sha256: sha256Hex(a) }];
    const recipe = [{ path: 'scripts/build.sh', as: 'build.sh', size: r.length, sha256: sha256Hex(r) }];
    const root = join(tmp(), 'sources');
    await fetchSources({ root, sources, recipe, fetchImpl: fakeFetch({ 'tiny-1.0.tar.gz': a, 'build.sh': r }), log: quiet, out: silentOut });
    expect(readdirSync(root).sort()).toEqual(['SHA256SUMS', 'SOURCES.md', 'build.sh', 'tiny-1.0.tar.gz']);
    expect(readFileSync(join(root, 'SOURCES.md'), 'utf8')).toContain(sha256Hex(a));
    expect(parseSha256Sums(readFileSync(join(root, 'SHA256SUMS'), 'utf8')).get('tiny-1.0.tar.gz')).toBe(sha256Hex(a));
    rmSync(join(root, '..'), { recursive: true });
  });
});

// ---- licence texts ------------------------------------------------------------------------------------------
describe('licenses/toolchain', () => {
  const dir = join(REPO, 'licenses', 'toolchain');
  // git on Windows may check text files out with CRLF; the recorded digests are of the LF form
  const lf = (file) => Buffer.from(readFileSync(file).toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  const sourcesTxt = readFileSync(join(dir, 'SOURCES.txt'), 'utf8');

  it('SOURCES.txt records the sha256 of every licence file in the folder, and they match', () => {
    const recorded = new Map();
    for (const m of sourcesTxt.matchAll(/^(\S+)\n {2}sha256: ([0-9a-f]{64})\n/gm)) recorded.set(m[1], m[2]);
    const files = readdirSync(dir).filter((f) => f !== 'SOURCES.txt').sort();
    expect([...recorded.keys()].sort()).toEqual(files);
    for (const f of files) expect(createHash('sha256').update(lf(join(dir, f))).digest('hex'), f).toBe(recorded.get(f));
  });

  it('GPL-3.0.txt is the COPYING file of the release, and the avr-libc text is the one in NOTICE', () => {
    expect(sha256Hex(lf(join(dir, 'GPL-3.0.txt')))).toBe(RUNTIME_ASSETS.find((a) => a.name === 'COPYING').sha256);
    const notice = lf(join(REPO, 'NOTICE')).toString('latin1').split('\n');
    expect(lf(join(dir, 'avr-libc-BSD.txt')).toString('latin1')).toBe(notice.slice(39, 109).join('\n') + '\n');
  });
});

// ---- packs --------------------------------------------------------------------------------------------------
describe('pack container', () => {
  const files = [
    { path: 'b/two.txt', data: enc('second') },
    { path: 'a/one.bin', data: Uint8Array.from([0, 1, 2, 255]) },
    { path: 'empty', data: new Uint8Array(0) },
  ];

  it('round-trips, sorts by path and is deterministic', async () => {
    const pack = buildPack(files);
    expect(buildPack([...files].reverse())).toEqual(pack);
    expect(new TextDecoder().decode(pack.subarray(0, 4))).toBe('GHP1');
    const r = readPack(pack);
    expect(r.files.map((f) => f.path)).toEqual(['a/one.bin', 'b/two.txt', 'empty']);
    expect([...r.get('a/one.bin')]).toEqual([0, 1, 2, 255]);
    expect(new TextDecoder().decode(r.get('b/two.txt'))).toBe('second');
    expect(r.get('empty').length).toBe(0);
    expect(r.has('nope')).toBe(false);
    expect(() => r.get('nope')).toThrow(PackError);
    expect([...r.entries()].map(([p]) => p)).toEqual(['a/one.bin', 'b/two.txt', 'empty']);
    await verifyPack(r, sha256Hex);
  });

  it('gzipDeterministic round-trips and always has the same header', () => {
    const pack = buildPack(files);
    const gz = gzipDeterministic(pack);
    expect(gz[9]).toBe(3);
    expect(gunzipSync(gz)).toEqual(Buffer.from(pack));
  });

  it('rejects broken packs', async () => {
    const good = buildPack(files);
    const bad = (mutate) => { const c = Uint8Array.from(good); mutate(c); return c; };
    expect(() => readPack(bad((c) => { c[0] = 0x58; }))).toThrow(/magic/);
    expect(() => readPack(good.subarray(0, good.length - 1))).toThrow(PackError);
    expect(() => readPack(new Uint8Array(3))).toThrow(PackError);
    expect(() => readPack(bad((c) => { c[7] = 0x7f; }))).toThrow(/longer than the pack/);
    expect(() => readPack(Uint8Array.from([...good, 0]))).toThrow(PackError); // trailing byte
    // a single flipped data byte passes the structure check but fails verifyPack
    const flipped = bad((c) => { c[c.length - 1] ^= 1; });
    await expect(verifyPack(readPack(flipped), sha256Hex)).rejects.toThrow(/sha256 mismatch/);
  });

  it('rejects unsafe paths in the index', () => {
    for (const p of ['../x', '/abs', 'a//b', 'a/./b', 'a\\b', 'C:/x', '']) expect(isSafePackPath(p), p).toBe(false);
    for (const p of ['a', 'a/b.c', 'sysroot/avr/include/avr/io.h']) expect(isSafePackPath(p), p).toBe(true);
    expect(() => buildPack([{ path: '../evil', data: enc('x') }])).toThrow(PackError);
    expect(() => buildPack([{ path: 'dup', data: enc('1') }, { path: 'dup', data: enc('2') }])).toThrow(/duplicate|contiguous/);
  });
});

// ---- the real packs (needs npm run toolchain:fetch and npm run toolchain:packs) ---------------------------
const packsDir = join(REPO, 'toolchain', 'packs');
describe.skipIf(!existsSync(join(packsDir, 'manifest.json')))('real packs round-trip against the unpacked toolchain', () => {
  const manifest = existsSync(join(packsDir, 'manifest.json')) ? JSON.parse(readFileSync(join(packsDir, 'manifest.json'), 'utf8')) : { packs: [] };
  const tc = join(REPO, 'toolchain');
  const sourceOf = (path) => {
    if (path.startsWith('tools/')) return join(tc, 'tools', path.slice(6));
    if (path === 'ldscripts/avr5.xn') return join(tc, 'sysroot', 'sysroot', 'avr', 'lib', 'ldscripts', 'avr5.xn');
    if (path.startsWith('licenses/')) return null; // licence texts and generated READMEs, checked below
    return join(tc, 'sysroot', ...path.split('/'));
  };
  const covered = new Set();

  it('has the compiler, the board and one pack per library, with consistent dependencies', () => {
    const names = manifest.packs.map((p) => p.name);
    expect(names).toContain('compiler');
    expect(names).toContain('board-atmega328p');
    const libs = JSON.parse(readFileSync(join(tc, 'dl', 'manifest.json'), 'utf8')).libraries;
    for (const lib of Object.keys(libs)) expect(names).toContain(`lib-${lib.toLowerCase()}`);
    for (const p of manifest.packs) for (const d of p.dependencies) expect(names, `${p.name} depends on ${d}`).toContain(d);
  });

  for (const p of manifest.packs) {
    it(`${p.name}: sizes, hashes and every file match the unpacked files`, async () => {
      const raw = readFileSync(join(packsDir, p.file));
      const gz = readFileSync(join(packsDir, p.fileGz));
      expect(raw.length).toBe(p.size.raw);
      expect(gz.length).toBe(p.size.gzip);
      expect(sha256Hex(raw)).toBe(p.sha256);
      expect(sha256Hex(gz)).toBe(p.sha256Gz);
      expect(p.file).toContain(p.sha256.slice(0, 12));
      expect(Buffer.compare(gunzipSync(gz), raw)).toBe(0);
      const pack = readPack(new Uint8Array(raw.buffer, raw.byteOffset, raw.length));
      expect(pack.files.length).toBe(p.files);
      await verifyPack(pack, sha256Hex);
      for (const [path, data] of pack.entries()) {
        const src = sourceOf(path);
        if (src) {
          covered.add(path);
          expect(Buffer.compare(Buffer.from(data), readFileSync(src)), path).toBe(0);
        } else if (path !== 'licenses/README.txt') {
          const name = path.slice('licenses/'.length);
          const lic = { COPYING: 'GPL-3.0.txt', LICENSE: 'HC-SR04-MIT.txt' }[name] ?? name;
          expect(Buffer.compare(Buffer.from(data), readFileSync(join(REPO, 'licenses', 'toolchain', lic))), path).toBe(0);
        }
      }
    });
  }

  it('together the packs contain every file of the unpacked sysroot except the linker scripts under their sysroot path', () => {
    const all = [];
    const walk = (dir, base) => {
      for (const e of readdirSync(join(dir, base), { withFileTypes: true })) {
        const rel = base ? `${base}/${e.name}` : e.name;
        if (e.isDirectory()) walk(dir, rel); else all.push(rel);
      }
    };
    walk(join(tc, 'sysroot'), '');
    const sysroot = new Set(all);
    const inPacks = new Set();
    for (const p of manifest.packs) {
      const raw = readFileSync(join(packsDir, p.file));
      for (const f of readPack(new Uint8Array(raw.buffer, raw.byteOffset, raw.length)).files) inPacks.add(f.path);
    }
    const missing = [...sysroot].filter((f) => !inPacks.has(f)).sort();
    // avr5.xn is the one ld opens: it ships in the compiler pack as ldscripts/avr5.xn (checked above). The other five are
    // never read by the build (tried each one alone) and are left out.
    expect(missing).toEqual(['avr5.x', 'avr5.xbn', 'avr5.xe', 'avr5.xn', 'avr5.xr', 'avr5.xu'].map((n) => `sysroot/avr/lib/ldscripts/${n}`));
  });
});
