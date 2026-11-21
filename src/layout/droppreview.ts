// The preview shown while a window (tab) is dragged: where it would land.
//
// Dockview draws it itself, but throws it away and draws a new one whenever
// the pointer moves from one window to another (the old rectangle is cleared
// a tick after the pointer leaves, before the next window asks for its own),
// so the preview could only glide inside one window and blinked between
// windows. This keeps one preview card of our own: while dragging it follows
// dockview's rectangle (which glass.css makes invisible and instant), and when
// that rectangle is missing for a moment (the pointer is between two windows)
// the card stays where it was, so the next window's rectangle makes it glide
// there instead of appearing from nothing. If no rectangle comes back within
// GRACE_MS the card fades out (the drag ended or left the dock).

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PreviewState {
  /** The card is on screen (showing or waiting for the next rectangle). */
  shown: boolean;
  /** Where it was last placed. */
  box: Box | null;
  /** Time (ms) dockview's rectangle was last seen. */
  lastSeen: number;
}

export interface PreviewStep {
  state: PreviewState;
  visible: boolean;
  box: Box | null;
  /** Place the card without animating (it has just appeared). */
  jump: boolean;
}

/** How long the card waits for the next window's rectangle before it fades out. */
export const GRACE_MS = 180;

export const EMPTY_PREVIEW: PreviewState = { shown: false, box: null, lastSeen: 0 };

/** One frame: where the card should be, given dockview's rectangle now (null when there is none). */
export function stepPreview(prev: PreviewState, anchor: Box | null, now: number): PreviewStep {
  if (anchor) {
    return { state: { shown: true, box: anchor, lastSeen: now }, visible: true, box: anchor, jump: !prev.shown };
  }
  if (prev.shown && now - prev.lastSeen <= GRACE_MS) {
    return { state: prev, visible: true, box: prev.box, jump: false };
  }
  return { state: { shown: false, box: prev.box, lastSeen: prev.lastSeen }, visible: false, box: prev.box, jump: false };
}

/**
 * Starts following drags in `host` (the dockview root). Returns a function
 * that removes everything again.
 */
export function installDropPreview(host: HTMLElement): () => void {
  const ghost = document.createElement('div');
  ghost.className = 'gh-drop-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  document.body.append(ghost);

  let state: PreviewState = EMPTY_PREVIEW;
  let dragging = false;
  let raf = 0;
  let lastActive = 0;

  const anchorBox = (): Box | null => {
    const a = host.querySelector<HTMLElement>('.dv-drop-target-anchor');
    if (!a || a.style.visibility !== 'visible') return null;
    const r = a.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
  };

  const place = (box: Box): void => {
    ghost.style.left = `${box.left}px`;
    ghost.style.top = `${box.top}px`;
    ghost.style.width = `${box.width}px`;
    ghost.style.height = `${box.height}px`;
  };

  const frame = (now: number): void => {
    raf = 0;
    const box = anchorBox();
    if (box) lastActive = now;
    const step = stepPreview(state, box, now);
    state = step.state;
    if (step.box) {
      if (step.jump) {
        ghost.classList.add('jump');
        place(step.box);
        void ghost.offsetWidth; // apply the position before the transition comes back
        ghost.classList.remove('jump');
      } else {
        place(step.box);
      }
    }
    ghost.classList.toggle('show', step.visible);
    // A drag that never shows a rectangle (or whose end event was missed) stops after a second.
    if (dragging && now - lastActive > 1000 && !state.shown) dragging = false;
    if (dragging || state.shown) raf = requestAnimationFrame(frame);
  };
  const wake = (): void => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const onStart = (): void => {
    dragging = true;
    lastActive = performance.now();
    wake();
  };
  const onEnd = (): void => {
    dragging = false;
    wake();
  };
  document.addEventListener('dragstart', onStart, true);
  document.addEventListener('dragenter', onStart, true);
  document.addEventListener('dragend', onEnd, true);
  document.addEventListener('drop', onEnd, true);

  return () => {
    document.removeEventListener('dragstart', onStart, true);
    document.removeEventListener('dragenter', onStart, true);
    document.removeEventListener('dragend', onEnd, true);
    document.removeEventListener('drop', onEnd, true);
    if (raf) cancelAnimationFrame(raf);
    ghost.remove();
  };
}
