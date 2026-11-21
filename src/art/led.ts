import { ledGlowColors, ledPalette, type Hs, type LedPalette } from '../ledcolor';
import { svgDoc, vLead, type PartArt } from './common';

// 5 mm red LED seen from the side: domed epoxy body, flange with the
// cathode flat on the left, lead frame visible through the epoxy.
// 3 x 4 cells; legs end at (20, 80) cathode and (40, 80) anode.

const DOME = 'M10 44V22A20 20 0 0 1 50 22V44Z';
const RIM = 'M10 39.5H51.5Q53 39.5 53 41V45Q53 46.5 51.5 46.5H10Z';

const RED = ['#6d0907', '#d42b22', '#f2463a', '#5e0605', '#e2463c', '#7a0d0a'];
const BURNED = ['#1c1110', '#3a2622', '#46302b', '#150c0b', '#3d2a26', '#1a100f'];

// Polarity marks on the legs, so the sides are clear at a glance: a white
// badge with a dark "-" on the cathode leg (left) and "+" on the anode leg
// (right). Drawn as shapes (no font).
const MARK_Y = 64;
const POLARITY_MARKS = `
<g stroke="#1b1f24" stroke-width="1.8" stroke-linecap="round">
  <circle cx="20" cy="${MARK_Y}" r="5.6" fill="#f1f3f5" stroke="#5d626a" stroke-width=".8"/>
  <path d="M17 ${MARK_Y}H23"/>
  <circle cx="40" cy="${MARK_Y}" r="5.6" fill="#f1f3f5" stroke="#5d626a" stroke-width=".8"/>
  <path d="M37 ${MARK_Y}H43M40 ${MARK_Y - 3}V${MARK_Y + 3}"/>
</g>`;

function ledSvg(burned: boolean, pal?: LedPalette): string {
  const c = burned ? BURNED : (pal?.epoxy ?? RED);
  const highlight = pal?.glowHighlight ?? '#ff9b8c';
  const outline = pal?.outline ?? '#3d0302';
  const defs = `
<linearGradient id="epoxy" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${c[0]}"/>
  <stop offset=".3" stop-color="${c[1]}"/>
  <stop offset=".55" stop-color="${c[2]}"/>
  <stop offset="1" stop-color="${c[3]}"/>
</linearGradient>
<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${c[4]}"/>
  <stop offset="1" stop-color="${c[5]}"/>
</linearGradient>
<radialGradient id="glow" cx=".5" cy=".3" r=".55">
  <stop offset="0" stop-color="${highlight}" stop-opacity=".55"/>
  <stop offset="1" stop-color="${highlight}" stop-opacity="0"/>
</radialGradient>`;

  const body = `
${vLead(20, 44, 80)}
${vLead(40, 44, 80)}
<g fill="#a7adb3">
  <path d="M18.8 44V29H14.5V23.5Q20 21 26 23.5V29H21.2V44Z"/>
  <rect x="38.8" y="27" width="2.4" height="17"/>
  <rect x="35.5" y="25.5" width="6" height="2.2" rx=".6"/>
</g>
${burned ? '' : '<path d="M36 25.8Q31 19 23 22.6" fill="none" stroke="#e8e1c8" stroke-width=".5"/>'}
${POLARITY_MARKS}
<path d="${DOME}" fill="url(#epoxy)" fill-opacity="${burned ? 0.95 : 0.84}"/>
${burned ? '<path d="M27 6L31 15L26 21L32 28L28 36" fill="none" stroke="#000" stroke-opacity=".7" stroke-width="1"/>' : `<path d="${DOME}" fill="url(#glow)"/>`}
<path d="${RIM}" fill="url(#rim)"/>
<path d="M15 37V22Q15 11 22.5 6.5" fill="none" stroke="#fff" stroke-opacity="${burned ? 0.18 : 0.6}" stroke-width="2.4" stroke-linecap="round"/>
<ellipse cx="42" cy="15" rx="1.6" ry="3.6" fill="#fff" fill-opacity="${burned ? 0.08 : 0.3}"/>
<path d="${DOME}" fill="none" stroke="${outline}" stroke-opacity=".6" stroke-width=".7"/>
<path d="${RIM}" fill="none" stroke="${outline}" stroke-opacity=".6" stroke-width=".7"/>`;
  return svgDoc(3, 4, defs, body);
}

export const LED_ART: PartArt = { cols: 3, rows: 4, svg: ledSvg(false) };
export const LED_BURNED_SVG = ledSvg(true);

/** The LED art in another color (hue and saturation, see ledcolor.ts). */
export function ledColorSvg(color: Hs): string {
  return ledSvg(false, ledPalette(color));
}

/** Light from the LED, brightness 0..1 (canvas in art units); `color` is the LED's color, red when left out. */
export function drawLedGlow(ctx: CanvasRenderingContext2D, brightness: number, color?: Hs): void {
  if (brightness <= 0) return;
  const b = Math.min(1, brightness);
  // The default red keeps the colors it was tuned with; another color takes the same recipe.
  const g = color ? ledGlowColors(color) : { centre: [255, 215, 190], body: [255, 70, 45], halo: [255, 60, 40] };
  const rgb = (c: readonly number[], a: number): string => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;
  ctx.globalCompositeOperation = 'lighter';
  // The lit epoxy body...
  const core = ctx.createRadialGradient(30, 24, 1, 30, 26, 22);
  core.addColorStop(0, rgb(g.centre, 0.95 * b));
  core.addColorStop(0.45, rgb(g.body, 0.75 * b));
  core.addColorStop(1, rgb(g.body, 0));
  ctx.fillStyle = core;
  ctx.fillRect(4, 0, 52, 50);
  // ...and the light it throws around it.
  const reach = 30 + 45 * b;
  const halo = ctx.createRadialGradient(30, 22, 6, 30, 22, reach);
  halo.addColorStop(0, rgb(g.halo, 0.4 * b));
  halo.addColorStop(1, rgb(g.halo, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(30 - reach, 22 - reach, 2 * reach, 2 * reach);
  ctx.globalCompositeOperation = 'source-over';
}
