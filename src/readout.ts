// Small tooltip next to the cursor with live values of the hovered part,
// pin or wire.

import { formatSI } from './format';
import type { JunctionRef, PlacedPart, Wire } from './model';
import { getPart, partWarning } from './parts';
import type { Pin } from './pins';
import type { Simulation } from './simulation';

export interface ReadoutText {
  title: string;
  lines: string[];
  warning?: string;
}

export function describePart(part: PlacedPart, sim: Simulation): ReadoutText | null {
  const type = getPart(part.typeId);
  if (!type) return null;
  const state = part.state ?? {};
  const facts: string[] = [];
  const value = type.value ? state[type.value.key ?? 'value'] : undefined;
  if (type.value && value !== undefined) facts.push(formatSI(value, type.value.unit));
  if (type.control === 'knob') facts.push(`wiper ${Math.round((state.position ?? 0.5) * 100)} %`);
  if (type.control === 'toggle' || type.control === 'momentary') facts.push(state.closed ? 'closed' : 'open');
  const text: ReadoutText = { title: [type.name, ...facts].join(' · '), lines: [] };

  if (state.burned) {
    text.warning = `Burned out by ${state.burnedBy ?? 'too much current'}. Click it to replace it.`;
    return text;
  }
  const r = sim.partResult(part.id);
  if (!r || !sim.result?.converged) return text;
  if (type.readout) {
    text.lines.push(...type.readout(r));
  } else if (type.board) {
    text.lines.push(`USB ${formatSI(r.voltage, 'V')} · ${formatSI(r.current, 'A')} out`, 'GND is the 0 V reference');
  } else if ('gnd' in r.pins || type.pins.length === 1) {
    text.lines.push('0 V reference');
  } else if ('c' in r.pins) {
    text.lines.push(`Ic ${formatSI(r.pins.c, 'A')} · Ib ${formatSI(r.pins.b, 'A')}`, `Vce ${formatSI(r.voltage, 'V')}`);
  } else if ('pos' in r.pins) {
    text.lines.push(`${formatSI(r.voltage, 'V')} · ${formatSI(r.current, 'A')} out`);
  } else {
    text.lines.push(`${formatSI(Math.abs(r.voltage), 'V')} · ${formatSI(Math.abs(r.current), 'A')}`, formatSI(r.power, 'W'));
  }
  const warning = partWarning(type, r, state);
  if (warning !== null) text.warning = warning;
  return text;
}

export function describePin(pin: Pin, sim: Simulation): ReadoutText {
  const volts = sim.pinVoltage(pin.ref);
  return {
    title: `${getPart(pin.part.typeId)?.name ?? 'Part'} · pin ${pin.def.name}`,
    lines: volts === undefined ? [] : [formatSI(volts, 'V')],
  };
}

export function describeJunction(end: JunctionRef, sim: Simulation): ReadoutText {
  const volts = sim.pinVoltage(end);
  return { title: 'Wire junction', lines: volts === undefined ? [] : [formatSI(volts, 'V')] };
}

export function describeWire(wire: Wire, sim: Simulation): ReadoutText {
  const volts = sim.pinVoltage(wire.from);
  const amps = Math.abs(sim.wireCurrent(wire.id));
  const lines = volts === undefined ? [] : [amps > 0 ? `${formatSI(volts, 'V')} · ${formatSI(amps, 'A')}` : formatSI(volts, 'V')];
  return { title: 'Wire', lines };
}

export class Readout {
  private readonly el = document.createElement('div');
  private shown = '';

  /** `bounds`: the viewport rectangle to keep the tooltip inside (the grid's canvas). */
  constructor(private readonly bounds: () => DOMRect) {
    this.el.className = 'readout';
    this.el.style.display = 'none';
    document.body.appendChild(this.el);
  }

  /** Show the text beside a viewport point, or hide with null. */
  show(text: ReadoutText | null, clientX = 0, clientY = 0): void {
    const el = this.el;
    if (!text) {
      if (this.shown !== '') el.style.display = 'none';
      this.shown = '';
      return;
    }
    const key = JSON.stringify(text);
    if (key !== this.shown) {
      this.shown = key;
      el.replaceChildren(
        line('readout-title', text.title),
        ...text.lines.map((l) => line('', l)),
        ...(text.warning ? [line('readout-warning', text.warning)] : []),
      );
      el.style.display = '';
    }
    const area = this.bounds();
    const left = Math.min(clientX + 16, area.right - el.offsetWidth - 8);
    const top = Math.min(clientY + 18, area.bottom - el.offsetHeight - 8);
    el.style.left = `${Math.max(area.left + 8, left)}px`;
    el.style.top = `${Math.max(area.top + 8, top)}px`;
  }
}

function line(className: string, text: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  return div;
}
