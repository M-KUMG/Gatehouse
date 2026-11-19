// Arduino Uno: an ATmega328P at 16 MHz with Arduino pin numbering.
// Pin ids (stable, used in project files and wires):
//   d0..d7   = PD0..PD7   (d0 RX, d1 TX)
//   d8..d13  = PB0..PB5   (d13 also drives the on-board "L" LED)
//   a0..a5   = PC0..PC5   (ADC channels 0..5; also digital pins 14..19)
//   5v, 3v3  supply rails;  gnd, gnd2, gnd3 ground;  vin, aref unconnected inside

import { PinState, type AVRIOPort } from 'avr8js';
import type {
  BoardElectrical, BoardEmulator, BoardInputs, BoardSpec, DriveCode, IoPinDef, PinEvent, SerialPortDef, SliceResult,
} from '../board';
import { ATMEGA328P_FLASH_BYTES, Atmega328p } from './atmega328p';

export const UNO_CLOCK_HZ = 16_000_000;

interface UnoPin extends IoPinDef {
  port: 'B' | 'C' | 'D';
  bit: number;
}

const digital = (n: number): UnoPin =>
  n < 8 ? { id: `d${n}`, analog: false, port: 'D', bit: n } : { id: `d${n}`, analog: false, port: 'B', bit: n - 8 };

/** The Uno's io pins in a fixed order (drive strings and inputs use it). */
export const UNO_IO: readonly UnoPin[] = [
  ...Array.from({ length: 14 }, (_, n) => digital(n)),
  ...Array.from({ length: 6 }, (_, n): UnoPin => ({ id: `a${n}`, analog: true, port: 'C', bit: n })),
];

/** ATmega328P pins at 5 V (datasheet figures, rounded). */
export const UNO_ELECTRICAL: BoardElectrical = {
  rails: { '5v': 5, '3v3': 3.3 },
  vcc: 5,
  outputOhms: 25,
  pullupOhms: 30_000,
  inputOhms: 1e8,
  highAbove: 3.0,
  lowBelow: 1.5,
};

/** The Uno's one serial port: USART0 on d0 (RX) / d1 (TX), also the USB link. */
export const UNO_SERIAL: SerialPortDef = { id: 'usart0', name: 'Serial (USART0)' };
export const UNO_SERIAL_PORTS: readonly SerialPortDef[] = [UNO_SERIAL];

const CODES: Record<PinState, DriveCode> = {
  [PinState.High]: 'H',
  [PinState.Low]: 'L',
  [PinState.Input]: 'Z',
  [PinState.InputPullUp]: 'P',
};

export class UnoEmulator implements BoardEmulator {
  readonly clockHz = UNO_CLOCK_HZ;
  readonly io = UNO_IO;
  readonly electrical = UNO_ELECTRICAL;
  private readonly chip: Atmega328p;
  private readonly ports: Record<UnoPin['port'], AVRIOPort>;
  private lastDrives: string;
  private events: PinEvent[] = [];
  private serial: number[] = [];
  private inputs: boolean[] = [];

  /** `flash` is the program memory image (see parseIntelHex). Starts from reset. */
  constructor(flash: Uint8Array) {
    this.chip = new Atmega328p(flash, UNO_CLOCK_HZ);
    const chip = this.chip;
    this.ports = { B: chip.portB, C: chip.portC, D: chip.portD };
    this.lastDrives = this.drives();
    for (const port of [chip.portB, chip.portC, chip.portD]) port.addListener(this.onPortChange);
    chip.usart.onByteTransmit = (byte) => this.serial.push(byte);
  }

  get cycles(): number {
    return this.chip.cycles;
  }

  drives(): string {
    let s = '';
    for (const pin of UNO_IO) s += CODES[this.ports[pin.port].pinState(pin.bit)];
    return s;
  }

  run(cycles: number): SliceResult {
    const start = this.chip.cycles;
    const drives = this.lastDrives;
    this.chip.run(cycles);
    const serial = this.serial.length > 0 ? { [UNO_SERIAL.id]: this.serial } : {};
    const result: SliceResult = { start, end: this.chip.cycles, drives, events: this.events, serial };
    this.events = [];
    this.serial = [];
    return result;
  }

  setInputs(inputs: BoardInputs): void {
    UNO_IO.forEach((pin, i) => {
      const level = inputs.digital[i] === true;
      if (this.inputs[i] !== level) this.ports[pin.port].setPin(pin.bit, level);
      if (pin.analog) this.chip.adc.channelValues[pin.bit] = Math.min(5, Math.max(0, inputs.analog[i] ?? 0));
    });
    this.inputs = [...inputs.digital];
  }

  serialBaud(port: string): number | null {
    const usart = this.chip.usart;
    if (port !== UNO_SERIAL.id || !(usart.txEnable || usart.rxEnable)) return null;
    return usart.baudRate;
  }

  private onPortChange = (): void => {
    const drives = this.drives();
    if (drives === this.lastDrives) return;
    this.lastDrives = drives;
    this.events.push({ cycle: this.chip.cycles, drives });
  };
}

export const UNO_SPEC: BoardSpec = {
  flashBytes: ATMEGA328P_FLASH_BYTES,
  io: UNO_IO,
  electrical: UNO_ELECTRICAL,
  serialPorts: UNO_SERIAL_PORTS,
  create: (flash) => new UnoEmulator(flash),
};

/**
 * Arduino Nano: the same ATmega328P at 16 MHz, same serial port and the same
 * pin ids as far as they exist (d0..d13, a0..a5), so it reuses the Uno's
 * emulator, io list and electrical model unchanged. A6/A7 are left out: the
 * compiler pack has no "eightanaloginputs" variant and the bridge only knows
 * port pins.
 */
export const NANO_SPEC: BoardSpec = { ...UNO_SPEC };
