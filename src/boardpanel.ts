// Panel for a microcontroller board (top-left of the grid, under the file bar): its
// program (Open .hex), Run / Pause / Reset, simulated time and speed, and a
// link to the Serial console window (which shows the serial output). It
// follows the board last selected; the console's "Auto" choice follows it too.

import type { BoardClock } from './boardclock';
import type { GridView } from './grid';
import { HexError, parseIntelHex } from './mcu/hex';
import type { PlacedPart, Scene } from './model';
import { boardLabel, getPart } from './parts';
import type { Simulation } from './simulation';

export class BoardPanel {
  private readonly el = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly program = document.createElement('div');
  private readonly runButton = button('Run', 'Run the program (simulated time from CPU cycles)');
  private readonly resetButton = button('Reset', 'Restart the program from the beginning');
  private readonly openButton = button('Open .hex…', 'Load a compiled program (Intel HEX, e.g. from the Arduino IDE "Export compiled binary")');
  private readonly status = document.createElement('div');
  private readonly consoleLink = document.createElement('button');
  private readonly fileInput = document.createElement('input');
  private partId: number | null = null;
  /** A failed Open .hex, shown until the next load or board change. */
  private loadError: string | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly view: GridView,
    private readonly sim: Simulation,
    private readonly clock: BoardClock,
    /** Where the panel goes (the grid's area). */
    parent: HTMLElement,
    /** Open (or bring forward) the Serial console showing this board. */
    openConsole: (partId: number) => void,
  ) {
    const el = this.el;
    el.className = 'board-panel';
    this.title.className = 'board-title';
    this.program.className = 'board-program';
    this.status.className = 'board-status';
    this.consoleLink.type = 'button';
    this.consoleLink.className = 'board-link';
    this.consoleLink.textContent = 'Serial console';
    this.consoleLink.title = 'Show what this board sends on its serial port (Serial.print) in the Serial console window';
    const buttons = document.createElement('div');
    buttons.className = 'board-buttons';
    buttons.append(this.runButton, this.resetButton, this.openButton);
    el.append(this.title, this.program, buttons, this.status, this.consoleLink);
    this.fileInput.type = 'file';
    this.fileInput.accept = '.hex,.ihx,.ihex,text/plain';
    this.fileInput.style.display = 'none';
    el.append(this.fileInput);
    el.style.display = 'none';
    parent.appendChild(el);

    this.runButton.addEventListener('click', this.toggleRun);
    this.resetButton.addEventListener('click', () => {
      if (this.partId === null) return;
      this.sim.boards.reset(this.partId);
      this.view.requestRender();
    });
    this.openButton.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => void this.openFile());
    this.consoleLink.addEventListener('click', () => {
      if (this.partId !== null) openConsole(this.partId);
    });
  }

  /** The board the panel shows (also what the console's "Auto" follows), or null. */
  get boardId(): number | null {
    return this.partId;
  }

  /** Call after every frame. */
  update(): void {
    const part = this.pickBoard();
    if (!part) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = '';
    const type = getPart(part.typeId);
    const rt = this.sim.boards.get(part.id);
    const program = part.state?.program;
    this.title.textContent = type ? boardLabel(part) : 'Board';
    this.program.textContent = program ? `Program: ${program.name}` : 'No program loaded';
    this.runButton.textContent = rt?.running ? 'Pause' : 'Run';
    this.runButton.disabled = !rt?.emulator;
    this.resetButton.disabled = !rt?.emulator;

    const error = this.loadError ?? rt?.error ?? null;
    let text: string;
    if (error) text = error;
    else if (!rt?.emulator) text = 'Open a compiled .hex file to run it.';
    else {
      const seconds = rt.emulator.cycles / rt.emulator.clockHz;
      const state = rt.running ? `Running · ${speedText(this.clock.speed)}` : 'Stopped';
      text = `${state} · board time ${seconds.toFixed(3)} s`;
    }
    this.status.textContent = text;
    this.status.classList.toggle('error', error !== null);
  }

  /** The selected board, else the one shown before (if it still exists), else the first board. */
  private pickBoard(): PlacedPart | null {
    const selected = this.scene.parts.filter((p) => this.view.selected.has(p.id));
    const isBoard = (p: PlacedPart | undefined): p is PlacedPart => p !== undefined && getPart(p.typeId)?.board !== undefined;
    let part: PlacedPart | undefined = selected.length === 1 && isBoard(selected[0]) ? selected[0] : this.scene.find(this.partId);
    if (!isBoard(part)) part = this.scene.parts.find((p) => isBoard(p));
    const id = part?.id ?? null;
    if (id !== this.partId) {
      this.partId = id;
      this.loadError = null;
    }
    return part ?? null;
  }

  private toggleRun = (): void => {
    if (this.partId === null) return;
    const rt = this.sim.boards.get(this.partId);
    if (rt?.running) this.sim.boards.pause(this.partId);
    else this.sim.boards.run(this.partId);
    this.clock.wake();
    this.view.requestRender();
  };

  private async openFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    const part = this.scene.find(this.partId);
    const spec = part && getPart(part.typeId)?.board;
    if (!file || !part || !spec) return;
    try {
      const hex = (await file.text()).replace(/\r\n?/g, '\n').trim() + '\n';
      parseIntelHex(hex, spec.flashBytes);
      part.state = { ...part.state, program: { name: file.name.replace(/\.(hex|ihx|ihex)$/i, ''), hex } };
      this.loadError = null;
    } catch (e) {
      this.loadError = `Could not load "${file.name}": ${e instanceof HexError ? e.message : String(e)}`;
    }
    this.view.requestRender();
  }
}

function speedText(speed: number): string {
  return `${speed >= 0.995 ? speed.toFixed(2) : speed.toFixed(speed < 0.1 ? 2 : 1)}x`;
}

function button(text: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'board-button';
  b.textContent = text;
  b.title = title;
  return b;
}
