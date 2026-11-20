// The global simulation transport bar in the grid's top-right corner:
// Start / Pause, Reset, speed and the simulated time. The logic is in
// transportmodel.ts (state derivation, labels) and Simulation (start, pause,
// reset); this file only draws and wires the buttons. Buttons reuse the file
// bar's `file-button` class so a restyle covers both. UI-only state: nothing
// here is saved or recorded in the undo history.

import './transport.css';
import type { SimClock } from './boardclock';
import type { Simulation } from './simulation';
import { DEFAULT_SPEED, SPEEDS, speedLabel, transportView } from './transportmodel';

const svg = (body: string): string =>
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" ' +
  `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  run: svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>'),
  pause: svg('<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3"/>'),
  reset: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/>'),
};

export class TransportBar {
  readonly element = document.createElement('div');
  private readonly toggleButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly speedSelect = document.createElement('select');
  private readonly timeEl = document.createElement('span');
  private readonly behindEl = document.createElement('span');
  private shown = '';

  constructor(
    parent: HTMLElement,
    private readonly sim: Simulation,
    private readonly clock: SimClock,
    /** After a button changed something: redraw (the next frame calls update()). */
    private readonly changed: () => void,
  ) {
    const el = this.element;
    el.className = 'transport-bar';
    this.toggleButton = button(() => this.toggle());
    this.resetButton = button(() => this.reset());
    this.resetButton.innerHTML = ICONS.reset;
    this.speedSelect.className = 'transport-speed';
    this.speedSelect.title = 'Simulation speed (simulated time per real second; all boards and the circuit together)';
    for (const s of SPEEDS) {
      const o = document.createElement('option');
      o.value = String(s);
      o.textContent = speedLabel(s);
      this.speedSelect.append(o);
    }
    this.speedSelect.value = String(DEFAULT_SPEED);
    this.speedSelect.addEventListener('change', () => {
      this.clock.multiplier = Number(this.speedSelect.value) || DEFAULT_SPEED;
      this.speedSelect.blur(); // give the keyboard back to the grid (Space)
      this.changed();
    });
    this.timeEl.className = 'transport-time';
    this.behindEl.className = 'transport-behind';
    el.append(this.toggleButton, this.resetButton, this.speedSelect, this.timeEl, this.behindEl);
    parent.append(el);
    this.update();
  }

  /** Start or Pause, whichever the button shows (also the Space key on the grid). */
  toggle(): void {
    if (this.sim.transport() === 'running') this.sim.pause();
    else this.sim.start();
    this.clock.wake();
    this.changed();
  }

  reset(): void {
    this.sim.reset();
    this.changed();
  }

  /** Call after every frame. Touches the DOM only when something changed. */
  update(): void {
    const v = transportView({
      state: this.sim.transport(),
      time: this.sim.time,
      speed: this.clock.multiplier,
      achieved: this.clock.speed,
      timeRunning: this.sim.timeRunning,
      hasReactiveParts: this.sim.hasReactiveParts,
      boardCount: this.sim.boardCount,
    });
    const key = JSON.stringify(v);
    if (key === this.shown) return;
    this.shown = key;
    this.toggleButton.innerHTML = ICONS[v.icon];
    this.toggleButton.title = v.toggleTitle;
    this.toggleButton.setAttribute('aria-label', v.icon === 'pause' ? 'Pause' : 'Start');
    this.resetButton.title = v.resetTitle;
    this.resetButton.setAttribute('aria-label', 'Reset');
    this.timeEl.textContent = v.time;
    this.timeEl.title = v.timeTitle;
    this.behindEl.textContent = v.behind ?? '';
    this.behindEl.hidden = v.behind === null;
    this.behindEl.title = v.timeTitle;
  }
}

function button(onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'file-button';
  b.addEventListener('click', onClick);
  return b;
}
