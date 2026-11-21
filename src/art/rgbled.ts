import { svgDoc, type PartArt } from './common';

// 5 mm common-cathode RGB LED seen from the side: a frosted (diffused) dome
// with three coloured dies on the lead frame, four legs that fan out to the
// grid: R, the common cathode (-), G, B. Coloured badges on the legs name them.
// 5 x 4 cells; legs end at (20, 80) R, (40, 80) -, (60, 80) G, (80, 80) B.

const DOME = 'M30 44V22A20 20 0 0 1 70 22V44Z';
const RIM = 'M30 39.5H71.5Q73 39.5 73 41V45Q73 46.5 71.5 46.5H30Z';

/** Pin x of the legs, left to right (r, com, g, b), and where each enters the body. */
const LEGS = [{ out: 20, inn: 38 }, { out: 40, inn: 46 }, { out: 60, inn: 54 }, { out: 80, inn: 62 }];

const BADGE_Y = 66;
/** A badge on a leg: coloured disc with a white letter, or the white "-" disc of the common cathode. */
function badge(x: number, fill: string, mark: string): string {
  return `<circle cx="${x}" cy="${BADGE_Y}" r="5.6" fill="${fill}" stroke="#2a2f36" stroke-opacity=".7" stroke-width=".8"/>${mark}`;
}
const letter = (x: number, t: string): string =>
  `<text x="${x}" y="${BADGE_Y + 2.7}" font-family="Arial, sans-serif" font-size="7.6" font-weight="700" fill="#fff" text-anchor="middle">${t}</text>`;

function rgbledSvg(burned: boolean): string {
  const defs = `
<linearGradient id="rgbEpoxy" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${burned ? '#1c1110' : '#9aa0a8'}"/>
  <stop offset=".3" stop-color="${burned ? '#3a2622' : '#e4e7ea'}"/>
  <stop offset=".55" stop-color="${burned ? '#46302b' : '#f6f7f8'}"/>
  <stop offset="1" stop-color="${burned ? '#150c0b' : '#8f959c'}"/>
</linearGradient>
<linearGradient id="rgbRim" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${burned ? '#3d2a26' : '#d3d6da'}"/>
  <stop offset="1" stop-color="${burned ? '#1a100f' : '#8c9198'}"/>
</linearGradient>`;

  const legs = LEGS.map(({ out, inn }) => {
    const d = `M${inn} 46V52L${out} 62V80`;
    return `<path d="${d}" fill="none" stroke="#5d6269" stroke-width="3.2" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#e3e6e9" stroke-width="1.8" stroke-linejoin="round"/>`;
  }).join('');

  // Lead frame and dies, seen through the frosted epoxy.
  const dies = burned ? '' : `
<g id="rgbDies">
  <rect x="49" y="26" width="2.4" height="18" fill="#a7adb3"/>
  <path d="M43 28H59L56.5 33H45.5Z" fill="#a7adb3"/>
  <rect x="43.2" y="24.2" width="3.2" height="3.2" fill="#ff4a3a"/>
  <rect x="48.4" y="22.4" width="3.2" height="3.2" fill="#34e06a"/>
  <rect x="53.6" y="24.2" width="3.2" height="3.2" fill="#4a7dff"/>
</g>`;

  const marks = `
${badge(20, '#d4261e', letter(20, 'R'))}
${badge(40, '#f1f3f5', '<path d="M37 ' + BADGE_Y + 'H43" stroke="#1b1f24" stroke-width="1.9" stroke-linecap="round"/>')}
${badge(60, '#1ea152', letter(60, 'G'))}
${badge(80, '#2f63e0', letter(80, 'B'))}`;

  const body = `
${legs}
${dies}
<path d="${DOME}" fill="url(#rgbEpoxy)" fill-opacity="${burned ? 0.95 : 0.82}"/>
${burned ? '<path d="M47 6L51 15L46 21L52 28L48 36" fill="none" stroke="#000" stroke-opacity=".7" stroke-width="1"/>' : ''}
<path d="${RIM}" fill="url(#rgbRim)"/>
<path d="M35 37V22Q35 11 42.5 6.5" fill="none" stroke="#fff" stroke-opacity="${burned ? 0.18 : 0.7}" stroke-width="2.4" stroke-linecap="round"/>
<ellipse cx="62" cy="15" rx="1.6" ry="3.6" fill="#fff" fill-opacity="${burned ? 0.08 : 0.4}"/>
<path d="${DOME}" fill="none" stroke="#4b4f55" stroke-opacity=".6" stroke-width=".7"/>
<path d="${RIM}" fill="none" stroke="#4b4f55" stroke-opacity=".6" stroke-width=".7"/>
${marks}`;
  return svgDoc(5, 4, defs, body);
}

export const RGBLED_ART: PartArt = { cols: 5, rows: 4, svg: rgbledSvg(false) };
export const RGBLED_BURNED_SVG = rgbledSvg(true);

/** The light colours of the three dies (red, green, blue). */
const DIE_RGB = { r: [255, 50, 35], g: [60, 255, 100], b: [70, 110, 255] } as const;

/** Light from the LED, per colour brightness 0..1 (canvas in art units); the colours add up on the dome. */
export function drawRgbGlow(ctx: CanvasRenderingContext2D, brightness: Readonly<{ r: number; g: number; b: number }>): void {
  ctx.globalCompositeOperation = 'lighter';
  for (const ch of ['r', 'g', 'b'] as const) {
    const b = Math.min(1, Math.max(0, brightness[ch]));
    if (b <= 0) continue;
    const [r, g, bl] = DIE_RGB[ch];
    const core = ctx.createRadialGradient(50, 24, 1, 50, 26, 22);
    core.addColorStop(0, `rgba(${r}, ${g}, ${bl}, ${0.6 * b})`);
    core.addColorStop(0.5, `rgba(${r}, ${g}, ${bl}, ${0.45 * b})`);
    core.addColorStop(1, `rgba(${r}, ${g}, ${bl}, 0)`);
    ctx.fillStyle = core;
    ctx.fillRect(24, 0, 52, 50);
    const reach = 28 + 40 * b;
    const halo = ctx.createRadialGradient(50, 22, 6, 50, 22, reach);
    halo.addColorStop(0, `rgba(${r}, ${g}, ${bl}, ${0.3 * b})`);
    halo.addColorStop(1, `rgba(${r}, ${g}, ${bl}, 0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(50 - reach, 22 - reach, 2 * reach, 2 * reach);
  }
  ctx.globalCompositeOperation = 'source-over';
}
