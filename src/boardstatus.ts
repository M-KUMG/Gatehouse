// The small status chip just below the selected board: state dot, state and
// speed ("Running 1.00x"), simulated time, firmware file name, and the build
// message or error. The composer is plain data; the chip draws it and follows
// the board like the toolbar does (see Toolbar for the shared placement).

import type { ScreenRect } from './grid';
import type { BoardRunState, BoardRunStatus } from './mcu/runtime';
import { isOnScreen, visibleArea } from './toolbar';

const GAP = 6; // between the board and the chip

export type StatusDot = BoardRunStatus;

export interface StatusParts {
  /** Colour of the dot: stopped grey, running green, paused amber, error red. */
  dot: StatusDot;
  /** "Stopped", "Running 1.00x", "Paused", "Building…" or "Error". */
  state: string;
  /** "3.2 s" of simulated time; empty in the error state. */
  time: string;
  /** The firmware that was built, or empty. */
  firmware: string;
  /** The error text (error state) or the build messages; empty when there is none. */
  note: string;
  noteIsError: boolean;
  /** First line of the chip: state, time and firmware. */
  line: string;
  /** Everything, for the tooltip (the chip truncates long text); starts with the board's name when it is given. */
  title: string;
}

/** `boardName`: the board's label (its custom name, else the default), for the tooltip. */
export function statusParts(s: BoardRunState, boardName?: string): StatusParts {
  const state = s.building
    ? 'Building…'
    : s.state === 'running'
      ? s.speed > 0 ? `Running ${s.speed.toFixed(2)}x` : 'Running'
      : s.state === 'paused' ? 'Paused' : s.state === 'error' ? 'Error' : 'Stopped';
  const time = s.state === 'error' ? '' : `${s.time.toFixed(1)} s`;
  const firmware = s.firmwareName ?? '';
  const noteIsError = s.state === 'error' && s.error !== undefined && s.error !== '';
  const note = noteIsError ? (s.error ?? '') : s.messages.join(' ');
  const line = [state, time, firmware].filter((x) => x !== '').join(' · ');
  const details = note ? `${line}\n${note}` : line;
  return { dot: s.state, state, time, firmware, note, noteIsError, line, title: boardName ? `${boardName}\n${details}` : details };
}

export class BoardStatusChip {
  private readonly el = document.createElement('div');
  private readonly name = document.createElement('div');
  private readonly dot = document.createElement('span');
  private readonly line = document.createElement('div');
  private readonly note = document.createElement('div');
  private shown = '';

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.el.className = 'board-chip';
    this.name.className = 'board-chip-name';
    this.dot.className = 'board-chip-dot';
    this.line.className = 'board-chip-line';
    this.note.className = 'board-chip-note';
    const first = document.createElement('div');
    first.className = 'board-chip-row';
    first.append(this.dot, this.line);
    this.el.append(this.name, first, this.note);
    document.body.appendChild(this.el);
    this.show(null, null);
  }

  /** Show the chip below a viewport rectangle (the board), or hide it with null. `boardName` heads the chip. */
  show(target: ScreenRect | null, state: BoardRunState | null, boardName = ''): void {
    const el = this.el;
    const area = visibleArea(this.canvas);
    if (!target || !state || !isOnScreen(target, area)) {
      el.style.display = 'none';
      return;
    }
    const p = statusParts(state, boardName);
    const key = `${p.dot}|${p.line}|${p.note}|${p.noteIsError}|${boardName}`;
    if (key !== this.shown) {
      this.shown = key;
      this.name.textContent = boardName;
      this.name.hidden = boardName === '';
      this.dot.className = `board-chip-dot ${p.dot}`;
      this.line.textContent = p.line;
      this.note.textContent = p.note;
      this.note.hidden = p.note === '';
      this.note.classList.toggle('error', p.noteIsError);
      el.title = p.title;
    }
    el.style.display = '';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(area.left, Math.min(target.left, area.right - w));
    const top = Math.max(area.top, Math.min(target.bottom + GAP, area.bottom - h));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }
}
