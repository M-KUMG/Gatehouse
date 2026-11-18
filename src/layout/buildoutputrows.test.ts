import { describe, expect, it } from 'vitest';
import type { BuildMessage } from '../build/wasm/diagnostics';
import { compilerNote, detailText, groupMessages, locationText, messageTarget, startsExpanded, treePath } from './buildoutputrows';

const m = (severity: BuildMessage['severity'], message: string, extra: Partial<BuildMessage> = {}): BuildMessage => ({ severity, message, raw: message, ...extra });
const order = (messages: BuildMessage[]) => groupMessages(messages).map((r) => r.message.message);

describe('message order', () => {
  it('puts errors first, then warnings, then loose notes, in the compiler order inside each kind', () => {
    expect(order([m('warning', 'w1'), m('error', 'e1'), m('error', 'e2'), m('warning', 'w2')])).toEqual(['e1', 'e2', 'w1', 'w2']);
  });

  it('keeps a note under the message it explains and moves them together', () => {
    const rows = groupMessages([m('warning', 'w1'), m('note', 'w1 note'), m('error', 'e1'), m('note', 'e1 note a'), m('note', 'e1 note b'), m('warning', 'w2')]);
    expect(rows.map((r) => r.message.message)).toEqual(['e1', 'e1 note a', 'e1 note b', 'w1', 'w1 note', 'w2']);
    expect(rows.map((r) => r.indent)).toEqual([false, true, true, false, true, false]);
  });

  it('a note with nothing before it stands alone, after the warnings', () => {
    const rows = groupMessages([m('note', 'lonely'), m('warning', 'w')]);
    expect(rows.map((r) => r.message.message)).toEqual(['w', 'lonely']);
    expect(rows.find((r) => r.message.message === 'lonely')?.indent).toBe(false);
  });

  it('keeps the original position of each message as its key and does not change the input', () => {
    const input = [m('warning', 'w'), m('error', 'e')];
    expect(groupMessages(input).map((r) => r.index)).toEqual([1, 0]);
    expect(input.map((x) => x.message)).toEqual(['w', 'e']);
    expect(groupMessages([])).toEqual([]);
  });
});

describe('where a message points', () => {
  it('writes file, line and column as far as they are known', () => {
    expect(locationText({ file: 'main.ino', line: 5, column: 3 })).toBe('main.ino:5:3');
    expect(locationText({ file: 'main.ino', line: 5 })).toBe('main.ino:5');
    expect(locationText({ file: 'main.ino' })).toBe('main.ino');
    expect(locationText({})).toBe('');
  });

  const files = new Set(['main.ino', 'src/foo.cpp', 'lib/led.h']);

  it('maps a file of the sketch to the board tree path, with line and column', () => {
    expect(messageTarget({ file: 'main.ino', line: 5, column: 3 }, 'uno-2', files)).toEqual({ boardId: 'uno-2', path: 'main.ino', line: 5, column: 3 });
    expect(messageTarget({ file: 'src/foo.cpp', line: 12 }, 'uno-2', files)).toEqual({ boardId: 'uno-2', path: 'src/foo.cpp', line: 12 });
    expect(messageTarget({ file: './src\\foo.cpp', line: 1 }, 'uno-1', files)).toEqual({ boardId: 'uno-1', path: 'src/foo.cpp', line: 1 });
    expect(messageTarget({ file: 'lib/led.h', line: 2 }, 'uno-1', ['lib/led.h'])?.path).toBe('lib/led.h');
  });

  it('is not clickable without a file or line, or for a file that is not in the tree', () => {
    expect(messageTarget({ line: 5 }, 'uno-1', files)).toBeNull();
    expect(messageTarget({ file: 'main.ino' }, 'uno-1', files)).toBeNull();
    expect(messageTarget({ file: 'main.ino', line: 0 }, 'uno-1', files)).toBeNull();
    expect(messageTarget({ file: 'Servo.h', line: 3 }, 'uno-1', files)).toBeNull();
    expect(messageTarget({ file: '/arduino/libraries/Servo/src/Servo.h', line: 3 }, 'uno-1', files)).toBeNull();
    expect(messageTarget({ file: 'deleted.ino', line: 3 }, 'uno-1', new Set())).toBeNull();
  });

  it('cleans path spelling', () => {
    expect(treePath('.\\a\\b.cpp')).toBe('a/b.cpp');
    expect(treePath('./././x.ino')).toBe('x.ino');
  });
});

describe('details', () => {
  it('shows the "In function" lines, then the code and caret lines', () => {
    expect(detailText({ context: "main.ino: In function 'void setup()':", detail: '  5 |   foo();\n    |   ^~~' })).toBe("main.ino: In function 'void setup()':\n  5 |   foo();\n    |   ^~~");
    expect(detailText({ detail: '  x' })).toBe('  x');
    expect(detailText({})).toBe('');
  });

  it('errors start expanded, the rest collapsed', () => {
    expect(startsExpanded({ severity: 'error' })).toBe(true);
    expect(startsExpanded({ severity: 'warning' })).toBe(false);
    expect(startsExpanded({ severity: 'note' })).toBe(false);
  });
});

describe('the compiler row', () => {
  it('is empty while the compiler is ready or not asked yet', () => {
    expect(compilerNote(null)).toBeNull();
    expect(compilerNote({ status: 'ready' })).toBeNull();
  });

  it('offers the download with its size', () => {
    const note = compilerNote({ status: 'needs-download', downloadBytes: 6 * 1024 * 1024, packs: ['compiler'] });
    expect(note).toMatchObject({ kind: 'download', button: 'Download compiler now (6.0 MB)' });
  });

  it('says in plain words when the files are not served, with the development hint', () => {
    const note = compilerNote({ status: 'unavailable', reason: 'The compiler files are not served here.' });
    expect(note).toMatchObject({ kind: 'unavailable', text: 'The compiler files are not served here' });
    expect(note?.kind === 'unavailable' && note.hint).toContain('npm run toolchain:fetch and npm run toolchain:packs');
  });

  it('gives other reasons as they are, and a different hint when offline', () => {
    const offline = compilerNote({ status: 'unavailable', reason: 'Offline, and the compiler files are not stored for offline use yet.' });
    expect(offline).toMatchObject({ kind: 'unavailable', text: 'Offline, and the compiler files are not stored for offline use yet.', hint: expect.stringContaining('Connect once') });
  });
});
