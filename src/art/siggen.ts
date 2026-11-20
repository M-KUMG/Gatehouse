import { hLead, svgDoc, type PartArt } from './common';

// Function generator: a small blue-grey box with a display showing the
// waveform and its frequency, and a red (+) and a black (-) output on the
// right. 6 x 4 cells; the leads end at (120, 20) positive and (120, 60) negative.

export const SIGGEN_COLS = 6;
export const SIGGEN_ROWS = 4;

const defs = `
<linearGradient id="sgBody" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#4f6275"/><stop offset=".5" stop-color="#3b4a59"/><stop offset="1" stop-color="#2a3541"/>
</linearGradient>
<linearGradient id="sgGlass" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#0d1a14"/><stop offset="1" stop-color="#050b08"/>
</linearGradient>`;

/** The waveform as a small polyline in a 30 x 14 box at (x, y). */
function wavePath(wave: string, x: number, y: number): string {
  const w = 30;
  const h = 14;
  const pts: [number, number][] = [];
  if (wave === 'sine') {
    for (let i = 0; i <= 24; i++) pts.push([(i / 24) * w, h / 2 - Math.sin((i / 24) * 2 * Math.PI) * (h / 2)]);
  } else if (wave === 'square') {
    pts.push([0, h], [0, 0], [w / 2, 0], [w / 2, h], [w, h], [w, 0]);
  } else if (wave === 'triangle') {
    pts.push([0, h], [w / 4, 0], [(3 * w) / 4, h], [w, 0]);
  } else {
    pts.push([0, h], [w / 2, 0], [w / 2, h], [w, 0]);
  }
  const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${(x + px).toFixed(1)} ${(y + py).toFixed(1)}`).join('');
  return `<path d="${d}" fill="none" stroke="#5dff9a" stroke-width="1.6" stroke-linejoin="round"/>`;
}

/** The frequency as printed: "1 Hz", "2.5 kHz". */
export function freqLabel(hz: number): string {
  if (hz >= 1e6) return `${+(hz / 1e6).toPrecision(3)} MHz`;
  if (hz >= 1e3) return `${+(hz / 1e3).toPrecision(3)} kHz`;
  return `${+hz.toPrecision(3)} Hz`;
}

/** The artwork showing `wave` at `hz`. */
export function siggenSvg(wave: string, hz: number): string {
  const body = `
${hLead(100, 120, 20, 3)}
${hLead(100, 120, 60, 3)}
<rect x="3" y="5" width="98" height="70" rx="5" fill="url(#sgBody)"/>
<rect x="3" y="5" width="98" height="70" rx="5" fill="none" stroke="#000" stroke-opacity=".6" stroke-width=".8"/>
<rect x="10" y="12" width="60" height="32" rx="2.5" fill="url(#sgGlass)" stroke="#000" stroke-width=".8"/>
${wavePath(wave, 14, 16)}
<text x="66" y="40" text-anchor="end" font-family="Consolas, 'Courier New', monospace" font-size="11" font-weight="bold" fill="#5dff9a">${freqLabel(hz)}</text>
<circle cx="24" cy="58" r="8" fill="#232b33" stroke="#0b0c0e" stroke-width="1"/>
<path d="M24 58L28 52" stroke="#e8eaee" stroke-width="2" stroke-linecap="round"/>
<circle cx="86" cy="20" r="6" fill="#c0392b" stroke="#400" stroke-width="1"/>
<circle cx="86" cy="60" r="6" fill="#16181b" stroke="#000" stroke-width="1"/>
<g font-family="Arial, Helvetica, sans-serif" font-weight="bold" text-anchor="middle" fill="#e8eaee">
  <text x="86" y="40" font-size="11">+</text>
  <text x="86" y="52" font-size="11">−</text>
  <text x="54" y="68" font-size="6" fill-opacity=".7">FUNCTION GEN</text>
</g>`;
  return svgDoc(SIGGEN_COLS, SIGGEN_ROWS, defs, body);
}

export const SIGGEN_ART: PartArt = { cols: SIGGEN_COLS, rows: SIGGEN_ROWS, svg: siggenSvg('square', 1) };
