// Idle skipping for the ATmega328P: when the program waits in a loop that
// changes nothing outside itself (delay(), a millis() poll, a sleep loop),
// jump the CPU over whole iterations of that loop instead of executing them.
//
// The skip is exact for everything outside the loop: pin edges, serial bytes,
// timer state and every later instruction run at the same cycles as without
// skipping. How:
//
// 1. Find a loop: from the current PC ("head"), run a sandbox copy of the
//    CPU until it is back at the head with the same SP (at most MAX_LEN
//    instructions). That is one iteration: its PC path, its cycle count P,
//    and the data addresses it reads and writes through readData/writeData.
// 2. Purity: the iteration may not write any register with a hook (ports,
//    UDR, timers, TIFR...), may not read any hooked register except a
//    timer's TCNT (whose value the sandbox predicts from the timer's state),
//    may not run WDR, and the CPU may not have an interrupt pending.
// 3. Liveness (once per loop, cached): which data bytes (registers, SREG,
//    SP, SRAM, I/O) the iteration reads before writing. Each of them must be
//    unchanged at the end of the iteration. Bytes it writes first may change
//    (scratch); every iteration rewrites them. One exception: SREG's flags
//    (not I) may change when a test shows they are dead at the head (see
//    flagsDead; Arduino's micros() saves and restores SREG, which reads as
//    "live" byte by byte). Heads where loop temporaries are live fail this
//    step; the skipper then waits for the loop's tops (targets of its
//    backward branches) and tries there.
// 4. Horizon: nothing outside the loop may happen while it is skipped: no
//    clock event other than a timer tick (USART, ADC, EEPROM, TWI, SPI,
//    watchdog, serial RX frames, ...), no "significant" timer tick (one that
//    raises an enabled interrupt, moves a compare output pin, or, for a
//    timer the loop reads (TCNT/TIFR), any tick that sets a flag, wraps or
//    turns), and not the end of the requested slice.
// 5. Probe: iteration j (starting at head cycle c0 + j*P) is replayed in the
//    sandbox from the current state with the timer values it would read at
//    that time. It must take the same path, touch the same addresses, and
//    leave its live-in bytes unchanged. The largest such j within the
//    horizon is found by binary search (assumption: once an iteration leaves
//    the reference path, later ones do too, as with "time >= deadline").
// 6. Skip: set the CPU's cycle counter to c0 + j*P and let the timers catch
//    up in one count each (exact for the ticks in between: none of them is
//    significant). The CPU state at that moment differs from a full run
//    only in bytes the next iteration writes before reading; iteration j
//    then runs for real (it fits before the horizon), after which the state
//    is the same as a full run's, byte for byte.
//
// SLEEP is a no-op in avr8js, so a sleep loop is just a loop; mode 'sleep'
// only skips loops whose iteration executes SLEEP with SMCR.SE set, mode
// 'spin' skips any pure loop. Attempts are cheap but not free: the CPU loop
// calls attempt() every so many instructions (CHECK, backing off after
// failures) or when it reaches the head of the last skipped loop (seek).
// Everything is a function of the program and its inputs: deterministic.
//
// Limits: the binary search assumes monotone loop exits (a loop that leaves
// its path only for some values of TCNT in the middle of a skip window
// would be skipped past them); the flags test checks two flag patterns, not
// all; loops longer than MAX_LEN instructions, loops with a pending
// interrupt, and loops that touch hooked I/O are never skipped.

import { CPU, avrInstruction, type AVRTimer } from 'avr8js';
import type { IdleSkipMode } from '../board';

export type { IdleSkipMode };

export interface IdleSkipStats {
  /** Skip attempts (sandbox runs started). */
  attempts: number;
  /** Successful skips. */
  skips: number;
  /** CPU cycles jumped over. */
  skippedCycles: number;
}

const OP_SLEEP = 0x9588;
const SMCR = 0x53;
const SMCR_SE = 0x01;
const SP_LOW = 93;
const SREG = 95;
const SREG_I = 0x80;
/** Longest loop iteration considered, in instructions. */
const MAX_LEN = 600;
/** Instructions between attempts while the program looks idle. */
const CHECK = 64;
/**
 * While the skipper waits for a head PC (IdleSkipper.seek), instructions
 * after the countdown ran out before it attempts at any PC.
 */
