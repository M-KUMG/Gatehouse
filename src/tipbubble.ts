// A small glass bubble with a name or a hint in it, shown next to an element
// while the mouse is over it (the parts menu uses it directly; tooltips.ts uses
// it for every control that has a title). Positioning is a pure function so it
// can be unit-tested; TipBubble owns the one DOM element and is cheap to reuse
// for many anchors.

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

export type BubbleSide = 'left' | 'right' | 'above' | 'below';

export interface BubblePlacement {
  x: number;
  y: number;
  /** Side of the anchor the bubble ended up on (it flips when the preferred side has no room). */
  side: BubbleSide;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

/**
 * Where to put a bubble of `bubble` size next to `anchor`. Left/right: beside
 * the anchor, centred vertically. Above/below: over or under it, centred
 * horizontally. It flips to the opposite side when the preferred side would
 * leave the viewport, and is always kept at least `margin` inside it.
 */
export function placeBubble(anchor: Box, bubble: Size, viewport: Size, prefer: BubbleSide = 'left', gap = 10, margin = 6): BubblePlacement {
  if (prefer === 'above' || prefer === 'below') {
    const aboveY = anchor.top - gap - bubble.height;
    const belowY = anchor.top + anchor.height + gap;
    const fitsY = (y: number): boolean => y >= margin && y + bubble.height <= viewport.height - margin;

    let side: BubbleSide = prefer;
    let y = prefer === 'above' ? aboveY : belowY;
    if (!fitsY(y)) {
      const otherY = prefer === 'above' ? belowY : aboveY;
      if (fitsY(otherY)) {
        side = prefer === 'above' ? 'below' : 'above';
        y = otherY;
      }
    }
    y = clamp(y, margin, viewport.height - margin - bubble.height);
    const x = clamp(anchor.left + anchor.width / 2 - bubble.width / 2, margin, viewport.width - margin - bubble.width);
    return { x, y, side };
  }

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
  x = clamp(x, margin, viewport.width - margin - bubble.width);

  const centred = anchor.top + anchor.height / 2 - bubble.height / 2;
  const y = clamp(centred, margin, viewport.height - margin - bubble.height);
  return { x, y, side };
}

/** Under the control, unless it sits in the lower third of the window: then above it. */
export function preferredVerticalSide(anchor: Box, viewport: Size): 'above' | 'below' {
  return anchor.top + anchor.height / 2 > viewport.height * 0.66 ? 'above' : 'below';
}

export class TipBubble {
  private readonly el: HTMLDivElement;

  constructor(private readonly prefer: BubbleSide = 'left') {
    this.el = document.createElement('div');
    this.el.className = 'tip-bubble';
    this.el.setAttribute('role', 'tooltip');
    document.body.appendChild(this.el);
  }

  /** Show `text` next to `anchor`, on `prefer` side (default: the one given to the constructor). */
  show(anchor: HTMLElement, text: string, prefer: BubbleSide = this.prefer): void {
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
      prefer,
      prefer === 'above' || prefer === 'below' ? 8 : 10,
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

  /** True while the bubble is on screen. */
  get visible(): boolean {
    return this.el.classList.contains('visible');
  }
}
