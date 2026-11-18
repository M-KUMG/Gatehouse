// Parsing REAL tool output (captured from the startabit v1 tools, see fixtures/).
import { describe, expect, it } from 'vitest';
import { formatMessage, ldLocation, parseAsOutput, parseGccOutput, parseLdOutput } from './diagnostics';
import asUnknownOpcode from './fixtures/as-unknown-opcode.txt?raw';
import gccCFile from './fixtures/gcc-c-file-warning.txt?raw';
import gccIncludeChain from './fixtures/gcc-include-chain.txt?raw';
import gccMissingHeader from './fixtures/gcc-missing-header.txt?raw';
import gccSecondIno from './fixtures/gcc-second-ino.txt?raw';
import gccTemplate from './fixtures/gcc-template-warning.txt?raw';
import ldIsrServo from './fixtures/ld-isr-servo.txt?raw';
import ldMultiple from './fixtures/ld-multiple-definition.txt?raw';
import ldUndefined from './fixtures/ld-undefined-reference.txt?raw';

/** Like the pipeline's mapping: /sketch/x -> x, /build/x.o -> x, the joined .ino unit -> its primary file. */
const mapPath = (p: string): string => {
  if (/^\/sketch\/[^/]+\.ino\.cpp$/.test(p)) return p.slice(8, -4);
  if (p.startsWith('/sketch/')) return p.slice(8);
  if (p.startsWith('/build/')) return p.slice(7).replace(/\.o$/, '');
  return p;
};

const brief = (ms: ReturnType<typeof parseGccOutput>) => ms.map((m) => [m.severity, m.file, m.line, m.column, m.message]);

describe('parseGccOutput', () => {
  it('maps an error in the second .ino file to that file and line, with snippet and context', () => {
    const ms = parseGccOutput(gccSecondIno, mapPath);
    expect(brief(ms)).toEqual([
      ['error', 'b_helpers.ino', 4, 3, "'dealy' was not declared in this scope"],
      ['note', 'b_helpers.ino', 4, 3, "suggested alternative: 'delay'"],
      ['error', 'b_helpers.ino', 6, 1, "expected ';' before '}' token"],
    ]);
    expect(ms[0].context).toBe("b_helpers.ino: In function 'void blinkOnce(int)':");
    expect(ms[0].detail).toBe('   dealy(ms);\n   ^~~~~');
    expect(ms[1].detail).toBe('   dealy(ms);\n   ^~~~~\n   delay');
    expect(ms[0].raw).toBe("b_helpers.ino: In function 'void blinkOnce(int)':\nb_helpers.ino:4:3: error: 'dealy' was not declared in this scope\n   dealy(ms);\n   ^~~~~");
    expect(formatMessage(ms[2])).toBe("b_helpers.ino:6:1: error: expected ';' before '}' token");
  });

  it('keeps an include chain as context, with internal paths mapped', () => {
    const ms = parseGccOutput(gccIncludeChain, mapPath);
    expect(brief(ms)[0]).toEqual(['error', 'toolarge.ino', 1, 26, "size of array 'big' is too large"]);
    expect(ms[0].context).toBe('In file included from /arduino/core/Arduino.h:28:0,\n                 from toolarge.ino:1:');
    expect(ms[2]).toMatchObject({ severity: 'note', line: 3, column: 30 });
    expect(ms[2].detail).toBeUndefined();
  });

  it('reads warnings, template "required from here" context and a fatal missing header', () => {
    const ms = parseGccOutput(gccTemplate, mapPath);
    expect(brief(ms)).toEqual([
      ['warning', 'warn.ino', 4, 21, 'large integer implicitly truncated to unsigned type [-Woverflow]'],
      ['error', 'warn.ino', 2, 43, "request for member 'x' in 't', which is of non-class type 'int'"],
    ]);
    expect(ms[1].context).toBe("warn.ino: In instantiation of 'T twice(T) [with T = int]':\nwarn.ino:5:18:   required from here");
    const missing = parseGccOutput(gccMissingHeader, mapPath);
    expect(brief(missing)).toEqual([['error', 'missinghdr.ino', 1, 10, 'config.h: No such file or directory']]);
    expect(missing[0].raw).toMatch(/compilation terminated\.$/);
  });

  it('maps a .c file compiled as C++ to its own name', () => {
    expect(brief(parseGccOutput(gccCFile, mapPath))).toEqual([
      ['warning', 'src/mathc.c', 5, 48, "invalid conversion from 'void*' to 'int*' [-fpermissive]"],
    ]);
  });

  it('never drops text it does not recognise', () => {
    expect(parseGccOutput('cc1plus: out of memory allocating 65536 bytes\n')).toEqual([
      { severity: 'error', message: 'cc1plus: out of memory allocating 65536 bytes', raw: 'cc1plus: out of memory allocating 65536 bytes' },
    ]);
    expect(parseGccOutput('cc1plus: fatal error: x.cpp: No such file or directory')[0]).toMatchObject({ severity: 'error', message: 'x.cpp: No such file or directory' });
  });
});

