// Main-thread side of the simulation Worker: the link the Simulation facade
// (src/simulation.ts) talks through, how the Worker is started, and the
// stand-in emulator the board runtimes keep while the real one runs in the
// Worker.
//
// Which mode (decided once at start-up, openSimWorker):
// - Worker (default): a module worker made from sim.worker.ts. Vite bundles
//   it from `new URL('./sim.worker.ts', import.meta.url)` in dev, build and
//   preview (like the compiler Worker, vite.config.ts: worker format 'es'),
//   and Electron serves it through gatehouse://app like every other file.
// - In-process (main thread): when `?sim=main` is in the page URL or
//   localStorage 'gatehouse.sim' is 'main', when there is no Worker, or when
//   making one throws. If the Worker fails later (an error event: the module
//   did not load, or it crashed) the facade switches to in-process by itself
//   and re-sends everything (boards then restart from their program start).
// Unit tests use inProcessWorkerLink(): the real EngineHost in this thread
// behind structured-clone messages, delivered synchronously in order, with
// no timer (the tests step simulated time with advance / runTo), so the
// Worker mode can run the same tests as the in-process mode.

import type { BoardElectrical, BoardEmulator, BoardSpec, IoPinDef, SliceResult } from '../../mcu/board';
import { EngineHost, type HostTimer } from './host';
import type { FromEngine, ToEngine } from './protocol';

export interface EngineLink {
  post(msg: ToEngine): void;
  /** Set by the facade: every message from the engine. */
  onmessage: ((msg: FromEngine) => void) | null;
  /** Set by the facade: the Worker could not start or crashed (the facade falls back to in-process). */
  onfail: ((reason: string) => void) | null;
  terminate(): void;
}

/** The engine mode asked for by the page (`?sim=main` or localStorage 'gatehouse.sim'). */
export function requestedSimMode(): 'main' | 'worker' {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    const asked = new URLSearchParams(search).get('sim') ?? globalThis.localStorage?.getItem('gatehouse.sim');
    return asked === 'main' ? 'main' : 'worker';
  } catch {
    return 'worker';
  }
}

/** A link to a new simulation Worker, or null for in-process (asked for, or no Worker here). */
export function openSimWorker(): EngineLink | null {
  if (requestedSimMode() === 'main' || typeof Worker === 'undefined') return null;
  try {
    const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module', name: 'gatehouse-sim' });
    return workerLink(worker);
  } catch (e) {
    console.warn('The simulation Worker could not start; simulating on the main thread.', e);
    return null;
  }
}

export function workerLink(worker: Worker): EngineLink {
  const link: EngineLink = {
    post: (msg) => worker.postMessage(msg),
    onmessage: null,
    onfail: null,
    terminate: () => worker.terminate(),
  };
  worker.onmessage = (e: MessageEvent<FromEngine>) => link.onmessage?.(e.data);
  worker.onerror = (e) => {
    e.preventDefault();
    link.onfail?.(e.message || 'the simulation Worker failed');
  };
  worker.onmessageerror = () => link.onfail?.('a message from the simulation Worker could not be read');
  return link;
}

/** A timer that never fires: simulated time moves only by advance / runTo (tests). */
const noTimer: HostTimer = { now: () => 0, schedule: () => {} };

/**
 * The engine host in this thread behind a message boundary (structured
 * clones, delivered synchronously and in order): the Worker mode without a
 * Worker, for tests. `host` is exposed for inspection.
 */
export function inProcessWorkerLink(timer: HostTimer = noTimer): EngineLink & { host: EngineHost } {
  const queue: (() => void)[] = [];
  let draining = false;
  const deliver = (fn: () => void): void => {
    queue.push(fn);
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) queue.shift()!();
    } finally {
      draining = false;
    }
  };
  let closed = false;
  const link = {
    post: (msg: ToEngine) => {
      if (closed) return;
      const copy = structuredClone(msg);
      deliver(() => host.handle(copy));
    },
    onmessage: null as ((msg: FromEngine) => void) | null,
    onfail: null as ((reason: string) => void) | null,
    terminate: () => {
      closed = true;
    },
    host: null as unknown as EngineHost,
  };
  const host = new EngineHost((msg) => {
    if (closed) return;
    const copy = structuredClone(msg);
    deliver(() => link.onmessage?.(copy));
  }, timer);
  link.host = host;
  return link;
}

/**
 * What a board runtime keeps on the main thread while its emulator runs in
 * the Worker: the program (sent with the circuit), a unique key that tags
 * everything the Worker reports for it (stale serial bytes, slices and
 * cycles of an older program are dropped), and the last reported cycles,
 * clock and baud rates. run() is never called on it.
 */
export class RemoteEmulator implements BoardEmulator {
  private static nextKey = 0;
  readonly key = ++RemoteEmulator.nextKey;
  readonly io: readonly IoPinDef[];
  readonly electrical: BoardElectrical;
  /** From the snapshots (1 until the first one, so times read 0). */
  clockHz = 1;
  cycles = 0;
  bauds: Record<string, number | null> = {};

  constructor(
    readonly spec: BoardSpec,
    readonly flash: Uint8Array,
    private readonly send: (key: number, port: string, bytes: readonly number[]) => void,
  ) {
    this.io = spec.io;
    this.electrical = spec.electrical;
  }

  drives(): string {
    return 'Z'.repeat(this.io.length);
  }

  run(): SliceResult {
    throw new Error('A remote emulator runs in the simulation Worker');
  }

  setInputs(): void {}

  serialBaud(port: string): number | null {
    return this.bauds[port] ?? null;
  }

  sendSerial(port: string, bytes: readonly number[]): void {
    this.send(this.key, port, bytes);
  }
}
