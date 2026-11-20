// The Scope window (panel id 'scope'): the part inspector. It follows the
// part selected on the grid (or one pinned part) and shows that part's
// internal values live (src/sim/inspect.ts) and as time graphs, like an
// oscilloscope per part. (The digital pin traces are the Logic analyzer, logicanalyzer.ts.)
//
// - Which part: see PartFollower (src/scope/follow.ts): the primary selected
//   part (the last one added to the selection), or the pinned one. Nothing
//   selected: a hint. A board shows its pin voltages and rail currents.
// - Table: every quantity, formatted with SI units, region and switch state
//   as text; numeric rows have a checkbox that puts them on the graph. The
//   choice is kept per part for the session (default: the 2-3 most telling
//   ones, defaultPlot in inspect.ts; boards start with none).
// - Recording: the graphed quantities of the shown part are armed in
//   sim.analog (src/scope/analog.ts) while the window is open, so other parts
//   and a closed window cost nothing. Samples come from the solved instants
//   of the bridge in simulated time; while time stands still the shown
//   instant is sampled, so a DC circuit shows its value as a flat line
//   (dashed past the current time: it holds until something changes).
//   Reset clears the samples.
// - Graph: one lane per graphed quantity, each auto-scaled to what is in
//   view (its range written at the lane's right), a shared time axis (the
//   Logic analyzer's helpers in timeaxis.ts: wheel zoom, drag pan, Latest
//   follows the newest time, Hold freezes the display, Fit shows all), two
//   cursors (click, click; a third click starts again) with the values and
//   their deltas, and the values under the pointer.
// - UI-only state (not saved in the project, no undo step, no unsaved mark).
//   Drawing happens only when something changed, at most once per frame.

import './serialconsole.css';
import './scope.css';
import './inspector.css';
import { isBoardPart } from '../boardcontrols';
import type { PlacedPart, Scene } from '../model';
import { boardLabelWithId, getPart } from '../parts';
import type { ComponentModel } from '../sim';
import { defaultPlot, inspect, quantityValues, type InspectPart, type Quantity } from '../sim/inspect';
import { autoRange, columns, valueAt } from '../scope/analog';
import { PartFollower, formatQuantity, formatValue } from '../scope/follow';
import { DEFAULT_SPAN, fitAll, followLatest, formatTime, panBy, tickStep, ticks, timeToX, xToTime, zoomAt, type TimeView } from '../scope/timeaxis';
import type { Simulation } from '../simulation';

export const SCOPE_ID = 'scope';

const AXIS_H = 22;
/** Smallest lane height in CSS pixels (more lanes than fit make the canvas scroll). */
const MIN_LANE_H = 56;
const CLICK_SLOP = 3;

/** Canvas colours (one place, for the palette clean-up in docs/FRONTEND.md). */
const COLORS = {
  background: '#18191c',
  laneLine: '#2a2c31',
  axis: '#9aa0aa',
  grid: '#25272c',
  zero: '#3a3d44',
  cursorA: '#4ea1ff',
  cursorB: '#e0a040',
  hover: 'rgba(255, 255, 255, 0.35)',
  text: '#c3c7ce',
};
/** Trace colours, by position in the graphed list. */
const TRACE_COLORS = ['#5fd38d', '#4ea1ff', '#e0a040', '#d070d0', '#e05a5a', '#50c8c8', '#c8c850', '#a0a0ff'];

interface Row {
  element: HTMLElement;
  value: HTMLElement;
  check: HTMLInputElement | null;
  swatch: HTMLElement | null;
}

export class ScopeWindow {
  /** The window's content; DockLayout adopts it whenever the window opens. */
  readonly element = document.createElement('div');
  private readonly title = document.createElement('span');
  private readonly mode = document.createElement('span');
  private readonly pinButton = document.createElement('button');
  private readonly holdButton = document.createElement('button');
  private readonly followButton = document.createElement('button');
  private readonly fitButton = document.createElement('button');
  private readonly clearCursorsButton = document.createElement('button');
  private readonly table = document.createElement('div');
  private readonly plot = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly hint = document.createElement('div');
  private readonly readout = document.createElement('div');
  private readonly ctx: CanvasRenderingContext2D | null;

