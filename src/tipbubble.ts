// A small glass bubble with a name in it, shown beside an element while the
// mouse is over it (used by the parts menu, where tiles show only the icon).
// Positioning is a pure function so it can be unit-tested; TipBubble owns the
// one DOM element and is cheap to reuse for many anchors.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type BubbleSide = 'left' | 'right';

export interface BubblePlacement {
  x: number;
  y: number;
  /** Side of the anchor the bubble ended up on (it flips when the preferred side has no room). */
  side: BubbleSide;
}

/**
 * Where to put a bubble of `bubble` size next to `anchor`: on the preferred
 * side, vertically centred on the anchor, flipped to the other side when it
 * would leave the viewport, and always kept at least `margin` inside it.
 */
export function placeBubble(anchor: Box, bubble: Size, viewport: Size, prefer: BubbleSide = 'left', gap = 10, margin = 6): BubblePlacement {
  const leftX = anchor.left - gap - bubble.width;
  const rightX = anchor.left + anchor.width + gap;
  const fits = (x: number): boolean => x >= margin && x + bubble.width <= viewport.width - margin;

  let side: BubbleSide = prefer;
  let x = prefer === 'left' ? leftX : rightX;
  if (!fits(x)) {
    const otherX = prefer === 'left' ? rightX : leftX;
    if (fits(otherX)) {
      side = prefer === 'left' ? 'right' : 'left';
      x = otherX;
    }
  }
  x = Math.max(margin, Math.min(x, viewport.width - margin - bubble.width));

  const centred = anchor.top + anchor.height / 2 - bubble.height / 2;
  const y = Math.max(margin, Math.min(centred, viewport.height - margin - bubble.height));
  return { x, y, side };
}

export class TipBubble {
  private readonly el: HTMLDivElement;

  constructor(private readonly prefer: BubbleSide = 'left') {
    this.el = document.createElement('div');
    this.el.className = 'tip-bubble';
    this.el.setAttribute('role', 'tooltip');
    document.body.appendChild(this.el);
  }

  /** Show `text` beside `anchor`. */
  show(anchor: HTMLElement, text: string): void {
    const el = this.el;
    el.textContent = text;
    // Measure while invisible (display is on, opacity is 0), then place and fade in.
    el.classList.remove('visible');
    el.style.display = 'block';
    const a = anchor.getBoundingClientRect();
    const place = placeBubble(
      { left: a.left, top: a.top, width: a.width, height: a.height },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      this.prefer,
    );
    el.style.left = `${Math.round(place.x)}px`;
    el.style.top = `${Math.round(place.y)}px`;
    el.dataset.side = place.side;
    // Force a style flush so the transition starts from the hidden state.
    void el.offsetWidth;
    el.classList.add('visible');
  }

  hide(): void {
    this.el.classList.remove('visible');
    this.el.style.display = 'none';
  }
}
