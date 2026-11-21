// The wires of I2C and SPI as edges in CPU cycles. The chip's TWI and SPI work on
// whole bytes (i2c.ts, spi.ts); a logic analyzer needs the line levels, so the
// emulator turns every bus operation into the edges the real peripheral would
// put on its pins, timed by the same clock the operation takes. Pure, no DOM.
//
// I2C: SDA changes while SCL is low, a bit is read on SCL's rising edge;
// START is SDA falling while SCL is high, STOP is SDA rising while SCL is high.
// A bit time T is one SCL period: SCL rises a quarter in, falls three quarters in.
// SPI: SCK idles at CPOL; with CPHA 0 the data is set at the start of a bit and
// read on the leading edge (half a bit later), with CPHA 1 it changes on the
// leading edge and is read on the trailing edge.

/** Lines the chip drives. `null` releases the line (the pin goes back to what the port says). */
export type LineName = 'sda' | 'scl' | 'sck' | 'mosi' | 'miso';

export interface LineEdge {
  cycle: number;
  line: LineName;
  high: boolean | null;
}

/** I2C master side of the wires: remembers the line levels so each operation only emits real changes. */
export class I2cWire {
  /** Levels after the last operation (the bus idles high). */
  sda = true;
  scl = true;

  private set(out: LineEdge[], line: 'sda' | 'scl', high: boolean, cycle: number): void {
    if (this[line] === high) return;
    this[line] = high;
    out.push({ cycle: Math.round(cycle), line, high });
  }

  /** START, or a repeated START from a bus that is mid-transfer (SCL low). One bit time. */
  start(t0: number, bit: number): LineEdge[] {
    const out: LineEdge[] = [];
    if (!this.scl) {
      this.set(out, 'sda', true, t0); // SDA up while SCL is low, then SCL up: ready for the falling SDA
      this.set(out, 'scl', true, t0 + bit * 0.25);
    }
    this.set(out, 'sda', false, t0 + bit * 0.5);
    this.set(out, 'scl', false, t0 + bit * 0.75);
    return out;
  }

  /**
   * One byte and its acknowledge bit: 9 bit times. `value` goes out MSB first;
   * the ninth bit is the ACK (`acked`: SDA pulled low by whoever receives the byte).
   */
  byte(t0: number, bit: number, value: number, acked: boolean): LineEdge[] {
    const out: LineEdge[] = [];
    for (let k = 0; k < 9; k++) {
      const s = t0 + k * bit;
      this.set(out, 'sda', k < 8 ? ((value >> (7 - k)) & 1) === 1 : !acked, s);
      this.set(out, 'scl', true, s + bit * 0.25);
      this.set(out, 'scl', false, s + bit * 0.75);
    }
    return out;
  }

  /** STOP: SDA rises while SCL is high. One bit time. */
  stop(t0: number, bit: number): LineEdge[] {
    const out: LineEdge[] = [];
    this.set(out, 'sda', false, t0); // SCL is low here
    this.set(out, 'scl', true, t0 + bit * 0.25);
    this.set(out, 'sda', true, t0 + bit * 0.5);
    return out;
  }
}

export interface SpiByteWire {
  /** Cycle the transfer starts at, and the cycles all eight bits take. */
  t0: number;
  cycles: number;
  /** Byte on MOSI (sent by the chip) and on MISO (read by the chip). */
  tx: number;
  rx: number;
  cpol: boolean;
  cpha: boolean;
  lsbFirst: boolean;
}

/**
 * The edges of one SPI byte exchange (master). SCK ends at its idle level and
 * MOSI keeps the last bit (both stay driven while SPI is on); MISO is released
 * at the end (it belongs to the slave). The first edge's bit is not repeated if
 * a level is unchanged, so callers pass the previous levels in `prev`.
 */
export function spiByteEdges(w: SpiByteWire, prev: { sck: boolean | null; mosi: boolean | null; miso: boolean | null }): LineEdge[] {
  const out: LineEdge[] = [];
  const level = { ...prev };
  const set = (line: 'sck' | 'mosi' | 'miso', high: boolean | null, cycle: number): void => {
    if (level[line] === high) return;
    level[line] = high;
    out.push({ cycle: Math.round(cycle), line, high });
  };
  const bit = w.cycles / 8;
  const idle = w.cpol;
  const active = !w.cpol;
  for (let k = 0; k < 8; k++) {
    const n = w.lsbFirst ? k : 7 - k;
    const s = w.t0 + k * bit;
    set('mosi', ((w.tx >> n) & 1) === 1, s);
    set('miso', ((w.rx >> n) & 1) === 1, s);
    if (w.cpha) {
      set('sck', active, s); // leading edge: the data changes with it, and is read on the trailing edge
      set('sck', idle, s + bit * 0.5);
    } else {
      set('sck', active, s + bit * 0.5); // data was set first, and is read on the leading edge
      set('sck', idle, s + bit);
    }
  }
  set('miso', null, w.t0 + w.cycles);
  return out;
}
