// The Logic analyzer window (panel id 'logic-analyzer'; it was the first
// "Scope" window, id 'scope', and saved layouts are migrated, see persist.ts):
// digital traces of board pins over simulated time, with UART decoding. The
// analog part inspector is now the Scope window (inspector.ts). Probing by
// clicking a part comes later (docs/PLAN.md step 7b).
//
// - Channels: "Add channel" with a Board and a Pin dropdown (the board's io
//   pins, named like on the part). Adding arms the pin in the recorder
//   (sim.recorder, src/scope/recorder.ts), which records it from then on while
//   the board runs; removing disarms it. Each row can be renamed and decoded
//   (UART; I2C and SPI are listed as coming later).
// - The channel list is session UI state: not saved in the project, no undo
//   step, no unsaved mark. The samples are never saved either.
// - Canvas: one row per channel (high / low, high impedance as a mid line,
//   pull-up as a dimmer high), a time axis on top, decoded bytes above the
//   trace. Wheel zooms around the pointer, drag pans, a click places cursor A
//   then B (a third click starts again), the bar shows their delta and
//   frequency, hovering shows the levels under the pointer. "Hold" freezes
//   the display (recording goes on); "Latest" follows the newest time while
//   the simulation runs.
// - Drawing: only when something changed (new edges, a zoom, the pointer) and
//   at most once per animation frame; every row is planned per pixel column
//   (timeaxis.ts planTrace), so a million edges cost the same as a few.

import './serialconsole.css';
import './scope.css';
import { boardsInOrder } from '../boardcontrols';
import type { PlacedPart, Scene } from '../model';
import { boardLabelWithId, getPart } from '../parts';
import { I2C_DECODER, SPI_DECODER, logicOf } from '../scope/decoders';
import { HIGH, HI_Z, LOW, PULL_UP, channelKey, type DigitalTrace, type Level } from '../scope/recorder';
import {
  DEFAULT_SPAN, firstEndingAfter, fitAll, followLatest, formatFrequency, formatTime, levelY, panBy, planTrace, tickStep,
  ticks, timeToX, xToTime, zoomAt, type TimeView,
} from '../scope/timeaxis';
import {
  DEFAULT_UART, UART_BAUDS, UartStream, byteLabel, frameFormat, type DataBits, type Parity, type StopBits, type UartSettings,
} from '../scope/uart';
import type { Simulation } from '../simulation';

export const LOGIC_ANALYZER_ID = 'logic-analyzer';

/** Heights in CSS pixels: the time axis, one channel row, the decoded-byte band at a row's top. */
const AXIS_H = 22;
const ROW_H = 56;
const LABEL_H = 16;
/** A press that moves less than this is a click (cursor), more is a pan. */
const CLICK_SLOP = 3;

/** Canvas colours (one place, for the palette clean-up in docs/FRONTEND.md). */
const COLORS = {
  background: '#18191c',
  rowLine: '#2a2c31',
  axis: '#9aa0aa',
  grid: '#25272c',
  trace: '#5fd38d',
  weak: '#3f8a5e',
  hiZ: '#c9a43b',
  band: 'rgba(95, 211, 141, 0.45)',
  label: '#2f5f99',
  labelText: '#e8f1ff',
  error: '#d0544c',
  cursorA: '#4ea1ff',
  cursorB: '#e0a040',
  hover: 'rgba(255, 255, 255, 0.35)',
  text: '#c3c7ce',
};

type DecoderId = 'none' | 'uart' | 'i2c' | 'spi';

const FORMATS: readonly Omit<UartSettings, 'baud'>[] = [
  { dataBits: 8, parity: 'none', stopBits: 1 },
  { dataBits: 8, parity: 'even', stopBits: 1 },
  { dataBits: 8, parity: 'odd', stopBits: 1 },
  { dataBits: 8, parity: 'none', stopBits: 2 },
  { dataBits: 8, parity: 'none', stopBits: 1.5 },
  { dataBits: 7, parity: 'even', stopBits: 1 },
  { dataBits: 7, parity: 'odd', stopBits: 1 },
  { dataBits: 7, parity: 'none', stopBits: 1 },
  { dataBits: 7, parity: 'even', stopBits: 2 },
  { dataBits: 9, parity: 'none', stopBits: 1 },
  { dataBits: 6, parity: 'none', stopBits: 1 },
  { dataBits: 5, parity: 'none', stopBits: 1 },
];

