import { describe, expect, it } from 'vitest';
import { orderInoFiles, prepareIno, scanFunctions, type SourceFile } from './preprocess';
import { blankSource } from './source';

/** Where line `n` (1-based) of the unit text comes from, following #line directives like the compiler. */
function origin(text: string, n: number): { file: string; line: number } {
  const lines = text.split('\n');
  let file = '<unit>';
  let line = 1;
  for (let k = 0; k < n - 1; k++) {
    const m = /^#line (\d+) "(.*)"$/.exec(lines[k]);
    if (m) {
      line = Number(m[1]);
      file = m[2];
    } else line++;
  }
  return { file, line };
}

/** Where `needle` (first occurrence, or the occurrence after `after`) lands in the original files. */
function whereIs(text: string, needle: string): { file: string; line: number } {
  const lines = text.split('\n');
  const k = lines.findIndex((l) => l.includes(needle) && !l.startsWith('#line'));
  expect(k, `"${needle}" in the unit`).toBeGreaterThanOrEqual(0);
  return origin(text, k + 1);
}

const prep = (files: SourceFile[]) => prepareIno(files);
const protos = (text: string) => prepareIno([{ path: 'a.ino', text }]).prototypes;

describe('orderInoFiles', () => {
  it('puts the file named like the sketch folder first, then the rest alphabetically', () => {
    expect(orderInoFiles(['b.ino', 'Blink.ino', 'a.ino'], 'Blink')).toEqual(['Blink.ino', 'a.ino', 'b.ino']);
  });

  it('falls back to main.ino, then sketch.ino, then the first alphabetically', () => {
    expect(orderInoFiles(['z.ino', 'main.ino', 'a.ino'])).toEqual(['main.ino', 'a.ino', 'z.ino']);
    expect(orderInoFiles(['z.ino', 'sketch.ino', 'a.ino'], 'Other')).toEqual(['sketch.ino', 'a.ino', 'z.ino']);
    expect(orderInoFiles(['z.ino', 'B.ino', 'a.ino'])).toEqual(['a.ino', 'B.ino', 'z.ino']);
    expect(orderInoFiles([])).toEqual([]);
  });
});

describe('blankSource', () => {
  it('blanks comments, strings and directives without moving anything', () => {
    const src = 'int a; // c { \n/* x\n } */ char *s = "a{b}\\"c"; char c = \'{\';\n#define X { \\\n  }\nconst char *r = R"x(a")}x";\n';
    const all = blankSource(src, { strings: true, directives: true });
    expect(all.length).toBe(src.length);
    expect(all.split('\n').length).toBe(src.split('\n').length);
    expect(all).not.toMatch(/[{}]/);
    expect(blankSource(src)).toContain('"a{b}\\"c"');
    expect(blankSource(src)).toContain('#define X');
  });
});

describe('prepareIno', () => {
  it('includes Arduino.h first and joins the files primary first, with #line for each', () => {
    const r = prep([
      { path: 'main.ino', text: 'void setup() {}\nvoid loop() { helper(); }\n' },
      { path: 'b.ino', text: '// b\nvoid helper() {\n  int x = 1;\n}\n' },
    ]);
    expect(r.text.split('\n')[0]).toBe('#include <Arduino.h>');
    expect(r.order).toEqual(['main.ino', 'b.ino']);
    expect(r.prototypes).toEqual(['void helper();']);
    expect(whereIs(r.text, 'void loop()')).toEqual({ file: 'main.ino', line: 2 });
    expect(whereIs(r.text, 'int x = 1')).toEqual({ file: 'b.ino', line: 3 });
    // The prototype is placed before the first function (setup), pointing at its definition.
    const lines = r.text.split('\n');
    expect(lines.indexOf('void helper();')).toBeLessThan(lines.indexOf('void setup() {}'));
    expect(whereIs(r.text, 'void helper();')).toEqual({ file: 'b.ino', line: 2 });
  });

  it('keeps types declared above the first function visible to the prototypes', () => {
    const text = '#include "x.h"\nstruct Point { int x, y; };\nint total = 0;\n\nvoid setup() {}\nvoid loop() {}\nvoid move(Point p) {}\n';
    const r = prep([{ path: 'main.ino', text }]);
    const lines = r.text.split('\n');
    const at = lines.indexOf('void move(Point p);');
    expect(at).toBeGreaterThan(lines.findIndex((l) => l.startsWith('struct Point')));
    expect(at).toBeLessThan(lines.indexOf('void setup() {}'));
    expect(whereIs(r.text, 'void setup()')).toEqual({ file: 'main.ino', line: 5 });
    expect(whereIs(r.text, 'void move(Point p) {}')).toEqual({ file: 'main.ino', line: 7 });
  });

  it('keeps columns when the first function shares a line with the end of a comment', () => {
    const text = '/* a\n b */ int twice(int v) { return 2 * v; }\nvoid setup() {}\nvoid loop() {}\n';
    const r = prep([{ path: 'main.ino', text }]);
    const line = r.text.split('\n').find((l) => l.includes('int twice(int v) {'))!;
    expect(line.indexOf('int twice')).toBe(text.split('\n')[1].indexOf('int twice'));
    expect(whereIs(r.text, 'int twice(int v) {')).toEqual({ file: 'main.ino', line: 2 });
    expect(r.prototypes).toEqual(['int twice(int v);']);
  });

  it('uses the given names in #line (paths the compiler can open)', () => {
    const r = prepareIno([{ path: 'main.ino', text: 'void setup() {}\n' }], (p) => `/sketch/${p}`);
    expect(r.text).toContain('#line 1 "/sketch/main.ino"');
  });
});

