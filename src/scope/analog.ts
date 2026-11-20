// Analog sample recorder behind the Scope window (the part inspector,
// src/layout/inspector.ts). DOM-free and deterministic: samples are stamped
// with simulated seconds (the bridge's global timeline), never the wall clock.
//
// What it records: for every ARMED part, the values of its armed quantities
// (ids from src/sim/inspect.ts), one series per (part id, quantity id). The
// window arms only the part it follows and the quantities it graphs, so
// every other part costs nothing; with nothing armed a fed result costs one
// size check.
//
// Feeding: the mixed-signal bridge (MixedSignal.stepObserver) passes every
// solved instant it keeps: each accepted transient step, the pin segments of
// a DC slice (start and end, so PWM edges show as edges) and the slice end.
// The window adds the shown instant while time stands still (`sample` with
// the same time again: a changed value, e.g. a switch flipped while paused,
// is appended at the same time; an unchanged one is skipped), so a DC
// circuit shows its current value too.
//
// Bounds: each series is a ring of at most `capacity` samples (oldest
// dropped and counted). Decimation: a new sample closer than `minInterval`
// seconds to the one before the last replaces the last one, so kept samples
// are at least `minInterval` apart in pairs and the newest value is always
// there. Time going backwards (a reset without clear()) restarts the series.
// The number of series is bounded too (`maxSeries`, the least recently armed
// part's series go first).

import type { SimResult } from '../sim';

/** Default samples kept per series. */
export const DEFAULT_SAMPLES = 20_000;
/** Default shortest spacing of kept samples (seconds of simulated time). */
export const DEFAULT_MIN_INTERVAL = 1e-6;
/** Default number of series kept (armed or not). */
export const DEFAULT_MAX_SERIES = 64;
/** First allocation of a series (it doubles up to the capacity). */
const INITIAL_SLOTS = 256;

/** Reads the armed quantities of one part out of a result (by quantity id). */
export type ValueReader = (result: SimResult) => ReadonlyMap<string, number>;

/** What the bridge calls (see MixedSignal.stepObserver). */
export interface StepObserver {
  /** False when nothing is armed: the bridge then skips collecting samples. */
  readonly active: boolean;
  sample(time: number, result: SimResult): void;
}

/** A recorded series, read-only for the window. */
export interface AnalogTrace {
  readonly length: number;
  time(i: number): number;
  value(i: number): number;
  /** Index of the last sample at or before `t`, -1 when none. */
  indexAt(t: number): number;
  /** Samples dropped because the series was full. */
  readonly dropped: number;
}

export function seriesKey(part: number, quantity: string): string {
  return `${part}:${quantity}`;
}

class Series implements AnalogTrace {
  private times = new Float64Array(0);
  private values = new Float64Array(0);
  private head = 0;
  private count = 0;
  dropped = 0;

  constructor(private readonly capacity: number) {}

  get length(): number {
    return this.count;
  }

  private slot(i: number): number {
    const at = this.head + i;
    return at >= this.times.length ? at - this.times.length : at;
  }

  time(i: number): number {
    return this.times[this.slot(i)];
  }

  value(i: number): number {
    return this.values[this.slot(i)];
  }

  indexAt(t: number): number {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.time(mid) <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.dropped = 0;
  }

  /** Add a sample (see the top of the file for the rules). True when the data changed. */
  add(t: number, v: number, minInterval: number): boolean {
    const n = this.count;
    if (n > 0) {
      const lastT = this.time(n - 1);
      const lastV = this.value(n - 1);
      if (t < lastT - 1e-12) this.clear();
      else if (t <= lastT + 1e-15 && sameValue(v, lastV)) return false;
      else if (n >= 2 && t > lastT && t - this.time(n - 2) < minInterval) {
        const s = this.slot(n - 1);
        this.times[s] = t;
        this.values[s] = v;
        return true;
      }
    }
    this.push(t, v);
    return true;
  }

  private push(t: number, v: number): void {
    if (this.count === this.times.length) {
      if (this.count < this.capacity) this.grow();
      else {
        // Full: drop the oldest.
        this.head = this.slot(1);
        this.count--;
        this.dropped++;
      }
    }
    const s = this.slot(this.count);
    this.times[s] = t;
    this.values[s] = v;
    this.count++;
  }

  private grow(): void {
    const size = Math.min(this.capacity, Math.max(INITIAL_SLOTS, this.times.length * 2));
    const times = new Float64Array(size);
    const values = new Float64Array(size);
    for (let i = 0; i < this.count; i++) {
      times[i] = this.time(i);
      values[i] = this.value(i);
    }
    this.times = times;
    this.values = values;
    this.head = 0;
  }
}