  private readonly follower = new PartFollower();
  private partId: number | null = null;
  private model: ComponentModel | null = null;
  private info: InspectPart | null = null;
  private modelKey = '';
  private quantities: Quantity[] = [];
  private rows = new Map<string, Row>();
  private rowsKey = '';
  /** Graphed quantity ids per part (session only). */
  private readonly plotted = new Map<number, string[]>();
  private armedKey = '';
  private seenResult: unknown = null;
  private seenVersion = -1;

  private view: TimeView = { start: 0, span: DEFAULT_SPAN };
  private follow = true;
  private holdAt: number | null = null;
  private cursorA: number | null = null;
  private cursorB: number | null = null;
  private hoverX: number | null = null;
  private press: { x: number; lastX: number; moved: boolean; id: number } | null = null;
  private width = 0;
  private dirty = true;
  private frame = 0;

  constructor(
    private readonly scene: Scene,
    private readonly sim: Simulation,
    /** The selected part ids, in the order they were added (GridView.selected). */
    private readonly selected: () => Iterable<number>,
  ) {
    const el = this.element;
    el.className = 'scope-window inspector-window';
    this.ctx = this.canvas.getContext('2d');

    const bar = document.createElement('div');
    bar.className = 'scope-bar';
    this.title.className = 'inspector-title';
    this.mode.className = 'inspector-mode';
    button(this.pinButton, 'Pin to this part', 'Keep showing this part whatever is selected');
    button(this.holdButton, 'Hold', 'Freeze the display (recording goes on)');
    button(this.followButton, 'Latest', 'Follow the newest time while the simulation runs');
    button(this.fitButton, 'Fit', 'Show everything recorded');
    button(this.clearCursorsButton, 'Clear cursors', 'Remove cursors A and B');
    const spacer = document.createElement('span');
    spacer.className = 'serial-spacer';
    bar.append(this.title, this.mode, this.pinButton, spacer, this.clearCursorsButton, this.fitButton, this.followButton, this.holdButton);

    const body = document.createElement('div');
    body.className = 'inspector-body';
    this.table.className = 'inspector-table';
    this.plot.className = 'inspector-plot';
    this.canvas.className = 'scope-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Graph of the part values');
    this.hint.className = 'serial-hint';
    this.plot.append(this.canvas);
    body.append(this.table, this.plot, this.hint);
    this.readout.className = 'scope-readout';
    el.append(bar, body, this.readout);

