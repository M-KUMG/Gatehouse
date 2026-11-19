import { describe, expect, it } from 'vitest';
import { DEFAULT_LINE_ENDING, LINE_ENDINGS, encodeSerialLine, isLineEnding, serialInputState } from './serialinput';

describe('serial console input line', () => {
  it('encodes text as UTF-8 followed by the line ending', () => {
    expect(encodeSerialLine('hi', 'none')).toEqual([0x68, 0x69]);
    expect(encodeSerialLine('hi', 'lf')).toEqual([0x68, 0x69, 0x0a]);
    expect(encodeSerialLine('hi', 'cr')).toEqual([0x68, 0x69, 0x0d]);
    expect(encodeSerialLine('hi', 'crlf')).toEqual([0x68, 0x69, 0x0d, 0x0a]);
    expect(encodeSerialLine('é€', 'none')).toEqual([0xc3, 0xa9, 0xe2, 0x82, 0xac]);
    expect(encodeSerialLine('', 'lf')).toEqual([0x0a]); // Enter on an empty line still sends the ending
    expect(encodeSerialLine('', 'none')).toEqual([]);
  });

  it('offers the four endings, Newline by default', () => {
    expect(LINE_ENDINGS.map((l) => l.id)).toEqual(['none', 'lf', 'cr', 'crlf']);
    expect(DEFAULT_LINE_ENDING).toBe('lf');
    expect(isLineEnding('crlf')).toBe(true);
    expect(isLineEnding('toString')).toBe(false);
  });

  it('is enabled only for a board with the port that runs or is paused', () => {
    const on = (status: 'running' | 'paused' | 'stopped' | 'error') => serialInputState({ board: true, port: true, status }).enabled;
    expect(on('running')).toBe(true);
    expect(on('paused')).toBe(true);
    expect(on('stopped')).toBe(false);
    expect(on('error')).toBe(false);
    expect(serialInputState({ board: false, port: false, status: 'running' })).toEqual({ enabled: false, hint: 'No board to send to' });
    expect(serialInputState({ board: true, port: false, status: 'running' }).enabled).toBe(false);
    expect(serialInputState({ board: true, port: true, status: 'stopped' }).hint).toMatch(/Run/);
  });
});
