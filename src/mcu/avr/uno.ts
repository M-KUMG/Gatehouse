// Arduino Uno: an ATmega328P at 16 MHz with Arduino pin numbering.
// Pin ids (stable, used in project files and wires):
//   d0..d7   = PD0..PD7   (d0 RX, d1 TX)
//   d8..d13  = PB0..PB5   (d13 also drives the on-board "L" LED)
//   a0..a5   = PC0..PC5   (ADC channels 0..5; also digital pins 14..19)
//   5v, 3v3  supply rails;  gnd, gnd2, gnd3 ground;  vin, aref unconnected inside
//
// Serial TX on d1: while UCSR0B.TXEN is set the USART drives d1 (idle high),
// and every byte written to UDR0 goes out as a cycle-exact UART frame.
//
// Serial RX: bytes from the console (sendSerial) wait in a queue and arrive
// one per frame time of the USART's current setup ((UBRR+1) * (U2X ? 8 : 16)
// * symbols per frame, CPU cycles), as if a host sent them back to back. At
// the end of each frame the receiver takes the byte when RXEN is set and the
// last byte was read (else it is lost, like on real hardware). d0's pin level
// is not decoded: d0 stays a plain port pin.

import { PinState, usart0Config, type AVRIOPort } from 'avr8js';
import type {
  BoardElectrical, BoardEmulator, BoardInputs, BoardSpec, DriveCode, IoPinDef, PinEvent, SerialPortDef, SliceResult,
} from '../board';
import { ATMEGA328P_FLASH_BYTES, Atmega328p } from './atmega328p';
import type { I2cBus } from './i2c';
import type { SpiPort } from './spi';

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

/** Index of d1 (PD1, TXD) in UNO_IO. */
const TX_INDEX = UNO_IO.findIndex((p) => p.id === 'd1');
const UCSRA_U2X = 0x02;
const UCSRA_RXC = 0x80;
const UCSRB_TXB8 = 0x01;

/** A scheduled change of the TX line; `end` marks the end of a frame. */
interface TxEdge {
  cycle: number;
  high: boolean;
  end?: true;
}

export class UnoEmulator implements BoardEmulator {
  readonly clockHz = UNO_CLOCK_HZ;
  readonly io = UNO_IO;
  readonly electrical = UNO_ELECTRICAL;
  private readonly chip: Atmega328p;
  private ports: Record<UnoPin['port'], AVRIOPort>;
  private lastDrives: string;
  private events: PinEvent[] = [];
  private serial: number[] = [];
  private inputs: boolean[] = [];
  private lastInputs: BoardInputs | null = null;
  /** Drive codes from the ports alone (PORTx/DDRx), as of the last port change. */
  private lastPortDrives: string;
  /** UCSR0B.TXEN as of the last port/USART change. */
  private txEnabled = false;
  /** TX line level (idle high). */
  private txHigh = true;
  /** Line changes of frames already started, in cycle order; applied once the CPU reaches them. */
  private txQueue: TxEdge[] = [];
  /** Cycle at which the last scheduled frame ends (the line is free from then on). */
  private txFreeAt = 0;
  /** Bytes from sendSerial not on the line yet. */
  private rxQueue: number[] = [];
  /** A received frame is on the line (its end is a clock event of the CPU). */
  private rxOnLine = false;

  /** `flash` is the program memory image (see parseIntelHex). Starts from reset. */
  constructor(flash: Uint8Array) {
    this.chip = new Atmega328p(flash, UNO_CLOCK_HZ);
    this.ports = this.wire();
    this.lastPortDrives = this.portDrives();
    this.lastDrives = this.drives();
    this.chip.onReset = this.onReset;
  }

  /**
   * I2C devices (a4 SDA / a5 SCL), byte level: attach/detach models by
   * 7-bit address. Pin levels are not modelled (see i2c.ts).
   */
  get i2c(): I2cBus {
    return this.chip.i2c;
  }

