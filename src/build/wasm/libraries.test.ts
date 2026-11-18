import { describe, expect, it } from 'vitest';
import { resolveLibraries, scanIncludes } from './libraries';
import { BUNDLED_LIBRARIES } from './sysroot';

const names = (files: { path: string; text: string }[]) => resolveLibraries(files).libraries.map((l) => l.name);

describe('scanIncludes', () => {
  it('finds includes with their position, ignoring comments', () => {
    const text = '// #include <Nope.h>\n/* #include <Nope2.h> */\n  #  include <Servo.h>\n#include "local.h" // note\n';
    expect(scanIncludes({ path: 'a.ino', text })).toEqual([
      { file: 'a.ino', line: 3, column: 14, header: 'Servo.h', angle: true },
      { file: 'a.ino', line: 4, column: 10, header: 'local.h', angle: false },
    ]);
  });
});

describe('resolveLibraries', () => {
  it('links only the libraries the sketch includes, in table order', () => {
    expect(names([{ path: 'a.ino', text: '#include <Wire.h>\n#include "Servo.h"\n#include <Arduino.h>\n#include <avr/io.h>\n' }])).toEqual(['Wire', 'Servo']);
    expect(names([{ path: 'a.ino', text: 'void setup() {}\n' }])).toEqual([]);
  });

  it('finds includes in .cpp, .c and header files under src/ too', () => {
    const files = [
      { path: 'a.ino', text: '#include "src/dev.h"\n' },
      { path: 'src/dev.h', text: '#include <SPI.h>\n' },
      { path: 'src/x.c', text: '#include <EEPROM.h>\n' },
    ];
    expect(names(files)).toEqual(['SPI', 'EEPROM']);
    expect(resolveLibraries(files).libraries.find((l) => l.name === 'EEPROM')?.archive).toBeUndefined();
  });

  it('prefers the sketch\'s own headers (root, src/, or next to the includer)', () => {
    const files = [
      { path: 'a.ino', text: '#include <Wire.h>\n#include "util.h"\n' },
      { path: 'Wire.h', text: '' },
      { path: 'src/util.h', text: '#include "../Wire.h"\n#include "deep/x.h"\n' },
      { path: 'src/deep/x.h', text: '' },
    ];
    const r = resolveLibraries(files);
    expect(r.errors).toEqual([]);
    expect(r.libraries).toEqual([]);
  });

  it('reports an unknown library with the file and line, and lists the bundled ones', () => {
    const r = resolveLibraries([{ path: 'main.ino', text: 'void x();\n#include <DHT.h>\n' }]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ severity: 'error', file: 'main.ino', line: 2, column: 10 });
    expect(r.errors[0].message).toBe(
      "Library 'DHT.h' is not available in the browser compiler. Bundled libraries: Wire, SPI, SoftwareSerial, EEPROM, Servo, Adafruit_NeoPixel, HCSR04.",
    );
  });

  it('hints at the right case for a known header', () => {
    const r = resolveLibraries([{ path: 'main.ino', text: '#include <servo.h>\n' }]);
    expect(r.errors[0].message).toMatch(/case-sensitive, did you mean <Servo\.h>\?/);
  });

  it('leaves a missing quoted include to the compiler', () => {
    expect(resolveLibraries([{ path: 'main.ino', text: '#include "config.h"\n' }]).errors).toEqual([]);
  });

  it('has an include folder for every bundled library and an archive for all but EEPROM', () => {
    for (const l of BUNDLED_LIBRARIES) {
      expect(l.includeDir).toBe(`/arduino/libraries/${l.name}`);
      expect(l.archive === undefined).toBe(l.name === 'EEPROM');
    }
  });
});
