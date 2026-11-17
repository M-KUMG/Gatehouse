import { describe, expect, it } from 'vitest';
import { parseIntelHex } from '../hex';
import { BLINK_HEX } from '../programs/blink';
import { UNO_CLOCK_HZ, UNO_IO, UnoEmulator } from './uno';

const D13 = UNO_IO.findIndex((p) => p.id === 'd13');

/** Run the Blink program for `seconds`; returns pin 13's changes (in seconds) and the serial text. */
function runBlink(seconds: number): { edges: { t: number; level: string }[]; serial: string } {
  const uno = new UnoEmulator(parseIntelHex(BLINK_HEX, 32 * 1024).bytes);
  const edges: { t: number; level: string }[] = [];
  let serial = '';
  let last = uno.drives()[D13];
  const slice = UNO_CLOCK_HZ / 1000;
  for (let i = 0; i < seconds * 1000; i++) {
    const r = uno.run(slice);
    for (const e of r.events) {
      if (e.drives[D13] !== last) edges.push({ t: e.cycle / UNO_CLOCK_HZ, level: (last = e.drives[D13]) });
    }
    serial += String.fromCharCode(...(r.serial.usart0 ?? []));
  }
  return { edges, serial };
}

describe('Arduino Uno emulator', () => {
  it('starts with every pin as an input', () => {
    const uno = new UnoEmulator(parseIntelHex(BLINK_HEX, 32 * 1024).bytes);
    expect(uno.drives()).toBe('Z'.repeat(20));
    expect(uno.cycles).toBe(0);
  });

  it('runs Blink: pin 13 toggles every 1000 ms of simulated (cycle-counted) time', () => {
    const { edges, serial } = runBlink(3.5);
    // Output low as soon as pinMode runs, then high/low every second.
    expect(edges.map((e) => e.level).join('')).toBe('LHLHL');
    const rise = edges[1].t;
    // The start-up message (22 characters at 9600 baud, ~23 ms) comes first.
    expect(rise).toBeGreaterThan(0.015);
    expect(rise).toBeLessThan(0.03);
    for (let k = 2; k < edges.length; k++) {
      expect(edges[k].t - rise).toBeCloseTo(k - 1, 2); // within 5 ms per period
    }
    expect(serial).toBe('Blink: LED on pin 13\r\nLED on\r\nLED off\r\nLED on\r\nLED off\r\n');
  });

  it('is deterministic: the same program gives the same cycle-exact edges', () => {
    expect(runBlink(2.1)).toEqual(runBlink(2.1));
  });
});
