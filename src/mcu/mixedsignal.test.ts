import { assemble } from 'avr8js/dist/esm/utils/assembler';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../examples';
import { Scene } from '../model';
import { RED_LED, type SimInput } from '../sim';
import { boardParts, buildNetlist } from '../simulation';
import { UNO_ELECTRICAL, UNO_IO, UNO_SPEC, UnoEmulator } from './avr/uno';
import type { BoardEmulator, BoardInputs, SliceResult } from './board';
import { MixedSignal, SLICE_SECONDS, type BoardSlot } from './mixedsignal';
import { BoardRuntimes } from './runtime';

const UNO = 1;
const RES = 2;
const LED = 3;
const pin = (s: string) => ({ part: Number(s.split('.')[0]), pin: s.split('.')[1] });

/** Uno pin `from` -> resistor -> LED -> Uno gnd. */
function ledCircuit(from: string, ohms: number): SimInput {
  return {
    components: [
      { id: UNO, model: { kind: 'board', rails: { ...UNO_ELECTRICAL.rails }, io: {} } },
      { id: RES, model: { kind: 'resistor', ohms } },
      { id: LED, model: RED_LED },
    ],
    links: [
      [pin(`1.${from}`), pin('2.a')],
      [pin('2.b'), pin('3.anode')],
      [pin('3.cathode'), pin('1.gnd')],
    ],
  };
}

/** A board whose pins follow a script: `pattern(t)` gives the drive codes at simulated time t. */
class ScriptedBoard implements BoardEmulator {
  readonly clockHz = 1_000_000;
  readonly io = UNO_IO;
  readonly electrical = UNO_ELECTRICAL;
  cycles = 0;
  inputs: BoardInputs | null = null;
  constructor(private readonly pattern: (t: number) => string) {}
  drives(): string {
    return this.pattern(this.cycles / this.clockHz);
  }
  run(cycles: number): SliceResult {
    const start = this.cycles;
    const result: SliceResult = { start, end: start + cycles, drives: this.drives(), events: [], serial: {} };
    let last = result.drives;
    for (let c = start + 1; c <= start + cycles; c++) {
      this.cycles = c;
      const now = this.drives();
      if (now !== last) result.events.push({ cycle: c, drives: (last = now) });
    }
    return result;
  }
  setInputs(inputs: BoardInputs): void {
    this.inputs = inputs;
  }
  serialBaud(): number | null {
    return null;
  }
}

const D13 = UNO_IO.findIndex((p) => p.id === 'd13');
const withPin = (index: number, code: string): string => 'Z'.repeat(index) + code + 'Z'.repeat(UNO_IO.length - index - 1);

function slot(emulator: BoardEmulator | null, running = true): BoardSlot {
  return { partId: UNO, io: UNO_IO, electrical: UNO_ELECTRICAL, emulator, running };
}

/** LED current by hand: I = (5 V - Vled(I)) / (25 + R), Vled from the same diode law, iterated. */
function handLedCurrent(ohms: number): number {
  const { is, n, rs } = RED_LED as { is: number; n: number; rs: number };
  const nvt = n * 0.025852;
  let i = 0.01;
  for (let k = 0; k < 50; k++) i = (5 - (nvt * Math.log(i / is + 1) + i * rs)) / (UNO_ELECTRICAL.outputOhms + ohms);
  return i;
}

