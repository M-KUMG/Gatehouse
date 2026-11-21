// I2C as plain logic: a bus that device models attach to by 7-bit address,
// and the glue that lets avr8js' TWI peripheral (the ATmega328P's I2C
// master) talk to that bus. No DOM, no timers: transfers take CPU cycles
// worked out from the TWI's own SCL frequency.
//
// Out of scope for now (byte level only): the electrical side of I2C. SDA
// (a4) and SCL (a5) are not modelled as open-drain lines with pull-ups, so
// the pins show what the GPIO registers say, a missing pull-up does not
// stop the bus, and the TWI slave (receiver) mode is not supported.

import type { AVRTWI, CPU, TWIEventHandler } from 'avr8js';
import { I2cWire, type LineEdge } from './lineedges';

/** A device model on the I2C bus. */
export interface I2cDevice {
  /** 7-bit address (0x08..0x77 for ordinary devices). */
  readonly address: number;
  /** The master sent a byte to this device; return true to ACK it. */
  write(byte: number): boolean;
  /** The master reads a byte from this device. */
  read(): number;
  /** This device was addressed after a (repeated) START; `read` is the transfer direction. */
  start?(read: boolean): void;
  /** STOP ended a transfer this device took part in. */
  stop?(): void;
}

/**
 * The bus as one master sees it: who is attached and who is addressed.
 * Its methods are the master's bus operations, each returning what the
 * master would see (ACK / NACK, the byte read).
 */
export class I2cBus {
  private readonly devices = new Map<number, I2cDevice>();
  private active: I2cDevice | null = null;
  private reading = false;
  /** Devices addressed since the last STOP (a repeated START may switch devices). */
  private touched = new Set<I2cDevice>();

  /** Attach a device; replaces any device at the same address. */
  attach(device: I2cDevice): void {
    if (!Number.isInteger(device.address) || device.address < 0 || device.address > 0x7f) {
      throw new RangeError(`I2C address ${device.address} is not a 7-bit address`);
    }
    this.detach(device.address);
    this.devices.set(device.address, device);
  }

  /** Detach a device, or whatever is at an address. */
  detach(device: I2cDevice | number): void {
    const address = typeof device === 'number' ? device : device.address;
    const found = this.devices.get(address);
    if (!found || (typeof device !== 'number' && found !== device)) return;
    if (this.active === found) this.active = null;
    this.touched.delete(found);
    this.devices.delete(address);
  }

  device(address: number): I2cDevice | undefined {
    return this.devices.get(address);
  }

  /** Attached addresses, ascending. */
  addresses(): number[] {
    return [...this.devices.keys()].sort((a, b) => a - b);
  }

  /** START or repeated START: nobody is addressed until connect(). */
  start(): void {
    this.active = null;
  }

  /** Address byte after START. True (ACK) when a device answers at `address`. */
  connect(address: number, read: boolean): boolean {
    const device = this.devices.get(address & 0x7f) ?? null;
    this.active = device;
    this.reading = read;
    if (!device) return false;
    this.touched.add(device);
    device.start?.(read);
    return true;
  }

  /** A data byte from the master; NACK when nobody is addressed for writing. */
  write(byte: number): boolean {
    if (!this.active || this.reading) return false;
    return this.active.write(byte & 0xff);
  }

  /** A data byte to the master; 0xFF (released SDA) when nobody is addressed for reading. */
  read(): number {
    if (!this.active || !this.reading) return 0xff;
    return this.active.read() & 0xff;
  }

  /** Forget the current transfer without telling the devices (the master was reset). */
  release(): void {
    this.touched.clear();
    this.active = null;
  }

  /** STOP: tells every device addressed since the last STOP, then frees the bus. */
  stop(): void {
    const touched = [...this.touched];
    this.touched.clear();
    this.active = null;
    for (const d of touched) d.stop?.();
  }
}

/**
 * Drives avr8js' TWI from an I2cBus. Each bus operation happens when the
 * program starts it; the TWI reports it finished after the time it takes
 * on the wire at the TWI's SCL frequency (1 bit for START/STOP, 9 bits for
 * a byte plus its ACK), counted in CPU cycles.
 */
export class TwiBusHandler implements TWIEventHandler {
  /** The line levels the bus operations put on SDA and SCL (lineedges.ts). */
  private readonly wire = new I2cWire();

  /** `onEdges`: told the SDA / SCL edges of every operation, stamped with CPU cycles (the analyzer's view of the bus). */
  constructor(
    private readonly cpu: CPU,
    private readonly twi: AVRTWI,
    private readonly bus: I2cBus,
    private readonly clockHz: number,
    private readonly onEdges: ((edges: LineEdge[]) => void) | null = null,
  ) {}

  start(): void {
    this.bus.start();
    this.onEdges?.(this.wire.start(this.cpu.cycles, this.bitCycles()));
    this.later(1, () => this.twi.completeStart());
  }

  stop(): void {
    this.bus.stop();
    this.onEdges?.(this.wire.stop(this.cpu.cycles, this.bitCycles()));
    this.later(1, () => this.twi.completeStop());
  }

  connectToSlave(addr: number, write: boolean): void {
    const ack = this.bus.connect(addr, !write);
    this.onEdges?.(this.wire.byte(this.cpu.cycles, this.bitCycles(), ((addr & 0x7f) << 1) | (write ? 0 : 1), ack));
    this.later(9, () => this.twi.completeConnect(ack));
  }

  writeByte(value: number): void {
    const ack = this.bus.write(value);
    this.onEdges?.(this.wire.byte(this.cpu.cycles, this.bitCycles(), value & 0xff, ack));
    this.later(9, () => this.twi.completeWrite(ack));
  }

  /** `ack`: the master answers this byte with ACK (more to read), else NACK (the last one). */
  readByte(ack = true): void {
    const value = this.bus.read();
    this.onEdges?.(this.wire.byte(this.cpu.cycles, this.bitCycles(), value, ack));
    this.later(9, () => this.twi.completeRead(value));
  }

  /** One SCL period = f_cpu / sclFrequency = 16 + 2 * TWBR * prescaler cycles. */
  private bitCycles(): number {
    return Math.max(1, Math.round(this.clockHz / this.twi.sclFrequency));
  }

  private later(bits: number, done: () => void): void {
    this.cpu.addClockEvent(done, bits * this.bitCycles());
  }
}
