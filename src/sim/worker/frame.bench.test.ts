// Main-thread cost per frame, engine in-process vs in the Worker.
// Skipped in the normal `npm test`; run it with
//   GATEHOUSE_BENCH=1 npx vitest run src/sim/worker/frame.bench.test.ts
// For each circuit it runs FRAMES frames of 16 ms simulated time at 1x and
// prints the main thread's JavaScript time per frame (mean and worst):
// - in-process ("before"): Simulation.update() + the BoardClock's advances
//   (CHUNK_SECONDS each), all on the UI thread;
// - Worker ("after"): Simulation.update() + receiving the frame (a
//   structured clone of it, standing in for the Worker message's
//   deserialization, plus the facade applying it). The engine's own time is
//   printed as "worker" (it runs on the Worker's thread then).
// Drawing is excluded in both (it is the same).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { EXAMPLES } from '../../examples';
import { Scene } from '../../model';
import { getPart } from '../../parts';
import { decodeGth } from '../../project/gth';
import { Project } from '../../project/project';
import { fromFileMap } from '../../project/storage';
import { Simulation } from '../../simulation';
import type { EngineLink } from './client';
import { CHUNK_SECONDS, EngineHost } from './host';
import type { FromEngine, ToEngine } from './protocol';

const FRAMES = 120;
const FRAME_SECONDS = 0.016;

function halfBridge(): Scene {
  const scene = new Scene();
  scene.insert(EXAMPLES.find((e) => e.name === 'Half-bridge with IGBTs')!.state);
  return scene;
}

function inverterFixture(): Scene {
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../fixtures/inverter.gth', import.meta.url))));
  const project = new Project();
  project.load(fromFileMap(decodeGth(bytes).fileMap));
  return project.scene;
}

/** A link whose two sides are pumped by hand, so each side's time can be measured. */
function pumpedLink() {
  const toHost: ToEngine[] = [];
  const toMain: FromEngine[] = [];
  const link: EngineLink = { post: (m) => void toHost.push(structuredClone(m)), onmessage: null, onfail: null, terminate: () => {} };
  const host = new EngineHost((m) => void toMain.push(m), { now: () => 0, schedule: () => {} });
  return {
    link,
    host,
    /** Worker side: handle every queued command. */
    pumpHost: () => {
      while (toHost.length > 0) host.handle(toHost.shift()!);
    },
    /** Main side: receive every queued frame. */
    pumpMain: () => {
      while (toMain.length > 0) link.onmessage?.(structuredClone(toMain.shift()!));
    },
  };
}

async function started(sim: Simulation, scene: Scene, pump: () => void): Promise<void> {
  sim.update();
  pump();
  sim.start();
  pump();
  for (const p of scene.parts.filter((x) => getPart(x.typeId)?.board)) {
    await vi.waitFor(() => expect(sim.boards.boardRunState(p.id).building).toBe(false));
  }
  sim.update();
  pump();
}

const stats = (xs: number[]) => `mean ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)} ms, worst ${Math.max(...xs).toFixed(2)} ms`;

async function measure(name: string, make: () => Scene): Promise<void> {
  // Before: everything on the main thread.
  const sceneA = make();
  const local = new Simulation(sceneA);
  await started(local, sceneA, () => {});
  const before: number[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const t0 = performance.now();
    local.update();
    for (let done = 0; done < FRAME_SECONDS - 1e-12; done += CHUNK_SECONDS) local.advance(Math.min(CHUNK_SECONDS, FRAME_SECONDS - done));
    before.push(performance.now() - t0);
  }

  // After: the engine behind the Worker boundary.
  const sceneB = make();
  const p = pumpedLink();
  const remote = new Simulation(sceneB, undefined, { link: p.link });
  await started(remote, sceneB, () => {
    p.pumpHost();
    p.pumpMain();
  });
  const main: number[] = [];
  const worker: number[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const t0 = performance.now();
    remote.update();
    const t1 = performance.now();
    p.pumpHost();
    p.host.handle({ type: 'runTo', until: p.host.engine.time + FRAME_SECONDS, chunk: CHUNK_SECONDS });
    const t2 = performance.now();
    p.pumpMain();
    const t3 = performance.now();
    main.push(t1 - t0 + (t3 - t2));
    worker.push(t2 - t1);
  }
  expect(remote.time).toBeCloseTo(local.time, 9);
  console.log(`${name.padEnd(18)} before (main thread): ${stats(before)}`);
  console.log(`${''.padEnd(18)} after  (main thread): ${stats(main)}   worker: ${stats(worker)}`);
}

describe.skipIf(!process.env.GATEHOUSE_BENCH)('main-thread time per frame', () => {
  it('half-bridge example', async () => {
    await measure('half-bridge', halfBridge);
  });
  it('inverter fixture', async () => {
    await measure('inverter fixture', inverterFixture);
  });
});