describe('mixed-signal bridge', () => {
  it('an output-high pin drives the LED with the hand-calculated current', () => {
    const ms = new MixedSignal();
    ms.setCircuit(ledCircuit('d13', 220), [slot(new ScriptedBoard(() => withPin(D13, 'H')))]);
    const expected = handLedCurrent(220);
    expect(expected).toBeGreaterThan(0.0122);
    expect(expected).toBeLessThan(0.0126); // about 12.4 mA
    const r = ms.result!;
    expect(r.converged).toBe(true);
    expect(r.parts[LED].current).toBeCloseTo(expected, 4);
    expect(Math.abs(r.parts[LED].current - expected) / expected).toBeLessThan(0.02);
    // The pin sags by I * 25 ohm; the 5 V rail does not.
    expect(r.parts[UNO].volts?.d13).toBeCloseTo(5 - expected * 25, 3);
    expect(r.parts[UNO].volts?.['5v']).toBeCloseTo(5, 3);
    // The pin sources the current that the gnd pin takes back.
    expect(r.parts[UNO].pins.d13).toBeCloseTo(-expected, 6);
    expect(r.parts[UNO].pins.gnd).toBeCloseTo(expected, 6);
  });

  it('an output-low or input pin leaves the LED dark', () => {
    for (const code of ['L', 'Z', 'P']) {
      const ms = new MixedSignal();
      ms.setCircuit(ledCircuit('d13', 220), [slot(new ScriptedBoard(() => withPin(D13, code)))]);
      // A pull-up (30 kohm) gives only microamps.
      expect(ms.result!.parts[LED].current).toBeLessThan(code === 'P' ? 2e-4 : 1e-9);
    }
  });

  it('the board 5 V pin powers a circuit by itself', () => {
    const ms = new MixedSignal();
    ms.setCircuit(ledCircuit('5v', 330), [slot(null)]);
    expect(ms.result!.reference).toBe('ground');
    expect(ms.result!.parts[LED].current).toBeGreaterThan(0.008);
  });

  it('averages PWM to its duty cycle instead of flickering', () => {
    // 500 Hz, 25 % high.
    const pwm = (t: number): string => withPin(D13, (t * 500) % 1 < 0.25 ? 'H' : 'L');
    const ms = new MixedSignal();
    ms.setCircuit(ledCircuit('d13', 220), [slot(new ScriptedBoard(pwm))]);
    ms.advance(0.2);
    expect(ms.time).toBeCloseTo(0.2, 9);
    const on = handLedCurrent(220);
    expect(ms.result!.parts[LED].current / on).toBeCloseTo(0.25, 1);
    expect(ms.result!.parts[UNO].volts!.d13 / 5).toBeCloseTo(0.25, 1);
  });

  it('a steady blink stays a crisp on/off', () => {
    const blink = (t: number): string => withPin(D13, Math.floor(t / 0.5) % 2 === 0 ? 'H' : 'L');
    const ms = new MixedSignal();
    ms.setCircuit(ledCircuit('d13', 220), [slot(new ScriptedBoard(blink))]);
    ms.advance(0.4);
    expect(ms.result!.parts[LED].current).toBeGreaterThan(0.95 * handLedCurrent(220));
    ms.advance(0.4);
    expect(ms.result!.parts[LED].current).toBeLessThan(1e-4);
  });

  it('runs whole slices only; the outcome does not depend on how time is asked for', () => {
    const blink = (t: number): string => withPin(D13, (t * 7) % 1 < 0.5 ? 'H' : 'L');
    const a = new MixedSignal();
    a.setCircuit(ledCircuit('d13', 220), [slot(new ScriptedBoard(blink))]);
    a.advance(0.3);
    const b = new MixedSignal();
    b.setCircuit(ledCircuit('d13', 220), [slot(new ScriptedBoard(blink))]);
    for (let i = 0; i < 70; i++) b.advance(0.3 / 70);
    b.advance(SLICE_SECONDS / 2); // rounding: finishes the last slice
    expect(b.time).toBeCloseTo(a.time, 9);
    expect(b.result!.parts[LED].current).toBeCloseTo(a.result!.parts[LED].current, 12);
  });

  it('INPUT_PULLUP reads high when open and low when wired to GND (real AVR code)', () => {
    // Copies pin 2 (PD2, pull-up on) to pin 13 (PB5), forever.
    const { bytes, errors } = assemble(`
      ldi r16, 0x20
      out 0x04, r16     ; DDRB = PB5 output
      ldi r16, 0x04
      out 0x0b, r16     ; PORTD = pull-up on PD2
    loop:
      sbic 0x09, 2      ; skip if PIND bit 2 is clear
      rjmp high
      cbi 0x05, 5
      rjmp loop
    high:
      sbi 0x05, 5
      rjmp loop
    `);
    expect(errors).toEqual([]);
    const uno = new UnoEmulator(bytes);
    const open: SimInput = {
      components: [{ id: UNO, model: { kind: 'board', rails: { ...UNO_ELECTRICAL.rails }, io: {} } }],
      links: [],
    };
    const ms = new MixedSignal();
    const slots = [slot(uno)];
    ms.setCircuit(open, slots);
    ms.advance(0.005);
    expect(uno.drives()[UNO_IO.findIndex((p) => p.id === 'd2')]).toBe('P');
    expect(ms.pinVolts(UNO, 'd2')).toBeCloseTo(5, 3);
    expect(uno.drives()[D13]).toBe('H');

    ms.setCircuit({ ...open, links: [[pin('1.d2'), pin('1.gnd')]] }, slots);
    ms.advance(0.005);
    expect(ms.pinVolts(UNO, 'd2')).toBeCloseTo(0, 6);
    expect(uno.drives()[D13]).toBe('L');
  });

  it('feeds pin voltages to the ADC (analogRead)', () => {
    const board = new ScriptedBoard(() => 'Z'.repeat(UNO_IO.length));
    const ms = new MixedSignal();
    // 5 V -> 10k -> A0 -> 10k -> gnd: 2.5 V at A0.
    ms.setCircuit({
      components: [
        { id: UNO, model: { kind: 'board', rails: { ...UNO_ELECTRICAL.rails }, io: {} } },
        { id: 2, model: { kind: 'resistor', ohms: 10_000 } },
        { id: 3, model: { kind: 'resistor', ohms: 10_000 } },
      ],
      links: [[pin('1.5v'), pin('2.a')], [pin('2.b'), pin('1.a0')], [pin('1.a0'), pin('3.a')], [pin('3.b'), pin('1.gnd')]],
    }, [slot(board)]);
    const a0 = UNO_IO.findIndex((p) => p.id === 'a0');
    expect(board.inputs!.analog[a0]).toBeCloseTo(2.5, 2);
  });

  it('runs the "Uno blink" example end to end: the LED follows Blink', () => {
    const scene = new Scene();
    scene.insert(EXAMPLES.find((e) => e.name === 'Uno blink')!.state);
    const runtimes = new BoardRuntimes();
    const slots = runtimes.sync(boardParts(scene));
    expect(slots[0].emulator).not.toBeNull();
    expect(slots[0].running).toBe(false); // stopped until Run
    const ms = new MixedSignal();
    ms.setCircuit(buildNetlist(scene).input, slots);
    const led = scene.parts.find((p) => p.typeId === 'led')!.id;
    expect(ms.result!.parts[led].current).toBeLessThan(1e-9);

    runtimes.run(slots[0].partId);
    const serial = ms.advance(0.5);
    expect(ms.result!.parts[led].current).toBeGreaterThan(0.012); // on
    expect(String.fromCharCode(...serial.get(slots[0].partId)!.usart0)).toBe('Blink: LED on pin 13\r\nLED on\r\n');
    ms.advance(1.0);
    expect(ms.result!.parts[led].current).toBeLessThan(1e-6); // off
    expect(UNO_SPEC.io).toBe(UNO_IO);
  });
});
