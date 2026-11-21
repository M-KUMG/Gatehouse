import { describe, expect, it } from 'vitest';
import { parseIntelHex } from '../mcu/hex';
import { UNO_IO, UnoEmulator } from '../mcu/avr/uno';
import { boardClockHz, CLOCK_CHOICES, DEFAULT_CLOCK_HZ, formatClock } from '../mcu/clock';
import { BLINK_HEX } from '../mcu/programs/blink';
import { setBoardClock } from './boardfiles';
import { projectFromBytes, projectToGth } from './diskfile';
import { stringifyProject } from './format';
import { Project } from './project';
import { readProject } from './read';
import { buildInput } from '../simulation';

const add = (p: Project, typeId = 'uno', col = 0) => p.scene.add({ typeId, col, row: 0, rotation: 0 });

describe('clock choices', () => {
  it('formats and defaults', () => {
    expect(CLOCK_CHOICES.map(formatClock)).toEqual(['1 MHz', '8 MHz', '16 MHz', '20 MHz']);
    expect(boardClockHz({})).toBe(DEFAULT_CLOCK_HZ);
    expect(boardClockHz({ state: { clockHz: 8_000_000 } })).toBe(8_000_000);
    expect(boardClockHz({ state: { clockHz: 12_345 } })).toBe(DEFAULT_CLOCK_HZ); // not a choice
  });
});

describe('setBoardClock', () => {
  it('stores a choice, stores the default as no value, keeps other state', () => {
    const p = new Project();
    const a = add(p);
    expect(setBoardClock(p, a.id, 8_000_000)).toEqual({ ok: true });
    expect(a.state).toEqual({ clockHz: 8_000_000 });
    a.state = { ...a.state, name: 'X' };
    expect(setBoardClock(p, a.id, DEFAULT_CLOCK_HZ)).toEqual({ ok: true });
    expect(a.state).toEqual({ name: 'X' });
    a.state = {};
    setBoardClock(p, a.id, 1_000_000);
    setBoardClock(p, a.id, DEFAULT_CLOCK_HZ);
    expect(a.state).toBeUndefined();
  });

  it('refuses unknown speeds, unknown boards and parts that are not boards', () => {
    const p = new Project();
    const a = add(p);
    expect(setBoardClock(p, a.id, 12_345)).toMatchObject({ ok: false });
    expect(setBoardClock(p, 999, 8_000_000)).toMatchObject({ ok: false });
    const r = add(p, 'resistor');
    expect(setBoardClock(p, r.id, 8_000_000)).toMatchObject({ ok: false });
    expect(a.state).toBeUndefined();
  });

  it('marks the project changed once, and not for an unchanged clock', () => {
    const p = new Project();
    const a = add(p);
    p.markSaved();
    let changes = 0;
    p.onChange(() => changes++);
    setBoardClock(p, a.id, 8_000_000);
    setBoardClock(p, a.id, 8_000_000);
    expect(changes).toBe(1);
  });

  it('reaches the build input, which the runtime reads when the board starts', () => {
    const p = new Project();
    const a = add(p);
    expect(buildInput(p.scene, a.id)?.clockHz).toBe(DEFAULT_CLOCK_HZ);
    setBoardClock(p, a.id, 1_000_000);
    expect(buildInput(p.scene, a.id)?.clockHz).toBe(1_000_000);
  });
});

describe('saving the clock', () => {
  const setup = () => {
    const p = new Project();
    setBoardClock(p, add(p).id, 8_000_000);
    add(p, 'uno', 30);
    return p;
  };

  it('round-trips through JSON and .gth', () => {
    const file = setup().serialize();
    const text = stringifyProject(file);
    expect(text).toContain('"clockHz": 8000000');
    expect(readProject(text)).toEqual(file);
    expect(projectFromBytes('c.gth', projectToGth({ ...file, name: 'c' })).file.parts.map((x) => x.state?.clockHz)).toEqual([8_000_000, undefined]);
  });

  it('refuses a clock that is not a choice, or on a part that is not a board', () => {
    const p = setup();
    p.scene.add({ typeId: 'resistor', col: 60, row: 0, rotation: 0 });
    const doc = JSON.parse(stringifyProject(p.serialize()));
    doc.parts[0].state.clockHz = 12_345;
    expect(() => readProject(JSON.stringify(doc))).toThrow(/clockHz must be one of/);
    doc.parts[0].state.clockHz = 8_000_000;
    doc.parts[2].state = { clockHz: 8_000_000 };
    expect(() => readProject(JSON.stringify(doc))).toThrow(/only allowed on boards/);
  });
});

describe('the emulated chip runs at the board clock', () => {
  const D13 = UNO_IO.findIndex((p) => p.id === 'd13');

  /** Simulated seconds Blink keeps the LED on (its delay(1000)): pin 13 goes low (pinMode), high, low. */
  function onTime(clockHz: number | undefined): number {
    const uno = new UnoEmulator(parseIntelHex(BLINK_HEX, 32 * 1024).bytes, { clockHz });
    let last = uno.drives()[D13];
    const edges: number[] = [];
    const slice = uno.clockHz / 1000;
    for (let i = 0; i < 6000 && edges.length < 3; i++) {
      for (const e of uno.run(slice).events) {
        if (e.drives[D13] !== last) {
          last = e.drives[D13];
          edges.push(e.cycle / uno.clockHz);
        }
      }
    }
    return edges[2] - edges[1];
  }

  it('reports the clock and defaults to 16 MHz', () => {
    expect(new UnoEmulator(parseIntelHex(BLINK_HEX, 32 * 1024).bytes).clockHz).toBe(16_000_000);
    expect(new UnoEmulator(parseIntelHex(BLINK_HEX, 32 * 1024).bytes, { clockHz: 8_000_000 }).clockHz).toBe(8_000_000);
  });

  it('firmware built for 16 MHz takes twice as long at 8 MHz (delay(1000) counts timer ticks)', () => {
    expect(onTime(undefined)).toBeCloseTo(1, 1);
    expect(onTime(8_000_000)).toBeCloseTo(2, 1);
  });
});