export const SEEK_TIMEOUT = 4 * MAX_LEN;
/** Longest wait between attempts after failures (instructions). */
const MAX_BACKOFF = 1 << 14;
/** Fewest iterations worth skipping. */
const MIN_SKIP = 2;
const CACHE_LIMIT = 64;

/** avr8js internals we read (private in its typings). */
interface ClockEntry {
  cycles: number;
  callback: () => void;
  next: ClockEntry | null;
}
interface CpuInternals {
  nextClockEvent: ClockEntry | null;
  clockEventPool: ClockEntry[];
  nextInterrupt: number;
}
interface TimerInternals {
  config: { bits: number; TCNT: number; TIFR: number; TIMSK: number; TOIE: number; OCIEA: number; OCIEB: number };
  count: () => void;
  tcnt: number;
  lastCycle: number;
  divider: number;
  countingUp: boolean;
  tcntUpdated: boolean;
  updateDivider: boolean;
  timerMode: number;
  readonly TOP: number;
  ocrA: number;
  ocrB: number;
  ocrC: number;
  nextOcrA: number;
  nextOcrB: number;
  nextOcrC: number;
  compA: number;
  compB: number;
}
/** avr8js TimerMode values with up/down counting. */
const PHASE_CORRECT = 1;
const PHASE_FREQ_CORRECT = 4;

const isPhase = (t: TimerInternals): boolean => t.timerMode === PHASE_CORRECT || t.timerMode === PHASE_FREQ_CORRECT;

/** Counter value `n` ticks after the timer's last count (exactly as avr8js counts tick by tick). */
function advance(t: TimerInternals, n: number): number {
  let v = t.tcnt;
  if (n <= 0) return v;
  const top = t.TOP;
  if (!isPhase(t)) return (v + n) % (top + 1);
  let up = t.countingUp;
  if (up && v + n < top) return v + n;
  if (!up && v - n > 0) return v - n;
  if (!v && !top) return v;
  for (; n > 0; n--) {
    if (up) {
      v++;
      if (v === top) up = false;
    } else {
      v--;
      if (!v) up = true;
    }
  }
  return v;
}

/**
 * Ticks from the timer's last count to its first significant tick (see the
 * header), or Infinity when there is none within `maxTicks`. 0 = the timer
 * is in the middle of an update: do not skip.
 */
function significantTick(t: TimerInternals, data: Uint8Array, observed: boolean, maxTicks: number): number {
  if (t.tcntUpdated || t.updateDivider) return 0;
  if (!t.divider) return Infinity;
  const cfg = t.config;
  const timsk = data[cfg.TIMSK];
  const ovf = observed || (timsk & cfg.TOIE) !== 0;
  const a = observed || (timsk & cfg.OCIEA) !== 0 || t.compA !== 0;
  const b = observed || (timsk & cfg.OCIEB) !== 0 || t.compB !== 0;
  const top = t.TOP;
  const { ocrA, ocrB } = t;
  let v = t.tcnt;
  if (v > top) return 1;
  if (!isPhase(t)) {
    // Every wrap stops a skip (OCR updates at BOTTOM, overflow flags, PWM pins).
    let n = top - v + 1;
    if (a && ocrA > v && ocrA <= top) n = Math.min(n, ocrA - v);
    if (b && ocrB > v && ocrB <= top) n = Math.min(n, ocrB - v);
    return n;
  }
  if (!top) return 1;
  // Turning points matter when the loop reads the timer, or when OCR updates wait for them.
  const turn = observed || t.nextOcrA !== ocrA || t.nextOcrB !== ocrB || t.nextOcrC !== t.ocrC;
  let up = t.countingUp;
  if (up && v >= top) return 1;
  for (let n = 1; n <= maxTicks; n++) {
    if (up) {
      v++;
      if (v === top) {
        up = false;
        if (turn) return n;
      }
    } else {
      v--;
      if (!v) {
        up = true;
        if (ovf || turn) return n;
      }
    }
    if ((a && v === ocrA) || (b && v === ocrB)) return n;
  }
  return Infinity;
}

/** One loop iteration as found from a head. */
interface Loop {
  pc0: number;
  sp0: number;
  /** Instructions per iteration. */
  len: number;
  /** CPU cycles per iteration. */
  period: number;
  /** PC before each instruction. */
  pcs: Int32Array;
  /** Addresses passed to readData / writeData, in order. */
  reads: number[];
  writes: number[];
  /** Data bytes read before written (must be unchanged by an iteration). */
  liveIn: Int32Array;
  /** Bit i: the loop reads timer i (TCNT or TIFR). */
  observed: number;
  /** Executes SLEEP with SMCR.SE set. */
  sleeps: boolean;
  /** Targets of backward jumps/branches in the iteration (good heads: loop tops). */
  tops: number[];
  /** SREG's flags (not I) are dead at the head (see flagsDead); null = not tested yet. */
  flagsDead: boolean | null;
}

