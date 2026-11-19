// The Serial console window: the serial output of one board on one port.
// Board dropdown (boards in a fixed order, e.g. uno-1, uno-2, uno-10): "Auto"
// (follows the active board: the one selected on the grid, else the last one)
// or a fixed board; Port dropdown: the board type's
// serial ports (BoardSpec.serialPorts). The text comes from the serial store
// (sim.boards.serial), which keeps collecting while this window is closed.
// The choice of board and port is session UI state, never saved in the
// project.
//
// Rendering appends only the new text (and trims the front when the store
// dropped old text), so a long run never rebuilds the whole output.
//
// The input line below the output sends text to the shown board and port
// (sim.boards.sendSerial): UTF-8 plus the chosen line ending (serialinput.ts),
// on Enter or Send. Nothing is echoed: what appears is what the sketch sends
// back. It is enabled while the board runs or is paused (paused: the bytes
// wait and arrive when it runs again). Keys typed in it stay in it (no grid
// or project shortcuts), like the File explorer's rename field.

import './serialconsole.css';
import { boardsInOrder } from '../boardcontrols';
import type { BoardEmulator } from '../mcu/board';
import { nominalBaud, type SerialBuffer } from '../mcu/serialstore';
import type { PlacedPart, Scene } from '../model';
import { boardLabelWithId, getPart } from '../parts';
import type { Simulation } from '../simulation';
import {
  DEFAULT_LINE_ENDING, LINE_ENDINGS, encodeSerialLine, isLineEnding, serialInputState, type LineEnding,
} from './serialinput';

export const SERIAL_CONSOLE_ID = 'serial-console';

const AUTO = 'auto';
/** Text nodes grow up to this size before a new one starts. */
const NODE_CHARS = 8192;
/** Within this many pixels of the end counts as "at the bottom". */
const BOTTOM_SLACK = 4;

/** What the output area shows right now. */
interface Shown {
  board: number | null;
  port: string | null;
  generation: number;
  /** Store positions of the first and past-the-last shown character. */
  start: number;
  end: number;
}

export class SerialConsole {
  /** The window's content; DockLayout adopts it whenever the window opens. */
  readonly element = document.createElement('div');
  private readonly boardSelect = document.createElement('select');
  private readonly portSelect = document.createElement('select');
  private readonly baud = document.createElement('span');
  private readonly clearButton = document.createElement('button');
  private readonly output = document.createElement('pre');
  private readonly hint = document.createElement('div');
  private readonly followButton = document.createElement('button');
  private readonly input = document.createElement('input');
  private readonly endingSelect = document.createElement('select');
  private readonly sendButton = document.createElement('button');
  /** Line ending for sent text (session UI state, like the board choice). */
  private ending: LineEnding = DEFAULT_LINE_ENDING;

  /** AUTO or a board part id (as text, the select's value). */
  private boardChoice = AUTO;
  /** Last port picked by hand; used whenever the shown board has it. */
  private portChoice: string | null = null;
  private boardOptions = '';
  private portOptions = '';
  /** Keep the newest line in view (off while the person has scrolled up). */
  private follow = true;
  private shown: Shown = { board: null, port: null, generation: -1, start: 0, end: 0 };
  private current: { board: number | null; port: string | null } = { board: null, port: null };

