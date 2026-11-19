// SPI as plain logic: one handler sees each byte the ATmega328P's SPI
// master shifts out (MOSI) and returns the byte shifted in (MISO).
//
// Out of scope for now (byte level only): SCK/MOSI/MISO/SS pin states
// (d13/d11/d12/d10) and chip selects are not modelled; a handler that
// serves several devices has to decide by itself who is selected. SPI slave
// mode is not supported.

/** One SPI byte exchange: the byte sent on MOSI in, the byte read on MISO out. */
export type SpiHandler = (txByte: number) => number;

/**
 * With nothing attached, MISO is not driven. We read it as 0xFF (the line
 * floating high, as most breakouts with a pull-up or an idle-high MISO do),
 * not as an echo of MOSI.
 */
export const SPI_NO_DEVICE: SpiHandler = () => 0xff;

/** The SPI port of a chip: set a handler to attach a device model. */
export class SpiPort {
  private handler: SpiHandler = SPI_NO_DEVICE;

  /** Attach a handler; null (or nothing) goes back to the floating-MISO default. */
  setHandler(handler: SpiHandler | null = null): void {
    this.handler = handler ?? SPI_NO_DEVICE;
  }

  /** One byte exchange (called by the chip). */
  transfer(txByte: number): number {
    return this.handler(txByte & 0xff) & 0xff;
  }
}