    this.pinButton.addEventListener('click', () => {
      this.follower.pin(this.follower.pinned === null ? this.partId : null);
      this.update();
    });
    this.holdButton.addEventListener('click', () => {
      this.holdAt = this.holdAt === null ? this.sim.time : null;
      this.invalidate();
      this.update();
    });
    this.followButton.addEventListener('click', () => {
      this.follow = true;
      this.holdAt = null;
      this.view = followLatest(this.view, this.sim.time);
      this.invalidate();
      this.update();
    });
    this.fitButton.addEventListener('click', () => {
      this.follow = false;
      this.view = fitAll(this.holdAt ?? this.sim.time);
      this.invalidate();
      this.update();
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
  }

  /** Call after every frame and when the window opens or closes. Cheap when nothing changed. */
  update(): void {
    const part = this.followedPart();
    if ((part?.id ?? null) !== this.partId) {
      this.partId = part?.id ?? null;
      this.cursorA = this.cursorB = null;
      this.seenResult = null;
      this.dirty = true;
    }
    this.updateModel(part);
    this.updateValues();
    this.updateArming();
    this.updateHeader(part);

    // While time stands still, the shown instant is the newest sample.
    const instant = this.sim.bridge.instant;
    if (!this.sim.timeRunning && instant) this.sim.analog.sample(this.sim.time, instant);
    if (this.sim.analog.version !== this.seenVersion) {
      this.seenVersion = this.sim.analog.version;
      this.dirty = true;
    }
    if (this.follow && this.holdAt === null) {
      const next = followLatest(this.view, this.sim.time);
      if (next.start !== this.view.start) {
        this.view = next;
        this.dirty = true;
      }
    }
    this.holdButton.classList.toggle('scope-on', this.holdAt !== null);
    this.followButton.classList.toggle('scope-on', this.follow && this.holdAt === null);
    if (this.dirty) this.scheduleDraw();
  }

  /** The part to show, or null. Parts without a model (none today) are skipped. */
  private followedPart(): PlacedPart | null {
    const id = this.follower.current(this.selected(), (pid) => {
      const p = this.scene.find(pid);
      return p !== undefined && getPart(p.typeId)?.sim !== undefined;
    });
    return id === null ? null : (this.scene.find(id) ?? null);
  }

  private updateModel(part: PlacedPart | null): void {
    const type = part ? getPart(part.typeId) : undefined;
    const model = part && type?.sim ? type.sim(part.state ?? {}) : null;
    const key = part && model ? `${part.id}|${JSON.stringify(model)}` : '';
    if (key === this.modelKey) return;
    this.modelKey = key;
    this.model = model;
    this.info = part && type
      ? { id: part.id, pins: type.pins, led: part.typeId === 'led', type: part.typeId, burnedBy: part.state?.burnedBy }
      : null;
    this.seenResult = null;
    if (part && model && !this.plotted.has(part.id)) this.plotted.set(part.id, defaultPlot(model));
  }

  /** Recompute the quantities when the result (or the part) changed, and write them into the table. */
  private updateValues(): void {
    const result = this.sim.result;
    if (result === this.seenResult) return;
    this.seenResult = result;
    this.quantities = this.model && this.info && result ? inspect(this.model, result, this.info) : [];
    const key = `${this.partId}|${this.quantities.map((q) => `${q.id}=${q.label}`).join('|')}`;
    if (key !== this.rowsKey) {
      this.rowsKey = key;
      this.buildTable();
    }
    for (const q of this.quantities) {
      const row = this.rows.get(q.id);
      const text = formatQuantity(q);
      if (row && row.value.textContent !== text) row.value.textContent = text;
    }
  }

  /** The graphed ids of the shown part that exist as numbers now. */
  private graphed(): Quantity[] {
    if (this.partId === null) return [];
    const ids = this.plotted.get(this.partId) ?? [];
    return ids.map((id) => this.quantities.find((q) => q.id === id && q.kind !== 'text')).filter((q): q is Quantity => q !== undefined);
  }

  /** Arm exactly the graphed quantities of the shown part while the window is open. */
  private updateArming(): void {
    const open = this.element.isConnected;
    const ids = open && this.partId !== null ? this.graphed().map((q) => q.id) : [];
    const key = ids.length > 0 ? `${this.partId}|${ids.join(',')}` : '';
    if (key === this.armedKey) return;
    this.armedKey = key;
    const analog = this.sim.analog;
    analog.disarmAll();
    if (ids.length === 0 || this.partId === null) return;
    analog.arm(this.partId, ids, (r) => (this.model && this.info ? quantityValues(inspect(this.model, r, this.info)) : new Map()));
    this.dirty = true;
  }

  private updateHeader(part: PlacedPart | null): void {
    const title = part ? partTitle(part) : 'No part selected';
    if (this.title.textContent !== title) this.title.textContent = title;
    const pinned = this.follower.pinned !== null;
    const mode = part ? (pinned ? 'pinned' : 'follows the selection') : '';
    if (this.mode.textContent !== mode) this.mode.textContent = mode;
    const label = pinned ? 'Follow selection' : 'Pin to this part';
    if (this.pinButton.textContent !== label) this.pinButton.textContent = label;
    this.pinButton.title = pinned ? 'Show the selected part again' : 'Keep showing this part whatever is selected';
    this.pinButton.classList.toggle('scope-on', pinned);
    this.pinButton.disabled = !part && !pinned;
    const hint = !part
      ? 'Select a part on the grid to see its values here. With several selected, the last one added is shown.'
      : this.quantities.length === 0
        ? `${getPart(part.typeId)?.name ?? 'This part'} has no values of its own.`
        : '';
    if (this.hint.textContent !== hint) this.hint.textContent = hint;
    this.hint.hidden = hint === '';
  }

  private buildTable(): void {
    this.rows.clear();
    const items: HTMLElement[] = [];
    const header = document.createElement('div');
    header.className = 'scope-list-header inspector-header';
    header.style.height = `${AXIS_H}px`;
    header.textContent = this.quantities.length > 0 ? 'Value · tick to graph' : '';
    items.push(header);
    let inPins = false;
    for (const q of this.quantities) {
      if (q.group === 'pin' && !inPins) {
        inPins = true;
        const group = document.createElement('div');
        group.className = 'inspector-group';
        group.textContent = 'Pin voltages (against the reference)';
        items.push(group);
      }
      const row = this.makeRow(q);
      this.rows.set(q.id, row);
      items.push(row.element);
    }
    this.table.replaceChildren(...items);
    this.updateSwatches();
  }

  private makeRow(q: Quantity): Row {
    const element = document.createElement('label');
    element.className = 'inspector-row';
    element.dataset.quantity = q.id;
    let check: HTMLInputElement | null = null;
    let swatch: HTMLElement | null = null;
    if (q.kind !== 'text') {
      check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'inspector-check';
      check.checked = this.partId !== null && (this.plotted.get(this.partId) ?? []).includes(q.id);
      check.title = `Graph ${q.label}`;
      check.addEventListener('change', () => this.togglePlot(q.id, check!.checked));
      swatch = document.createElement('span');
      swatch.className = 'inspector-swatch';
    } else {
      element.classList.add('inspector-row-text');
    }
    const label = document.createElement('span');
    label.className = 'inspector-label';
    label.textContent = q.label;
    const value = document.createElement('span');
    value.className = 'inspector-value';
    value.textContent = formatQuantity(q);
    element.append(check ?? document.createElement('span'), swatch ?? document.createElement('span'), label, value);
    return { element, value, check, swatch };
  }

  private togglePlot(id: string, on: boolean): void {
    if (this.partId === null) return;
    const current = this.plotted.get(this.partId) ?? [];
    // Keep the table's order, so colours and lanes follow the list.
    const wanted = new Set(on ? [...current, id] : current.filter((x) => x !== id));
    this.plotted.set(this.partId, this.quantities.map((q) => q.id).filter((x) => wanted.has(x)));
    this.updateArming();
    this.updateSwatches();
    this.invalidate();
  }

  private updateSwatches(): void {
    const graphed = this.graphed().map((q) => q.id);
    for (const [id, row] of this.rows) {
      if (!row.swatch) continue;
      const i = graphed.indexOf(id);
      row.swatch.style.background = i >= 0 ? TRACE_COLORS[i % TRACE_COLORS.length] : 'transparent';
      if (row.check) row.check.checked = i >= 0;
    }
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

  // ---- Drawing ----

  private draw(): void {
    const ctx = this.ctx;
    const width = this.plot.clientWidth;
    const traces = this.graphed();
    const height = Math.max(this.plot.clientHeight, AXIS_H + Math.max(1, traces.length) * MIN_LANE_H);
    if (!ctx || !this.element.isConnected || width === 0 || this.plot.clientHeight === 0) return; // hidden: drawn when shown
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

    if (this.partId !== null && traces.length === 0 && this.quantities.length > 0) {
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'center';
      ctx.fillText('Tick values in the table to graph them', width / 2, AXIS_H + (height - AXIS_H) / 2);
      ctx.textAlign = 'left';
    }
    const laneH = (height - AXIS_H) / Math.max(1, traces.length);
    traces.forEach((q, i) => this.drawLane(ctx, q, i, AXIS_H + i * laneH, laneH, width));
    this.drawCursors(ctx, width, height);
    this.updateReadout();
  }

  private drawLane(ctx: CanvasRenderingContext2D, q: Quantity, index: number, top: number, laneH: number, width: number): void {
    const color = TRACE_COLORS[index % TRACE_COLORS.length];
    ctx.fillStyle = COLORS.laneLine;
    ctx.fillRect(0, Math.round(top + laneH) - 1, width, 1);
    const label = `${q.label}  ${formatQuantity(q)}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(label, 6, top + 9);
    const trace = this.partId === null ? undefined : this.sim.analog.trace(this.partId, q.id);
    if (!trace || trace.length === 0) return;
    const until = this.holdAt ?? Infinity;
    const cols = columns(trace, this.view, width, until);
    const now = Math.min(this.sim.time, until);
    const lastIndex = trace.indexAt(until);
    const lastValue = lastIndex >= 0 ? trace.value(lastIndex) : NaN;
    const range = autoRange(cols.length > 0 ? cols : Number.isFinite(lastValue) ? [{ x: -1, first: lastValue, last: lastValue, min: lastValue, max: lastValue }] : []);
    if (!range) return;
    const y0 = top + 18;
    const hh = Math.max(4, laneH - 24);
    const y = (v: number): number => y0 + (1 - (v - range.min) / (range.max - range.min)) * hh;
    // Range labels and the zero line.
    ctx.fillStyle = COLORS.axis;
    ctx.textAlign = 'right';
    ctx.fillText(formatValue(q, range.max), width - 4, y0 + 5);
    ctx.fillText(formatValue(q, range.min), width - 4, y0 + hh - 5);
    if (range.min < 0 && range.max > 0) {
      ctx.fillStyle = COLORS.zero;
      ctx.fillRect(0, Math.round(y(0)), width, 1);
    }
    ctx.textAlign = 'left';
    // The trace: per pixel column, entry, min..max and exit.
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    let started = false;
    let lastX = 0;
    let lastY = 0;
    for (const c of cols) {
      const x = c.x < 0 ? 0 : c.x + 0.5;
      if (!started) {
        ctx.moveTo(x, y(c.first));
        started = true;
      } else ctx.lineTo(x, y(c.first));
      if (c.min < c.max) {
        ctx.lineTo(x, y(c.min));
        ctx.lineTo(x, y(c.max));
      }
      ctx.lineTo(x, y(c.last));
      lastX = x;
      lastY = y(c.last);
    }
    // The newest value holds until now; while time stands still, dashed to the right edge.
    if (Number.isFinite(lastValue)) {
      const xNow = Math.min(width, timeToX(this.view, width, now));
      if (!started) {
        lastX = Math.max(0, Math.min(width, timeToX(this.view, width, trace.time(Math.max(0, lastIndex)))));
        lastY = y(lastValue);
        ctx.moveTo(lastX, lastY);
        started = true;
      }
      if (xNow > lastX) ctx.lineTo(xNow, lastY);
      ctx.stroke();
      if (!this.sim.timeRunning && this.holdAt === null && xNow < width) {
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(Math.max(lastX, xNow, 0), lastY);
        ctx.lineTo(width, lastY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else ctx.stroke();
  }

  private drawCursors(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const line = (t: number | null, color: string, label: string): void => {
      if (t === null) return;
      const x = Math.round(timeToX(this.view, width, t)) + 0.5;
      if (x < 0 || x > width) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
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
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(this.hoverX) + 0.5, AXIS_H);
      ctx.lineTo(Math.round(this.hoverX) + 0.5, height);
      ctx.stroke();
    }
  }

  /** The line under the graph: cursors with each trace's values and deltas, and the values under the pointer. */
  private updateReadout(): void {
    const parts: string[] = [];
    const traces = this.graphed();
    const at = (q: Quantity, t: number): number => {
      const trace = this.partId === null ? undefined : this.sim.analog.trace(this.partId, q.id);
      return trace && t <= Math.min(this.sim.time, this.holdAt ?? Infinity) + 1e-12 ? valueAt(trace, t) : NaN;
    };
    const { cursorA: a, cursorB: b } = this;
    if (a !== null) parts.push(`A ${formatTime(a)}`);
    if (b !== null) parts.push(`B ${formatTime(b)}`);
    if (a !== null && b !== null) {
      parts.push(`Δt ${formatTime(Math.abs(b - a))}`);
      for (const q of traces) {
        const va = at(q, a);
        const vb = at(q, b);
        parts.push(`${q.label}: A ${formatValue(q, va)} B ${formatValue(q, vb)} Δ ${formatValue(q, vb - va)}`);
      }
    } else if (a !== null) {
      for (const q of traces) parts.push(`${q.label}: ${formatValue(q, at(q, a))}`);
    }
    if (this.hoverX !== null && this.width > 0) {
      const t = xToTime(this.view, this.width, this.hoverX);
      parts.push(`t ${formatTime(t)}`, ...traces.map((q) => `${q.label} ${formatValue(q, at(q, t))}`));
    }
    if (parts.length === 0 && traces.length > 0) parts.push('Click to place cursors A and B · wheel zooms · drag pans');
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

/** Header name of a part: a board's label, else the type name and the part id ("NPN transistor (BC547) #5"). */
export function partTitle(part: PlacedPart): string {
  if (isBoardPart(part)) return boardLabelWithId(part);
  return `${getPart(part.typeId)?.name ?? part.typeId} #${part.id}`;
}

function button(b: HTMLButtonElement, text: string, title: string): void {
  b.type = 'button';
  b.className = 'serial-button';
  b.textContent = text;
  b.title = title;
}
