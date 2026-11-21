// A menu in the file bar makes the bar itself grow: while the menu is open the
// bar gets taller (and at least as wide as the list) and the list sits inside it,
// so the bar seems to unfold into the menu instead of a separate popup appearing
// under it. The look is in motion.css (`.file-bar.menu-open`); this only tells the
// bar how much room the open list needs. A menu that is not in the bar is left alone.

/** How long after the pointer leaves a bar menu it closes (a short grace so the small gap between button and list does not close it). */
export const MENU_LEAVE_MS = 250;

/**
 * Every bar menu (File, Windows, Graphics) closes by itself when the pointer has
 * been away from it (button and list) for a moment; coming back in time keeps it
 * open. Returns `cancel`, to call whenever the menu opens or closes for another
 * reason, so a pending close can never fire after that.
 */
export function closeWhenPointerLeaves(wrap: HTMLElement, isOpen: () => boolean, close: () => void): () => void {
  let timer = 0;
  const cancel = (): void => window.clearTimeout(timer);
  wrap.addEventListener('pointerenter', cancel);
  wrap.addEventListener('pointerleave', () => {
    cancel();
    if (isOpen()) timer = window.setTimeout(close, MENU_LEAVE_MS);
  });
  return cancel;
}

/** Call after the menu's `hidden` has changed (a list that is shown can be measured). */
export function setBarMenuOpen(wrap: HTMLElement, menu: HTMLElement, open: boolean): void {
  const bar = wrap.closest<HTMLElement>('.file-bar');
  if (!bar) return;
  if (open) {
    bar.style.setProperty('--gh-bar-menu-h', `${menu.offsetHeight}px`);
    bar.classList.add('menu-open');
  } else if (!bar.querySelector('.windows-menu-list:not([hidden])')) {
    // A menu that closes late (its own timer) must not fold the bar around another menu that is open by now.
    bar.classList.remove('menu-open');
  }
}
