// The serial console's input line, without the DOM: what a line of text
// becomes on the wire, and whether the line can send right now.

import type { BoardRunStatus } from '../mcu/runtime';

/** What is added after the typed text, like the Arduino IDE's line-ending menu. */
export type LineEnding = 'none' | 'lf' | 'cr' | 'crlf';

export const LINE_ENDINGS: readonly { id: LineEnding; name: string }[] = [
  { id: 'none', name: 'No line ending' },
  { id: 'lf', name: 'Newline' },
  { id: 'cr', name: 'Carriage return' },
  { id: 'crlf', name: 'Both NL & CR' },
];

export const DEFAULT_LINE_ENDING: LineEnding = 'lf';

const ENDING_BYTES: Record<LineEnding, readonly number[]> = {
  none: [],
  lf: [0x0a],
  cr: [0x0d],
  crlf: [0x0d, 0x0a],
};

export function isLineEnding(value: string): value is LineEnding {
  return Object.prototype.hasOwnProperty.call(ENDING_BYTES, value);
}

/** The bytes to send for `text` (UTF-8) followed by the line ending. */
export function encodeSerialLine(text: string, ending: LineEnding): number[] {
  return [...new TextEncoder().encode(text), ...ENDING_BYTES[ending]];
}

/** What the console knows about the board and port it shows. */
export interface SerialInputContext {
  /** A board is shown. */
  board: boolean;
  /** The board has the shown port. */
  port: boolean;
  /** The board's run state. */
  status: BoardRunStatus;
}

/** Whether the input line can send, and the hint shown when it cannot. */
export function serialInputState(c: SerialInputContext): { enabled: boolean; hint: string } {
  if (!c.board) return { enabled: false, hint: 'No board to send to' };
  if (!c.port) return { enabled: false, hint: 'This board has no serial port' };
  switch (c.status) {
    case 'running':
      return { enabled: true, hint: 'Send to the board (Enter)' };
    case 'paused':
      return { enabled: true, hint: 'Board paused: sent text arrives when it runs again' };
    case 'error':
      return { enabled: false, hint: 'The program could not be loaded' };
    case 'stopped':
      return { enabled: false, hint: 'Board stopped: press Run to send' };
  }
}
