// The color of a normal LED: the color maths, the electrical model per color, the part
// (variant, glow, chip text, bar button), the picker's wheel maths, save / load, undo.

import { describe, expect, it } from 'vitest';
import { ledColorSvg } from './art/led';
import { toolbarButtons } from './boardcontrols';
import { hsToPoint, pointToHs } from './coloredit';
import {
  LED_DEFAULT_COLOR, hexToHs, hsToHex, hsToRgb, isLedColor, ledColorName, ledColorOf, ledForwardVolts, ledModelOf, ledPalette,
} from './ledcolor';
import { getPart } from './parts';
import { selectionLabel } from './partlabel';
import { stringifyProject } from './project/format';
import { editKey } from './project/history';
import { Project } from './project/project';
import { readProject } from './project/read';
import { RED_LED, solveCircuit, type ComponentModel, type SimInput } from './sim';

describe('color maths', () => {
  it('turns hue and saturation into rgb at full brightness (the six corners and white)', () => {
    expect(hsToRgb(0, 1)).toEqual([255, 0, 0]);
    expect(hsToRgb(60, 1)).toEqual([255, 255, 0]);
    expect(hsToRgb(120, 1)).toEqual([0, 255, 0]);
    expect(hsToRgb(180, 1)).toEqual([0, 255, 255]);
    expect(hsToRgb(240, 1)).toEqual([0, 0, 255]);
    expect(hsToRgb(300, 1)).toEqual([255, 0, 255]);
    expect(hsToRgb(360, 1)).toEqual([255, 0, 0]);
    expect(hsToRgb(77, 0)).toEqual([255, 255, 255]);
    expect(hsToRgb(0, 0.5)).toEqual([255, 128, 128]);
  });

  it('round-trips through "#rrggbb"', () => {
    expect(hsToHex(210, 1)).toBe('#0080ff');
    for (const hue of [0, 17, 60, 119, 180, 233, 300, 351]) {
      for (const sat of [0.3, 0.7, 1]) {
        const back = hexToHs(hsToHex(hue, sat));
        expect(Math.abs(back.hue - hue)).toBeLessThan(1.2);
        expect(back.sat).toBeCloseTo(sat, 1);
      }
    }
    expect(hexToHs('#ffffff').sat).toBe(0);
    expect(hexToHs('#000000')).toEqual({ hue: 0, sat: 0 });
  });

  it('accepts only lower-case "#rrggbb" as a color', () => {
    expect(isLedColor('#3da5ff')).toBe(true);
    expect(isLedColor('#3DA5FF')).toBe(false);
    expect(isLedColor('#3da5f')).toBe(false);
    expect(isLedColor('red')).toBe(false);
    expect(isLedColor(12)).toBe(false);
    expect(isLedColor(undefined)).toBe(false);
  });

  it('names the colors for the chip; the default is Red; a bad value reads as the default', () => {
    expect(ledColorName(undefined)).toBe('Red');
    expect(ledColorName(LED_DEFAULT_COLOR)).toBe('Red');
    expect(ledColorName('#ffa500')).toBe('Orange');
    expect(ledColorName('#ffe600')).toBe('Yellow');
    expect(ledColorName('#00ff00')).toBe('Green');
    expect(ledColorName('#00ffff')).toBe('Cyan');
    expect(ledColorName('#0066ff')).toBe('Blue');
    expect(ledColorName('#9933ff')).toBe('Purple');
    expect(ledColorName('#ff40a0')).toBe('Pink');
    expect(ledColorName('#f0f0f0')).toBe('White');
    expect(ledColorName('nonsense')).toBe('Red');
    expect(ledColorOf('nonsense')).toEqual(hexToHs(LED_DEFAULT_COLOR));
  });
});

