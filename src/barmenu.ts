// A menu in the file bar makes the bar itself grow: while the menu is open the
// bar gets taller (and at least as wide as the list) and the list sits inside it,
// so the bar seems to unfold into the menu instead of a separate popup appearing
// under it. The look is in motion.css (`.file-bar.menu-open`); this only tells the
// bar how much room the open list needs. A menu that is not in the bar is left alone.

/** Call after the menu's `hidden` has changed (a list that is shown can be measured). */
export function setBarMenuOpen(wrap: HTMLElement, menu: HTMLElement, open: boolean): void {
  const bar = wrap.closest<HTMLElement>('.file-bar');
  if (!bar) return;
  if (open) bar.style.setProperty('--gh-bar-menu-h', `${menu.offsetHeight}px`);
  bar.classList.toggle('menu-open', open);
}
