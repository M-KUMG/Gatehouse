import { describe, expect, it } from 'vitest';
import { extensionOf, fileName, isEditable, languageFor } from './editorlang';

describe('extensionOf / fileName', () => {
  it('reads the last segment and a lower-case extension', () => {
    expect(fileName('lib/deep/led.h')).toBe('led.h');
    expect(fileName('main.ino')).toBe('main.ino');
    expect(extensionOf('lib/LED.H')).toBe('h');
    expect(extensionOf('a.b.py')).toBe('py');
  });

  it('treats names without a real extension as having none', () => {
    expect(extensionOf('Makefile')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('name.')).toBe('');
    expect(extensionOf('dir.d/Makefile')).toBe('');
  });
});

describe('isEditable', () => {
  it('accepts the text and source types', () => {
    for (const p of ['main.ino', 'a.cpp', 'a.c', 'a.h', 'a.hpp', 'a.py', 'n.txt', 'r.md', 'c.json', 'c.ini', 'c.cfg', 'd.csv', 'lib/Util.CPP']) {
      expect(isEditable(p), p).toBe(true);
    }
  });

  it('accepts files with no extension', () => {
    expect(isEditable('Makefile')).toBe(true);
    expect(isEditable('lib/LICENSE')).toBe(true);
    expect(isEditable('.gitignore')).toBe(true);
  });

  it('refuses everything else (binary kinds)', () => {
    for (const p of ['firmware.hex', 'a.bin', 'logo.png', 'x.elf', 'lib.zip', 'a.uf2']) expect(isEditable(p), p).toBe(false);
  });
});

describe('languageFor', () => {
  it('uses C/C++ for the Arduino and C family', () => {
    for (const p of ['main.ino', 'a.cpp', 'a.c', 'a.h', 'a.hpp', 'src/b.CC']) expect(languageFor(p), p).toBe('cpp');
  });

  it('uses Python for .py, JSON for .json and plain text for the rest', () => {
    expect(languageFor('main.py')).toBe('python');
    expect(languageFor('lib/x.PY')).toBe('python');
    expect(languageFor('gatehouse.json')).toBe('json');
    expect(languageFor('lib/Data.JSON')).toBe('json');
    for (const p of ['n.txt', 'r.md', 'Makefile', 'c.ini']) expect(languageFor(p), p).toBe('plain');
  });
});
