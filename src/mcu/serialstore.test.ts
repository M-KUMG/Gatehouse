import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../examples';
import { Scene } from '../model';
import { Simulation } from '../simulation';
import { UNO_SPEC, UnoEmulator } from './avr/uno';
import { parseIntelHex } from './hex';
import { BLINK_HEX } from './programs/blink';
import { decodeSerial, nominalBaud, SerialStore, type DecodeState } from './serialstore';

const bytes = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const decode = (s: string, state: DecodeState = { afterCR: false }): string => decodeSerial(bytes(s), state);

describe('decodeSerial', () => {
  it('turns \\r\\n, a lone \\r and a lone \\n into one line end each', () => {
    expect(decode('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
    expect(decode('a\r\r\nb')).toBe('a\n\nb');
    expect(decode('a\n\rb')).toBe('a\n\nb');
  });

  it('keeps \\r\\n as one line end when split across chunks', () => {
    const state = { afterCR: false };
    expect(decode('LED on\r', state) + decode('\nLED off\r', state) + decode('\n', state)).toBe('LED on\nLED off\n');
  });

  it('shows non-printable bytes as \\xNN and keeps tabs', () => {
    expect(decodeSerial([0x41, 0x00, 0x1b, 0x7f, 0x80, 0xff, 0x09, 0x42], { afterCR: false })).toBe('A\\x00\\x1B\\x7F\\x80\\xFF\tB');
  });
});

describe('nominalBaud', () => {
  it('maps register-derived rates to the usual rate', () => {
    expect(nominalBaud(9615)).toBe(9600); // 16 MHz, UBRR 103
    expect(nominalBaud(117647)).toBe(115200); // 16 MHz, U2X, UBRR 16
    expect(nominalBaud(12345)).toBe(12345);
  });
});

describe('SerialStore', () => {
  it('keeps text per board and per port', () => {
    const store = new SerialStore();
    store.write(1, 'usart0', bytes('one'));
    store.write(1, 'usart1', bytes('two'));
    store.write(2, 'usart0', bytes('three'));
    store.write(1, 'usart0', bytes('!'));
    expect(store.get(1, 'usart0')?.text).toBe('one!');
    expect(store.get(1, 'usart1')?.text).toBe('two');
    expect(store.get(2, 'usart0')?.text).toBe('three');
    expect(store.get(2, 'usart1')).toBeUndefined();
  });

  it('caps a buffer by characters, dropping the oldest whole lines', () => {
    const store = new SerialStore({ maxChars: 100, maxLines: 1000 });
    for (let i = 0; i < 50; i++) store.write(1, 'p', bytes(`line ${String(i).padStart(2, '0')}\r\n`)); // 8 chars each
    const buf = store.get(1, 'p')!;
    expect(buf.text.length).toBeLessThanOrEqual(100);
    expect(buf.text.endsWith('line 49\n')).toBe(true);
    expect(buf.text.startsWith('line ')).toBe(true); // whole lines only
    expect(buf.start + buf.text.length).toBe(50 * 8); // positions keep counting
    expect(buf.lines).toBe(buf.text.split('\n').length - 1);
  });

  it('caps a buffer by lines', () => {
    const store = new SerialStore({ maxChars: 1_000_000, maxLines: 10 });
    for (let i = 0; i < 100; i++) store.write(1, 'p', bytes(`${i}\n`));
    const buf = store.get(1, 'p')!;
    expect(buf.lines).toBeLessThanOrEqual(10);
    expect(buf.text.split('\n').length - 1).toBe(buf.lines);
    expect(buf.text.endsWith('98\n99\n')).toBe(true);
  });

  it('cuts inside a very long line when there is no line end', () => {
    const store = new SerialStore({ maxChars: 50, maxLines: 10 });
    store.write(1, 'p', bytes('x'.repeat(500)));
    expect(store.get(1, 'p')!.text.length).toBeLessThanOrEqual(50);
    expect(store.get(1, 'p')!.start + store.get(1, 'p')!.text.length).toBe(500);
  });

  it('clears a port or a whole board, with a new generation afterwards', () => {
    const store = new SerialStore();
    store.write(1, 'a', bytes('x'));
    store.write(1, 'b', bytes('y'));
    const before = store.get(1, 'a')!.generation;
    store.clear(1, 'a');
    expect(store.get(1, 'a')).toBeUndefined();
    expect(store.get(1, 'b')?.text).toBe('y');
    store.write(1, 'a', bytes('z'));
    expect(store.get(1, 'a')!.generation).not.toBe(before);
    expect(store.get(1, 'a')!.start).toBe(0);
    store.clear(1);
    expect(store.get(1, 'b')).toBeUndefined();
  });

  it('removes a deleted board', () => {
    const store = new SerialStore();
    store.write(1, 'a', bytes('x'));
    store.write(2, 'a', bytes('y'));
    store.removeBoard(1);
    expect(store.boardIds()).toEqual([2]);
    expect(store.get(1, 'a')).toBeUndefined();
  });
});

describe('serial ports of the Uno', () => {
  it('exposes exactly one port, USART0', () => {
    expect(UNO_SPEC.serialPorts).toEqual([{ id: 'usart0', name: 'Serial (USART0)' }]);
  });

  it('reports the baud rate Blink sets up (9600, really 9615)', () => {
    const uno = new UnoEmulator(parseIntelHex(BLINK_HEX, UNO_SPEC.flashBytes).bytes);
    expect(uno.serialBaud('usart0')).toBeNull(); // not set up yet
    uno.run(16_000); // 1 ms: past Serial.begin
    expect(uno.serialBaud('usart0')).toBe(9615);
    expect(nominalBaud(uno.serialBaud('usart0')!)).toBe(9600);
    expect(uno.serialBaud('usart1')).toBeNull();
  });
});

describe('Blink output through the simulation', () => {
  function blinkSim(): { sim: Simulation; scene: Scene; id: number } {
    const scene = new Scene();
    scene.insert(EXAMPLES.find((e) => e.name === 'Uno blink')!.state);
    const sim = new Simulation(scene);
    sim.update();
    const id = scene.parts.find((p) => p.typeId === 'uno')!.id;
    return { sim, scene, id };
  }

  it('reaches the store per board and port', () => {
    const { sim, id } = blinkSim();
    sim.boards.run(id);
    for (let i = 0; i < 50; i++) sim.advance(0.05); // 2.5 s
    expect(sim.boards.serial.get(id, 'usart0')?.text).toBe('Blink: LED on pin 13\nLED on\nLED off\nLED on\n');
  });

  it('reset clears the board\'s buffers; deleting the board removes them', () => {
    const { sim, scene, id } = blinkSim();
    sim.boards.run(id);
    sim.advance(0.1);
    expect(sim.boards.serial.get(id, 'usart0')?.text).toContain('LED on');
    sim.boards.reset(id);
    expect(sim.boards.serial.get(id, 'usart0')).toBeUndefined();
    sim.advance(0.1);
    expect(sim.boards.serial.get(id, 'usart0')?.text).toContain('LED on');
    scene.remove(id);
    sim.update();
    expect(sim.boards.serial.boardIds()).toEqual([]);
  });
});
