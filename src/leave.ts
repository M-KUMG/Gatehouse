// Takes an element out of the page with an exit animation instead of making it
// vanish: it gets the class `gh-leaving` (motion.css plays the fade-out for the
// elements that have one), stops taking clicks and focus, and is removed once the
// animation is over. For people who ask for reduced motion it goes at once.

/** The part of an element `leave` uses (so it can be tested without a browser). */
export interface Leavable {
  isConnected: boolean;
  classList: { add(name: string): void };
  inert: boolean;
  remove(): void;
}

/** How long a leaving element stays (a little over the longest exit animation, motion.css). */
export const LEAVE_MS = 200;

export function leave(el: Leavable, reduced: boolean = prefersReducedMotion()): void {
  if (!el.isConnected) return;
  if (reduced) {
    el.remove();
    return;
  }
  el.classList.add('gh-leaving');
  el.inert = true;
  setTimeout(() => el.remove(), LEAVE_MS);
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