  /** SPI (d11 MOSI / d12 MISO / d13 SCK), byte level: set a handler. Pins are not modelled (see spi.ts). */
  get spi(): SpiPort {
    return this.chip.spi;
  }

  /** Watchdog resets since the emulator was created. */
  get watchdogResets(): number {
    return this.chip.resets;
  }

  get cycles(): number {
    return this.chip.cycles;
  }

  /** Current drive codes (between run() calls every TX change up to now has been applied). */
  drives(): string {
    return this.compose(this.portDrives());
  }

  run(cycles: number): SliceResult {
    const start = this.chip.cycles;
    const drives = this.lastDrives;
    this.chip.run(cycles);
    const end = this.chip.cycles;
    // TX bits that began by the end of the slice; later ones carry over to the next slice.
    this.flushTx(end);
    const serial = this.serial.length > 0 ? { [UNO_SERIAL.id]: this.serial } : {};
    const result: SliceResult = { start, end, drives, events: this.events, serial };
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
    this.lastInputs = { digital: [...inputs.digital], analog: [...inputs.analog] };
  }

  serialBaud(port: string): number | null {
    const usart = this.chip.usart;
    if (port !== UNO_SERIAL.id || !(usart.txEnable || usart.rxEnable)) return null;
    return usart.baudRate;
  }

  sendSerial(port: string, bytes: readonly number[]): void {
    if (port !== UNO_SERIAL.id) return;
    for (const b of bytes) this.rxQueue.push(b & 0xff);
    if (!this.rxOnLine) this.nextRxFrame();
  }

  /** Bytes from sendSerial still waiting (the one on the line not counted). */
  get serialRxPending(): number {
    return this.rxQueue.length;
  }

  /**
   * Put the next queued byte on the RX line: it takes one frame at the
   * USART's setup as of now. At the stop bit the receiver latches it, if it
   * is enabled and its data register is free (avr8js has one receive
   * register, not the chip's 2-byte FIFO; an unread byte is not
   * overwritten, the new one is lost as on a data overrun).
   */
  private nextRxFrame = (): void => {
    const byte = this.rxQueue.shift();
    if (byte === undefined) {
      this.rxOnLine = false;
      return;
    }
    this.rxOnLine = true;
    const { cpu, usart } = this.chip;
    cpu.addClockEvent(() => {
      const unread = (cpu.data[usart0Config.UCSRA] & UCSRA_RXC) !== 0;
      if (usart.rxEnable && !usart.rxBusy && !unread) usart.writeByte(byte, true);
      this.nextRxFrame();
    }, this.frameCycles());
  };

  private portDrives(): string {
    let s = '';
    for (const pin of UNO_IO) s += CODES[this.ports[pin.port].pinState(pin.bit)];
    return s;
  }

  /**
   * Port drive codes with d1 taken over by the transmitter: while TXEN is
   * set, and after TXEN is cleared until the frames already started are out
   * (datasheet: disabling waits for ongoing and pending transmissions).
   */
  private compose(portDrives: string): string {
    if (!this.txEnabled && this.txQueue.length === 0) return portDrives;
    return portDrives.slice(0, TX_INDEX) + (this.txHigh ? 'H' : 'L') + portDrives.slice(TX_INDEX + 1);
  }

  /** Record the pins as they are now, stamped `cycle`, if they changed. */
  private emit(cycle: number): void {
    const drives = this.compose(this.lastPortDrives);
    if (drives === this.lastDrives) return;
    this.lastDrives = drives;
    this.events.push({ cycle, drives });
  }

  /** Apply the TX line changes up to and including `cycle`, each at its own cycle. */
  private flushTx(cycle: number): void {
    const queue = this.txQueue;
    let n = 0;
    while (n < queue.length && queue[n].cycle <= cycle) {
      const edge = queue[n++];
      this.txHigh = edge.high;
      // Empty the queue before the last edge is emitted, so the end of the
      // last frame hands d1 back to the port when TXEN is already off.
      if (n === queue.length) {
        queue.length = 0;
        n = 0;
      }
      this.emit(edge.cycle);
    }
    if (n > 0) queue.splice(0, n);
  }