/** One row of the window (session state only). */
interface Channel {
  board: number;
  pin: string;
  name: string;
  decoder: DecoderId;
  uart: UartSettings;
  /** Show decoded bytes as ASCII where printable (else hex). */
  ascii: boolean;
  stream: UartStream;
  /** The row's baud dropdown (its Auto entry shows the detected rate). */
  baudSelect: HTMLSelectElement | null;
}

const LEVEL_NAMES: Record<Level, string> = { [LOW]: 'low', [HIGH]: 'high', [HI_Z]: 'hi-Z', [PULL_UP]: 'pull-up' };

export class LogicAnalyzerWindow {
  /** The window's content; DockLayout adopts it whenever the window opens. */
  readonly element = document.createElement('div');
  private readonly boardSelect = document.createElement('select');
  private readonly pinSelect = document.createElement('select');
  private readonly addButton = document.createElement('button');
  private readonly holdButton = document.createElement('button');
  private readonly followButton = document.createElement('button');
  private readonly fitButton = document.createElement('button');
  private readonly clearCursorsButton = document.createElement('button');
  private readonly note = document.createElement('span');
  private readonly list = document.createElement('div');
  private readonly plot = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly hint = document.createElement('div');
  private readonly readout = document.createElement('div');
  private readonly ctx: CanvasRenderingContext2D | null;

  private channels: Channel[] = [];
  private boardChoice = '';
  private pinChoice = '';
  private boardOptions = '';
  private pinOptions = '';
  private view: TimeView = { start: 0, span: DEFAULT_SPAN };
  private follow = true;
  /** Held: the display stops at this time (recording goes on). */
  private holdAt: number | null = null;
  private cursorA: number | null = null;
  private cursorB: number | null = null;
  private hoverX: number | null = null;
  private press: { x: number; lastX: number; moved: boolean; id: number } | null = null;
  private width = 0;
  private dirty = true;
  private frame = 0;
  private seenVersion = -1;

  constructor(
    private readonly scene: Scene,
    private readonly sim: Simulation,
    /** The board preselected in the Board dropdown (the active board), or null. */
    private readonly autoBoard: () => number | null,
  ) {
    const el = this.element;
    el.className = 'scope-window';
    this.ctx = this.canvas.getContext('2d');

    const bar = document.createElement('div');
    bar.className = 'scope-bar';
    this.boardSelect.className = 'serial-select';
    this.boardSelect.setAttribute('aria-label', 'Board');
    this.boardSelect.title = 'Board of the pin to add';
    this.pinSelect.className = 'serial-select';
    this.pinSelect.setAttribute('aria-label', 'Pin');
    this.pinSelect.title = 'Pin to add as a channel';
    button(this.addButton, 'Add channel', 'Record this pin from now on while its board runs');
    button(this.holdButton, 'Hold', 'Freeze the display (recording goes on)');
    button(this.followButton, 'Latest', 'Follow the newest time while the simulation runs');
    button(this.fitButton, 'Fit', 'Show everything recorded');
    button(this.clearCursorsButton, 'Clear cursors', 'Remove cursors A and B');
    this.note.className = 'scope-note';
    const spacer = document.createElement('span');
    spacer.className = 'serial-spacer';
    bar.append(
      field('Board', this.boardSelect), field('Pin', this.pinSelect), this.addButton, this.note, spacer,
      this.clearCursorsButton, this.fitButton, this.followButton, this.holdButton,
    );

    const body = document.createElement('div');
    body.className = 'scope-body';
    this.list.className = 'scope-list';
    this.plot.className = 'scope-plot';
    this.canvas.className = 'scope-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Traces');
    this.hint.className = 'serial-hint';
    this.plot.append(this.canvas);
    body.append(this.list, this.plot, this.hint);
    this.readout.className = 'scope-readout';
    el.append(bar, body, this.readout);