export class IdleSkipper {
  readonly stats: IdleSkipStats = { attempts: 0, skips: 0, skippedCycles: 0 };
  private readonly sb: CPU;
  private readonly timers: TimerInternals[];
  private readonly counts: Set<() => void>;
  /** Data address -> timer index, for the timers' TCNT (low byte, the read hook). */
  private readonly tcntTimer = new Map<number, number>();
  private readonly cache = new Map<string, Loop>();
  private fails = 0;
  private seekTries = 0;
  /** A PC to attempt at as soon as the CPU gets there (-1: none). */
  seek = -1;
  /** The sandbox's bytes at the end of the reference iteration. */
  private readonly end: Uint8Array;
  // Sandbox run state.
  private bad = false;
  private sleeps = false;
  private reads: number[] = [];
  private writes: number[] = [];
  /** When set, readData/writeData addresses must match these lists (probe mode). */
  private ref: Loop | null = null;
  private ri = 0;
  private wi = 0;
  private readonly pcs = new Int32Array(MAX_LEN);

  constructor(private readonly cpu: CPU, timers: readonly AVRTimer[], private readonly mode: Exclude<IdleSkipMode, 'off'>) {
    this.timers = timers as unknown as TimerInternals[];
    this.counts = new Set(this.timers.map((t) => t.count));
    this.timers.forEach((t, i) => this.tcntTimer.set(t.config.TCNT, i));
    const sb = new CPU(cpu.progMem, cpu.data.length - 0x100);
    sb.readData = this.sandboxRead;
    sb.writeData = this.sandboxWrite;
    sb.onWatchdogReset = () => {
      this.bad = true;
    };
    this.sb = sb;
    this.end = new Uint8Array(cpu.data.length);
  }

