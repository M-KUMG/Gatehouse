import { describe, expect, it } from 'vitest';
import { statusParts } from './boardstatus';
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
