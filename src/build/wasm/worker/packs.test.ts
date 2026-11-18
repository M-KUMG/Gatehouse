// Pack loading with a fake server and a fake Cache Storage: progress, sha256
// checks, the offline cache, cleanup and the memory-only fallback.
import { describe, expect, it } from 'vitest';
import {
  boardPackName, compilerStatus, libraryPackNames, MANIFEST_CACHE_KEY, packCacheKey, packClosure, PackLoader, parseManifest,
  parsePackCacheKey, readWithProgress, type DownloadProgress, type PackLoaderOptions,
} from './packs';
import { PackError } from './packreader';
import { FakeCacheStorage, FakeServer, manifestOf, testPacks } from './testpacks';

const base = 'https://packs.test/toolchain-packs/';

async function setup(opts: Partial<PackLoaderOptions> = {}) {
  const packs = await testPacks();
  const server = new FakeServer(packs, base);
  const storage = new FakeCacheStorage();
  const make = (more: Partial<PackLoaderOptions> = {}) => new PackLoader({ baseUrl: base, fetch: server.fetch, caches: storage, ...opts, ...more });
  return { packs, server, storage, make, manifest: manifestOf(packs) };
}

describe('pack manifest helpers', () => {
  it('cache keys carry name and sha256 and parse back', () => {
    const sha = 'ab'.repeat(32);
    const key = packCacheKey('lib-wire', sha);
    expect(key).toBe(`https://gatehouse.invalid/pack/lib-wire/${sha}`);
    expect(parsePackCacheKey(key)).toEqual({ name: 'lib-wire', sha256: sha });
    expect(parsePackCacheKey(MANIFEST_CACHE_KEY)).toBeNull();
  });

  it('resolves dependencies first and maps libraries to their packs', async () => {
    const { manifest } = await setup();
    expect(packClosure(manifest, ['lib-wire']).map((p) => p.name)).toEqual(['compiler', 'board-atmega328p', 'lib-wire']);
    expect(packClosure(manifest, [boardPackName('atmega328p'), 'lib-wire']).map((p) => p.name)).toEqual(['compiler', 'board-atmega328p', 'lib-wire']);
    expect(libraryPackNames(manifest, ['Wire', 'Nope'])).toEqual(['lib-wire']);
    expect(() => packClosure(manifest, ['board-atmega2560'])).toThrow(PackError);
  });

  it('rejects things that are not a manifest', () => {
    expect(() => parseManifest({ schema: 2, packs: [] })).toThrow(PackError);
    expect(() => parseManifest({ schema: 1, packs: [{ name: 'x', file: '../x', fileGz: 'x.gz', sha256: 'a'.repeat(64), dependencies: [], size: { raw: 1, gzip: 1 } }] })).toThrow(PackError);
  });

  it('status logic: unavailable, needs-download with the bytes still missing, ready', async () => {
    const { manifest } = await setup();
    const needed = packClosure(manifest, ['board-atmega328p']);
    const gz = needed.reduce((n, p) => n + p.size.gzip, 0);
    expect(compilerStatus({ manifest: null, fresh: false, needed: [], present: () => false, gzip: true }).status).toBe('unavailable');
    expect(compilerStatus({ manifest, fresh: true, needed, present: () => false, gzip: true })).toEqual({ status: 'needs-download', downloadBytes: gz, packs: ['compiler', 'board-atmega328p'] });
    expect(compilerStatus({ manifest, fresh: true, needed, present: (p) => p.name === 'compiler', gzip: false })).toMatchObject({ downloadBytes: needed[1].size.raw });
    expect(compilerStatus({ manifest, fresh: false, needed, present: () => false, gzip: true }).status).toBe('unavailable'); // offline, not cached
    expect(compilerStatus({ manifest, fresh: false, needed, present: () => true, gzip: true })).toEqual({ status: 'ready' });
  });

  it('reads a body with byte progress (throttled to 64 KiB steps, always the final count)', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(40_000).fill(i));
        c.close();
      },
    });
    const seen: number[] = [];
    const out = await readWithProgress(new Response(body), (n) => seen.push(n));
    expect(out.length).toBe(200_000);
    expect(out[199_999]).toBe(4);
    expect(seen).toEqual([80_000, 160_000, 200_000]);
  });
});

