// Popups that hang from an element (a dropdown list from its button, a tooltip
// from what it describes) used to close or hide on ANY scroll in the page. That
// breaks while the simulation runs: the serial console scrolls its output by
// itself about 25 times a second, which closed every dropdown the moment it
// opened. Only a scroll that can move the anchor matters: one of an element that
// contains it (or the page).

/** True when a scroll event aimed at `target` can have moved `anchor`. A target we cannot tell counts as moving it. */
export function scrollMovesAnchor(target: EventTarget | null, anchor: Node | null): boolean {
  if (!anchor) return true;
  if (!target || typeof (target as Node).contains !== 'function') return true;
  return (target as Node).contains(anchor);
}
