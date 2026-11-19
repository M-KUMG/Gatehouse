// Serial output of the boards, kept per board part and per serial port.
// Lives with the board runtimes (not with any window), so text keeps
// arriving while the serial console is closed. Bounded: each buffer keeps
// roughly the last MAX_CHARS characters / MAX_LINES lines and drops the
// oldest whole lines. No DOM.
//
// Bytes are turned into display text here, once (decodeSerial): line ends
// become "\n" and bytes that are not printable ASCII become "\xNN".

/** Default limits of one buffer (one board, one port). */
export const SERIAL_MAX_CHARS = 200_000;
export const SERIAL_MAX_LINES = 5000;
/** When a limit is passed, trim down to this share of it (so trimming is rare). */
const KEEP = 0.9;
/** A cut may move forward this far to the next line start, to drop whole lines. */
const LINE_SEARCH = 1000;

/** What decodeSerial remembers between chunks. */
export interface DecodeState {
  /** The last byte was a "\r" (a "\n" right after it belongs to the same line end). */
  afterCR: boolean;
}

/**
 * Bytes to display text. "\r\n", a lone "\r" and a lone "\n" each become one
 * "\n" (also when "\r" and "\n" arrive in different chunks); a tab stays a
 * tab; printable ASCII (0x20-0x7e) stays; everything else becomes "\xNN"
 * (two upper-case hex digits), so control bytes cannot upset the layout.
 * Bytes above 0x7f are not decoded as UTF-8 (shown as "\xNN" too).
 */
export function decodeSerial(bytes: readonly number[], state: DecodeState): string {
  let out = '';
  for (const raw of bytes) {
    const b = raw & 0xff;
    if (b === 0x0a && state.afterCR) {
      state.afterCR = false;
      continue;
    }
    state.afterCR = b === 0x0d;
    if (b === 0x0d || b === 0x0a) out += '\n';
    else if (b === 0x09 || (b >= 0x20 && b <= 0x7e)) out += String.fromCharCode(b);
    else out += `\\x${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** Usual baud rates (the Scope's UART decoder offers them too). */
export const STANDARD_BAUDS = [
  300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 31250, 38400, 57600, 74880, 76800,
  115200, 230400, 250000, 460800, 500000, 921600, 1000000, 2000000,
];

/**
 * The usual baud rate a register-derived rate stands for: a 16 MHz AVR set
 * up for 9600 really runs at 9615 baud (UBRR = 103). Within 4 % of a
 * standard rate gives that rate, otherwise the rate itself (rounded).
 */
export function nominalBaud(actual: number): number {
  let best = Math.round(actual);
  let bestError = 0.04;
  for (const rate of STANDARD_BAUDS) {
    const error = Math.abs(actual - rate) / rate;
    if (error <= bestError) {
      best = rate;
      bestError = error;
    }
  }
  return best;
}

/** One board's output on one port, as readers see it. */
export interface SerialBuffer {
  /** The kept display text (see decodeSerial). */
  readonly text: string;
  /**
   * Characters dropped from the front since the buffer was made: `text`
   * covers positions start .. start + text.length of everything written.
   * A reader that has shown up to position p appends text.slice(p - start).
   */
  readonly start: number;
  /** Unique per buffer and changed by clear(): a reader seeing a new one starts over. */
  readonly generation: number;
  /** Number of "\n" in `text`. */
  readonly lines: number;
}

interface Buffer extends SerialBuffer {
  text: string;
  start: number;
  generation: number;
  lines: number;
  decode: DecodeState;
}

export interface SerialLimits {
  maxChars: number;
  maxLines: number;
}

export class SerialStore {
  private readonly boards = new Map<number, Map<string, Buffer>>();
  private generations = 0;

  constructor(private readonly limits: SerialLimits = { maxChars: SERIAL_MAX_CHARS, maxLines: SERIAL_MAX_LINES }) {}

  /** Add bytes a board sent on a port. */
  write(boardId: number, portId: string, bytes: readonly number[]): void {
    if (bytes.length === 0) return;
    let ports = this.boards.get(boardId);
    if (!ports) this.boards.set(boardId, (ports = new Map()));
    let buf = ports.get(portId);
    if (!buf) ports.set(portId, (buf = this.fresh()));
    const text = decodeSerial(bytes, buf.decode);
    if (text === '') return;
    buf.text += text;
    buf.lines += countLines(text, 0, text.length);
    this.trim(buf);
  }

  /** A board's output on a port, or undefined when it sent nothing (since the last clear). */
  get(boardId: number, portId: string): SerialBuffer | undefined {
    return this.boards.get(boardId)?.get(portId);
  }

  /** Empty one port of a board, or all its ports. */
  clear(boardId: number, portId?: string): void {
    const ports = this.boards.get(boardId);
    if (!ports) return;
    if (portId === undefined) ports.clear();
    else ports.delete(portId);
  }

  /** Forget a board (its part was deleted). */
  removeBoard(boardId: number): void {
    this.boards.delete(boardId);
  }

  /** Forget everything (another project was loaded). */
  clearAll(): void {
    this.boards.clear();
  }

  /** Ids of the boards that have buffers. */
  boardIds(): number[] {
    return [...this.boards.keys()];
  }

  private fresh(): Buffer {
    return { text: '', start: 0, generation: ++this.generations, lines: 0, decode: { afterCR: false } };
  }

  /** Drop the oldest text once a limit is passed, whole lines where possible. */
  private trim(buf: Buffer): void {
    const { maxChars, maxLines } = this.limits;
    const text = buf.text;
    if (text.length <= maxChars && buf.lines <= maxLines) return;
    const keepChars = Math.max(1, Math.floor(maxChars * KEEP));
    const keepLines = Math.max(0, Math.floor(maxLines * KEEP));

    let cut = Math.max(0, text.length - keepChars);
    if (cut > 0 && text[cut - 1] !== '\n') {
      const next = text.indexOf('\n', cut);
      if (next >= 0 && next - cut < LINE_SEARCH) cut = next + 1;
    }
    let dropped = countLines(text, 0, cut);
    // Still too many lines: cut after more of them.
    let extra = buf.lines - dropped - keepLines;
    while (extra > 0) {
      const next = text.indexOf('\n', cut);
      if (next < 0) break;
      cut = next + 1;
      dropped++;
      extra--;
    }
    buf.text = text.slice(cut);
    buf.start += cut;
    buf.lines -= dropped;
  }
}

function countLines(text: string, from: number, to: number): number {
  let n = 0;
  for (let i = text.indexOf('\n', from); i >= 0 && i < to; i = text.indexOf('\n', i + 1)) n++;
  return n;
}
