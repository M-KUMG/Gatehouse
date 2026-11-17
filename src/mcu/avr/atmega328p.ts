// An ATmega328P built from avr8js parts: CPU, Timer0/1/2, USART0, GPIO
// ports B/C/D, ADC, clock prescaler and EEPROM. No DOM, no timers: time
// is the CPU's cycle counter and nothing else.

import {
  AVRADC, AVRClock, AVREEPROM, AVRIOPort, AVRTimer, AVRUSART, CPU, EEPROMMemoryBackend,
  adcConfig, avrInstruction, clockConfig, eepromConfig, portBConfig, portCConfig, portDConfig,
  timer0Config, timer1Config, timer2Config, usart0Config,
} from 'avr8js';

export const ATMEGA328P_FLASH_BYTES = 32 * 1024;
const SRAM_BYTES = 2048;
const EEPROM_BYTES = 1024;

export class Atmega328p {
  readonly cpu: CPU;
  readonly portB: AVRIOPort;
  readonly portC: AVRIOPort;
  readonly portD: AVRIOPort;
  readonly adc: AVRADC;
  readonly usart: AVRUSART;
  private target = 0;

  /** `flash` is the program memory image (see parseIntelHex). */
  constructor(flash: Uint8Array, readonly clockHz: number) {
    const words = new Uint16Array(ATMEGA328P_FLASH_BYTES / 2);
    new Uint8Array(words.buffer).set(flash.subarray(0, ATMEGA328P_FLASH_BYTES));
    this.cpu = new CPU(words, SRAM_BYTES);
    const cpu = this.cpu;
    new AVRTimer(cpu, timer0Config);
    new AVRTimer(cpu, timer1Config);
    new AVRTimer(cpu, timer2Config);
    new AVRClock(cpu, clockHz, clockConfig);
    new AVREEPROM(cpu, new EEPROMMemoryBackend(EEPROM_BYTES), eepromConfig);
    this.usart = new AVRUSART(cpu, usart0Config, clockHz);
    this.portB = new AVRIOPort(cpu, portBConfig);
    this.portC = new AVRIOPort(cpu, portCConfig);
    this.portD = new AVRIOPort(cpu, portDConfig);
    this.adc = new AVRADC(cpu, adcConfig);
  }

  get cycles(): number {
    return this.cpu.cycles;
  }

  /** Run whole instructions until `cycles` more cycles have passed since the last target. */
  run(cycles: number): void {
    const cpu = this.cpu;
    this.target += cycles;
    while (cpu.cycles < this.target) {
      avrInstruction(cpu);
      cpu.tick();
    }
  }
}
