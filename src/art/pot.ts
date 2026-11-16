import { svgDoc, vLead, type PartArt } from './common';

// Rotary potentiometer seen from the front: round steel can, black knob,
// three solder legs. The pointer on the knob is drawn live (drawPotPointer).
// 4 x 4 cells; legs end at (20, 80), (40, 80) wiper and (60, 80).

export const POT_KNOB = { x: 40, y: 31, r: 15 }; // art units
/** The knob turns this many degrees either way from straight up. */
export const POT_SWEEP = 150;

const defs = `
<linearGradient id="can" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#f1f3f5"/>
  <stop offset=".5" stop-color="#a9afb6"/>
  <stop offset="1" stop-color="#6d737a"/>
</linearGradient>
<radialGradient id="knob" cx=".38" cy=".32" r=".85">
  <stop offset="0" stop-color="#56585f"/>
  <stop offset=".6" stop-color="#232428"/>
  <stop offset="1" stop-color="#0d0d0f"/>
</radialGradient>`;

const ticks = [-150, -100, -50, 0, 50, 100, 150]
  .map((deg) => {
    const a = (deg * Math.PI) / 180;
    const p = (r: number): string =>
      `${(POT_KNOB.x + r * Math.sin(a)).toFixed(2)} ${(POT_KNOB.y - r * Math.cos(a)).toFixed(2)}`;
    return `M${p(19.5)}L${p(23)}`;
  })
  .join('');

const body = `
${vLead(20, 54, 80, 3)}
${vLead(40, 54, 80, 3)}
${vLead(60, 54, 80, 3)}
<rect x="11" y="49" width="58" height="13" rx="1.5" fill="#9a6b3c" stroke="#3c2710" stroke-width=".6"/>
<g fill="#c9ced6" stroke="#4d5258" stroke-width=".5">
  <circle cx="20" cy="56.5" r="3"/><circle cx="40" cy="56.5" r="3"/><circle cx="60" cy="56.5" r="3"/>
</g>
<circle cx="40" cy="31" r="27" fill="url(#can)" stroke="#33373c" stroke-width=".7"/>
<path d="${ticks}" stroke="#2a2d31" stroke-width="1.3" stroke-linecap="round"/>
<circle cx="40" cy="32.5" r="16" fill="#000" fill-opacity=".3"/>
<circle cx="40" cy="31" r="15" fill="url(#knob)" stroke="#000" stroke-opacity=".7" stroke-width=".7"/>
<circle cx="40" cy="31" r="14" fill="none" stroke="#6a6d75" stroke-width="1.4" stroke-dasharray="1.2 1.9"/>`;

export const POT_ART: PartArt = { cols: 4, rows: 4, svg: svgDoc(4, 4, defs, body) };

/** Pointer line on the knob for a wiper position 0..1 (canvas in art units). */
export function drawPotPointer(ctx: CanvasRenderingContext2D, position: number): void {
  const angle = ((position * 2 - 1) * POT_SWEEP * Math.PI) / 180;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  ctx.beginPath();
  ctx.moveTo(POT_KNOB.x + 3 * sin, POT_KNOB.y - 3 * cos);
  ctx.lineTo(POT_KNOB.x + 12.5 * sin, POT_KNOB.y - 12.5 * cos);
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = '#f2f4f7';
  ctx.stroke();
}
