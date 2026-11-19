// An ATmega328P built from avr8js parts: CPU, Timer0/1/2, USART0, GPIO
// ports B/C/D, ADC, clock prescaler, EEPROM, TWI (I2C master), SPI and the
// watchdog. No DOM, no timers: time is the CPU's cycle counter and nothing
// else.
//
// I2C and SPI are byte level only (see i2c.ts and spi.ts): device models
// see the bytes, the pins (a4/a5, d10..d13) are not driven by the buses.

import {
  AVRADC, AVRClock, AVREEPROM, AVRIOPort, AVRSPI, AVRTimer, AVRTWI, AVRUSART, AVRWatchdog, CPU, EEPROMMemoryBackend,
  adcConfig, avrInstruction, clockConfig, eepromConfig, portBConfig, portCConfig, portDConfig, spiConfig,
  timer0Config, timer1Config, timer2Config, twiConfig, usart0Config, watchdogConfig,
} from 'avr8js';
import { I2cBus, TwiBusHandler } from './i2c';
import { SpiPort } from './spi';

export const ATMEGA328P_FLASH_BYTES = 32 * 1024;
const SRAM_BYTES = 2048;
const EEPROM_BYTES = 1024;
const MCUSR = watchdogConfig.MCUSR;
const MCUSR_WDRF = 0x08;

/** The avr8js parts of one power-up (rebuilt by a watchdog reset). */
interface Parts {
  cpu: CPU;
  portB: AVRIOPort;
  portC: AVRIOPort;
  portD: AVRIOPort;
  adc: AVRADC;
  usart: AVRUSART;
  twi: AVRTWI;
  spi: AVRSPI;
  watchdog: AVRWatchdog;
}

export class Atmega328p {
  /** Devices on the I2C bus (kept across resets, like real devices). */
  readonly i2c = new I2cBus();
  /** The SPI device handler (kept across resets). */
  readonly spi = new SpiPort();
  /**
   * Called after a watchdog reset rebuilt the chip, so owners can attach
   * their listeners to the new ports and USART.
   */
  onReset: (() => void) | null = null;
  /** Watchdog resets so far. */
  resets = 0;
  private parts: Parts;
  private readonly program: Uint16Array;
  /** Carried over from the old EEPROM on reset (EEPROM survives a reset). */
  private readonly eeprom = new EEPROMMemoryBackend(EEPROM_BYTES);
  private resetPending = false;
  private target = 0;

  /** `flash` is the program memory image (see parseIntelHex). */
  constructor(flash: Uint8Array, readonly clockHz: number) {
    this.program = new Uint16Array(ATMEGA328P_FLASH_BYTES / 2);
    new Uint8Array(this.program.buffer).set(flash.subarray(0, ATMEGA328P_FLASH_BYTES));
    this.parts = this.build(0);
  }

  get cpu(): CPU { return this.parts.cpu; }
  get portB(): AVRIOPort { return this.parts.portB; }
  get portC(): AVRIOPort { return this.parts.portC; }
  get portD(): AVRIOPort { return this.parts.portD; }
  get adc(): AVRADC { return this.parts.adc; }
  get usart(): AVRUSART { return this.parts.usart; }
  get twi(): AVRTWI { return this.parts.twi; }
  get watchdog(): AVRWatchdog { return this.parts.watchdog; }

  get cycles(): number {
    return this.parts.cpu.cycles;
  }

  /** Run whole instructions until `cycles` more cycles have passed since the last target. */
  run(cycles: number): void {
    this.target += cycles;
    let cpu = this.parts.cpu;
    while (cpu.cycles < this.target) {
      avrInstruction(cpu);
      cpu.tick();
      if (this.resetPending) {
        this.watchdogReset();
        cpu = this.parts.cpu;
      }
    }
  }

  /**
   * A fresh chip at cycle `cycles`: the same program and EEPROM, every
   * register and peripheral back to its reset state. The cycle counter goes
   * on (it is the board's clock, not a register).
   */
  private build(cycles: number): Parts {
    const cpu = new CPU(this.program, SRAM_BYTES);
    cpu.cycles = cycles;
    const clockHz = this.clockHz;
    new AVRTimer(cpu, timer0Config);
    new AVRTimer(cpu, timer1Config);
    new AVRTimer(cpu, timer2Config);
    const clock = new AVRClock(cpu, clockHz, clockConfig);
    new AVREEPROM(cpu, this.eeprom, eepromConfig);
    const usart = new AVRUSART(cpu, usart0Config, clockHz);
    const portB = new AVRIOPort(cpu, portBConfig);
    const portC = new AVRIOPort(cpu, portCConfig);
    const portD = new AVRIOPort(cpu, portDConfig);
    const adc = new AVRADC(cpu, adcConfig);
    const twi = new AVRTWI(cpu, twiConfig, clockHz);
    twi.eventHandler = new TwiBusHandler(cpu, twi, this.i2c, clockHz);
    const spi = new AVRSPI(cpu, spiConfig, clockHz);
    spi.onByte = (tx) => {
      const rx = this.spi.transfer(tx);
      cpu.addClockEvent(() => spi.completeTransfer(rx), spi.transferCycles);
    };
    const watchdog = new AVRWatchdog(cpu, watchdogConfig, clock);
    // avr8js' watchdog calls cpu.reset() on a timeout, which only resets the
    // PC, SP and pending interrupts. We rebuild the whole chip instead, after
    // the instruction (see run()).
    cpu.reset = () => {
      this.resetPending = true;
    };
    return { cpu, portB, portC, portD, adc, usart, twi, spi, watchdog };
  }

  /**
   * After a watchdog timeout: the same as a power-up reset (our reset path
   * builds a new chip too), except MCUSR.WDRF is set. The watchdog is left
   * off afterwards, as the Uno's bootloader (optiboot) leaves it; a chip
   * without a bootloader would keep it running at 16 ms.
   */
  private watchdogReset(): void {
    this.resetPending = false;
    this.resets++;
    this.parts = this.build(this.parts.cpu.cycles);
    this.parts.cpu.data[MCUSR] |= MCUSR_WDRF;
    this.i2c.release();
    this.onReset?.();
  }
}