describe('parseLdOutput', () => {
  it('summarises undefined references with the source line, keeping the raw text', () => {
    const ms = parseLdOutput(ldUndefined, mapPath);
    expect(ms.map((m) => [m.file, m.line, m.message])).toEqual([
      ['undefref.ino', 3, "Undefined reference to 'foo()' in setup: it is declared but never defined, or its library is not included."],
      ['undefref.ino', 4, "Undefined reference to 'helper(int)' in loop: it is declared but never defined, or its library is not included."],
    ]);
    expect(ms[0].raw).toBe("ld: undefref.ino: in function `setup':\nundefref.ino:3:(.text.setup+0x0): undefined reference to `foo()'");
  });

  it('names both files of a multiple definition', () => {
    const ms = parseLdOutput(ldMultiple, mapPath);
    expect(ms.map((m) => [m.file, m.line, m.message])).toEqual([
      ['b.cpp', 3, "'tick()' is defined more than once: in b.cpp:3 and in a.cpp:3. Define it in one file only (declare it 'extern' in the others)."],
      ['b.cpp', 2, "'counter' is defined more than once: in b.cpp:2 and in a.cpp:2. Define it in one file only (declare it 'extern' in the others)."],
    ]);
  });

  it('explains an interrupt handler clash with a library and points at the sketch', () => {
    const [m] = parseLdOutput(ldIsrServo, mapPath);
    expect(m).toMatchObject({ severity: 'error', file: 'isrservo.ino', line: 3 });
    expect(m.message).toMatch(/^Interrupt handler __vector_11 \(vector 11\) is defined twice: in isrservo\.ino:3 and in the Servo library\./);
  });

  it('recognises region overflows and passes other lines through', () => {
    const [a, b, c] = parseLdOutput(
      "ld: firmware.elf section `.text' will not fit in region `text'\nld: region `text' overflowed by 1234 bytes\nld: cannot find -lfoo\n",
    );
    expect(a.message).toMatch(/^Sketch too big for the flash memory/);
    expect(b.message).toBe("Sketch too big for the flash memory: region `text' overflowed by 1234 bytes");
    expect(c).toMatchObject({ severity: 'error', message: 'cannot find -lfoo' });
  });

  it('finds locations in its various forms', () => {
    expect(ldLocation('/build/a.cpp.o:/sketch/a.cpp:3', mapPath)).toEqual({ file: 'a.cpp', line: 3 });
    expect(ldLocation('/sketch/a.ino:4:(.text.loop+0x4)', mapPath)).toEqual({ file: 'a.ino', line: 4 });
    expect(ldLocation('a.ino.cpp:(.text.loop+0x4)', mapPath)).toEqual({ file: 'a.ino.cpp' });
    expect(ldLocation('ld: /arduino/libraries/Servo.a(avr_Servo.cpp.o)', mapPath)).toEqual({ file: '/arduino/libraries/Servo.a(avr_Servo.cpp.o)', library: 'Servo' });
  });
});

describe('parseAsOutput', () => {
  it('names the unit and the assembly line (not a sketch line)', () => {
    const [m] = parseAsOutput(asUnknownOpcode, 'asmerr.ino');
    expect(m).toMatchObject({ severity: 'error', file: 'asmerr.ino' });
    expect(m.line).toBeUndefined();
    expect(m.message).toBe("Assembler error in the code generated for asmerr.ino (assembly line 22): unknown opcode `bogus'");
  });
});
