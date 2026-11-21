// One glass tooltip for every control that has a `title`: it replaces the
// browser's plain tooltip (file bar, run controls, selection toolbar, menu
// buttons, windows ...), using the same bubble as the parts menu.
//
// How: delegated listeners on the document. When the mouse (or the keyboard
// focus) reaches an element with a title, the title is moved to `data-tip`
// (so the browser shows nothing) and our bubble shows it after a short pause;
// it is put back when the element is left. Code that sets `title` as before
// keeps working, even while the element is hovered. Touch screens have no hover
// and are left alone. Positioning is in tipbubble.ts.

import { TipBubble, preferredVerticalSide } from './tipbubble';

const SHOW_DELAY_MS = 350; // pause before the first bubble appears
const QUICK_WINDOW_MS = 600; // right after a bubble went away, the next one appears at once

export function installTooltips(): void {
  const bubble = new TipBubble('below');
  let current: HTMLElement | null = null; // the element whose tip is being tracked
  let timer = 0;
  let lastHidden = 0;

  const holder = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element) || target.closest('.tip-bubble')) return null;
    const el = target.closest('[title], [data-tip]');
    return el instanceof HTMLElement ? el : null;
  };

  const textOf = (el: HTMLElement): string => (el.getAttribute('title') ?? el.dataset.tip ?? '').trim();

  /** Move the title out of the way so the browser does not show its own tooltip. */
  const take = (el: HTMLElement): void => {
    const title = el.getAttribute('title');
    if (title !== null) {
      el.dataset.tip = title;
      el.removeAttribute('title');
    }
  };

  /** Put the title back (screen readers and the next hover use it). */
  const give = (el: HTMLElement): void => {
    if (el.dataset.tip !== undefined && !el.hasAttribute('title')) el.setAttribute('title', el.dataset.tip);
  };

  const hideBubble = (): void => {
    window.clearTimeout(timer);
    timer = 0;
    if (bubble.visible) lastHidden = performance.now();
    bubble.hide();
  };

  const showNow = (el: HTMLElement): void => {
    const text = textOf(el);
    if (!text || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    bubble.show(el, text, preferredVerticalSide({ left: r.left, top: r.top, width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight }));
  };

  const enter = (el: HTMLElement, immediate: boolean): void => {
    if (el === current) return;
    leave();
    current = el;
    take(el);
    if (!textOf(el)) return;
    const wait = immediate || performance.now() - lastHidden < QUICK_WINDOW_MS ? 0 : SHOW_DELAY_MS;
    if (wait === 0) showNow(el);
    else timer = window.setTimeout(() => current === el && showNow(el), wait);
  };

  function leave(): void {
    hideBubble();
    if (current) give(current);
    current = null;
  }

  document.addEventListener(
    'pointerover',
    (e) => {
      if (e.pointerType === 'touch') return;
      const el = holder(e.target);
      if (el) enter(el, false);
    },
    true,
  );

  document.addEventListener(
    'pointerout',
    (e) => {
      if (!current) return;
      const into = e.relatedTarget;
      if (into instanceof Node && current.contains(into)) return;
      if (e.target instanceof Node && current.contains(e.target)) leave();
    },
    true,
  );

  // Code may set a new title while the element is hovered (e.g. Start becomes Pause): keep the bubble current.
  document.addEventListener(
    'pointermove',
    () => {
      if (!current || current.getAttribute('title') === null) return;
      take(current);
      if (bubble.visible) showNow(current);
    },
    true,
  );

  document.addEventListener('pointerdown', hideBubble, true);

  // Keyboard focus shows the tip too (only for focus-visible, not after a mouse click).
  document.addEventListener('focusin', (e) => {
    const el = holder(e.target);
    if (el && el.matches(':focus-visible')) enter(el, true);
  });
  document.addEventListener('focusout', () => leave());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideBubble();
  });
  window.addEventListener('scroll', hideBubble, true);
  window.addEventListener('blur', () => leave());
}
