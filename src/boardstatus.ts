// The small status chip just below the selected board: state dot, state and
// speed ("Running 1.00x"), simulated time, firmware file name, and the build
// message or error. The composer is plain data; the chip draws it and follows
// the board like the toolbar does (see Toolbar for the shared placement).

import type { BoardBuildState } from './build/buildlog';
import { countMessages, progressText } from './build/buildtext';
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
  /** The firmware came from compiling the board's sketch (else from a .hex file, or there is none). */
  compiled: boolean;
  /** The build progress ("Compiling main.ino (1/3)"), the error text, or the build messages; empty when there is none. */
  note: string;
  noteIsError: boolean;
  /** The last build failed: clicking the chip opens the Build output window. */
  clickable: boolean;
  /** First line of the chip: state, time and firmware (with "(compiled)" after a compiled one). */
  line: string;
  /** Everything, for the tooltip (the chip truncates long text); starts with the board's name when it is given. */
  title: string;
}

const SEE_BUILD_OUTPUT = 'see Build output';

/** "Build failed: 2 errors." -> "Build failed: 2 errors, see Build output" */
const withHint = (summary: string): string => `${summary.replace(/[.\s]+$/, '')}, ${SEE_BUILD_OUTPUT}`;

/**
 * `boardName`: the board's label (its custom name, else the default), for the
 * tooltip. `build`: the board's build log state; it adds the build progress
 * while building, the summary and a hint after a failed compile, and
 * "(compiled)" after a compiled one. Without it (or for a .hex file) the chip
 * says what it always did.
 */
export function statusParts(s: BoardRunState, boardName?: string, build?: BoardBuildState | null): StatusParts {
  const state = s.building
    ? 'Building…'
    : s.state === 'running'
      ? s.speed > 0 ? `Running ${s.speed.toFixed(2)}x` : 'Running'
      : s.state === 'paused' ? 'Paused' : s.state === 'error' ? 'Error' : 'Stopped';
  const time = s.state === 'error' ? '' : `${s.time.toFixed(1)} s`;
  const firmware = s.firmwareName ?? '';
  const b = build ?? null;
  const building = s.building && b !== null && (b.status === 'building' || b.status === 'downloading');
  const failed = !s.building && b !== null && b.status === 'failed';
  const compiled = !s.building && b !== null && b.status === 'succeeded' && b.source === 'compiled';
  const errorText = s.state === 'error' && s.error !== undefined && s.error !== '' ? s.error : '';

  let note: string;
  let noteIsError = false;
  if (building) {
    note = progressText(b);
  } else if (failed && (b.source === 'compiled' || errorText === '')) {
    note = withHint(b.summary || 'Build failed');
    noteIsError = true;
  } else if (compiled) {
    // The sketch was compiled: no "not compiled" notes. Warnings point to the build output; a compile-only build has no firmware name yet.
    const { warnings } = countMessages(b);
    note = warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'}, ${SEE_BUILD_OUTPUT}` : firmware === '' ? b.summary : '';
  } else {
    noteIsError = errorText !== '';
    note = noteIsError ? errorText : s.messages.join(' ');
  }
  const clickable = failed;
  const firmwareLine = firmware !== '' && compiled ? `${firmware} (compiled)` : firmware;
  const line = [state, time, firmwareLine].filter((x) => x !== '').join(' · ');
  const details = note ? `${line}
${note}` : line;
  return { dot: s.state, state, time, firmware, compiled: compiled && firmware !== '', note, noteIsError, clickable, line, title: boardName ? `${boardName}
${details}` : details };
}

export class BoardStatusChip {
  private readonly el = document.createElement('div');
  private readonly name = document.createElement('div');
  private readonly dot = document.createElement('span');
  private readonly line = document.createElement('div');
  private readonly note = document.createElement('div');
  private shown = '';
  private clickable = false;
  /** The chip of a failed build was clicked. */
  onClick: (() => void) | null = null;

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
    this.el.addEventListener('click', () => {
      if (this.clickable) this.onClick?.();
    });
    document.body.appendChild(this.el);
    this.show(null, null);
  }

  /** Show the chip below a viewport rectangle (the board), or hide it with null. `boardName` heads the chip; `build` is the board's build log state. */
  show(target: ScreenRect | null, state: BoardRunState | null, boardName = '', build: BoardBuildState | null = null): void {
    const el = this.el;
    const area = visibleArea(this.canvas);
    if (!target || !state || !isOnScreen(target, area)) {
      el.style.display = 'none';
      return;
    }
    const p = statusParts(state, boardName, build);
    const key = `${p.dot}|${p.line}|${p.note}|${p.noteIsError}|${p.clickable}|${boardName}`;
    if (key !== this.shown) {
      this.shown = key;
      this.name.textContent = boardName;
      this.name.hidden = boardName === '';
      this.dot.className = `board-chip-dot ${p.dot}`;
      this.line.textContent = p.line;
      this.note.textContent = p.note;
      this.note.hidden = p.note === '';
      this.note.classList.toggle('error', p.noteIsError);
      this.clickable = p.clickable;
      this.el.classList.toggle('clickable', p.clickable);
      el.title = p.clickable ? `${p.title}
Click to open the Build output` : p.title;
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
