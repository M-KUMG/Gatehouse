/// <reference types="node" />
// TOOL-BACKED (skipped when toolchain/packs is missing): the Worker's code in
// Node. The real packs are served from disk through a fake fetch (gzip, sha256
// check, a fake Cache Storage); tools and sysroot come ONLY from the pack
// bytes; the client talks to the engine through an in-process "Worker".
// Not covered here (no browser): the Blob-URL glue import (Node imports the
// glue bytes from a temp file instead) and the real Worker / Cache Storage.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseIntelHex } from '../../../mcu/hex';
import { UNO_CLOCK_HZ, UNO_IO, UnoEmulator } from '../../../mcu/avr/uno';
import type { Compiler } from '../../compiler';
import { buildFirmware, registerCompiler } from '../../registry';
import type { EmscriptenFactory } from '../emscripten';
import type { CompileResult } from '../pipeline';
import type { WorkerLike } from './client';
import { CompilerEngine } from './engine';
import { PackLoader, platformGunzip, type DownloadProgress, type FetchLike } from './packs';
import type { GlueLoader } from './packrunner';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { registerBrowserCompilers } from './register';
import { FakeCacheStorage } from './testpacks';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
const PACKS = join(ROOT, 'toolchain', 'packs');
const hasPacks = existsSync(join(PACKS, 'manifest.json'));
const BASE = 'https://packs.test/toolchain-packs/';
const T = 180_000;

const BLINK = 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(1000); digitalWrite(13, LOW); delay(1000); }\n';
const WIRE = '#include <Wire.h>\nvoid setup() { Wire.begin(); }\nvoid loop() { Wire.beginTransmission(8); Wire.write(1); Wire.endTransmission(); delay(10); }\n';

/** Serves toolchain/packs/ under BASE; logs the URLs. */
function diskFetch(log: string[]): FetchLike {
  return (url) => {
    log.push(url);
    const name = url.startsWith(BASE) ? url.slice(BASE.length) : '';
    const file = join(PACKS, name);
    if (!/^[\w.-]+$/.test(name) || !existsSync(file)) return Promise.resolve(new Response('not found', { status: 404 }));
    return Promise.resolve(new Response(new Uint8Array(readFileSync(file))));
  };
}

