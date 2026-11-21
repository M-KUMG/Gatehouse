// The welcome card in the middle of an empty grid: a few ways to get started
// (add a board, open an example, open a project). It disappears the moment
// anything is on the grid and can be closed for good with its x (kept per
// user in localStorage). UI-only state: nothing here is saved in the project
// or recorded in the undo history. The show rule is in welcomemodel.ts.

import { APP_NAME } from './app';
import { shouldShowWelcome } from './welcomemodel';

const DISMISSED_KEY = 'gatehouse.welcome.dismissed';

export interface WelcomeAction {
  name: string;
  hint: string;
  run: () => void;
}

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // storage blocked: the card just comes back next time
  }
}

export class Welcome {
  private readonly root = document.createElement('div');
  private dismissed = wasDismissed();
  private shown: boolean | null = null;

  /** `actions` are the buttons, first one highlighted. */
  constructor(area: HTMLElement, actions: readonly WelcomeAction[]) {
    const root = this.root;
    root.className = 'welcome';
    root.hidden = true;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Getting started');

    const card = document.createElement('div');
    card.className = 'welcome-card';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'welcome-close';
    close.textContent = '×';
    close.title = 'Hide this for good';
    close.setAttribute('aria-label', 'Hide the getting started card for good');
    close.addEventListener('click', () => {
      this.dismissed = true;
      rememberDismissed();
      this.apply(false);
    });

    const title = document.createElement('h2');
    title.className = 'welcome-title';
    title.textContent = `Welcome to ${APP_NAME}`;
    const text = document.createElement('p');
    text.className = 'welcome-text';
    text.textContent = 'Build a circuit and run real Arduino code on it. Pick a way to start:';

    const list = document.createElement('div');
    list.className = 'welcome-actions';
    actions.forEach((action, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = i === 0 ? 'welcome-action primary' : 'welcome-action';
      const name = document.createElement('span');
      name.className = 'welcome-action-name';
      name.textContent = action.name;
      const hint = document.createElement('span');
      hint.className = 'welcome-action-hint';
      hint.textContent = action.hint;
      b.append(name, hint);
      b.addEventListener('click', action.run);
      list.appendChild(b);
    });

    const tip = document.createElement('p');
    tip.className = 'welcome-tip';
    tip.textContent = 'Or drag any part from the menu on the right, or search for one. Press ? for the keyboard shortcuts.';

    card.append(close, title, text, list, tip);
    root.appendChild(card);
    area.appendChild(root);
  }

  /** Call after every frame with the current counts. Touches the DOM only when the card appears or goes. */
  update(parts: number, wires: number): void {
    this.apply(shouldShowWelcome({ parts, wires, dismissed: this.dismissed }));
  }

  private apply(show: boolean): void {
    if (show === this.shown) return;
    this.shown = show;
    this.root.hidden = !show;
  }
}