describe('forward voltage by color', () => {
  it('red, yellow and green are about 2 V, blue and white about 3.2 V, between them in between', () => {
    expect(ledForwardVolts({ hue: 0, sat: 1 })).toBeCloseTo(2.0, 6);
    expect(ledForwardVolts({ hue: 60, sat: 1 })).toBeCloseTo(2.1, 6);
    expect(ledForwardVolts({ hue: 120, sat: 1 })).toBeCloseTo(2.3, 6);
    expect(ledForwardVolts({ hue: 240, sat: 1 })).toBeCloseTo(3.2, 6);
    expect(ledForwardVolts({ hue: 90, sat: 0 })).toBeCloseTo(3.2, 6); // pale = white LED
    expect(ledForwardVolts({ hue: 0, sat: 0.5 })).toBeCloseTo(2.6, 6);
    expect(ledForwardVolts({ hue: 180, sat: 1 })).toBeGreaterThan(3.0);
    expect(ledForwardVolts({ hue: 360, sat: 1 })).toBeCloseTo(2.0, 6);
    expect(ledForwardVolts({ hue: -120, sat: 1 })).toBeCloseTo(ledForwardVolts({ hue: 240, sat: 1 }), 6);
  });

  it('the default is exactly the red LED model; a color puts its voltage across it at 20 mA', () => {
    expect(ledModelOf(undefined)).toBe(RED_LED);
    expect(ledModelOf('bad')).toBe(RED_LED);
    const blue = ledModelOf('#0000ff') as Extract<ComponentModel, { kind: 'diode' }>;
    const input: SimInput = {
      components: [
        { id: 1, model: { kind: 'battery', volts: 5, rInternal: 0 } },
        { id: 2, model: { kind: 'resistor', ohms: 100 } },
        { id: 3, model: blue },
        { id: 4, model: { kind: 'ground' } },
      ],
      links: [
        [{ part: 1, pin: 'neg' }, { part: 4, pin: 'gnd' }], [{ part: 1, pin: 'pos' }, { part: 2, pin: 'a' }],
        [{ part: 2, pin: 'b' }, { part: 3, pin: 'anode' }], [{ part: 3, pin: 'cathode' }, { part: 4, pin: 'gnd' }],
      ],
    };
    const r = solveCircuit(input);
    expect(r.converged).toBe(true);
    // Hand check: 3.2 V at 20 mA, so a little more than 3.2 V at the 18 mA that 5 V / 100 ohm leaves it.
    const i = r.parts[3].current;
    expect(r.parts[3].voltage).toBeCloseTo(3.2 + 2 * 0.025852 * Math.log(i / 0.02) + 2.5 * (i - 0.02), 3);
    expect(i).toBeGreaterThan(0.017);
    expect(i).toBeLessThan(0.019);
  });
});

