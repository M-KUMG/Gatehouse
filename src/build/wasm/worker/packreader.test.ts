/// <reference types="node" />
// The TypeScript pack reader against scripts/packreader.mjs: the real packs
// (skipped when toolchain/packs is missing) and damaged packs (same errors).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { platformGunzip } from './packs';
import { PACK_MAGIC, readPack, sha256Hex, verifyPack } from './packreader';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
const PACKS = join(ROOT, 'toolchain', 'packs');
const hasPacks = existsSync(join(PACKS, 'manifest.json'));

interface MjsPack {
  files: { path: string; offset: number; length: number; sha256: string }[];
  dataStart: number;
  get(path: string): Uint8Array;
}
interface MjsReader {
  readPack(bytes: Uint8Array): MjsPack;
  PACK_MAGIC: string;
}
const loadMjs = async (): Promise<MjsReader> => (await import(/* @vite-ignore */ pathToFileURL(join(ROOT, 'scripts', 'packreader.mjs')).href)) as MjsReader;

/** A small valid pack. */
function makePack(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const names = Object.keys(files).sort();
  let offset = 0;
  const index = names.map((path) => {
    const length = enc.encode(files[path]).length;
    const e = { path, offset, length, sha256: '0'.repeat(64) };
    offset += length;
    return e;
  });
  const indexBytes = enc.encode(JSON.stringify(index));
  const out = new Uint8Array(8 + indexBytes.length + offset);
  out.set(enc.encode('GHP1'));
  new DataView(out.buffer).setUint32(4, indexBytes.length, true);
  out.set(indexBytes, 8);
  let p = 8 + indexBytes.length;
  for (const n of names) {
    const b = enc.encode(files[n]);
    out.set(b, p);
    p += b.length;
  }
  return out;
}

const errorOf = (fn: () => unknown): string => {
  try {
    fn();
    return 'no error';
  } catch (e) {
    return `${(e as Error).name}: ${(e as Error).message}`;
  }
};

describe('pack reader (TypeScript port)', () => {
  it('has the same magic and rejects damaged packs with the same errors as the .mjs reader', async () => {
    const mjs = await loadMjs();
    expect(PACK_MAGIC).toBe(mjs.PACK_MAGIC);
    const good = makePack({ 'a/b.h': 'hello', 'c.txt': 'world!' });
    const bad: Uint8Array[] = [
      new Uint8Array(3),
      (() => { const b = good.slice(); b[0] = 0x58; return b; })(),
      good.subarray(0, good.length - 1),
      new Uint8Array([...good, 0]),
      makePack({ '../evil': 'x' }),
      makePack({ '/abs': 'x' }),
      (() => { const b = good.slice(); new DataView(b.buffer).setUint32(4, 1_000_000, true); return b; })(),
      (() => { const b = good.slice(); b[8] = 0x7b; return b; })(), // index no longer an array / not JSON
    ];
    for (const b of [good, ...bad]) expect(errorOf(() => readPack(b))).toBe(errorOf(() => mjs.readPack(b)));
    const r = readPack(good);
    expect(new TextDecoder().decode(r.get('c.txt'))).toBe('world!');
    expect(r.has('a/b.h')).toBe(true);
    expect([...r.entries()].map(([p]) => p)).toEqual(['a/b.h', 'c.txt']);
  });

  describe.skipIf(!hasPacks)(`the real packs (${hasPacks ? PACKS : 'toolchain/packs missing: run npm run toolchain:packs'})`, () => {
    const manifest = hasPacks
      ? (JSON.parse(readFileSync(join(PACKS, 'manifest.json'), 'utf8')) as { packs: { name: string; file: string; fileGz: string; sha256: string }[] })
      : { packs: [] };

    it('reads every pack bit-identically to scripts/packreader.mjs, and every file hash checks', async () => {
      const mjs = await loadMjs();
      expect(manifest.packs.length).toBeGreaterThanOrEqual(3);
      for (const p of manifest.packs) {
        const bytes = new Uint8Array(readFileSync(join(PACKS, p.file)));
        expect(await sha256Hex(bytes)).toBe(p.sha256);
        const ours = readPack(bytes);
        const theirs = mjs.readPack(bytes);
        expect(ours.files).toEqual(theirs.files);
        expect(ours.dataStart).toBe(theirs.dataStart);
        for (const f of ours.files) expect(Buffer.compare(ours.get(f.path), theirs.get(f.path))).toBe(0);
        await verifyPack(ours, sha256Hex);
      }
    }, 60_000);

    it('the .pack.gz files gunzip (DecompressionStream) to the .pack bytes', async () => {
      const gunzip = platformGunzip();
      expect(gunzip).not.toBeNull();
      for (const p of manifest.packs.filter((x) => !x.name.startsWith('compiler'))) {
        const raw = await gunzip!(new Uint8Array(readFileSync(join(PACKS, p.fileGz))));
        expect(await sha256Hex(raw)).toBe(p.sha256);
      }
    }, 60_000);
  });
});
