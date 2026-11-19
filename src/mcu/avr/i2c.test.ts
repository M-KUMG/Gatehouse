import { describe, expect, it } from 'vitest';
import { I2cBus, type I2cDevice } from './i2c';
import { SPI_NO_DEVICE, SpiPort } from './spi';

/** Records every call; ACKs writes unless `nackAfter` bytes were written. */
function device(address: number, reads: number[] = [], nackAfter = Infinity): I2cDevice & { log: string[] } {
  const log: string[] = [];
  let written = 0;
  return {
    address,
    log,
    start: (read) => log.push(read ? 'start-r' : 'start-w'),
    stop: () => log.push('stop'),
    write: (b) => (log.push(`w${b}`), ++written <= nackAfter),
    read: () => reads.shift() ?? 0,
  };
}

describe('I2cBus', () => {
  it('ACKs an attached address, NACKs anything else', () => {
    const bus = new I2cBus();
    bus.attach(device(0x50));
    bus.start();
    expect(bus.connect(0x50, false)).toBe(true);
    bus.start();
    expect(bus.connect(0x51, false)).toBe(false);
    expect(bus.write(1)).toBe(false);
    expect(bus.read()).toBe(0xff);
    expect(bus.addresses()).toEqual([0x50]);
  });

  it('routes writes and reads to the addressed device, in order, with start/stop calls', () => {
    const bus = new I2cBus();
    const d = device(0x3c, [7, 300]);
    bus.attach(d);
    bus.start();
    bus.connect(0x3c, false);
    expect(bus.write(0x110)).toBe(true); // masked to a byte
    bus.start(); // repeated START
    bus.connect(0x3c, true);
    expect(bus.write(1)).toBe(false); // read transfer: writes are not delivered
    expect([bus.read(), bus.read()]).toEqual([7, 300 & 0xff]);
    bus.stop();
    expect(d.log).toEqual(['start-w', 'w16', 'start-r', 'stop']);
    expect(bus.read()).toBe(0xff); // freed by STOP
  });

  it('passes the device NACK on, and tells every device of a transfer about STOP once', () => {
    const bus = new I2cBus();
    const a = device(0x10, [], 1);
    const b = device(0x11);
    bus.attach(a);
    bus.attach(b);
    bus.start();
    bus.connect(0x10, false);
    expect([bus.write(1), bus.write(2)]).toEqual([true, false]);
    bus.start();
    bus.connect(0x11, false);
    bus.stop();
    bus.stop();
    expect(a.log.filter((x) => x === 'stop')).toHaveLength(1);
    expect(b.log.filter((x) => x === 'stop')).toHaveLength(1);
  });

  it('attach replaces, detach by device or address, release forgets silently, bad addresses throw', () => {
    const bus = new I2cBus();
    const a = device(0x20);
    const b = device(0x20);
    bus.attach(a);
    bus.attach(b);
    expect(bus.device(0x20)).toBe(b);
    bus.detach(a); // not the one attached: no-op
    expect(bus.device(0x20)).toBe(b);
    bus.start();
    bus.connect(0x20, false);
    bus.release();
    expect(b.log).toEqual(['start-w']);
    bus.detach(0x20);
    expect(bus.addresses()).toEqual([]);
    expect(() => bus.attach(device(0x80))).toThrow(RangeError);
    expect(() => bus.attach(device(-1))).toThrow(RangeError);
  });
});

describe('SpiPort', () => {
  it('reads 0xFF with no device, the handler reply otherwise (bytes masked)', () => {
    const spi = new SpiPort();
    expect(spi.transfer(0xa5)).toBe(0xff);
    expect(SPI_NO_DEVICE(0)).toBe(0xff);
    spi.setHandler((tx) => tx + 0x100 + 1);
    expect(spi.transfer(0x1a5)).toBe(0xa6);
    spi.setHandler(null);
    expect(spi.transfer(1)).toBe(0xff);
  });
});
