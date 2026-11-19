// The Worker client with a fake Worker: ids, progress relay, queueing,
// inactivity timeout and recycling, the instant re-run, failures.
import { describe, expect, it } from 'vitest';
import type { CompileProgress, CompileResult } from '../pipeline';
import { BUILD_TIMED_OUT, resolvePacksUrl, WasmCompilerClient, type WorkerLike } from './client';
import type { DownloadProgress } from './packs';
import type { WorkerRequest, WorkerResponse } from './protocol';

const BASE = 'https://app.test/toolchain-packs/';

class FakeWorker implements WorkerLike {
  readonly posted: WorkerRequest[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  postMessage(message: WorkerRequest): void {
    this.posted.push(structuredClone(message));
  }

  terminate(): void {
    this.terminated = true;
  }

  send(msg: WorkerResponse): void {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>);
  }

  crash(message: string): void {
    this.onerror?.({ message, preventDefault: () => {} } as ErrorEvent);
  }
}

const okResult = (hex = ':00000001FF\n'): CompileResult => ({
  ok: true, hex, flashBytes: 0, flashMax: 32256, ramBytes: 0, ramMax: 2048, messages: [],
  timings: { prepareMs: 0, compileMs: 0, linkMs: 0, totalMs: 0, units: [] }, firmwareName: 'main.ino.hex', libraries: [],
});

function setup(options: { timeoutMs?: number; recycleAfter?: number } = {}) {
  const workers: FakeWorker[] = [];
  const client = new WasmCompilerClient({
    baseUrl: BASE, statusLoader: null, ...options,
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
  });
  return { client, workers };
}

const sketch = (text = 'void setup(){}\nvoid loop(){}\n') => ({ files: { 'main.ino': text }, profileId: 'uno' });

/** Wait until the worker has `n` posted requests (the client hashes the input first, which is async). */
async function posted(w: () => FakeWorker | undefined, n: number): Promise<WorkerRequest> {
  for (let i = 0; i < 200; i++) {
    const worker = w();
    if (worker && worker.posted.length >= n) return worker.posted[n - 1];
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`no request #${n}`);
}