describe('the LED part with a color', () => {
  const led = () => getPart('led')!;

  it('is colorable; no color means the plain red art and model', () => {
    expect(led().colorable).toBe(true);
    expect(led().variant!({})).toBeNull();
    expect(led().sim!({})).toBe(RED_LED);
    expect(getPart('resistor')!.colorable).toBeUndefined();
  });

  it('a color has its own art (keyed by the color), its own model; burned still wins', () => {
    const v = led().variant!({ color: '#3da5ff' })!;
    expect(v.key).toBe('color:#3da5ff');
    expect(v.svg).toBe(ledColorSvg(hexToHs('#3da5ff')));
    expect(v.svg).not.toBe(led().svg);
    expect(v.svg).toContain('<circle cx="40"'); // the polarity badges stay
    expect(led().sim!({ color: '#3da5ff' })).toEqual(ledModelOf('#3da5ff'));
    expect(led().variant!({ color: '#3da5ff', burned: true })!.key).toBe('burned');
    expect(led().sim!({ color: '#3da5ff', burned: true })).toEqual({ kind: 'open' });
  });

  it('the art palette follows the hue: the red default recipe at red, bluish at blue', () => {
    const red = ledPalette(hexToHs(LED_DEFAULT_COLOR));
    expect(red.epoxy[1]).toMatch(/^#d4[0-9a-f]{4}$/); // about #d42b22, the hand-picked red
    const blue = ledPalette({ hue: 225, sat: 1 });
    const [r, , b] = [1, 3, 5].map((k) => parseInt(blue.epoxy[1].slice(k, k + 2), 16));
    expect(b).toBeGreaterThan(r + 80);
  });

  it('the chip shows the color name and the bar offers the picker', () => {
    const placed = (color?: string) => ({ id: 1, typeId: 'led', col: 0, row: 0, rotation: 0 as const, ...(color ? { state: { color } } : {}) });
    expect(selectionLabel([placed()])).toEqual({ title: 'LED', value: 'Red' });
    expect(selectionLabel([placed('#00ff00')])).toEqual({ title: 'LED', value: 'Green' });
    expect(toolbarButtons([placed()], () => 'stopped' as never).edit).toBe(true);
  });
});

describe('the picker wheel', () => {
  it('reads the angle as the hue (0 at the top, clockwise) and the distance as the saturation', () => {
    expect(pointToHs(0, -50, 50)).toEqual({ hue: 0, sat: 1 }); // top, at the rim
    expect(pointToHs(50, 0, 50).hue).toBeCloseTo(90, 9); // right
    expect(pointToHs(0, 50, 50).hue).toBeCloseTo(180, 9); // bottom
    expect(pointToHs(-50, 0, 50).hue).toBeCloseTo(270, 9); // left
    expect(pointToHs(0, -25, 50).sat).toBeCloseTo(0.5, 9);
    expect(pointToHs(400, 0, 50).sat).toBe(1); // dragged far outside: stays at the rim
    expect(pointToHs(1, 1, 50).sat).toBe(0); // the middle snaps to white
  });

  it('puts the bubble back where the color was picked', () => {
    for (const hs of [{ hue: 0, sat: 1 }, { hue: 90, sat: 0.5 }, { hue: 200, sat: 0.8 }, { hue: 333, sat: 0.3 }]) {
      const p = hsToPoint(hs, 60);
      const back = pointToHs(p.x, p.y, 60);
      expect(back.hue).toBeCloseTo(hs.hue, 6);
      expect(back.sat).toBeCloseTo(hs.sat, 6);
    }
    expect(hsToPoint({ hue: 0, sat: 1 }, 60).y).toBeCloseTo(-60, 9);
    expect(Math.hypot(hsToPoint({ hue: 123, sat: 0 }, 60).x, hsToPoint({ hue: 123, sat: 0 }, 60).y)).toBe(0);
  });

  it('what the wheel shows is what the LED gets: the white overlay fades linearly, like saturation', () => {
    // At radius r (0..1) of a hue the wheel shows hue color * r + white * (1 - r), which is the saturation r.
    const [r, g, b] = hsToRgb(0, 0.4);
    expect([r, g, b]).toEqual([255, 153, 153]);
    expect(hsToHex(0, 0.4)).toBe('#ff9999');
  });
});

describe('saving, loading and undo of the color', () => {
  const place = (color?: string) => {
    const p = new Project();
    const led = p.scene.add({ typeId: 'led', col: 0, row: 0, rotation: 0, ...(color ? { state: { color } } : {}) });
    return { p, led };
  };

  it('round-trips a color, and a default LED saves no color', () => {
    const { p } = place('#3da5ff');
    const first = p.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
    expect(b.scene.parts[0].state).toEqual({ color: '#3da5ff' });
    expect(stringifyProject(place().p.serialize())).not.toContain('color');
  });

  it('rejects a color that is not "#rrggbb", or on a part that has none', () => {
    const doc = JSON.parse(stringifyProject(place('#3da5ff').p.serialize()));
    const bad = (state: object, typeId = 'led') => () => {
      const d = JSON.parse(JSON.stringify(doc));
      d.parts[0].state = state;
      d.parts[0].typeId = typeId;
      readProject(JSON.stringify(d));
    };
    expect(bad({ color: 'blue' })).toThrow(/color/);
    expect(bad({ color: '#3DA5FF' })).toThrow(/color/);
    expect(bad({ color: 5 })).toThrow(/color/);
    expect(bad({ color: '#3da5ff' }, 'resistor')).toThrow(/only allowed on LEDs/);
    expect(bad({ color: '#3da5ff' }, 'rgbled')).toThrow(/only allowed on LEDs/);
    expect(bad({ color: '#3da5ff' })).not.toThrow();
  });

  it('a new color is an edit (an undo step) and changes the circuit the simulation sees', () => {
    const { p, led } = place();
    const before = editKey(p.circuit());
    p.scene.find(led.id)!.state = { color: '#00ff00' };
    expect(editKey(p.circuit())).not.toBe(before);
  });
});
