// What the AVR sysroot pack contains (startabit/avr-gcc-wasm v1, Arduino AVR
// core 1.8.8), as data: where things are in the tools' filesystem, which
// headers the core / avr-libc / GCC provide, and the bundled libraries.
// Derived from the unpacked sysroot and its manifest.json; a tool-backed test
// checks this table against the real files. Pure, no DOM, no Node.

/** The tools' filesystem paths (the sysroot is mounted at /). */
export const SYSROOT = {
  gccInclude: '/sysroot/lib/gcc/avr/7.3.0/include',
  gccIncludeFixed: '/sysroot/lib/gcc/avr/7.3.0/include-fixed',
  libcInclude: '/sysroot/avr/include',
  core: '/arduino/core',
  coreArchive: '/arduino/core.a',
  /** The `standard` variant (the only one in the pack, in an unnamed folder). */
  standardVariant: '/arduino/variant',
  libraries: '/arduino/libraries',
  libDir: (arch: string): string => `/sysroot/avr/lib/${arch}`,
  gccLibDir: (arch: string): string => `/sysroot/lib/gcc/avr/7.3.0/${arch}`,
  ldScripts: '/sysroot/avr/lib/ldscripts',
} as const;

/** Headers of the Arduino core (arduino/core). */
export const CORE_HEADERS: readonly string[] = [
  'Arduino.h', 'Client.h', 'HardwareSerial.h', 'HardwareSerial_private.h', 'IPAddress.h', 'PluggableUSB.h',
  'Print.h', 'Printable.h', 'Server.h', 'Stream.h', 'USBAPI.h', 'USBCore.h', 'USBDesc.h', 'Udp.h',
  'WCharacter.h', 'WString.h', 'binary.h', 'new', 'new.h', 'wiring_private.h',
];

/** Headers of the board variant folder. */
export const VARIANT_HEADERS: readonly string[] = ['pins_arduino.h'];

/** avr-libc headers (sysroot/avr/include, trimmed to the ATmega328P). */
export const LIBC_HEADERS: readonly string[] = [
  'alloca.h', 'assert.h', 'ctype.h', 'errno.h', 'fcntl.h', 'inttypes.h', 'locale.h', 'math.h', 'setjmp.h',
  'signal.h', 'stdfix-avrlibc.h', 'stdint.h', 'stdio.h', 'stdlib.h', 'string.h', 'time.h', 'unistd.h',
  'avr/boot.h', 'avr/builtins.h', 'avr/common.h', 'avr/cpufunc.h', 'avr/crc16.h', 'avr/delay.h', 'avr/eeprom.h',
  'avr/fuse.h', 'avr/interrupt.h', 'avr/io.h', 'avr/iom328p.h', 'avr/iomxx0_1.h', 'avr/iousbxx6_7.h', 'avr/lock.h',
  'avr/parity.h', 'avr/pgmspace.h', 'avr/portpins.h', 'avr/power.h', 'avr/sfr_defs.h', 'avr/signal.h',
  'avr/signature.h', 'avr/sleep.h', 'avr/version.h', 'avr/wdt.h', 'avr/xmega.h',
  'compat/deprecated.h', 'compat/ina90.h', 'compat/twi.h', 'sys/types.h',
  'util/atomic.h', 'util/crc16.h', 'util/delay.h', 'util/delay_basic.h', 'util/eu_dst.h', 'util/parity.h',
  'util/setbaud.h', 'util/twi.h', 'util/usa_dst.h',
];

/** GCC's own headers (lib/gcc/avr/7.3.0/include and include-fixed). */
export const GCC_HEADERS: readonly string[] = [
  'float.h', 'gcov.h', 'iso646.h', 'stdalign.h', 'stdarg.h', 'stdatomic.h', 'stdbool.h', 'stddef.h',
  'stdfix-gcc.h', 'stdfix.h', 'stdint-gcc.h', 'stdint.h', 'stdnoreturn.h', 'unwind.h', 'varargs.h',
  'limits.h', 'syslimits.h',
];

/** A precompiled library in the sysroot pack. */
export interface BundledLibrary {
  name: string;
  version: string;
  /** Top-level headers a sketch includes to use it. */
  headers: readonly string[];
  /** Include directory (tools' filesystem). */
  includeDir: string;
  /** Archive to link, or undefined for header-only libraries (EEPROM). */
  archive?: string;
}

const lib = (name: string, version: string, headers: string[], archive = true): BundledLibrary => ({
  name, version, headers, includeDir: `${SYSROOT.libraries}/${name}`,
  archive: archive ? `${SYSROOT.libraries}/${name}.a` : undefined,
});

/** The bundled libraries (manifest.json of the pack). */
export const BUNDLED_LIBRARIES: readonly BundledLibrary[] = [
  lib('Wire', '1.8.8', ['Wire.h']),
  lib('SPI', '1.8.8', ['SPI.h']),
  lib('SoftwareSerial', '1.8.8', ['SoftwareSerial.h']),
  lib('EEPROM', '1.8.8', ['EEPROM.h'], false),
  lib('Servo', '1.3.0', ['Servo.h']),
  lib('Adafruit_NeoPixel', '1.15.5', ['Adafruit_NeoPixel.h']),
  lib('HCSR04', '2.0.0', ['HCSR04.h']),
];

/** Every header a sketch may include without a library (core, variant, avr-libc, GCC). */
export const SYSTEM_HEADERS: ReadonlySet<string> = new Set([...CORE_HEADERS, ...VARIANT_HEADERS, ...LIBC_HEADERS, ...GCC_HEADERS]);
