import { hLead, svgDoc, type PartArt } from './common';

// 12 mm active buzzer seen from above: black cylinder with the sound hole in
// the middle, the '+' moulded next to the positive lead, the white sealing
// sticker's remains. 5 x 4 cells; leads end at (0, 40) + and (100, 40) -,
// on the centre line (a mirror equals a half turn: not mirrorable).

function buzzerSvg(burned: boolean): string {
  const defs = `
<radialGradient id="bzTop" cx=".42" cy=".38" r=".7">
  <stop offset="0" stop-color="${burned ? '#2a1c16' : '#3a3c41'}"/><stop offset=".7" stop-color="#18191c"/><stop offset="1" stop-color="#0a0a0b"/>
</radialGradient>
<radialGradient id="bzHole" cx=".5" cy=".5" r=".5">
  <stop offset="0" stop-color="#000"/><stop offset=".8" stop-color="#050505"/><stop offset="1" stop-color="#2c2d31"/>
</radialGradient>`;
  const body = `
${hLead(0, 24, 40)}
${hLead(76, 100, 40)}
<circle cx="50" cy="40" r="28" fill="url(#bzTop)"/>
<circle cx="50" cy="40" r="23.5" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="1"/>
<circle cx="50" cy="40" r="4.2" fill="url(#bzHole)"/>
<path d="M28 40H33M30.5 37.5V42.5" stroke="#8a8c91" stroke-width="1.3" stroke-linecap="round"/>
<path d="M67 40H72" stroke="#5e6065" stroke-width="1.1" stroke-linecap="round"/>
<path d="M33 24A24 24 0 0 1 58 17" fill="none" stroke="#fff" stroke-opacity="${burned ? 0.08 : 0.22}" stroke-width="2" stroke-linecap="round"/>
${burned ? '<path d="M44 20L50 30L45 38L53 50L48 60" fill="none" stroke="#6b3a20" stroke-width="1.2"/>' : ''}
<circle cx="50" cy="40" r="28" fill="none" stroke="#000" stroke-width=".8"/>`;
  return svgDoc(5, 4, defs, body);
}

export const BUZZER_ART: PartArt = { cols: 5, rows: 4, svg: buzzerSvg(false) };
export const BUZZER_BURNED_SVG = buzzerSvg(true);

/** Seconds per sound-wave ring (visual only). */
const WAVE_PERIOD = 0.6;
const WAVE_SECTORS: readonly (readonly [number, number])[] = [
  [-1.25, -0.35], [0.35, 1.25], [Math.PI + 0.35, Math.PI + 1.25], [Math.PI - 1.25, Math.PI - 0.35],
];

/**
 * Sound waves leaving the hole while the buzzer sounds (canvas in art
 * units). `seconds`: the frame time; the rings move outwards with it.
 */
export function drawBuzzerWaves(ctx: CanvasRenderingContext2D, seconds: number): void {
  const phase = (((seconds / WAVE_PERIOD) % 1) + 1) % 1;
  ctx.save();
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const t = (phase + k / 3) % 1;
    const r = 8 + 30 * t;
    ctx.strokeStyle = `rgba(120, 200, 255, ${0.85 * (1 - t)})`;
    ctx.lineWidth = 2.2 - 1.2 * t;
    // Four sectors, leaving out the directions of the two leads (0 and pi).
    for (const [a0, a1] of WAVE_SECTORS) {
      ctx.beginPath();
      ctx.arc(50, 40, r, a0, a1);
      ctx.stroke();
    }
  }
  ctx.restore();
}