  constructor(
    private readonly scene: Scene,
    private readonly sim: Simulation,
    /** The board "Auto" stands for (the active board), or null. */
    private readonly autoBoard: () => number | null,
  ) {
    const el = this.element;
    el.className = 'serial-console';

    const bar = document.createElement('div');
    bar.className = 'serial-bar';
    this.boardSelect.className = 'serial-select';
    this.boardSelect.title = 'Board whose serial output is shown';
    this.boardSelect.setAttribute('aria-label', 'Board');
    this.portSelect.className = 'serial-select';
    this.portSelect.title = 'Serial port of the board';
    this.portSelect.setAttribute('aria-label', 'Serial port');
    this.baud.className = 'serial-baud';
    const spacer = document.createElement('span');
    spacer.className = 'serial-spacer';
    this.clearButton.type = 'button';
    this.clearButton.className = 'serial-button';
    this.clearButton.textContent = 'Clear';
    this.clearButton.title = 'Clear the output of this board and port';
    bar.append(label('Board', this.boardSelect), label('Port', this.portSelect), this.baud, spacer, this.clearButton);

    const body = document.createElement('div');
    body.className = 'serial-body';
    this.output.className = 'serial-output';
    this.output.tabIndex = 0; // focusable, so key presses aim here and not at the grid
    this.output.setAttribute('aria-label', 'Serial output');
    this.hint.className = 'serial-hint';
    this.followButton.type = 'button';
    this.followButton.className = 'serial-follow';
    this.followButton.textContent = '↓ Scroll to bottom';
    this.followButton.title = 'Jump to the newest output and keep following it';
    this.followButton.hidden = true;
    body.append(this.output, this.hint, this.followButton);

    const send = document.createElement('div');
    send.className = 'serial-send';
    this.input.type = 'text';
    this.input.className = 'serial-input';
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.setAttribute('aria-label', 'Text to send');
    this.endingSelect.className = 'serial-select';
    this.endingSelect.title = 'Added after the text when it is sent';
    this.endingSelect.setAttribute('aria-label', 'Line ending');
    this.endingSelect.append(...LINE_ENDINGS.map((l) => option(l.id, l.name)));
    this.endingSelect.value = this.ending;
    this.sendButton.type = 'button';
    this.sendButton.className = 'serial-button';
    this.sendButton.textContent = 'Send';
    send.append(this.input, this.endingSelect, this.sendButton);
    el.append(bar, body, send);

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing belongs to the field, not to the grid or the project shortcuts
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.send();
      }
    });
    this.endingSelect.addEventListener('change', () => {
      if (isLineEnding(this.endingSelect.value)) this.ending = this.endingSelect.value;
    });
    this.sendButton.addEventListener('click', () => {
      this.send();
      this.input.focus();
    });

    this.boardSelect.addEventListener('change', () => {
      this.boardChoice = this.boardSelect.value;
      this.update();
    });
    this.portSelect.addEventListener('change', () => {
      this.portChoice = this.portSelect.value;
      this.update();
    });
    this.clearButton.addEventListener('click', () => {
      const { board, port } = this.current;
      if (board !== null && port !== null) this.sim.boards.serial.clear(board, port);
      this.update();
    });
    this.followButton.addEventListener('click', () => {
      this.setFollow(true);
      this.scrollToEnd();
      this.output.focus();
    });
    this.output.addEventListener('scroll', this.onScroll);
    this.output.addEventListener('keydown', this.onOutputKey);
    // Keep the end in view when the window is resized or shown again.
    new ResizeObserver(() => {
      if (this.follow) this.scrollToEnd();
    }).observe(this.output);
  }

  /** Show a board (from the toolbar's console button). Stays on "Auto" when Auto already shows it. */
  showBoard(partId: number): void {
    if (!(this.boardChoice === AUTO && this.autoBoard() === partId)) this.boardChoice = String(partId);
    this.setFollow(true);
    this.update();
    this.scrollToEnd();
  }

  /** Call after every frame and when the window opens. Cheap when nothing changed. */
  update(): void {
    const boards = boardsInOrder(this.scene.parts);
    if (this.boardChoice !== AUTO && !boards.some((p) => String(p.id) === this.boardChoice)) this.boardChoice = AUTO;
    const part = this.resolveBoard(boards);
    this.updateBoardSelect(boards, part);

    const spec = part ? getPart(part.typeId)?.board : undefined;
    const ports = spec?.serialPorts ?? [];
    const port = ports.find((p) => p.id === this.portChoice) ?? ports[0];
    this.updatePortSelect(ports.map((p) => [p.id, p.name]), port?.id ?? null, part !== null);

    const rt = part ? this.sim.boards.get(part.id) : undefined;
    const emulator = rt?.emulator ?? null;
    this.updateBaud(emulator, port?.id ?? null);

    const board = part?.id ?? null;
    const portId = port?.id ?? null;
    this.current = { board, port: portId };
    const buf = board !== null && portId !== null ? this.sim.boards.serial.get(board, portId) : undefined;
    if (this.element.isConnected) this.render(board, portId, buf);

    const empty = !buf || buf.text === '';
    let hint = '';
    if (!part) hint = 'No board in the project';
    else if (!port) hint = 'This board has no serial port.';
    else if (empty) {
      // Before the first Run there is no emulator yet (the firmware is built on Run), so do not claim "no firmware".
      if (!emulator) hint = rt?.error ? 'The program could not be loaded. Check the status below the board.' : 'Board stopped. Press Run.';
      else if (!rt?.running) hint = 'Board stopped. Press Run.';
      else hint = 'Waiting for serial output…';
    }
    if (this.hint.textContent !== hint) this.hint.textContent = hint;
    this.hint.hidden = hint === '';
    this.clearButton.disabled = empty;
    this.followButton.hidden = this.follow || empty;
    this.updateInput(board, portId);
  }

  /** Enable the input line for a board that runs or is paused; else disable it with the reason as its placeholder. */
  private updateInput(board: number | null, port: string | null): void {
    const status = board !== null ? this.sim.boards.boardRunState(board).state : 'stopped';
    const { enabled, hint } = serialInputState({ board: board !== null, port: port !== null, status });
    if (this.input.disabled === enabled) this.input.disabled = !enabled;
    if (this.sendButton.disabled === enabled) this.sendButton.disabled = !enabled;
    if (this.input.placeholder !== hint) this.input.placeholder = hint;
    if (this.sendButton.title !== hint) this.sendButton.title = hint;
  }

  /** Send the typed line to the shown board and port; the field is emptied once the board took it. */
  private send(): void {
    const { board, port } = this.current;
    if (board === null || port === null) return;
    const bytes = encodeSerialLine(this.input.value, this.ending);
    if (bytes.length === 0) return;
    if (this.sim.boards.sendSerial(board, port, bytes)) this.input.value = '';
    // Refused (the board stopped meanwhile): the text stays, the field shows why.
    this.updateInput(board, port);
  }

  /** The board to show: the fixed choice, else Auto's board, else the first board. */
  private resolveBoard(boards: readonly PlacedPart[]): PlacedPart | null {
    if (boards.length === 0) return null;
    const wanted = this.boardChoice === AUTO ? this.autoBoard() : Number(this.boardChoice);
    return boards.find((p) => p.id === wanted) ?? boards[0];
  }

  private updateBoardSelect(boards: readonly PlacedPart[], part: PlacedPart | null): void {
    const sel = this.boardSelect;
    const items: [string, string][] = boards.map((p) => [String(p.id), boardLabelWithId(p)]);
    const signature = items.map(([v, t]) => `${v}=${t}`).join('|');
    // Rebuild only when the list changes, so an open dropdown is not disturbed every frame.
    // The first time it must be built even for no boards (the empty list matches the initial signature).
    if (signature !== this.boardOptions || sel.options.length === 0) {
      this.boardOptions = signature;
      sel.replaceChildren(option(AUTO, ''), ...items.map(([v, t]) => option(v, t)));
    }
    const autoText = boards.length === 0 ? 'No board in the project' : this.boardChoice === AUTO && part
      ? `Auto: selected board (${boardLabelWithId(part)})` : 'Auto: selected board';
    const auto = sel.options[0];
    if (auto.textContent !== autoText) auto.textContent = autoText;
    if (sel.value !== this.boardChoice) sel.value = this.boardChoice;
    sel.disabled = boards.length === 0;
  }

  private updatePortSelect(items: [string, string][], port: string | null, hasBoard: boolean): void {
    const sel = this.portSelect;
    const signature = items.map(([v, t]) => `${v}=${t}`).join('|');
    if (signature !== this.portOptions || sel.options.length === 0) {
      this.portOptions = signature;
      sel.replaceChildren(...(items.length > 0 ? items.map(([v, t]) => option(v, t)) : [option('', hasBoard ? 'None' : '–')]));
    }
    if (port !== null && sel.value !== port) sel.value = port;
    sel.disabled = items.length === 0;
  }

  private updateBaud(emulator: BoardEmulator | null, port: string | null): void {
    const actual = emulator && port !== null ? emulator.serialBaud(port) : null;
    const text = actual ? `${nominalBaud(actual)} baud` : '';
    if (this.baud.textContent !== text) {
      this.baud.textContent = text;
      this.baud.title = actual ? `Set by the program: ${actual} baud from the baud-rate register` : '';
    }
  }

  /** Bring the output area in line with the buffer: append new text, drop what the store dropped. */
  private render(board: number | null, port: string | null, buf: SerialBuffer | undefined): void {
    const shown = this.shown;
    const generation = buf?.generation ?? -1;
    const start = buf?.start ?? 0;
    const end = start + (buf?.text.length ?? 0);
    const same = shown.board === board && shown.port === port && shown.generation === generation;
    if (same && shown.start === start && shown.end === end) return;

    if (!same || shown.end < start) {
      // Another board, port or buffer, or fallen too far behind: show it whole.
      this.output.textContent = buf?.text ?? '';
      if (!same) this.setFollow(true);
    } else {
      if (start > shown.start) this.dropFront(start - shown.start);
      if (end > shown.end) this.append(buf!.text.slice(shown.end - start));
    }
    this.shown = { board, port, generation, start, end };
    if (this.follow) this.scrollToEnd();
  }

  private append(text: string): void {
    const last = this.output.lastChild;
    if (last instanceof Text && last.length < NODE_CHARS) last.appendData(text);
    else this.output.append(document.createTextNode(text));
  }

  private dropFront(count: number): void {
    let left = count;
    while (left > 0) {
      const first = this.output.firstChild;
      if (!(first instanceof Text)) break;
      if (first.length <= left) {
        left -= first.length;
        first.remove();
      } else {
        first.deleteData(0, left);
        left = 0;
      }
    }
  }

  private scrollToEnd(): void {
    this.output.scrollTop = this.output.scrollHeight;
  }

  private setFollow(follow: boolean): void {
    this.follow = follow;
    this.followButton.hidden = follow || this.shown.end === this.shown.start;
  }

  private onScroll = (): void => {
    const o = this.output;
    if (!o.isConnected || o.clientHeight === 0) return; // hidden: keep the last state
    this.setFollow(o.scrollTop + o.clientHeight >= o.scrollHeight - BOTTOM_SLACK);
  };

  /** Ctrl+A selects the output only, not the whole page. */
  private onOutputKey = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(this.output);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };
}

function option(value: string, text: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

function label(text: string, control: HTMLElement): HTMLLabelElement {
  const l = document.createElement('label');
  l.className = 'serial-field';
  const span = document.createElement('span');
  span.textContent = text;
  l.append(span, control);
  return l;
}
