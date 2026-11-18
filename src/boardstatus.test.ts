import { describe, expect, it } from 'vitest';
import { statusParts } from './boardstatus';
import { idleBuildState, type BoardBuildState } from './build/buildlog';
import type { BoardRunState } from './mcu/runtime';

const base: BoardRunState = { state: 'stopped', time: 0, speed: 0, firmwareName: null, messages: [], building: false };
const parts = (s: Partial<BoardRunState>) => statusParts({ ...base, ...s });

describe('board status text', () => {
  it('a stopped board: grey dot, zero time, no firmware yet', () => {
    expect(parts({})).toMatchObject({ dot: 'stopped', state: 'Stopped', time: '0.0 s', firmware: '', note: '', noteIsError: false, line: 'Stopped · 0.0 s' });
  });

  it('a running board shows the speed with two decimals, the time and the firmware', () => {
    const p = parts({ state: 'running', speed: 1, time: 3.24, firmwareName: 'firmware.hex' });
    expect(p).toMatchObject({ dot: 'running', state: 'Running 1.00x', time: '3.2 s', firmware: 'firmware.hex' });
    expect(p.line).toBe('Running 1.00x · 3.2 s · firmware.hex');
    expect(parts({ state: 'running', speed: 0.874, time: 1 }).state).toBe('Running 0.87x');
  });

  it('a running board before the clock has measured a speed omits it', () => {
    expect(parts({ state: 'running', speed: 0 }).state).toBe('Running');
  });

  it('a paused board keeps its time and shows an amber dot', () => {
    expect(parts({ state: 'paused', time: 12.06, firmwareName: 'firmware.hex' })).toMatchObject({ dot: 'paused', state: 'Paused', time: '12.1 s' });
  });

  it('build messages go in the note, joined; the tooltip has everything', () => {
    const p = parts({
      state: 'running', speed: 1, time: 0.5, firmwareName: 'firmware.hex',
      messages: ['Sketch files are not compiled yet: running firmware.hex', 'Second note'],
    });
    expect(p.note).toBe('Sketch files are not compiled yet: running firmware.hex Second note');
    expect(p.noteIsError).toBe(false);
    expect(p.title).toBe(`${p.line}\n${p.note}`);
  });

  it('puts the board name first in the tooltip when it is given (not in the first line)', () => {
    const p = statusParts({ ...base, state: 'running', speed: 1, time: 1 }, 'Blinker');
    expect(p.line).toBe('Running 1.00x · 1.0 s');
    expect(p.title).toBe('Blinker\nRunning 1.00x · 1.0 s');
    expect(statusParts({ ...base, state: 'error', error: 'boom' }, 'Arduino Uno #1').title).toBe('Arduino Uno #1\nError\nboom');
    expect(statusParts(base).title).toBe(statusParts(base, '').title);
  });

  it('the error state shows the error text, a red dot and no time', () => {
    const p = parts({ state: 'error', error: 'No firmware: import a .hex into the board folder' });
    expect(p).toMatchObject({
      dot: 'error', state: 'Error', time: '', note: 'No firmware: import a .hex into the board folder', noteIsError: true, line: 'Error',
    });
  });

  it('an error wins over stale messages', () => {
    expect(parts({ state: 'error', error: 'boom', messages: ['old note'] }).note).toBe('boom');
  });

  it('while building the state says so, whatever the dot', () => {
    expect(parts({ building: true })).toMatchObject({ dot: 'stopped', state: 'Building…', line: 'Building… · 0.0 s' });
    expect(parts({ building: true, state: 'error', error: 'old' }).state).toBe('Building…');
  });
});

