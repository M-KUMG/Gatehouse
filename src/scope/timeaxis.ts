// The Scope window's time axis and drawing plan, as plain functions (no DOM):
// visible time span, zoom and pan, tick steps with units, and the
// per-pixel decimation of a digital trace, so drawing costs at most a few
// operations per pixel column however many edges are recorded.

import { HI_Z, type Level } from './recorder';

/** The visible stretch of simulated time. */
export interface TimeView {
  /** Seconds at the left edge. */
  start: number;
  /** Seconds across the whole width. */
  span: number;
}

/** Narrowest and widest span the zoom allows (seconds). */
export const MIN_SPAN = 1e-8;
export const MAX_SPAN = 1e5;
/** Span of a fresh window. */
export const DEFAULT_SPAN = 0.01;

export function clampSpan(span: number): number {
  return Math.min(MAX_SPAN, Math.max(MIN_SPAN, span));
}

export function timeToX(view: TimeView, width: number, t: number): number {
  return ((t - view.start) / view.span) * width;
}

export function xToTime(view: TimeView, width: number, x: number): number {
  return view.start + (x / Math.max(1, width)) * view.span;
}

/**
 * Zoom by `factor` (>1 zooms in) keeping the time under pixel `x` where it
 * is. Never shows time before 0.
 */
export function zoomAt(view: TimeView, width: number, x: number, factor: number): TimeView {
  const anchor = xToTime(view, width, x);
  const span = clampSpan(view.span / factor);
  const frac = width > 0 ? x / width : 0;
  return { start: Math.max(0, anchor - frac * span), span };
}

/** Move by `dx` pixels (drag right shows earlier time). Never before 0. */
export function panBy(view: TimeView, width: number, dx: number): TimeView {
  return { start: Math.max(0, view.start - (dx / Math.max(1, width)) * view.span), span: view.span };
}

/** The view that ends at `latest` (auto-follow while running). */
export function followLatest(view: TimeView, latest: number): TimeView {
  return { start: Math.max(0, latest - view.span), span: view.span };
}

/** Show 0 .. `latest` whole (or the default span when nothing is recorded). */
export function fitAll(latest: number): TimeView {
  return { start: 0, span: latest > 0 ? clampSpan(latest) : DEFAULT_SPAN };
}

/** A 1, 2 or 5 times a power of ten step so ticks are at least `minPx` apart. */
export function tickStep(span: number, width: number, minPx = 80): number {
  const raw = (span * minPx) / Math.max(1, width);
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw * (1 - 1e-9)) return m * pow;
  return 10 * pow;
}

/** Tick times inside the view, multiples of `step`. */
export function ticks(view: TimeView, step: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(view.start / step - 1e-9);
  for (let k = first; k * step <= view.start + view.span + step * 1e-9 && out.length < 1000; k++) out.push(k * step);
  return out;
}

const UNITS: readonly [number, string][] = [
  [1, 's'],
  [1e-3, 'ms'],
  [1e-6, 'µs'],
  [1e-9, 'ns'],
];

/**
 * A time as text with a unit fitting its size, 4 significant digits ("1.5
 * ms", "104.2 µs"); with `scale` (a tick step) the decimals fit the step, so
 * axis labels stay short ("200 µs", "250 ms", "1.5 s").
 */
export function formatTime(seconds: number, scale?: number): string {
  if (seconds === 0) return '0';
  const size = Math.max(Math.abs(seconds), scale ?? 0);
  const [unit, name] = UNITS.find(([u]) => size >= u * (1 - 1e-9)) ?? UNITS[UNITS.length - 1];
  const value = seconds / unit;
  if (scale === undefined) return `${Number(value.toPrecision(4))} ${name}`;
  // Enough decimals to tell steps of `scale` apart, at most 3.
  const step = (scale ?? size) / unit;
  const decimals = step > 0 ? Math.min(3, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))) : 0;
  return `${Number(value.toFixed(decimals))} ${name}`;
}

/** A frequency as text: "9.6 kHz", "1 MHz", "50 Hz". */
export function formatFrequency(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return '–';
  const [unit, name] = ([[1e9, 'GHz'], [1e6, 'MHz'], [1e3, 'kHz'], [1, 'Hz']] as const).find(([u]) => hz >= u) ?? [1, 'Hz'];
  return `${Number((hz / unit).toPrecision(4))} ${name}`;
}

/** What a digital trace offers for drawing (the recorder's DigitalTrace fits). */
export interface DrawableTrace {
  readonly length: number;
  time(i: number): number;
  level(i: number): Level;
  indexAt(seconds: number): number;
  readonly end: number;
}

/** One piece of a row: a level held over pixels, a transition at a pixel, or a band of edges too dense to draw. */
export type TraceRun =
  | { kind: 'level'; x0: number; x1: number; level: Level }
  | { kind: 'edge'; x: number; from: Level; to: Level }
  | { kind: 'band'; x0: number; x1: number };

/**
 * Plan the drawing of a trace across `width` pixel columns: levels as
 * horizontal runs, single transitions as edges, and columns with more than
 * one transition merged into bands. Cost: O(min(width, edges in view) *
 * log(edges)), never all edges. Time before the first edge and after
 * `until` (the end of the data, or the held time) is left out.
 */
export function planTrace(trace: DrawableTrace, view: TimeView, width: number, until = trace.end): TraceRun[] {
  const runs: TraceRun[] = [];
  const cols = Math.max(0, Math.floor(width));
  if (trace.length === 0 || cols === 0 || view.span <= 0) return runs;
  const px = view.span / cols;
  const colOf = (t: number): number => Math.floor((t - view.start) / px);
  const endCol = Math.min(cols, Math.ceil((Math.min(until, trace.end) - view.start) / px));
  let col = Math.max(0, colOf(trace.time(0)));
  if (col >= endCol) return runs;
  let idx = trace.indexAt(view.start + col * px);
  if (idx < 0) idx = 0;
  let levelStart = col;
  let level = trace.level(idx);
  const closeLevel = (at: number): void => {
    if (at > levelStart) runs.push({ kind: 'level', x0: levelStart, x1: at, level });
  };
  const pushBand = (x0: number, x1: number): void => {
    const last = runs[runs.length - 1];
    if (last?.kind === 'band' && last.x1 === x0) last.x1 = x1;
    else runs.push({ kind: 'band', x0, x1 });
  };
  while (col < endCol) {
    // Edges inside this column (after idx, up to the column's end).
    // Column `col` is [start, end): an edge exactly on its end belongs to the next column.
    let j = trace.indexAt(view.start + (col + 1) * px);
    while (j > idx && colOf(trace.time(j)) > col) j--;
    const inside = j - idx;
    if (inside <= 0) {
      // Nothing changes here: jump to the column of the next edge.
      const next = idx + 1 < trace.length ? colOf(trace.time(idx + 1)) : endCol;
      col = Math.min(endCol, Math.max(col + 1, next));
      continue;
    }
    closeLevel(col);
    if (inside === 1) runs.push({ kind: 'edge', x: col, from: level, to: trace.level(j) });
    else pushBand(col, col + 1);
    idx = j;
    level = trace.level(j);
    levelStart = col + 1;
    col++;
  }
  closeLevel(endCol);
  return runs;
}

/** Row height fraction (0 top .. 1 bottom) of a level's line. */
export function levelY(level: Level): number {
  return level === HI_Z ? 0.5 : level === 0 ? 1 : 0;
}

/** Index of the first item whose `end` is after `t` (items sorted by time, not overlapping). */
export function firstEndingAfter(items: readonly { end: number }[], t: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].end <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