function sameValue(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

interface Armed {
  ids: readonly string[];
  read: ValueReader;
}

export class AnalogRecorder implements StepObserver {
  private readonly armed = new Map<number, Armed>();
  /** Series by key, in the order their part was last armed (oldest first). */
  private readonly series = new Map<string, Series>();
  /** Bumped by every change of the data (consumers redraw on change). */
  version = 0;
  /** Simulated time of the newest sample (0 after clear). */
  latest = 0;
  /**
   * Told when what is armed changed (the Simulation forwards it to the
   * simulation Worker, which reads the same quantities there and sends them
   * back for ingest()).
   */
  onArm: (() => void) | null = null;

  constructor(
    readonly capacity = DEFAULT_SAMPLES,
    readonly minInterval = DEFAULT_MIN_INTERVAL,
    readonly maxSeries = DEFAULT_MAX_SERIES,
  ) {}

  get active(): boolean {
    return this.armed.size > 0;
  }

  /** The armed parts and their quantity ids. */
  armedParts(): [number, string[]][] {
    return [...this.armed].map(([part, a]) => [part, [...a.ids]]);
  }

  /** Record quantities `ids` of part `part` from now on (replaces what was armed for that part). */
  arm(part: number, ids: readonly string[], read: ValueReader): void {
    this.armPart(part, ids, read);
    this.onArm?.();
  }

  private armPart(part: number, ids: readonly string[], read: ValueReader): void {
    this.armed.set(part, { ids: [...ids], read });
    for (const id of ids) {
      const key = seriesKey(part, id);
      const s = this.series.get(key) ?? new Series(this.capacity);
      this.series.delete(key);
      this.series.set(key, s); // most recently armed last
    }
    while (this.series.size > this.maxSeries) {
      const oldest = this.series.keys().next().value as string;
      this.series.delete(oldest);
    }
  }

  disarm(part: number): void {
    if (this.armed.delete(part)) this.onArm?.();
  }

  disarmAll(): void {
    if (this.armed.size === 0) return;
    this.armed.clear();
    this.onArm?.();
  }

  isArmed(part: number, id: string): boolean {
    return this.armed.get(part)?.ids.includes(id) ?? false;
  }

  /** The recorded series (armed or kept from earlier), or undefined. */
  trace(part: number, id: string): AnalogTrace | undefined {
    return this.series.get(seriesKey(part, id));
  }

  /** One solved instant at simulated time `time`. Reads only the armed parts. */
  sample(time: number, result: SimResult): void {
    if (this.armed.size === 0 || !result.converged) return;
    let changed = false;
    for (const [part, armed] of this.armed) {
      if (!result.parts[part]) continue;
      const values = armed.read(result);
      changed = this.add(time, part, armed.ids, (j) => values.get(armed.ids[j])) || changed;
    }
    if (changed) {
      this.latest = time;
      this.version++;
    }
  }

  /**
   * Values of part `part` at one instant, read elsewhere (by the simulation
   * Worker with the same reader rules): `value(j)` is the value of ids[j], or
   * undefined. Same rules as sample(); only quantities armed here are kept.
   */
  ingest(time: number, part: number, ids: readonly string[], value: (j: number) => number | undefined): void {
    const armed = this.armed.get(part);
    if (!armed) return;
    const changed = this.add(time, part, ids, (j) => (armed.ids.includes(ids[j]) ? value(j) : undefined));
    if (changed) {
      this.latest = time;
      this.version++;
    }
  }

  private add(time: number, part: number, ids: readonly string[], value: (j: number) => number | undefined): boolean {
    let changed = false;
    ids.forEach((id, j) => {
      const v = value(j);
      if (v === undefined) return;
      let s = this.series.get(seriesKey(part, id));
      if (!s) this.series.set(seriesKey(part, id), (s = new Series(this.capacity)));
      changed = s.add(time, v, this.minInterval) || changed;
    });
    return changed;
  }

  /** Drop every sample (Reset, a new run, a project load); arming stays. */
  clear(): void {
    this.series.clear();
    this.latest = 0;
    this.version++;
  }
}

// ---- Drawing plan (pure) ---------------------------------------------------------

/** One pixel column of a trace: the first, last, smallest and largest value in it. */
export interface Column {
  x: number;
  first: number;
  last: number;
  min: number;
  max: number;
}

/**
 * Per pixel column summary of a series between view.start and
 * view.start + view.span (only samples up to `until`). The sample just
 * before the view is included as column -1 so the line enters from the left
 * edge. Cost: O(samples in view + log n). NaN samples are skipped.
 */
export function columns(trace: AnalogTrace, view: { start: number; span: number }, width: number, until = Infinity): Column[] {
  const out: Column[] = [];
  const cols = Math.max(0, Math.floor(width));
  if (trace.length === 0 || cols === 0 || view.span <= 0) return out;
  const px = view.span / cols;
  const end = Math.min(view.start + view.span, until);
  let i = Math.max(0, trace.indexAt(view.start));
  let current: Column | null = null;
  for (; i < trace.length; i++) {
    const t = trace.time(i);
    if (t > end) break;
    const v = trace.value(i);
    if (!Number.isFinite(v)) continue;
    const x = t < view.start ? -1 : Math.min(cols - 1, Math.floor((t - view.start) / px));
    if (current && current.x === x) {
      current.last = v;
      if (v < current.min) current.min = v;
      if (v > current.max) current.max = v;
    } else {
      current = { x, first: v, last: v, min: v, max: v };
      out.push(current);
    }
  }
  return out;
}

/** Smallest and largest value over the columns (null when there are none), padded so a flat line sits mid-lane. */
export function autoRange(cols: readonly Column[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const c of cols) {
    if (c.x < 0 && cols.length > 1) continue; // the sample before the view only steers the entry
    if (c.min < min) min = c.min;
    if (c.max > max) max = c.max;
  }
  if (min > max) {
    if (cols.length === 0) return null;
    min = max = cols[0].last;
  }
  // The scale always includes zero: 0 up to the largest value, down to the
  // most negative one when there are negative values, or both when the data
  // crosses zero. A small margin is added only on the sides that are not 0.
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 0);
  if (lo === 0 && hi === 0) return { min: -1e-12, max: 1e-12 };
  const margin = (hi - lo) * 0.05;
  return { min: lo < 0 ? lo - margin : 0, max: hi > 0 ? hi + margin : 0 };
}

/** Value of a series at time t: the last sample at or before t (NaN when none). */
export function valueAt(trace: AnalogTrace, t: number): number {
  const i = trace.indexAt(t);
  return i < 0 ? NaN : trace.value(i);
}