describe('prototype generation', () => {
  it('handles return types with qualifiers, pointers and references, over several lines', () => {
    expect(
      protos(
        'static int a(int x) { return x; }\ninline const char *b() { return ""; }\nString &c(String &s) { return s; }\n' +
          'unsigned long\nd(byte p,\n  int q)\n{ return 0; }\nvoid setup() {}\nvoid loop() {}\n',
      ),
    ).toEqual(['static int a(int x);', 'inline const char *b();', 'String &c(String &s);', 'unsigned long d(byte p, int q);']);
  });

  it('ignores braces and parentheses in comments, strings, chars and preprocessor lines', () => {
    const text =
      '#define BLOCK { int z; }\n#if 0\n#endif\nconst char *s = "void fake() {";\nchar c = \'{\';\n' +
      '// void commented() {\n/* void old() { } */\nvoid real(const char *m = "x)") { Serial.print("}"); }\n';
    expect(protos(text)).toEqual(['void real(const char *m = "x)");']);
  });

  it('moves default arguments to the prototype and removes them from the definition', () => {
    const r = prep([{ path: 'a.ino', text: 'void setup() { blink(); }\nvoid loop() {}\nvoid blink(int times = 3, int ms = 100) {}\n' }]);
    expect(r.prototypes).toEqual(['void blink(int times = 3, int ms = 100);']);
    const def = r.text.split('\n').find((l) => l.startsWith('void blink(int times') && l.endsWith('{}'))!;
    expect(def.replace(/\s+/g, ' ')).toBe('void blink(int times , int ms ) {}');
  });

  it('skips templates, class members, setup/loop, ISRs, lambdas and non-functions', () => {
    const text = [
      'template <typename T> T biggest(T a, T b) { return a > b ? a : b; }',
      'class Led { public: void on() { } };',
      'struct P { int x; } p = { 1 };',
      'void Led2::off() {}',
      'namespace util { int f() { return 1; } }',
      'extern "C" { void cfun() {} }',
      'ISR(TIMER1_COMPA_vect) { }',
      'auto sq = [](int v) { return v * v; };',
      'int table[] = { 1, 2 };',
      'enum Mode { A, B };',
      'void setup() { if (true) { } }',
      'void loop() { for (;;) { } }',
    ].join('\n');
    expect(protos(text)).toEqual([]);
  });

  it('does not duplicate an existing prototype, but keeps overloads apart', () => {
    const text = 'void a(int);\nvoid setup() {}\nvoid loop() {}\nvoid a(int v) {}\nvoid a(int v, int w) {}\nvoid b() {}\nvoid b() {}\n';
    expect(protos(text)).toEqual(['void a(int v, int w);', 'void b();']);
  });

  it('records definitions and declarations', () => {
    const s = scanFunctions('int f(void);\nint f(void) { return 1; }\nint g(int a, int b = 2) { return a; }\n');
    expect([...s.declared]).toEqual(['f/0']);
    expect(s.definitions.map((d) => [d.name, d.arity, d.line])).toEqual([['f', 0, 2], ['g', 2, 3]]);
  });
});
