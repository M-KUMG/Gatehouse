// The simulation Worker (a module worker, created by client.ts). All the work
// is in host.ts (EngineHost) and engine.ts; this file only connects the host
// to the message port and gives it the Worker's clock and scheduling.
// Scheduling: a delay of 0 uses a MessageChannel (no setTimeout clamping, and
// commands that arrived meanwhile are handled first); longer waits use setTimeout.

import { EngineHost } from './host';
import type { FromEngine, ToEngine } from './protocol';

interface WorkerScope {
  postMessage(message: FromEngine, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToEngine>) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;

const soon = new MessageChannel();
let queued: (() => void)[] = [];
soon.port1.onmessage = () => {
  const run = queued;
  queued = [];
  for (const fn of run) fn();
};

const host = new EngineHost((msg, transfer) => scope.postMessage(msg, transfer), {
  now: () => performance.now(),
  schedule: (fn, ms) => {
    if (ms > 0) {
      setTimeout(fn, ms);
      return;
    }
    queued.push(fn);
    if (queued.length === 1) soon.port2.postMessage(null);
  },
});

scope.onmessage = (e) => host.handle(e.data);
scope.postMessage({ type: 'ready' }, []);
