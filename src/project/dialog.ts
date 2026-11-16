// Small modal question and a passing message (toast), in the app's style.

export interface Choice<T> {
  label: string;
  value: T;
  primary?: boolean;
}

/** Ask a question; resolves with the chosen button's value (Escape picks `cancel`). */
export function ask<T>(title: string, message: string, choices: readonly Choice<T>[], cancel: T): Promise<T> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const box = document.createElement('div');
    box.className = 'dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const h = document.createElement('h3');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = message;
    const row = document.createElement('div');
    row.className = 'dialog-buttons';
    box.append(h, p, row);
    backdrop.append(box);

    const finish = (value: T): void => {
      window.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(value);
    };
    // While open, keys belong to the dialog, not the editor underneath.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(cancel);
      else if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== ' ') e.preventDefault();
      e.stopPropagation();
    };

    let focus: HTMLButtonElement | null = null;
    for (const choice of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = choice.primary ? 'dialog-button primary' : 'dialog-button';
      b.textContent = choice.label;
      b.addEventListener('click', () => finish(choice.value));
      row.append(b);
      if (choice.primary || !focus) focus = b;
    }
    window.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    focus?.focus();
  });
}

let current: HTMLDivElement | null = null;

/** A short message at the top of the window; errors stay longer and can be clicked away. */
export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  current?.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  el.title = 'Click to close';
  el.addEventListener('click', () => el.remove());
  document.body.append(el);
  current = el;
  window.setTimeout(() => el.remove(), kind === 'error' ? 9000 : 2500);
}