    this.boardSelect.addEventListener('change', () => {
      this.boardChoice = this.boardSelect.value;
      this.update();
    });
    this.pinSelect.addEventListener('change', () => (this.pinChoice = this.pinSelect.value));
    this.addButton.addEventListener('click', () => this.addChannel());
    this.holdButton.addEventListener('click', () => {
      this.holdAt = this.holdAt === null ? this.sim.recorder.latest : null;
      this.invalidate();
    });
    this.followButton.addEventListener('click', () => {
      this.follow = true;
      this.holdAt = null;
      this.view = followLatest(this.view, this.sim.recorder.latest);
      this.invalidate();
    });
    this.fitButton.addEventListener('click', () => {
      this.follow = false;
      this.view = fitAll(this.holdAt ?? this.sim.recorder.latest);
      this.invalidate();
    });
    this.clearCursorsButton.addEventListener('click', () => {
      this.cursorA = this.cursorB = null;
      this.invalidate();
    });

    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', () => (this.press = null));
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverX = null;
      this.invalidate();
    });
    new ResizeObserver(() => this.invalidate()).observe(this.plot);
    this.renderList();
  }

  /** Call after every frame and when the window opens. Cheap when nothing changed. */
  update(): void {
    const boards = boardsInOrder(this.scene.parts);
    this.updateBoardSelect(boards);
    this.updatePinSelect(boards.find((p) => String(p.id) === this.boardChoice) ?? null);
    const version = this.sim.recorder.version;
    if (version !== this.seenVersion) {
      this.seenVersion = version;
      this.dirty = true;
    }
    if (this.follow && this.holdAt === null && this.sim.timeRunning) {
      const next = followLatest(this.view, this.sim.recorder.latest);
      if (next.start !== this.view.start) {
        this.view = next;
        this.dirty = true;
      }
    }
    this.holdButton.classList.toggle('scope-on', this.holdAt !== null);
    this.followButton.classList.toggle('scope-on', this.follow && this.holdAt === null);
    const dropped = this.channels.some((c) => (this.sim.recorder.trace(c.board, c.pin)?.dropped ?? 0) > 0);
    const note = dropped ? 'Oldest edges dropped (1,000,000 kept per channel)' : '';
    if (this.note.textContent !== note) this.note.textContent = note;
    const hint = this.channels.length === 0
      ? boards.length === 0 ? 'No board in the project' : 'Pick a board and a pin, then Add channel. Pins are recorded while their board runs.'
      : '';
    if (this.hint.textContent !== hint) this.hint.textContent = hint;
    this.hint.hidden = hint === '';
    if (this.dirty) this.scheduleDraw();
  }

  private invalidate(): void {
    this.dirty = true;
    this.scheduleDraw();
  }

  private scheduleDraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private updateBoardSelect(boards: readonly PlacedPart[]): void {
    const items: [string, string][] = boards.map((p) => [String(p.id), boardLabelWithId(p)]);
    const signature = items.map(([v, t]) => `${v}=${t}`).join('|');
    if (!boards.some((p) => String(p.id) === this.boardChoice)) {
      const auto = this.autoBoard();
      this.boardChoice = String(boards.find((p) => p.id === auto)?.id ?? boards[0]?.id ?? '');
    }
    const sel = this.boardSelect;
    if (signature !== this.boardOptions || sel.options.length === 0) {
      this.boardOptions = signature;
      sel.replaceChildren(...(items.length > 0 ? items.map(([v, t]) => option(v, t)) : [option('', 'No board')]));
    }
    if (sel.value !== this.boardChoice) sel.value = this.boardChoice;
    sel.disabled = items.length === 0;
  }

  private updatePinSelect(part: PlacedPart | null): void {
    const items = part ? pinItems(part) : [];
    const signature = `${part?.id ?? ''}|` + items.map(([v, t]) => `${v}=${t}`).join('|');
    if (!items.some(([v]) => v === this.pinChoice)) this.pinChoice = items[0]?.[0] ?? '';
    const sel = this.pinSelect;
    if (signature !== this.pinOptions || sel.options.length === 0) {
      this.pinOptions = signature;
      sel.replaceChildren(...(items.length > 0 ? items.map(([v, t]) => option(v, t)) : [option('', '–')]));
    }
    if (sel.value !== this.pinChoice) sel.value = this.pinChoice;
    sel.disabled = items.length === 0;
    this.addButton.disabled = items.length === 0;
  }

  private addChannel(): void {
    const part = this.scene.find(Number(this.boardChoice));
    if (!part || !this.pinChoice) return;
    const board = part.id;
    const pin = this.pinChoice;
    if (this.channels.some((c) => c.board === board && c.pin === pin)) return; // already a channel
    const pinName = pinItems(part).find(([v]) => v === pin)?.[1] ?? pin;
    const several = boardsInOrder(this.scene.parts).length > 1;
    this.sim.recorder.arm(board, pin);
    this.channels.push({
      board, pin, name: several ? `${boardLabelWithId(part)} ${pinName}` : pinName,
      decoder: 'none', uart: { ...DEFAULT_UART }, ascii: true, stream: new UartStream(), baudSelect: null,
    });
    this.renderList();
    this.invalidate();
  }

  private removeChannel(ch: Channel): void {
    this.channels = this.channels.filter((c) => c !== ch);
    this.sim.recorder.disarm(ch.board, ch.pin);
    this.renderList();
    this.invalidate();
  }

  /** Rebuild the channel list (only when channels are added or removed, or a decoder changes). */
  private renderList(): void {
    const header = document.createElement('div');
    header.className = 'scope-list-header';
    header.style.height = `${AXIS_H}px`;
    header.textContent = this.channels.length > 0 ? 'Channels' : '';
    const rows = this.channels.map((ch) => this.channelRow(ch));
    this.list.replaceChildren(header, ...rows);
  }

  private channelRow(ch: Channel): HTMLElement {
    const row = document.createElement('div');
    row.className = 'scope-channel';
    row.style.height = `${ROW_H}px`;
    row.dataset.channel = channelKey(ch.board, ch.pin);

    const top = document.createElement('div');
    top.className = 'scope-channel-line';
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'scope-name';
    name.value = ch.name;
    name.spellcheck = false;
    name.setAttribute('aria-label', 'Channel name');
    name.title = 'Rename the channel';
    name.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing belongs to the field, not to the grid or the project shortcuts
      if (e.key === 'Enter' || e.key === 'Escape') name.blur();
    });
    name.addEventListener('change', () => {
      ch.name = name.value.trim() || ch.pin;
      name.value = ch.name;
      this.invalidate();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'scope-remove';
    remove.textContent = '×';
    remove.title = 'Remove the channel (stops recording it)';
    remove.setAttribute('aria-label', 'Remove channel');
    remove.addEventListener('click', () => this.removeChannel(ch));
    top.append(name, remove);

    const decode = document.createElement('div');
    decode.className = 'scope-channel-line';
    const decoder = select('Decoder', [
      ['none', 'No decoding'], ['uart', 'UART'],
      ['i2c', `${I2C_DECODER.name} (coming later)`], ['spi', `${SPI_DECODER.name} (coming later)`],
    ], ch.decoder);
    for (const o of decoder.options) o.disabled = o.value === 'i2c' || o.value === 'spi';
    decoder.addEventListener('change', () => {
      ch.decoder = decoder.value as DecoderId;
      this.renderList();
      this.invalidate();
    });
    decode.append(decoder);
    ch.baudSelect = null;
    if (ch.decoder === 'uart') {
      const baud = select('Baud rate', [['auto', 'Auto'], ...UART_BAUDS.map((b): [string, string] => [String(b), String(b)])], String(ch.uart.baud));
      baud.addEventListener('change', () => {
        ch.uart = { ...ch.uart, baud: baud.value === 'auto' ? 'auto' : Number(baud.value) };
        this.invalidate();
      });
      ch.baudSelect = baud;
      const formats = FORMATS.map((f): [string, string] => [frameFormat(f), frameFormat(f)]);
      const format = select('Frame format', formats, frameFormat(ch.uart));
      format.addEventListener('change', () => {
        const f = FORMATS.find((x) => frameFormat(x) === format.value);
        if (f) ch.uart = { ...ch.uart, dataBits: f.dataBits as DataBits, parity: f.parity as Parity, stopBits: f.stopBits as StopBits };
        this.invalidate();
      });
      const show = select('Show bytes as', [['ascii', 'ASCII'], ['hex', 'Hex']], ch.ascii ? 'ascii' : 'hex');
      show.addEventListener('change', () => {
        ch.ascii = show.value === 'ascii';
        this.invalidate();
      });
      decode.append(baud, format, show);
    }
    row.append(top, decode);
    return row;
  }

  // ---- Drawing ----

  private draw(): void {
    const ctx = this.ctx;
    const width = this.plot.clientWidth;
    const height = AXIS_H + Math.max(1, this.channels.length) * ROW_H;
    if (!ctx || !this.element.isConnected || width === 0) return; // hidden: stays dirty, drawn when shown
    this.dirty = false;
    this.width = width;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.height = `${height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    const view = this.view;
    const step = tickStep(view.span, width);
    const tickTimes = ticks(view, step);
    // Grid and axis labels.
    ctx.fillStyle = COLORS.grid;
    for (const t of tickTimes) ctx.fillRect(Math.round(timeToX(view, width, t)), AXIS_H, 1, height - AXIS_H);
    ctx.fillStyle = COLORS.axis;
    ctx.textAlign = 'left';
    for (const t of tickTimes) {
      const x = Math.round(timeToX(view, width, t));
      ctx.fillRect(x, AXIS_H - 5, 1, 5);
      ctx.fillText(formatTime(t, step), x + 3, AXIS_H / 2);
    }
    ctx.fillRect(0, AXIS_H - 1, width, 1);

    const until = this.holdAt ?? Infinity;
    this.channels.forEach((ch, i) => {
      const top = AXIS_H + i * ROW_H;
      ctx.fillStyle = COLORS.rowLine;
      ctx.fillRect(0, top + ROW_H - 1, width, 1);
      const trace = this.sim.recorder.trace(ch.board, ch.pin);
      if (!trace) return;
      this.drawTrace(ctx, trace, top + LABEL_H + 4, ROW_H - LABEL_H - 10, width, until);
      if (ch.decoder === 'uart') this.drawUart(ctx, ch, trace, top + 1, width, until);
    });

    this.drawCursors(ctx, width, height);
    this.updateReadout();
  }

  private drawTrace(ctx: CanvasRenderingContext2D, trace: DigitalTrace, top: number, h: number, width: number, until: number): void {
    const y = (l: Level): number => Math.round(top + levelY(l) * h) + 0.5;
    const color = (l: Level): string => (l === HI_Z ? COLORS.hiZ : l === PULL_UP ? COLORS.weak : COLORS.trace);
    ctx.lineWidth = 1;
    for (const run of planTrace(trace, this.view, width, until)) {
      if (run.kind === 'band') {
        ctx.fillStyle = COLORS.band;
        ctx.fillRect(run.x0, top, run.x1 - run.x0, h + 1);
        continue;
      }
      ctx.beginPath();
      if (run.kind === 'level') {
        ctx.strokeStyle = color(run.level);
        ctx.moveTo(run.x0, y(run.level));
        ctx.lineTo(run.x1, y(run.level));
      } else {
        ctx.strokeStyle = color(run.to);
        ctx.moveTo(run.x + 0.5, y(run.from));
        ctx.lineTo(run.x + 0.5, y(run.to));
        ctx.lineTo(run.x + 1, y(run.to));
      }
      ctx.stroke();
    }
  }

  /** Decoded bytes as boxes above the trace (bounded: at most one box per two pixels). */
  private drawUart(ctx: CanvasRenderingContext2D, ch: Channel, trace: DigitalTrace, top: number, width: number, until: number): void {
    ch.stream.update({ signal: logicOf(trace), generation: trace.generation }, ch.uart);
    this.updateBaudLabel(ch);
    const frames = ch.stream.frames;
    const view = this.view;
    const viewEnd = Math.min(view.start + view.span, until);
    let lastX = -Infinity;
    ctx.textAlign = 'center';
    for (let i = firstEndingAfter(frames, view.start); i < frames.length && frames[i].start < viewEnd; i++) {
      const f = frames[i];
      if (f.end > until) break;
      const x0 = Math.max(0, timeToX(view, width, f.start));
      const x1 = Math.min(width, timeToX(view, width, f.end));
      if (x1 < lastX + 2) continue; // too dense to tell apart: the next visible one is enough
      lastX = x1;
      ctx.fillStyle = f.error ? COLORS.error : COLORS.label;
      ctx.fillRect(x0 + 0.5, top, Math.max(1, x1 - x0 - 1), LABEL_H);
      const text = byteLabel(f.value, ch.ascii) + (f.error ? ` ${f.error}` : '');
      if (x1 - x0 > ctx.measureText(text).width + 4) {
        ctx.fillStyle = COLORS.labelText;
        ctx.fillText(text, (x0 + x1) / 2, top + LABEL_H / 2);
      }
    }
    ctx.textAlign = 'left';
  }

  private updateBaudLabel(ch: Channel): void {
    const auto = ch.baudSelect?.options[0];
    if (!auto) return;
    const text = ch.stream.baud !== null && ch.uart.baud === 'auto' ? `Auto (${ch.stream.baud})` : 'Auto';
    if (auto.textContent !== text) auto.textContent = text;
  }

  private drawCursors(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const line = (t: number | null, color: string, label: string): void => {
      if (t === null) return;
      const x = Math.round(timeToX(this.view, width, t)) + 0.5;
      if (x < 0 || x > width) return;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, AXIS_H);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(label, x + 3, AXIS_H + 8);
    };
    line(this.cursorA, COLORS.cursorA, 'A');
    line(this.cursorB, COLORS.cursorB, 'B');
    if (this.hoverX !== null) {
      ctx.strokeStyle = COLORS.hover;
      ctx.beginPath();
      ctx.moveTo(Math.round(this.hoverX) + 0.5, AXIS_H);
      ctx.lineTo(Math.round(this.hoverX) + 0.5, height);
      ctx.stroke();
    }
  }

  /** The line under the canvas: cursors, their delta and frequency, and the levels under the pointer. */
  private updateReadout(): void {
    const parts: string[] = [];
    const { cursorA: a, cursorB: b } = this;
    if (a !== null) parts.push(`A ${formatTime(a)}`);
    if (b !== null) parts.push(`B ${formatTime(b)}`);
    if (a !== null && b !== null) {
      const dt = Math.abs(b - a);
      parts.push(`Δ ${formatTime(dt)} (${formatFrequency(1 / dt)})`);
    }
    if (this.hoverX !== null && this.width > 0) {
      const t = xToTime(this.view, this.width, this.hoverX);
      const levels = this.channels.map((ch) => {
        const trace = this.sim.recorder.trace(ch.board, ch.pin);
        const i = trace && t <= trace.end ? trace.indexAt(t) : -1;
        let text = `${ch.name}: ${i >= 0 ? LEVEL_NAMES[trace!.level(i)] : '–'}`;
        if (ch.decoder === 'uart') {
          const frames = ch.stream.frames;
          const f = frames[firstEndingAfter(frames, t)];
          if (f && f.start <= t) text += ` ${byteLabel(f.value, false)}${f.value >= 0x20 && f.value <= 0x7e ? ` '${String.fromCharCode(f.value)}'` : ''}${f.error ? ` (${f.error} error)` : ''}`;
        }
        return text;
      });
      parts.push(`t ${formatTime(t)}`, ...levels);
    }
    if (parts.length === 0) parts.push(this.channels.length > 0 ? 'Click to place cursors A and B · wheel zooms · drag pans' : '');
    const text = parts.join('   ');
    if (this.readout.textContent !== text) this.readout.textContent = text;
  }

  // ---- Pointer ----

  private localX(e: MouseEvent): number {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const width = this.plot.clientWidth;
    if (width === 0) return;
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002));
    // While following, zoom around the newest time so it stays in view.
    const x = this.follow && this.holdAt === null ? width : this.localX(e);
    this.view = zoomAt(this.view, width, x, factor);
    this.invalidate();
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const x = this.localX(e);
    this.press = { x, lastX: x, moved: false, id: e.pointerId };
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus({ preventScroll: true });
  };

  private onPointerMove = (e: PointerEvent): void => {
    const x = this.localX(e);
    this.hoverX = x;
    const p = this.press;
    if (p && p.id === e.pointerId) {
      if (!p.moved && Math.abs(x - p.x) > CLICK_SLOP) p.moved = true;
      if (p.moved) {
        this.view = panBy(this.view, this.plot.clientWidth, x - p.lastX);
        this.follow = false;
      }
      p.lastX = x;
    }
    this.invalidate();
  };

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.press;
    this.press = null;
    if (!p || p.id !== e.pointerId || p.moved) return;
    const t = xToTime(this.view, this.plot.clientWidth, this.localX(e));
    if (this.cursorA === null) this.cursorA = t;
    else if (this.cursorB === null) this.cursorB = t;
    else {
      this.cursorA = t;
      this.cursorB = null;
    }
    this.invalidate();
  };
}

/** Io pins of a board part as [pin id, name like on the part]. */
function pinItems(part: PlacedPart): [string, string][] {
  const type = getPart(part.typeId);
  const io = type?.board?.io ?? [];
  return io.map((p) => [p.id, type?.pins.find((d) => d.id === p.id)?.name ?? p.id]);
}

function button(b: HTMLButtonElement, text: string, title: string): void {
  b.type = 'button';
  b.className = 'serial-button';
  b.textContent = text;
  b.title = title;
}

function option(value: string, text: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

function select(label: string, items: readonly [string, string][], value: string): HTMLSelectElement {
  const s = document.createElement('select');
  s.className = 'serial-select scope-small-select';
  s.setAttribute('aria-label', label);
  s.title = label;
  s.append(...items.map(([v, t]) => option(v, t)));
  s.value = value;
  return s;
}

function field(text: string, control: HTMLElement): HTMLLabelElement {
  const l = document.createElement('label');
  l.className = 'serial-field';
  const span = document.createElement('span');
  span.textContent = text;
  l.append(span, control);
  return l;
}
