// Board profiles for the browser compiler, as DATA: which MCU, defines, core
// variant, sysroot pieces and flags build a sketch for a board. A new AVR
// board (a Mega) is a new entry here plus its sysroot pack, not new code.
// Pure, no DOM, no Node.

import { SYSROOT } from './sysroot';

export interface BoardProfile {
  id: string;
  name: string;
  /** e.g. 'atmega328p' */
  mcu: string;
  /** GCC multilib / ld emulation (avr5 for the ATmega328P). */
  arch: string;
  /** F_CPU value as Arduino defines it. */
  fCpu: string;
  /** Preprocessor defines (without -D), board and MCU ones included. */
  defines: readonly string[];
  /** Arduino core variant name (the pins_arduino.h folder). */
  variant: string;
  /** Include directories in the tools' filesystem, before the sketch's own. */
  systemIncludeDirs: readonly string[];
  includeDirs: readonly string[];
  /** Precompiled core archive. */
  coreArchive: string;
  /** cc1plus flags that the avr-gcc driver would add for this MCU. */
  targetFlags: readonly string[];
  /**
   * Compile flags: Arduino's C++ recipe without -c (cc1plus emits assembly),
   * -flto (no LTO plugin) and -MMD (dependency files are not used: the object
   * cache key includes every sketch header). -g stays so ld can name the
   * source line of an undefined reference; it does not change the hex.
   */
  cppFlags: readonly string[];
  /** Assembler flags. */
  asFlags: readonly string[];
  link: {
    /** ld flags before the inputs. */
    flags: readonly string[];
    /** Start-up object, linked first. */
    crt: string;
    libDirs: readonly string[];
    /** Linked after the objects, core and libraries, in this order (-l names). */
    libs: readonly string[];
    /** The files those -l names resolve to (mounted for ld). */
    libFiles: readonly string[];
    /** Files ld opens by name: the default linker script it looks for at ldscripts/<arch>.xn (relative to /). */
    script: { from: string; to: string };
  };
  /** Flash available to the sketch (the bootloader takes the rest), bytes. */
  flashMax: number;
  /** SRAM, bytes. */
  ramSize: number;
  /** Anything a person should know about this profile. */
  notes?: string;
}

const avr328 = (id: string, name: string, boardDefine: string, notes?: string): BoardProfile => ({
  id,
  name,
  mcu: 'atmega328p',
  arch: 'avr5',
  fCpu: '16000000L',
  defines: [
    '__AVR_ATmega328P__', '__AVR_DEVICE_NAME__=atmega328p', 'F_CPU=16000000L', 'ARDUINO=10819', boardDefine, 'ARDUINO_ARCH_AVR',
  ],
  variant: 'standard',
  systemIncludeDirs: [SYSROOT.gccInclude, SYSROOT.gccIncludeFixed, SYSROOT.libcInclude],
  includeDirs: [SYSROOT.standardVariant, SYSROOT.core],
  coreArchive: SYSROOT.coreArchive,
  targetFlags: ['-imultilib', 'avr5', '-mn-flash=1', '-mno-skip-bug', '-mmcu=avr5'],
  cppFlags: [
    '-g', '-Os', '-std=gnu++11', '-fpermissive', '-fno-exceptions', '-ffunction-sections', '-fdata-sections',
    '-fno-threadsafe-statics', '-Wno-error=narrowing', '-fno-rtti', '-fno-enforce-eh-specs',
  ],
  asFlags: ['-mmcu=atmega328p'],
  link: {
    flags: ['-m', 'avr5', '-Tdata=0x800100', '--gc-sections'],
    crt: `${SYSROOT.libDir('avr5')}/crtatmega328p.o`,
    libDirs: [SYSROOT.libDir('avr5'), SYSROOT.gccLibDir('avr5')],
    libs: ['m', 'c', 'atmega328p', 'gcc'],
    libFiles: [
      `${SYSROOT.libDir('avr5')}/libm.a`, `${SYSROOT.libDir('avr5')}/libc.a`, `${SYSROOT.libDir('avr5')}/libatmega328p.a`,
      `${SYSROOT.gccLibDir('avr5')}/libgcc.a`,
    ],
    script: { from: `${SYSROOT.ldScripts}/avr5.xn`, to: '/ldscripts/avr5.xn' },
  },
  flashMax: 32256,
  ramSize: 2048,
  notes,
});

export const BOARD_PROFILES: Readonly<Record<string, BoardProfile>> = {
  uno: avr328('uno', 'Arduino Uno', 'ARDUINO_AVR_UNO'),
  nano: avr328(
    'nano',
    'Arduino Nano',
    'ARDUINO_AVR_NANO',
    'Built with the Uno\'s "standard" variant: the sysroot pack has no "eightanaloginputs" variant, so A6 and A7 are not defined. ' +
      'The precompiled core was built for the Uno (ARDUINO_AVR_UNO), which is the same ATmega328P code.',
  ),
};

export function getBoardProfile(id: string): BoardProfile | undefined {
  return Object.prototype.hasOwnProperty.call(BOARD_PROFILES, id) ? BOARD_PROFILES[id] : undefined;
}