  /**
   * Called before an instruction (after the previous tick). Skips iterations
   * of the loop at the current PC when it can (see the header). `target` is
   * the cycle the current run() must reach. Returns how many instructions to
   * wait before the next attempt.
   */
  attempt(target: number): number {
    const cpu = this.cpu;
    if ((cpu as unknown as CpuInternals).nextInterrupt !== -1) return this.backoff();
    const c0 = cpu.cycles;
    for (const t of this.timers) {
      if (t.tcntUpdated || t.updateDivider) return CHECK;
      if (t.divider && c0 - t.lastCycle >= t.divider) return 8; // a tick still to be counted
    }
    this.stats.attempts++;
    this.seek = -1;
    // A first horizon as if the loop read every timer (it can only be earlier than the real one):
    // the reference iteration has to end before it.
    const early = this.horizon(target, 0b111);
    const loop = this.findLoop(c0, early);
    if (loop === 'late') return this.soon(c0, early);
    if (!loop || (this.mode === 'sleep' && !loop.sleeps)) {
      return this.backoff();
    }
    // The sandbox is now at the end of the reference iteration (run from the head).
    this.end.set(this.sb.data);
    if (!this.liveInKept(loop, c0)) {
      const k = loop.tops.indexOf(cpu.pc);
      // At a loop top this pass may just be a different one (e.g. delay() counting down a
      // millisecond): try the same head on the next passes, a few times.
      if (k >= 0 && ++this.fails <= 3) {
        this.seek = cpu.pc;
        return 1;
      }
      // Else try the loop's tops in turn as heads (temporaries are dead there), then back off.
      if (this.seekTries < loop.tops.length) {
        this.seek = loop.tops[(k + 1) % loop.tops.length];
        this.seekTries++;
        return 0;
      }
      this.seekTries = 0;
      return this.backoff();
    }
    this.seekTries = 0;
    const limit = loop.observed === 0b111 ? early : this.horizon(target, loop.observed);
    // Skip j iterations, then iteration j runs for real: c0 + (j + 1) * P <= limit.
    const kmax = Math.floor((limit - c0) / loop.period) - 1;
    if (kmax < MIN_SKIP) return this.soon(c0, limit);
    let j = kmax;
    if (!this.probe(loop, c0, kmax)) {
      let lo = 0;
      let hi = kmax;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (this.probe(loop, c0, mid)) lo = mid;
        else hi = mid;
      }
      j = lo;
    }
    if (j < MIN_SKIP) {
      // The loop changes its path within a few iterations (e.g. delay() counting a millisecond down):
      // try again at this head on its next pass, a few times.
      if (++this.fails <= 3) {
        this.seek = loop.pc0;
        return 1;
      }
      return this.backoff();
    }
    this.jump(c0 + j * loop.period);
    // Come back to this head on the loop's next pass.
    this.seek = loop.pc0;
    this.fails = 0;
    this.stats.skips++;
    this.stats.skippedCycles += j * loop.period;
    return 1;
  }

  /**
   * The cycle before which nothing outside the loop happens: the first
   * clock event that is not a timer tick, the end of the slice (`target`),
   * the first significant tick of each timer (`observed`: bit i = the loop
   * reads timer i).
   */
  private horizon(target: number, observed: number): number {
    const cpu = this.cpu;
    let limit = target;
    for (let e = (cpu as unknown as CpuInternals).nextClockEvent; e; e = e.next) {
      if (this.counts.has(e.callback)) continue;
      limit = Math.min(limit, e.cycles);
      break;
    }
    for (let i = 0; i < this.timers.length; i++) {
      const t = this.timers[i];
      if (!t.divider || limit <= t.lastCycle) continue;
      const maxTicks = Math.floor((limit - t.lastCycle) / t.divider) + 1;
      const n = significantTick(t, cpu.data, (observed & (1 << i)) !== 0, maxTicks);
      if (n !== Infinity) limit = Math.min(limit, t.lastCycle + n * t.divider);
    }
    return limit;
  }

  /** Idle, but something happens soon (at `limit`): come back to this head after it. */
  private soon(c0: number, limit: number): number {
    this.fails = 0;
    this.seek = this.cpu.pc;
    return Math.max(1, Math.floor((limit - c0) / 2));
  }

  private backoff(): number {
    this.fails = Math.min(this.fails + 1, 14);
    return Math.min(MAX_BACKOFF, CHECK << this.fails);
  }

  /** Move the CPU clock to `cycles` (whole iterations later) and let the timers count up to it. */
  private jump(cycles: number): void {
    const cpu = this.cpu;
    const internals = cpu as unknown as CpuInternals;
    cpu.cycles = cycles;
    // Same as the clock-event half of cpu.tick(), for every tick now due (all timer counts).
    for (;;) {
      const e = internals.nextClockEvent;
      if (!e || e.cycles > cycles) break;
      if (!this.counts.has(e.callback)) throw new Error('idle skip crossed a clock event');
      e.callback();
      internals.nextClockEvent = e.next;
      if (internals.clockEventPool.length < 10) internals.clockEventPool.push(e);
    }
  }

  /** Reset the sandbox to the CPU's state at the head, `cycles` on the clock. */
  private load(cycles: number): void {
    const sb = this.sb;
    sb.data.set(this.cpu.data);
    sb.pc = this.cpu.pc;
    sb.cycles = cycles;
    this.bad = false;
    this.sleeps = false;
    this.ri = 0;
    this.wi = 0;
  }

  private sp(data: Uint8Array): number {
    return data[SP_LOW] | (data[SP_LOW + 1] << 8);
  }

  /**
   * Run the sandbox from the head until it is back there (same SP): the
   * loop, null when there is none, 'late' when the run passed cycle `cap`.
   */
  private findLoop(c0: number, cap: number): Loop | null | 'late' {
    const sb = this.sb;
    const pc0 = this.cpu.pc;
    const sp0 = this.sp(this.cpu.data);
    this.load(c0);
    this.ref = null;
    this.reads = [];
    this.writes = [];
    const pcs = this.pcs;
    let len = 0;
    while (len < MAX_LEN) {
      pcs[len++] = sb.pc;
      this.checkSleep(sb.data);
      avrInstruction(sb);
      if (this.bad) return null;
      if (sb.pc === pc0 && this.sp(sb.data) === sp0) break;
      if (sb.cycles > cap) return 'late';
    }
    if (sb.pc !== pc0 || this.sp(sb.data) !== sp0) return null;
    const period = sb.cycles - c0;
    const key = `${pc0}:${sp0}:${len}:${period}`;
    const cached = this.cache.get(key);
    if (cached && this.same(cached, pcs, len)) {
      return this.sleeps === cached.sleeps ? cached : { ...cached, sleeps: this.sleeps };
    }
    const loop = this.analyse(c0, pc0, sp0, len, period);
    if (!loop) return null;
    if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
    this.cache.set(key, loop);
    return loop;
  }

  private same(loop: Loop, pcs: Int32Array, len: number): boolean {
    for (let i = 0; i < len; i++) if (loop.pcs[i] !== pcs[i]) return false;
    return sameList(loop.reads, this.reads) && sameList(loop.writes, this.writes);
  }

  /** `data`: the sandbox's bytes, untracked (SMCR is not read by the instruction). */
  private checkSleep(data: Uint8Array): void {
    const sb = this.sb;
    if (sb.progMem[sb.pc] === OP_SLEEP && data[SMCR] & SMCR_SE) this.sleeps = true;
  }

  /**
   * Run the iteration again with every data access tracked, for the bytes it
   * reads before writing. Returns the loop, or null when the run differs.
   */
  private analyse(c0: number, pc0: number, sp0: number, len: number, period: number): Loop | null {
    const sb = this.sb as unknown as { data: Uint8Array; dataView: DataView };
    const raw = sb.data;
    const rawView = sb.dataView;
    const marks = new Uint8Array(raw.length); // 1 = read first (live-in), 2 = written first
    const read = (i: number): void => {
      if (!marks[i]) marks[i] = 1;
    };
    const write = (i: number): void => {
      if (!marks[i]) marks[i] = 2;
    };
    const index = (p: string | symbol): number => {
      if (typeof p !== 'string') return -1;
      const c = p.charCodeAt(0);
      return c >= 48 && c <= 57 ? Number(p) : -1;
    };
    const data = new Proxy(raw, {
      get(target, p) {
        const i = index(p);
        if (i >= 0) {
          read(i);
          return target[i];
        }
        const v = Reflect.get(target, p, target) as unknown;
        return typeof v === 'function' ? (v as (...args: unknown[]) => unknown).bind(target) : v;
      },
      set(target, p, value: number) {
        const i = index(p);
        if (i >= 0) {
          write(i);
          target[i] = value;
          return true;
        }
        return Reflect.set(target, p, value, target);
      },
    });
    const view = {
      getUint8: (a: number) => (read(a), rawView.getUint8(a)),
      getInt8: (a: number) => (read(a), rawView.getInt8(a)),
      getUint16: (a: number, le?: boolean) => (read(a), read(a + 1), rawView.getUint16(a, le)),
      setUint8: (a: number, v: number) => (write(a), rawView.setUint8(a, v)),
      setUint16: (a: number, v: number, le?: boolean) => (write(a), write(a + 1), rawView.setUint16(a, v, le)),
      setInt16: (a: number, v: number, le?: boolean) => (write(a), write(a + 1), rawView.setInt16(a, v, le)),
    };
    const pcs = new Int32Array(len);
    this.load(c0);
    this.reads = [];
    this.writes = [];
    sb.data = data;
    sb.dataView = view as unknown as DataView;
    try {
      for (let i = 0; i < len; i++) {
        pcs[i] = this.sb.pc;
        this.checkSleep(raw);
        avrInstruction(this.sb);
        if (this.bad) return null;
      }
    } finally {
      sb.data = raw;
      sb.dataView = rawView;
    }
    if (this.sb.pc !== pc0 || this.sp(raw) !== sp0 || this.sb.cycles - c0 !== period) return null;
    for (let i = 0; i < len; i++) if (pcs[i] !== this.pcs[i]) return null;
    const liveIn: number[] = [];
    for (let i = 0; i < marks.length; i++) if (marks[i] === 1) liveIn.push(i);
    let observed = 0;
    this.timers.forEach((t, i) => {
      const { TCNT, TIFR, bits } = t.config;
      if (this.reads.some((a) => a === TCNT || a === TIFR || (bits === 16 && a === TCNT + 1))) observed |= 1 << i;
    });
    const prog = this.sb.progMem;
    const tops: number[] = [];
    for (let i = 0; i < len; i++) {
      const next = i + 1 < len ? pcs[i + 1] : pc0;
      if (next <= pcs[i] && !isCallOrReturn(prog[pcs[i]]) && !tops.includes(next)) tops.push(next);
    }
    return {
      pc0, sp0, len, period, pcs, reads: this.reads, writes: this.writes,
      liveIn: Int32Array.from(liveIn), observed, sleeps: this.sleeps, tops, flagsDead: null,
    };
  }

  /**
   * After a sandbox run from the head: are the loop's live-in bytes as they
   * are in the CPU? SREG's flags may differ when they are dead at the head
   * (tested once per loop, at head cycle `c0`, see flagsDead); its I bit
   * may not.
   */
  private liveInKept(loop: Loop, c0?: number): boolean {
    const now = this.sb.data;
    const was = this.cpu.data;
    const { liveIn } = loop;
    let flags = false;
    for (let k = 0; k < liveIn.length; k++) {
      const i = liveIn[k];
      if (now[i] === was[i]) continue;
      if (i !== SREG || (now[i] ^ was[i]) & SREG_I) return false;
      flags = true;
    }
    if (!flags) return true;
    if (loop.flagsDead === null && c0 !== undefined) loop.flagsDead = this.flagsDead(loop, c0);
    return loop.flagsDead === true;
  }

  /**
   * Byte-level liveness counts SREG as read by every ALU instruction (they
   * keep some of its bits) and by "oldSREG = SREG; cli(); ...; SREG =
   * oldSREG", although the flags they pass on are overwritten before any
   * branch looks at them. Test it: the reference iteration from the head
   * with all flags (not I) inverted, and with the flags it ends with, must
   * end in exactly the same state (every byte) along the same path. Uses the
   * reference end state in `end`.
   */
  private flagsDead(loop: Loop, c0: number): boolean {
    const sreg = this.cpu.data[SREG];
    for (const flags of [sreg ^ 0x7f, this.end[SREG]]) {
      this.load(c0);
      this.sb.data[SREG] = (flags & ~SREG_I) | (sreg & SREG_I);
      if (!this.replay(loop)) return false;
      const now = this.sb.data;
      for (let i = 0; i < now.length; i++) if (now[i] !== this.end[i]) return false;
    }
    return true;
  }

  /** Iteration `j` (from head cycle c0 + j * P) replayed from the current state: same path, addresses, live-ins? */
  private probe(loop: Loop, c0: number, j: number): boolean {
    this.load(c0 + j * loop.period);
    return this.replay(loop) && this.liveInKept(loop);
  }

  /** Run the loaded sandbox through one iteration: does it follow the loop's path and addresses back to the head? */
  private replay(loop: Loop): boolean {
    const sb = this.sb;
    const start = sb.cycles;
    this.ref = loop;
    try {
      const { pcs, len } = loop;
      for (let i = 0; i < len; i++) {
        if (sb.pc !== pcs[i]) return false;
        avrInstruction(sb);
        if (this.bad) return false;
      }
    } finally {
      this.ref = null;
    }
    if (sb.pc !== loop.pc0 || this.sp(sb.data) !== loop.sp0) return false;
    if (sb.cycles - start !== loop.period) return false;
    return this.ri === loop.reads.length && this.wi === loop.writes.length;
  }

  private sandboxRead = (addr: number): number => {
    const sb = this.sb;
    if (this.ref) {
      if (this.ref.reads[this.ri++] !== addr) this.bad = true;
    } else {
      this.reads.push(addr);
    }
    if (addr >= 32 && this.cpu.readHooks[addr]) {
      const i = this.tcntTimer.get(addr);
      if (i === undefined) {
        this.bad = true;
        return sb.data[addr];
      }
      // As the timer's TCNT read hook: count up to now, the high byte to the temp register.
      const t = this.timers[i];
      const v = t.divider ? advance(t, Math.floor((sb.cycles - t.lastCycle) / t.divider)) : t.tcnt;
      if (t.config.bits === 16) sb.data[addr + 1] = v >> 8;
      return (sb.data[addr] = v & 0xff);
    }
    return sb.data[addr];
  };

  private sandboxWrite = (addr: number, value: number): void => {
    if (this.ref) {
      if (this.ref.writes[this.wi++] !== addr) this.bad = true;
    } else {
      this.writes.push(addr);
    }
    if (addr >= 32 && this.cpu.writeHooks[addr]) {
      this.bad = true;
      return;
    }
    this.sb.data[addr] = value;
  };
}

/** CALL, RCALL, ICALL, EICALL, RET, RETI: a backward PC change that is not a loop. */
function isCallOrReturn(op: number): boolean {
  return (op & 0xfe0e) === 0x940e || (op & 0xf000) === 0xd000 || op === 0x9509 || op === 0x9519 || op === 0x9508 || op === 0x9518;
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
