// The compile Worker (a module worker, created by client.ts). All the work is
// in engine.ts; this file only connects it to the message port, with the
// browser's fetch, Cache Storage, DecompressionStream and Blob-URL glue import.
// Requests are handled one after the other.

import { CompilerEngine } from './engine';
import { platformCaches, platformGunzip } from './packs';
import { blobGlueLoader } from './packrunner';
import type { WorkerRequest, WorkerResponse } from './protocol';

interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;

const engine = new CompilerEngine({
  packs: { fetch: (url, init) => fetch(url, init), caches: platformCaches(), gunzip: platformGunzip() },
  loadGlue: blobGlueLoader,
});

let queue: Promise<void> = Promise.resolve();
scope.onmessage = (e) => {
  const req = e.data;
  queue = queue.then(() => engine.handle(req, (msg) => scope.postMessage(msg)));
};
