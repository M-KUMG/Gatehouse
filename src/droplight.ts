// The water drop: one glass highlight in a list of options that slides (and
// stretches a little) from the option the pointer left to the one it entered,
// instead of every option lighting up on its own. It follows the pointer and
// keyboard focus, or is moved by the caller (`manual`: the dropdown list, whose
// own code already tracks the highlighted entry).
//
// The container must be positioned (this sets `position: relative` when it is
// not); the drop sits inside it, so it scrolls with the content. Visual only: it
// never takes clicks, and the options keep all their behaviour.

import './droplight.css';

export interface DropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the drop goes for an option: its box inside the container (offset parent). */
export function dropBox(item: { offsetLeft: number; offsetTop: number; offsetWidth: number; offsetHeight: number }): DropBox {
  return { left: item.offsetLeft, top: item.offsetTop, width: item.offsetWidth, height: item.offsetHeight };
}

/** Where an option is inside `container`, following its offset parents (they may be wrappers between the two). */
export function offsetWithin(item: HTMLElement, container: HTMLElement): { left: number; top: number } {
  let left = 0;
  let top = 0;
  let el: HTMLElement | null = item;
  while (el && el !== container) {
    left += el.offsetLeft;
    top += el.offsetTop;
    el = el.offsetParent as HTMLElement | null;
  }
  return el === container ? { left, top } : { left: item.offsetLeft, top: item.offsetTop };
}

export interface Drop {
  /** Slide to this option; null hides the drop. */
  moveTo(item: HTMLElement | null): void;
  destroy(): void;
}

export interface DropOptions {
  /** The caller moves the drop; no pointer or focus listeners. */
  manual?: boolean;
  /** Draw over the options (parts menu tiles, whose picture should sit under the glass) instead of behind them. */
  over?: boolean;
}

function enabled(item: Element): boolean {
  return !(item instanceof HTMLButtonElement && item.disabled) && item.getAttribute('aria-disabled') !== 'true';
}

export function attachDrop(container: HTMLElement, itemSelector: string, options: DropOptions = {}): Drop {
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.classList.add('has-drop');
  const drop = document.createElement('div');
  drop.className = options.over ? 'gh-drop gh-drop-over' : 'gh-drop';
  drop.setAttribute('aria-hidden', 'true');
  container.append(drop);
  let shown = false;

  const moveTo = (item: HTMLElement | null): void => {
    if (!item || !enabled(item)) {
      shown = false;
      drop.classList.remove('show');
      return;
    }
    if (!drop.isConnected) container.append(drop); // the container's content was rebuilt
    const at = offsetWithin(item, container);
    const box = { ...dropBox(item), left: at.left, top: at.top };
    const first = !shown;
    if (first) drop.classList.add('jump'); // appears in place, then glides from there
    drop.style.width = `${box.width}px`;
    drop.style.height = `${box.height}px`;
    drop.style.transform = `translate(${box.left}px, ${box.top}px)`;
    drop.style.setProperty('--gh-drop-radius', getComputedStyle(item).borderRadius);
    if (first) {
      void drop.offsetWidth; // apply the position before transitions come back
      drop.classList.remove('jump');
    }
    shown = true;
    drop.classList.add('show');
  };

  const find = (target: EventTarget | null): HTMLElement | null => {
    const el = target instanceof Element ? target.closest<HTMLElement>(itemSelector) : null;
    return el && container.contains(el) ? el : null;
  };
  const onOver = (e: PointerEvent): void => {
    const item = find(e.target);
    if (item) moveTo(item);
  };
  const onLeave = (): void => moveTo(null);
  const onFocusIn = (e: FocusEvent): void => {
    const item = find(e.target);
    if (item && item.matches(':focus-visible')) moveTo(item);
  };
  const onFocusOut = (): void => moveTo(null);
  if (!options.manual) {
    container.addEventListener('pointerover', onOver);
    container.addEventListener('pointerleave', onLeave);
    container.addEventListener('focusin', onFocusIn);
    container.addEventListener('focusout', onFocusOut);
  }

  return {
    moveTo,
    destroy: () => {
      container.removeEventListener('pointerover', onOver);
      container.removeEventListener('pointerleave', onLeave);
      container.removeEventListener('focusin', onFocusIn);
      container.removeEventListener('focusout', onFocusOut);
      container.classList.remove('has-drop');
      drop.remove();
    },
  };
}
