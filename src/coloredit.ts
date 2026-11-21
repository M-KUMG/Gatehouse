// The color picker of a normal LED: a round color wheel that unfolds the part
// bar (like the value, name and clock editors, barfold.ts). The angle is the
// hue, the distance from the middle is the saturation (the middle is white);
// a glass bubble marks the color. Dragging or the arrow keys change the color
// at once (the LED redraws while you move); Escape or clicking away closes it.
// A popup next to the bar when it cannot unfold.

import './coloredit.css';
import type { FoldHost, FoldHostProvider } from './barfold';
import type { ScreenRect } from './grid';
import { LED_DEFAULT_COLOR, hexToHs, hsToHex, isLedColor, ledColorName, type Hs } from './ledcolor';
import { leave } from './leave';

/** Pointer offset from the wheel's centre (px) -> the hue and saturation under it (saturation stops at the rim). */
export function pointToHs(dx: number, dy: number, radius: number): Hs {
  const hue = (((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360; // 0 at the top, clockwise
  const sat = Math.min(1, Math.hypot(dx, dy) / radius);
  return { hue, sat: sat < 0.05 ? 0 : sat }; // a little dead zone: the exact middle is easy to hit (white)
}

/** The offset from the centre (px) where a hue and saturation sits on a wheel of `radius`. */
export function hsToPoint({ hue, sat }: Hs, radius: number): { x: number; y: number } {
  const a = (hue * Math.PI) / 180;
  return { x: Math.sin(a) * sat * radius, y: -Math.cos(a) * sat * radius };
}

const KEY_HUE_STEP = 4;
const KEY_SAT_STEP = 0.05;

export class ColorEditor {
  private el: HTMLDivElement | null = null;
  private provider: FoldHostProvider | null = null;
  private hostedBy: FoldHost | null = null;

  setHost(provider: FoldHostProvider): void {
    this.provider = provider;
  }

  get isOpen(): boolean {
    return this.el !== null;
  }

  /**
   * `current`: the LED's color now (undefined = the default red). `apply` gets each new color as "#rrggbb", or
   * null for the default red; `onDone` runs after every change (the redraw, which also records the undo step).
   */
  open(current: string | undefined, anchor: ScreenRect, bounds: DOMRect, apply: (color: string | null) => void, onDone: () => void): void {
    this.close();
    let hs = hexToHs(isLedColor(current) ? current : LED_DEFAULT_COLOR);
    let isDefault = !isLedColor(current);

    const el = document.createElement('div');
    el.className = 'value-editor color-editor';

    const wheel = document.createElement('div');
    wheel.className = 'color-wheel';
    wheel.tabIndex = 0;
    wheel.setAttribute('role', 'slider');
    wheel.setAttribute('aria-label', 'LED color: hue round the wheel, saturation from the middle');
    const bubble = document.createElement('div');
    bubble.className = 'color-bubble';
    wheel.append(bubble);

    const info = document.createElement('div');
    info.className = 'color-info';
    const swatch = document.createElement('span');
    swatch.className = 'color-swatch';
    const name = document.createElement('span');
    name.className = 'color-name';
    const title = document.createElement('div');
    title.className = 'color-title';
    title.append(swatch, name);
    const hexText = document.createElement('div');
    hexText.className = 'color-hex';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'color-reset';
    reset.textContent = 'Default red';
    info.append(title, hexText, reset);
    el.append(wheel, info);

    const radius = (): number => wheel.clientWidth / 2;
    /** Show `hs` (bubble, swatch, texts). `glide`: let the bubble slide there (not while it is dragged). */
    const show = (glide: boolean): void => {
      const hex = hsToHex(hs.hue, hs.sat);
      const p = hsToPoint(hs, radius());
      bubble.classList.toggle('glide', glide);
      bubble.style.setProperty('--x', `${p.x}px`);
      bubble.style.setProperty('--y', `${p.y}px`);
      swatch.style.background = hex;
      name.textContent = ledColorName(hex);
      hexText.textContent = isDefault ? `${LED_DEFAULT_COLOR} (default)` : hex;
      reset.disabled = isDefault;
      wheel.setAttribute('aria-valuetext', `${ledColorName(hex)} ${hex}`);
    };
    const change = (next: Hs, glide: boolean): void => {
      hs = next;
      isDefault = false;
      show(glide);
      apply(hsToHex(hs.hue, hs.sat));
      onDone();
    };

    let dragging = false;
    const fromPointer = (e: PointerEvent): void => {
      const r = wheel.getBoundingClientRect();
      const half = r.width / 2;
      change(pointToHs(e.clientX - (r.left + half), e.clientY - (r.top + half), half), false);
    };
    wheel.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      wheel.setPointerCapture(e.pointerId);
      wheel.focus();
      fromPointer(e);
    });
    wheel.addEventListener('pointermove', (e) => {
      if (dragging) fromPointer(e);
    });
    const stop = (): void => {
      dragging = false;
    };
    wheel.addEventListener('pointerup', stop);
    wheel.addEventListener('pointercancel', stop);
    wheel.addEventListener('keydown', (e) => {
      const dh = e.key === 'ArrowRight' ? KEY_HUE_STEP : e.key === 'ArrowLeft' ? -KEY_HUE_STEP : 0;
      const ds = e.key === 'ArrowUp' ? KEY_SAT_STEP : e.key === 'ArrowDown' ? -KEY_SAT_STEP : 0;
      if (dh === 0 && ds === 0) return;
      e.preventDefault();
      change({ hue: (hs.hue + dh + 360) % 360, sat: Math.min(1, Math.max(0, hs.sat + ds)) }, true);
    });
    reset.addEventListener('click', () => {
      hs = hexToHs(LED_DEFAULT_COLOR);
      isDefault = true;
      show(true);
      apply(null);
      onDone();
      wheel.focus();
    });

    el.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the arrow keys and R, H, V ... must not reach the grid
      if (e.key === 'Escape') this.close();
    });

    const host = this.provider?.() ?? null;
    this.el = el;
    if (host?.available()) {
      el.classList.add('in-bar');
      this.hostedBy = host;
      host.show(el);
    } else {
      this.hostedBy = null;
      document.body.appendChild(el);
      el.style.left = `${Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - el.offsetWidth - 8))}px`;
      el.style.top = `${Math.max(bounds.top + 8, Math.min(anchor.bottom + 8, bounds.bottom - el.offsetHeight - 8))}px`;
    }
    // Closes when the focus leaves the editor altogether.
    el.addEventListener('focusout', (e) => {
      const next = e.relatedTarget;
      if (!(next instanceof Node && el.contains(next))) this.close();
    });
    wheel.focus({ preventScroll: true });
    // The wheel has no size until the bar has laid it out: place the bubble then.
    show(false);
    requestAnimationFrame(() => {
      if (this.el === el) show(false);
    });
  }

  close(): void {
    const el = this.el;
    this.el = null;
    if (!el) return;
    const host = this.hostedBy;
    this.hostedBy = null;
    if (host) host.hide(el);
    else leave(el);
  }
}
