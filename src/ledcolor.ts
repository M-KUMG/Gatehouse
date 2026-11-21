// The color of a normal LED: `state.color`, a "#rrggbb" text, or nothing for the
// default red. Pure functions (no DOM): the picker (coloredit.ts), the art and
// glow (art/led.ts), the electrical model (basicparts.ts) and the name chip all
// read the color through here.
//
// A color is described by its hue (0..360, degrees round the wheel) and its
// saturation (0..1, 0 = white); the brightness is always full, like the picker.

import { RED_LED, VT } from './sim/devices';
import type { ComponentModel } from './sim/types';

export const LED_DEFAULT_COLOR = '#ff0f00';

export interface Hs {
  hue: number;
  sat: number;
}

export type Rgb = readonly [number, number, number];

const HEX = /^#[0-9a-f]{6}$/;

/** True for "#rrggbb" in lower case (what is saved). */
export function isLedColor(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v);
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const hex2 = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** Hue and saturation at full brightness -> [r, g, b] (0..255). */
export function hsToRgb(hue: number, sat: number): Rgb {
  const h = (((hue % 360) + 360) % 360) / 60;
  const s = clamp01(sat);
  const f = h - Math.floor(h);
  const p = 1 - s;
  const q = 1 - s * f;
  const t = 1 - s * (1 - f);
  const [r, g, b] = [[1, t, p], [q, 1, p], [p, 1, t], [p, q, 1], [t, p, 1], [1, p, q]][Math.floor(h) % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** "#rrggbb" from hue and saturation (full brightness). */
export function hsToHex(hue: number, sat: number): string {
  const [r, g, b] = hsToRgb(hue, sat);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** The hue and saturation of a "#rrggbb" (its brightness is ignored: every LED color is full brightness). */
export function hexToHs(hex: string): Hs {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = ((g - b) / d + 6) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  return { hue, sat: max === 0 ? 0 : d / max };
}

/** The hue and saturation of a part's color state (the default red when it has none or a bad one). */
export function ledColorOf(color: unknown): Hs {
  return hexToHs(isLedColor(color) ? color : LED_DEFAULT_COLOR);
}

/** A short name for the chip: "Red", "Green", "White" ... */
export function ledColorName(color: unknown): string {
  const { hue, sat } = ledColorOf(color);
  if (sat < 0.2) return 'White';
  if (hue < 15 || hue >= 345) return 'Red';
  if (hue < 42) return 'Orange';
  if (hue < 70) return 'Yellow';
  if (hue < 165) return 'Green';
  if (hue < 200) return 'Cyan';
  if (hue < 255) return 'Blue';
  if (hue < 290) return 'Purple';
  return 'Pink';
}

// Forward voltage at 20 mA by hue, for the model of a colored LED. Real parts:
// red, orange, yellow and standard green are 2.0..2.3 V (AlGaInP / GaP);
// cyan, blue and violet are 3.0..3.3 V (InGaN). Pink and magenta LEDs do not
// exist (they are a blue die under a red-ish phosphor), so the curve just
// blends back to red. A paler color is a phosphor "white" LED: 3.2 V.
const HUE_VOLTS: readonly (readonly [number, number])[] = [
  [0, 2.0], [40, 2.0], [60, 2.1], [120, 2.3], [165, 3.0], [200, 3.1], [240, 3.2], [290, 3.2], [360, 2.0],
];
export const WHITE_LED_VOLTS = 3.2;

/** The forward voltage at 20 mA of an LED of this hue and saturation. */
export function ledForwardVolts({ hue, sat }: Hs): number {
  const h = ((hue % 360) + 360) % 360;
  let v = HUE_VOLTS[0][1];
  for (let i = 1; i < HUE_VOLTS.length; i++) {
    const [h1, v1] = HUE_VOLTS[i];
    const [h0, v0] = HUE_VOLTS[i - 1];
    if (h <= h1) {
      v = v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
      break;
    }
  }
  return v + (WHITE_LED_VOLTS - v) * (1 - clamp01(sat));
}

/** The six epoxy shades, the highlight and the outline of the LED art for a color. */
export interface LedPalette {
  epoxy: readonly [string, string, string, string, string, string];
  glowHighlight: string;
  outline: string;
}

const hsv = (hue: number, sat: number, value: number): string => {
  const [r, g, b] = hsToRgb(hue, 1);
  // Brightness below 1: scale the fully bright color (with white mixed in for the saturation).
  const mix = (c: number): number => (c * sat + 255 * (1 - sat)) * value;
  return `#${hex2(mix(r))}${hex2(mix(g))}${hex2(mix(b))}`;
};

/** The art palette of a color, by the same recipe the default red was drawn with. */
export function ledPalette({ hue, sat }: Hs): LedPalette {
  return {
    epoxy: [
      hsv(hue, sat * 0.92, 0.43), hsv(hue, sat * 0.83, 0.83), hsv(hue, sat * 0.76, 0.95),
      hsv(hue, sat * 0.94, 0.37), hsv(hue, sat * 0.74, 0.89), hsv(hue, sat * 0.92, 0.48),
    ],
    glowHighlight: hsv(hue, sat * 0.45, 1),
    outline: hsv(hue, sat * 0.95, 0.24),
  };
}

/** The glow colors for a color: the lit core's centre, its body, and the halo. */
export function ledGlowColors({ hue, sat }: Hs): { centre: Rgb; body: Rgb; halo: Rgb } {
  const body = hsToRgb(hue, Math.max(sat, 0.0));
  const mixWhite = (c: Rgb, k: number): Rgb => [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k];
  return { centre: mixWhite(body, 0.78), body, halo: body };
}

/**
 * The electrical model of an LED of `color` (a "#rrggbb" or nothing): the
 * default red is RED_LED itself; another color keeps its ideality (n 2) and
 * series resistance (2.5 ohm) and moves the knee so that it has
 * ledForwardVolts across it at 20 mA.
 */
export function ledModelOf(color: unknown): ComponentModel {
  if (!isLedColor(color)) return RED_LED;
  const red = RED_LED as Extract<ComponentModel, { kind: 'diode' }>;
  const volts = ledForwardVolts(hexToHs(color));
  return { kind: 'diode', n: red.n, rs: red.rs, is: 0.02 / Math.exp((volts - 0.02 * red.rs) / (red.n * VT)) };
}