describe('PackLoader', () => {
  it('downloads the .pack.gz with progress, checks it, stores it; a second loader reads the cache', async () => {
    const { server, storage, make, packs } = await setup();
    const loader = make();
    expect(await loader.status('atmega328p')).toMatchObject({ status: 'needs-download', downloadBytes: packs[0].gz.length + packs[1].gz.length });
    const m = (await loader.manifest())!;
    const events: DownloadProgress[] = [];
    const loaded = await loader.load(packClosure(m.manifest, ['board-atmega328p']), (d) => events.push(d));
    expect([...loaded.keys()]).toEqual(['compiler', 'board-atmega328p']);
    expect(new TextDecoder().decode(loaded.get('compiler')!.reader.get('ldscripts/avr5.xn'))).toBe('SECTIONS {}');
    expect(server.packRequests).toEqual([`${base}${packs[0].entry.fileGz}`, `${base}${packs[1].entry.fileGz}`]);
    const board = events.filter((e) => e.pack === 'board-atmega328p');
    expect(board[0]).toEqual({ pack: 'board-atmega328p', loadedBytes: 0, totalBytes: packs[1].gz.length, fromCache: false });
    expect(board.at(-1)).toEqual({ pack: 'board-atmega328p', loadedBytes: packs[1].gz.length, totalBytes: packs[1].gz.length, fromCache: false });
    expect(storage.cache.entries.has(packCacheKey('compiler', packs[0].entry.sha256))).toBe(true);
    expect(storage.cache.entries.has(MANIFEST_CACHE_KEY)).toBe(true);
    expect(await loader.status('atmega328p')).toEqual({ status: 'ready' });

    // Same loader: from memory. New loader (a recycled Worker): from Cache Storage, no download.
    const again: DownloadProgress[] = [];
    await loader.load(packClosure(m.manifest, ['compiler']), (d) => again.push(d));
    const second = make();
    const m2 = (await second.manifest())!;
    await second.load(packClosure(m2.manifest, ['board-atmega328p']), (d) => again.push(d));
    expect(again.every((e) => e.fromCache && e.loadedBytes === e.totalBytes)).toBe(true);
    expect(server.packRequests.length).toBe(2);
  });

  it('rejects a pack whose sha256 does not match, fetches it again past the HTTP cache, and fails if it stays wrong', async () => {
    const { server, make, packs } = await setup();
    server.tamper = (file, body, attempt) => (file === packs[0].entry.fileGz && attempt === 1 ? otherGzip(body, 'damaged') : body);
    const loader = make();
    const m = (await loader.manifest())!;
    await loader.load(packClosure(m.manifest, ['compiler']));
    const tries = server.log.filter((l) => l.url.endsWith(packs[0].entry.fileGz));
    expect(tries.length).toBe(2);
    expect(tries[1].init).toEqual({ cache: 'reload' });

    const { server: s2, make: make2 } = await setup();
    s2.tamper = (_f, body) => otherGzip(body, 'always');
    const bad = make2();
    const m2 = (await bad.manifest())!;
    await expect(bad.load(packClosure(m2.manifest, ['compiler']))).rejects.toThrow(/sha256 does not match the manifest/);
  });

  it('works offline from the cached manifest and packs; unavailable offline with nothing cached', async () => {
    const { server, make } = await setup();
    const online = make();
    const m = (await online.manifest())!;
    await online.load(packClosure(m.manifest, ['lib-wire']));
    server.offline = true;
    const offline = make();
    const mo = await offline.manifest();
    expect(mo?.fresh).toBe(false);
    expect(await offline.status('atmega328p')).toEqual({ status: 'ready' });
    const loaded = await offline.load(packClosure(mo!.manifest, ['lib-wire']));
    expect(loaded.get('lib-wire')!.reader.has('arduino/libraries/Wire/Wire.h')).toBe(true);

    const { server: s2, make: make2 } = await setup();
    s2.offline = true;
    expect((await make2().status('atmega328p')).status).toBe('unavailable');
  });

  it('a damaged cached pack is dropped and downloaded again', async () => {
    const { storage, make, packs, server } = await setup();
    const a = make();
    await a.load(packClosure((await a.manifest())!.manifest, ['compiler']));
    const key = packCacheKey('compiler', packs[0].entry.sha256);
    storage.cache.entries.set(key, new Uint8Array([1, 2, 3]));
    const b = make();
    await b.load(packClosure((await b.manifest())!.manifest, ['compiler']));
    expect(server.packRequests.length).toBe(2);
    expect(storage.cache.entries.get(key)!.length).toBe(packs[0].raw.length);
  });

  it('a new manifest version gets new keys and the old cache entries are cleaned up', async () => {
    const { server, storage, make } = await setup();
    const v1 = make();
    await v1.load(packClosure((await v1.manifest())!.manifest, ['lib-wire']));
    const oldKeys = [...storage.cache.entries.keys()].filter((k) => parsePackCacheKey(k));
    expect(oldKeys.length).toBe(3);
    // New release: the compiler pack changes, the others stay.
    server.packs = [...(await testPacks(' // v2')).slice(0, 1), ...server.packs.slice(1)];
    const v2 = make();
    const m2 = (await v2.manifest())!;
    const keys = [...storage.cache.entries.keys()].filter((k) => parsePackCacheKey(k));
    expect(keys.length).toBe(2); // the old compiler entry is gone at once
    expect(await v2.status('atmega328p')).toMatchObject({ status: 'needs-download', packs: ['compiler'] });
    await v2.load(packClosure(m2.manifest, ['board-atmega328p']));
    const names = [...storage.cache.entries.keys()].map(parsePackCacheKey).filter(Boolean).map((k) => k!.name).sort();
    expect(names).toEqual(['board-atmega328p', 'compiler', 'lib-wire']);
  });

  it('without Cache Storage (none, open fails, quota) it still loads, from memory', async () => {
    for (const variant of ['none', 'open', 'quota'] as const) {
      const { storage, make } = await setup();
      if (variant === 'open') storage.failOpen = true;
      if (variant === 'quota') storage.cache.failPut = true;
      const loader = make(variant === 'none' ? { caches: null } : {});
      const m = (await loader.manifest())!;
      const loaded = await loader.load(packClosure(m.manifest, ['board-atmega328p']));
      expect(loaded.size).toBe(2);
      expect(await loader.status('atmega328p')).toEqual({ status: 'ready' }); // in memory
      expect(storage.cache.entries.size).toBe(0);
    }
  });

  it('downloads the raw .pack when there is no gunzip', async () => {
    const { server, make, packs } = await setup();
    const loader = make({ gunzip: null });
    const events: DownloadProgress[] = [];
    await loader.load(packClosure((await loader.manifest())!.manifest, ['compiler']), (d) => events.push(d));
    expect(server.packRequests).toEqual([`${base}${packs[0].entry.file}`]);
    expect(events.at(-1)).toMatchObject({ loadedBytes: packs[0].raw.length, totalBytes: packs[0].raw.length });
  });

  it('asks the server for the manifest again only after the retry time', async () => {
    const { server, make } = await setup();
    let now = 0;
    server.offline = true;
    const loader = make({ now: () => now, manifestRetryMs: 1000 });
    expect(await loader.manifest()).toBeNull();
    expect(await loader.manifest()).toBeNull();
    expect(server.log.length).toBe(1);
    server.offline = false;
    now = 1500;
    expect((await loader.manifest())?.fresh).toBe(true);
  });
});

/** A gzip stream of different content (valid gzip, wrong hash). */
function otherGzip(_body: Uint8Array, text: string): Uint8Array {
  // gzip of `text` without zlib: stored deflate block.
  const data = new TextEncoder().encode(text);
  const crc = crc32(data);
  const out = [0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 1, data.length & 255, data.length >> 8, ~data.length & 255, (~data.length >> 8) & 255, ...data];
  for (const v of [crc, data.length]) out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  return Uint8Array.from(out);
}

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
