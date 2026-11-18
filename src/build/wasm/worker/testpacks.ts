/// <reference types="node" />
// TEST HELPERS (imported by *.test.ts only): small toolchain packs, a fake
// fetch serving them, and an in-memory Cache Storage.
import { gzipSync } from 'node:zlib';
import type { CacheLike, CacheStorageLike, FetchLike, PackEntry, PackManifest } from './packs';
import { sha256Hex } from './packreader';

/** A GHP1 pack of these files (hashes in the index are placeholders: the loader checks the whole pack). */
export function buildPack(files: Record<string, string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const names = Object.keys(files).sort();
  const data = names.map((n) => (typeof files[n] === 'string' ? enc.encode(files[n] as string) : (files[n] as Uint8Array)));
  let offset = 0;
  const index = names.map((path, i) => {
    const e = { path, offset, length: data[i].length, sha256: 'a'.repeat(64) };
    offset += data[i].length;
    return e;
  });
  const indexBytes = enc.encode(JSON.stringify(index));
  const out = new Uint8Array(8 + indexBytes.length + offset);
  out.set(enc.encode('GHP1'));
  new DataView(out.buffer).setUint32(4, indexBytes.length, true);
  out.set(indexBytes, 8);
  let p = 8 + indexBytes.length;
  for (const d of data) {
    out.set(d, p);
    p += d.length;
  }
  return out;
}

export interface TestPack {
  entry: PackEntry;
  raw: Uint8Array;
  gz: Uint8Array;
}

export async function testPack(
  name: string, kind: string, dependencies: string[], files: Record<string, string | Uint8Array>, extra: Partial<PackEntry> = {},
): Promise<TestPack> {
  const raw = buildPack(files);
  const gz = new Uint8Array(gzipSync(raw));
  const sha256 = await sha256Hex(raw);
  const file = `${name}-${sha256.slice(0, 12)}.pack`;
  return {
    raw, gz,
    entry: { name, kind, version: '1', dependencies, file, fileGz: `${file}.gz`, size: { raw: raw.length, gzip: gz.length }, sha256, ...extra },
  };
}

/** compiler + board-atmega328p + lib-wire, with a few files each. */
export async function testPacks(variant = ''): Promise<TestPack[]> {
  return [
    await testPack('compiler', 'compiler', [], { 'tools/as.mjs': `export default 1;${variant}`, 'ldscripts/avr5.xn': 'SECTIONS {}', 'licenses/README.txt': 'gpl' }),
    await testPack('board-atmega328p', 'board', ['compiler'], {
      'arduino/core/Arduino.h': '#pragma once', 'arduino/core.a': new Uint8Array(70_000).fill(7), 'sysroot/avr/include/avr/io.h': '//io',
    }),
    await testPack('lib-wire', 'library', ['board-atmega328p'], { 'arduino/libraries/Wire/Wire.h': '//wire', 'arduino/libraries/Wire.a': 'ar' }, {
      library: 'Wire', includes: ['Wire.h'],
    }),
  ];
}

export const manifestOf = (packs: TestPack[]): PackManifest => ({ schema: 1, packs: packs.map((p) => p.entry) });

/** A fetch serving manifest.json and the packs under `base`; `tamper` can change a body; `log` records URLs and init. */
export class FakeServer {
  readonly log: { url: string; init?: RequestInit }[] = [];
  offline = false;
  tamper: ((file: string, body: Uint8Array, attempt: number) => Uint8Array) | null = null;
  private readonly attempts = new Map<string, number>();

  constructor(public packs: TestPack[], readonly base = 'https://packs.test/toolchain-packs/') {}

  readonly fetch: FetchLike = (url, init) => {
    this.log.push({ url, init });
    if (this.offline) return Promise.reject(new TypeError('Failed to fetch'));
    const file = url.startsWith(this.base) ? url.slice(this.base.length) : '';
    if (file === 'manifest.json') return Promise.resolve(new Response(JSON.stringify(manifestOf(this.packs))));
    for (const p of this.packs) {
      for (const [name, body] of [[p.entry.file, p.raw], [p.entry.fileGz, p.gz]] as const) {
        if (name !== file) continue;
        const n = (this.attempts.get(file) ?? 0) + 1;
        this.attempts.set(file, n);
        return Promise.resolve(new Response((this.tamper ? this.tamper(file, body, n) : body) as Uint8Array<ArrayBuffer>));
      }
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  };

  /** Requests for pack files (not the manifest). */
  get packRequests(): string[] {
    return this.log.map((l) => l.url).filter((u) => !u.endsWith('manifest.json'));
  }
}

export class FakeCache implements CacheLike {
  readonly entries = new Map<string, Uint8Array>();
  failPut = false;

  async match(key: string): Promise<Response | undefined> {
    const b = this.entries.get(key);
    return b ? new Response(b.slice() as Uint8Array<ArrayBuffer>) : undefined;
  }

  async put(key: string, response: Response): Promise<void> {
    if (this.failPut) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.entries.set(key, new Uint8Array(await response.arrayBuffer()));
  }

  async delete(key: string): Promise<boolean> {
    return this.entries.delete(key);
  }

  async keys(): Promise<readonly { url: string }[]> {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
}

export class FakeCacheStorage implements CacheStorageLike {
  readonly cache = new FakeCache();
  failOpen = false;

  async open(): Promise<CacheLike> {
    if (this.failOpen) throw new DOMException('The operation is insecure.', 'SecurityError');
    return this.cache;
  }
}
