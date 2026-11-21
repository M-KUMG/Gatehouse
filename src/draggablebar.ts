// Lets the small bars floating on the grid (file bar, transport bar) be grabbed
// and moved with the mouse. Each bar gets a grip (six dots) at its start; the
// bar can also be dragged by any empty part of it, but not by its buttons,
// dropdowns or menus. The grip works from the keyboard too (arrow keys, Shift
// for big steps; Home) and a double click on it puts the bar back in its corner.
//
// UI-only state: positions are saved per user in localStorage, never in the
// project, and moving a bar is not an undo step. The position maths is in
// barposition.ts.

import { clampPosition, keyStep, parseSavedPositions, type BarPosition } from './barposition';

const STORAGE_KEY = 'gatehouse.bars';
const DRAG_THRESHOLD = 3; // px of movement before a press on the bar counts as a drag
/** Presses on these keep their own meaning and never start a drag. */
const INTERACTIVE = 'button, select, input, textarea, a, .windows-menu-list';

function readAll(): Record<string, BarPosition> {
  try {
    return parseSavedPositions(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

function writeOne(id: string, pos: BarPosition | null): void {
  try {
    const all = readAll();
    if (pos) all[id] = pos;
    else delete all[id];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage blocked: the bar just starts in its corner next time
  }
}

export interface DraggableBarOptions {
  /** Stable name used to save the position ("file", "transport"). */
  id: string;
  /** The bar; it must be positioned absolutely inside `area`. */
  bar: HTMLElement;
  /** The grid area the bar moves in. */
  area: HTMLElement;
  /** Name shown to screen readers on the grip, e.g. "file bar". */
  label: string;
}

export function makeDraggable({ id, bar, area, label }: DraggableBarOptions): void {
  const grip = document.createElement('span');
  grip.className = 'bar-grip';
  grip.tabIndex = 0;
  grip.setAttribute('role', 'button');
  grip.setAttribute('aria-label', `Move the ${label} (arrow keys; double click to put it back)`);
  grip.title = `Drag to move the ${label} · double click to put it back`;
  grip.innerHTML =
    '<svg viewBox="0 0 8 14" width="8" height="14" aria-hidden="true" fill="currentColor">' +
    '<circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/>' +
    '<circle cx="6" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/></svg>';
  bar.prepend(grip);

  /** Current position of the bar inside the area, in pixels. */
  const current = (): BarPosition => {
    const a = area.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    return { left: b.left - a.left, top: b.top - a.top };
  };

  /** Move the bar (clamped inside the area) and switch it from its corner anchor to explicit left/top. */
  const place = (pos: BarPosition): BarPosition | null => {
    const a = area.getBoundingClientRect();
    if (a.width === 0 || a.height === 0) return null; // hidden: nothing to measure against
    const clamped = clampPosition(pos, { width: bar.offsetWidth, height: bar.offsetHeight }, { width: a.width, height: a.height });
    bar.style.left = `${clamped.left}px`;
    bar.style.top = `${clamped.top}px`;
    bar.style.right = 'auto';
    bar.style.bottom = 'auto';
    return clamped;
  };

  const putBack = (): void => {
    bar.style.left = bar.style.top = bar.style.right = bar.style.bottom = '';
    writeOne(id, null);
  };

  let moved = false; // the bar has a custom position (saved or dragged)
  // A saved position waits here until the area has a size (the dock may not have laid it out yet).
  let pending: BarPosition | null = readAll()[id] ?? null;
  const applyPending = (): void => {
    if (pending && place(pending)) {
      moved = true;
      pending = null;
    }
  };
  applyPending();

  // Keep a moved bar inside the area when the window or the docked panels change size.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      applyPending();
      if (moved) place(current());
    }).observe(area);
  }

  // ---- Mouse and touch: press on the grip or on an empty part of the bar ----
  let drag: { pointerId: number; startX: number; startY: number; origin: BarPosition; active: boolean } | null = null;

  // The drag is followed on `window` (not with pointer capture), so a plain click
  // or double click on the grip still reaches it.
  const onMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.active = true;
      bar.classList.add('dragging');
      document.documentElement.classList.add('gh-dragging-bar'); // no text selection while dragging
    }
    if (place({ left: drag.origin.left + dx, top: drag.origin.top + dy })) moved = true;
  };

  const finish = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const wasDrag = drag.active;
    drag = null;
    bar.classList.remove('dragging');
    document.documentElement.classList.remove('gh-dragging-bar');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    if (wasDrag && moved) writeOne(id, current());
  };

  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target && target !== grip && !grip.contains(target) && target.closest(INTERACTIVE)) return;
    drag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origin: current(), active: false };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });

  grip.addEventListener('dblclick', () => {
    moved = false;
    pending = null;
    putBack();
  });

  // ---- Keyboard: arrow keys on the grip ----
  grip.addEventListener('keydown', (e) => {
    const step = keyStep(e.shiftKey);
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (d) {
      e.preventDefault();
      const from = current();
      if (place({ left: from.left + d[0], top: from.top + d[1] })) {
        moved = true;
        writeOne(id, current());
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      moved = false;
      pending = null;
      putBack();
    }
  });
}