  /** One bit on the line, the figure avr8js uses for UDRE/TXC: (UBRR + 1) * (U2X ? 8 : 16) cycles. */
  private txBitCycles(): number {
    const data = this.chip.cpu.data;
    const ubrr = (data[usart0Config.UBRRH] << 8) | data[usart0Config.UBRRL];
    return (ubrr + 1) * (data[usart0Config.UCSRA] & UCSRA_U2X ? 8 : 16);
  }

  /** One whole frame at the current setup: start bit, data bits, parity, stop bit(s). */
  private frameCycles(): number {
    const usart = this.chip.usart;
    return this.txBitCycles() * (1 + usart.bitsPerChar + (usart.parityEnabled ? 1 : 0) + usart.stopBits);
  }

  /**
   * A byte was written to UDR0 (avr8js calls this at the cycle of the
   * write): schedule its frame on the TX line, start bit low, data bits LSB
   * first, optional parity, stop bit(s) high. It starts now or, while an
   * earlier frame is still going out, straight after it.
   */
  private onTxByte = (byte: number): void => {
    this.serial.push(byte);
    const usart = this.chip.usart;
    if (!usart.txEnable) return;
    const now = this.chip.cycles;
    this.flushTx(now);
    const bits = usart.bitsPerChar;
    const ninth = (this.chip.cpu.data[usart0Config.UCSRB] & UCSRB_TXB8) << 8;
    const data = bits === 9 ? (byte & 0xff) | ninth : byte & ((1 << bits) - 1);
    const levels = [false];
    let ones = 0;
    for (let i = 0; i < bits; i++) {
      const bit = ((data >> i) & 1) === 1;
      if (bit) ones++;
      levels.push(bit);
    }
    if (usart.parityEnabled) levels.push((ones % 2 === 1) !== usart.parityOdd);
    for (let i = 0; i < usart.stopBits; i++) levels.push(true);
    const bitCycles = this.txBitCycles();
    let t = Math.max(now, this.txFreeAt);
    let high = true; // the line is high before a frame (idle, or the last stop bit)
    for (const level of levels) {
      if (level !== high) this.txQueue.push({ cycle: t, high: (high = level) });
      t += bitCycles;
    }
    this.txQueue.push({ cycle: t, high: true, end: true });
    this.txFreeAt = t;
    this.flushTx(now); // a start bit at `now` shows at once
  };

  /** Listen to the chip's current ports and USART. */
  private wire(): Record<UnoPin['port'], AVRIOPort> {
    const chip = this.chip;
    for (const port of [chip.portB, chip.portC, chip.portD]) port.addListener(this.onPortChange);
    chip.usart.onByteTransmit = this.onTxByte;
    // TXEN changes come through here (baud/frame changes too, harmless).
    chip.usart.onConfigurationChange = this.onPortChange;
    return { B: chip.portB, C: chip.portC, D: chip.portD };
  }

  /** A watchdog reset rebuilt the chip: listen to the new parts, feed them the last inputs, report the pins. */
  private onReset = (): void => {
    // The old transmitter ran until now; the new one starts idle and disabled.
    this.flushTx(this.chip.cycles);
    this.txQueue = [];
    this.txHigh = true;
    this.txFreeAt = this.chip.cycles;
    // The received frame's clock event went with the old CPU; queued bytes are dropped.
    this.rxQueue = [];
    this.rxOnLine = false;
    this.ports = this.wire();
    this.inputs = [];
    if (this.lastInputs) this.setInputs(this.lastInputs);
    this.onPortChange();
  };

  private onPortChange = (): void => {
    const now = this.chip.cycles;
    // TX changes before this moment happened with the old setup.
    this.flushTx(now);
    this.lastPortDrives = this.portDrives();
    this.txEnabled = this.chip.usart.txEnable;
    this.emit(now);
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