/** Node cannot import a blob: URL: import the glue BYTES from the pack through a temp file instead. */
const tempDir = hasPacks ? mkdtempSync(join(tmpdir(), 'gatehouse-glue-')) : '';
const fileGlueLoader: GlueLoader = async (glue, tool) => {
  const file = join(tempDir, `${tool}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, glue);
  return ((await import(/* @vite-ignore */ pathToFileURL(file).href)) as { default: EmscriptenFactory }).default;
};

/** The engine behind a message-passing fake Worker (structured clone both ways, async delivery). */
class InProcessWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly engine: CompilerEngine) {}

  postMessage(message: WorkerRequest): void {
    const req = structuredClone(message);
    this.queue = this.queue.then(() =>
      this.engine.handle(req, (m) => {
        const data = structuredClone(m);
        setTimeout(() => this.onmessage?.({ data } as MessageEvent<WorkerResponse>), 0);
      }),
    );
  }

  terminate(): void {
    this.onmessage = null;
  }
}

const exitCode = process.exitCode;
afterAll(() => {
  process.exitCode = exitCode; // the glue's Node branch sets it when a tool exits non-zero
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

function runUno(hex: string, seconds: number): string {
  const uno = new UnoEmulator(parseIntelHex(hex, 32 * 1024).bytes);
  const d13 = UNO_IO.findIndex((p) => p.id === 'd13');
  let last = uno.drives()[d13];
  let out = '';
  for (let i = 0; i < seconds * 1000; i++) for (const e of uno.run(UNO_CLOCK_HZ / 1000).events) if (e.drives[d13] !== last) out += last = e.drives[d13];
  return out;
}

describe.skipIf(!hasPacks)(`compile Worker logic with the real packs (${hasPacks ? PACKS : 'toolchain/packs missing: npm run toolchain:fetch && npm run toolchain:packs'})`, () => {
  const storage = new FakeCacheStorage();
  const log: string[] = [];
  const packs = { fetch: diskFetch(log), caches: storage, gunzip: platformGunzip() };
  const makeEngine = () => new CompilerEngine({ packs, loadGlue: fileGlueLoader });

  it('compiles Blink from the PACK BYTES (gzip download, sha256, cache) to ~1 KB of hex that blinks', async () => {
    const engine = makeEngine();
    const out: WorkerResponse[] = [];
    await engine.handle({ id: 1, type: 'compile', baseUrl: BASE, profileId: 'uno', sketch: { files: { 'Blink.ino': BLINK }, profileId: 'uno', sketchName: 'Blink' } }, (m) => out.push(m));
    const final = out.at(-1)!;
    expect(final.type).toBe('result');
    const r = (final as { result: CompileResult }).result;
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.flashBytes).toBeGreaterThan(900);
    expect(r.flashBytes).toBeLessThan(1200);
    expect(r.firmwareName).toBe('Blink.ino.hex');
    expect(runUno(r.hex, 2.1)).toBe('LHLH');
    // Only the compiler and board packs, as .pack.gz; progress reached the totals.
    expect(log.filter((u) => !u.endsWith('manifest.json')).map((u) => u.replace(/-[0-9a-f]{12}\.pack\.gz$/, ''))).toEqual([`${BASE}compiler`, `${BASE}board-atmega328p`]);
    const downloads = out.filter((m) => m.type === 'download').map((m) => (m as { download: DownloadProgress }).download);
    for (const pack of ['compiler', 'board-atmega328p']) {
      const last = downloads.filter((d) => d.pack === pack).at(-1)!;
      expect(last.fromCache).toBe(false);
      expect(last.loadedBytes).toBe(last.totalBytes);
    }
    expect(out.some((m) => m.type === 'progress' && m.progress.phase === 'link')).toBe(true);
    expect([...storage.cache.entries.keys()].length).toBe(3); // manifest + 2 packs
  }, T);

  it('through the client and the registry (WasmAvrCompiler): library pack on demand, errors, the offline cache', async () => {
    let engines = 0;
    const statusLoader = new PackLoader({ baseUrl: BASE, ...packs });
    const registered = new Map<string, Compiler>();
    const compilers = registerBrowserCompilers((type, c) => {
      registered.set(type, c);
      return () => registered.delete(type);
    }, {
      baseUrl: BASE, statusLoader,
      createWorker: () => {
        engines++;
        return new InProcessWorker(makeEngine());
      },
    });
    expect([...registered.keys()].sort()).toEqual(['nano', 'uno']);
    expect(await compilers.client.getCompilerStatus('uno')).toEqual({ status: 'ready' }); // cached by the first test

    const before = log.length;
    const wire = await registered.get('uno')!.build({ boardTypeId: 'uno', files: { 'main.ino': WIRE } });
    expect(wire).toMatchObject({ ok: true, source: 'compiled', name: 'main.ino' });
    expect(log.slice(before).filter((u) => u.includes('.pack')).map((u) => u.replace(/-[0-9a-f]{12}\.pack\.gz$/, ''))).toEqual([`${BASE}lib-wire`]);

    const broken = await registered.get('nano')!.build({ boardTypeId: 'nano', files: { 'main.ino': 'void setup() { nope(); }\nvoid loop() {}\n' } });
    expect(broken.ok).toBe(false);
    expect(!broken.ok && broken.buildMessages?.find((m) => m.severity === 'error')).toMatchObject({ file: 'main.ino', line: 1 });

    // A second build of the same files is instant (no Worker round trip at all).
    const t0 = performance.now();
    expect((await registered.get('uno')!.build({ boardTypeId: 'uno', files: { 'main.ino': WIRE } })).ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(50);
    compilers.dispose();
    expect(registered.size).toBe(0);
    expect(engines).toBe(1);
  }, T);

  it('offline with the packs in the cache: a fresh Worker still builds', async () => {
    const offlineEngine = new CompilerEngine({
      packs: { ...packs, fetch: () => Promise.reject(new TypeError('Failed to fetch')) },
      loadGlue: fileGlueLoader,
    });
    const out: WorkerResponse[] = [];
    await offlineEngine.handle({ id: 7, type: 'compile', baseUrl: BASE, profileId: 'uno', sketch: { files: { 'b.ino': BLINK }, profileId: 'uno' } }, (m) => out.push(m));
    const final = out.at(-1) as { result: CompileResult };
    expect(final.result.ok).toBe(true);
    expect(out.filter((m) => m.type === 'download').every((m) => (m as { download: DownloadProgress }).download.fromCache)).toBe(true);
  }, T);
});

describe.skipIf(!hasPacks)('registry with the browser compiler and real packs', () => {
  it('buildFirmware picks the compiler for sketch sources', async () => {
    const compilers = registerBrowserCompilers(registerCompiler, {
      baseUrl: BASE,
      statusLoader: new PackLoader({ baseUrl: BASE, fetch: diskFetch([]), caches: null }),
      createWorker: () => new InProcessWorker(new CompilerEngine({ packs: { fetch: diskFetch([]), caches: null }, loadGlue: fileGlueLoader })),
    });
    try {
      const r = await buildFirmware({ boardTypeId: 'uno', files: { 'Blink.ino': BLINK, 'firmware.hex': ':00000001FF\n' } });
      expect(r).toMatchObject({ ok: true, source: 'compiled', name: 'Blink.ino' });
      expect(r.ok && r.size?.flashBytes).toBeGreaterThan(900);
    } finally {
      compilers.dispose();
    }
  }, T);
});