describe('WasmCompilerClient', () => {
  it('sends a compile with an id, relays progress and downloads of that id only, returns the result', async () => {
    const { client, workers } = setup();
    const progress: CompileProgress[] = [];
    const downloads: DownloadProgress[] = [];
    const run = client.compile(sketch(), 'uno', { onProgress: (p) => progress.push(p), onDownload: (d) => downloads.push(d) });
    const req = await posted(() => workers[0], 1);
    expect(req).toMatchObject({ type: 'compile', baseUrl: BASE, profileId: 'uno', sketch: { files: { 'main.ino': expect.any(String) } } });
    const w = workers[0];
    w.send({ id: req.id, type: 'download', download: { pack: 'compiler', loadedBytes: 5, totalBytes: 10, fromCache: false } });
    w.send({ id: req.id + 99, type: 'progress', progress: { phase: 'compile', message: 'other request' } });
    w.send({ id: req.id, type: 'progress', progress: { phase: 'compile', message: 'Compiling main.ino (1/1)', current: 1, total: 1 } });
    w.send({ id: req.id, type: 'result', result: okResult() });
    expect(await run).toMatchObject({ ok: true });
    expect(progress.map((p) => p.message)).toEqual(['Compiling main.ino (1/1)']);
    expect(downloads).toEqual([{ pack: 'compiler', loadedBytes: 5, totalBytes: 10, fromCache: false }]);
  });

  it('runs one request at a time (queue) and uses new ids', async () => {
    const { client, workers } = setup();
    const a = client.compile(sketch('a'), 'uno');
    const b = client.compile(sketch('b'), 'uno');
    const first = await posted(() => workers[0], 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(workers[0].posted.length).toBe(1); // b waits
    workers[0].send({ id: first.id, type: 'result', result: okResult('A') });
    const second = await posted(() => workers[0], 2);
    expect(second.id).not.toBe(first.id);
    workers[0].send({ id: second.id, type: 'result', result: okResult('B') });
    expect(((await a) as { hex: string }).hex).toBe('A');
    expect(((await b) as { hex: string }).hex).toBe('B');
    expect(workers.length).toBe(1);
  });

  it('building unchanged sources again is instant (no request to the Worker)', async () => {
    const { client, workers } = setup();
    const run = client.compile(sketch(), 'uno');
    const req = await posted(() => workers[0], 1);
    workers[0].send({ id: req.id, type: 'result', result: okResult('X') });
    await run;
    const progress: CompileProgress[] = [];
    expect(await client.compile(sketch(), 'uno', { onProgress: (p) => progress.push(p) })).toMatchObject({ ok: true, hex: 'X' });
    expect(workers[0].posted.length).toBe(1);
    expect(progress).toEqual([{ phase: 'done', message: 'Done (unchanged)' }]);
    // A failed build is not remembered.
    const fail = client.compile(sketch('broken'), 'uno');
    const r2 = await posted(() => workers[0], 2);
    workers[0].send({ id: r2.id, type: 'result', result: { ...okResult(), ok: false, errors: ['e'], messages: [] } as CompileResult });
    await fail;
    const again = client.compile(sketch('broken'), 'uno');
    const r3 = await posted(() => workers[0], 3);
    workers[0].send({ id: r3.id, type: 'result', result: okResult() });
    await again;
  });

  it('times out after no message for timeoutMs: "Build timed out", the Worker is replaced', async () => {
    const { client, workers } = setup({ timeoutMs: 60 });
    const r = await client.compile(sketch(), 'uno');
    expect(r).toMatchObject({ ok: false, errors: [`error: ${BUILD_TIMED_OUT}`] });
    expect(workers[0].terminated).toBe(true);
    const next = client.compile(sketch('next'), 'uno');
    const req = await posted(() => workers[1], 1);
    workers[1].send({ id: req.id, type: 'result', result: okResult() });
    expect((await next).ok).toBe(true);
    expect(workers.length).toBe(2);
  });

  it('progress keeps a long build alive (inactivity timeout, not a total one)', async () => {
    const { client, workers } = setup({ timeoutMs: 80 });
    const run = client.compile(sketch(), 'uno');
    const req = await posted(() => workers[0], 1);
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 40));
      workers[0].send({ id: req.id, type: 'progress', progress: { phase: 'compile', message: `step ${i}` } });
    }
    workers[0].send({ id: req.id, type: 'result', result: okResult() });
    expect((await run).ok).toBe(true);
    expect(workers[0].terminated).toBe(false);
  });

  it('recycles the Worker every `recycleAfter` builds and after a fatal result', async () => {
    const { client, workers } = setup({ recycleAfter: 2 });
    for (const [i, [worker, n]] of ([[0, 1], [0, 2], [1, 1]] as const).entries()) {
      const run = client.compile(sketch(`s${i}`), 'uno');
      const req = await posted(() => workers[worker], n);
      workers[worker].send({ id: req.id, type: 'result', result: okResult() });
      await run;
    }
    expect(workers.length).toBe(2);
    expect(workers[0].terminated).toBe(true);
    const fatal = client.compile(sketch('oom'), 'uno');
    const req = await posted(() => workers[1], 2);
    workers[1].send({ id: req.id, type: 'result', result: { ...okResult(), ok: false, errors: ['error: Out of memory in the compiler'], messages: [] } as CompileResult, fatal: true });
    expect((await fatal).ok).toBe(false);
    expect(workers[1].terminated).toBe(true);
  });

  it('a crashing Worker fails the build with a message and is replaced; terminate() fails the running build', async () => {
    const { client, workers } = setup();
    const run = client.compile(sketch(), 'uno');
    await posted(() => workers[0], 1);
    workers[0].crash('RangeError: out of memory');
    expect(await run).toMatchObject({ ok: false, errors: ['error: The compiler stopped unexpectedly: RangeError: out of memory.'] });
    expect(workers[0].terminated).toBe(true);
    const run2 = client.compile(sketch('2'), 'uno');
    await posted(() => workers[1], 1);
    client.terminate();
    expect(await run2).toMatchObject({ ok: false, errors: ['error: The compiler was stopped.'] });
    expect(workers[1].terminated).toBe(true);
  });

  it('prefetch goes through the queue and reports downloads', async () => {
    const { client, workers } = setup();
    const downloads: DownloadProgress[] = [];
    const p = client.prefetch('uno', (d) => downloads.push(d));
    const req = await posted(() => workers[0], 1);
    expect(req).toMatchObject({ type: 'prefetch', profileId: 'uno', baseUrl: BASE });
    workers[0].send({ id: req.id, type: 'download', download: { pack: 'compiler', loadedBytes: 10, totalBytes: 10, fromCache: false } });
    workers[0].send({ id: req.id, type: 'prefetched', ok: true });
    expect(await p).toEqual({ ok: true });
    expect(downloads.length).toBe(1);
  });

  it('a Worker that cannot be created, or packs that cannot be served (file://), fail softly', async () => {
    const broken = new WasmCompilerClient({ baseUrl: BASE, statusLoader: null, createWorker: () => { throw new Error('no Worker here'); } });
    expect(await broken.compile(sketch(), 'uno')).toMatchObject({ ok: false, errors: ['error: The compiler could not start: no Worker here'] });
    expect(resolvePacksUrl('file:///C:/app/dist/toolchain-packs/')).toBeNull();
    expect(resolvePacksUrl(BASE)).toBe(BASE);
    expect(resolvePacksUrl('gatehouse://app/toolchain-packs')).toBe('gatehouse://app/toolchain-packs/');
    const electron = new WasmCompilerClient({ baseUrl: 'file:///C:/app/dist/toolchain-packs/', createWorker: () => { throw new Error('never'); } });
    expect(electron.baseUrl).toBeNull();
    expect((await electron.getCompilerStatus('uno')).status).toBe('unavailable');
    expect((await electron.compile(sketch(), 'uno')).ok).toBe(false);
    expect((await broken.getCompilerStatus('mega')).status).toBe('unavailable');
  });
});