describe('board status with a build log', () => {
  const build = (b: Partial<BoardBuildState>): BoardBuildState => ({ ...idleBuildState(), ...b });
  const err = (message: string) => ({ severity: 'error' as const, message, raw: message });
  const warn = (message: string) => ({ severity: 'warning' as const, message, raw: message });
  const chip = (s: Partial<BoardRunState>, b: Partial<BoardBuildState>) => statusParts({ ...base, ...s }, undefined, build(b));

  it('without a build log nothing changes', () => {
    expect(statusParts(base, undefined, null)).toEqual(statusParts(base));
    expect(statusParts(base, 'x', build({}))).toEqual(statusParts(base, 'x'));
  });

  it('while building the note shows what the build does', () => {
    const p = chip({ building: true }, { status: 'building', progress: { phase: 'compile', message: 'Compiling main.ino (1/3)', current: 1, total: 3 } });
    expect(p).toMatchObject({ state: 'Building…', note: 'Compiling main.ino (1/3)', noteIsError: false, clickable: false });
    expect(chip({ building: true }, { status: 'building', progress: { phase: 'link', message: 'Linking' } }).note).toBe('Linking');
  });

  it('while the compiler downloads the note shows the percentage', () => {
    const downloads = [{ pack: 'compiler', loadedBytes: 450, totalBytes: 1000, fromCache: false }];
    expect(chip({ building: true }, { status: 'downloading', downloads }).note).toBe('Downloading compiler 45%');
  });

  it('a failed compile shows the summary in red with the hint and the chip opens the build output', () => {
    const p = chip(
      { state: 'error', error: 'Build failed: main.ino:3:1: error: x' },
      { status: 'failed', source: 'compiled', summary: 'Build failed: 2 errors.', messages: [err('a'), err('b')] },
    );
    expect(p).toMatchObject({ note: 'Build failed: 2 errors, see Build output', noteIsError: true, clickable: true, dot: 'error' });
    expect(p.title).toContain('see Build output');
  });

  it('a failed compile-only build shows it too, whatever the board does', () => {
    const p = chip({ state: 'running', speed: 1, time: 2 }, { status: 'failed', source: 'compiled', summary: 'Build failed: 1 error.' });
    expect(p).toMatchObject({ state: 'Running 1.00x', note: 'Build failed: 1 error, see Build output', noteIsError: true, clickable: true });
  });

  it('a failed firmware-file build keeps its own error text (still opens the build output)', () => {
    const p = chip({ state: 'error', error: 'No firmware: import a .hex into the board folder' }, { status: 'failed', source: null, summary: 'Build failed: 1 error.' });
    expect(p).toMatchObject({ note: 'No firmware: import a .hex into the board folder', noteIsError: true, clickable: true });
  });

  it('a compiled build says so next to the firmware name and drops the old notes', () => {
    const p = chip(
      { state: 'running', speed: 1, time: 1, firmwareName: 'main.ino', messages: ['Sketch files are not compiled yet'] },
      { status: 'succeeded', source: 'compiled', summary: 'Compiled main.ino: 1064 bytes.' },
    );
    expect(p).toMatchObject({ compiled: true, note: '', noteIsError: false, clickable: false, firmware: 'main.ino' });
    expect(p.line).toBe('Running 1.00x · 1.0 s · main.ino (compiled)');
  });

  it('a compiled build with warnings points to the build output; a compile-only build shows its summary', () => {
    const warned = chip({ firmwareName: 'main.ino' }, { status: 'succeeded', source: 'compiled', messages: [warn('w1'), warn('w2')] });
    expect(warned.note).toBe('2 warnings, see Build output');
    const only = chip({}, { status: 'succeeded', source: 'compiled', summary: 'Compiled main.ino: 1064 bytes of flash (3%).' });
    expect(only).toMatchObject({ compiled: false, note: 'Compiled main.ino: 1064 bytes of flash (3%).', line: 'Stopped · 0.0 s' });
  });

  it('a firmware-file build keeps the old behaviour', () => {
    const p = chip(
      { state: 'running', speed: 1, time: 1, firmwareName: 'firmware.hex', messages: ['Sketch files are not compiled: compiler files not available here'] },
      { status: 'succeeded', source: 'firmware-file', summary: 'Running firmware.hex (not compiled).' },
    );
    expect(p).toMatchObject({ compiled: false, note: 'Sketch files are not compiled: compiler files not available here', clickable: false });
    expect(p.line).toBe('Running 1.00x · 1.0 s · firmware.hex');
  });
});

