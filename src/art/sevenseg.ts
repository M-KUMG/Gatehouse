import { svgDoc, vLead, type PartArt } from './common';

// 0.56 in common-cathode 7-segment display (red), seen from the front: black
// body, a slanted digit of seven segments plus the decimal point, drawn dim
// (the overlay lights them, see drawSevensegGlow). The pins are the usual
// 10-pin layout with the second common pin left out:
//   top    (y 0):   g f com a b   at x = 1..5 cells
//   bottom (y 8):   e d  -  c dp  at x = 1, 2, 4, 5 cells
// 6 x 8 cells (120 x 160 art units).

export type SegmentId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'dp';

const X0 = 36;
const Y0 = 32;
const W = 44;
const H = 92;
const T = 9;
const GAP = 1.4;
const SLANT = 0.1;

type Pt = readonly [number, number];

const skew = ([x, y]: Pt): Pt => [X0 + x + (H - y) * SLANT, Y0 + y];

function horizontal(yc: number): Pt[] {
  const x1 = GAP;
  const x2 = W - GAP;
  const h = T / 2;
  return [[x1, yc], [x1 + h, yc - h], [x2 - h, yc - h], [x2, yc], [x2 - h, yc + h], [x1 + h, yc + h]];
}

function vertical(xc: number, y1: number, y2: number): Pt[] {
  const h = T / 2;
  return [[xc, y1 + GAP], [xc + h, y1 + GAP + h], [xc + h, y2 - GAP - h], [xc, y2 - GAP], [xc - h, y2 - GAP - h], [xc - h, y1 + GAP + h]];
}

/** Outline of every bar segment in art units (slanted). */
export const SEGMENT_SHAPES: Readonly<Record<Exclude<SegmentId, 'dp'>, readonly Pt[]>> = {
  a: horizontal(0).map(skew),
  b: vertical(W, 0, H / 2).map(skew),
  c: vertical(W, H / 2, H).map(skew),
  d: horizontal(H).map(skew),
  e: vertical(0, H / 2, H).map(skew),
  f: vertical(0, 0, H / 2).map(skew),
  g: horizontal(H / 2).map(skew),
};

/** The decimal point: a dot right of the digit's foot. */
export const DP_DOT = { x: X0 + W + 11, y: Y0 + H, r: 4.6 };

const pathOf = (pts: readonly Pt[]): string =>
  `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z`;

const TOP = [1, 2, 3, 4, 5];
const BOTTOM = [1, 2, 4, 5];

function sevensegSvg(burned: boolean): string {
  const defs = `
<linearGradient id="ssBody" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="${burned ? '#2a1d18' : '#2b2c30'}"/><stop offset="1" stop-color="#0b0b0d"/>
</linearGradient>`;
  const dim = burned ? '#2a1612' : '#4a1a17';
  const segs = Object.values(SEGMENT_SHAPES).map((p) => `<path d="${pathOf(p)}" fill="${dim}"/>`).join('');
  const body = `
${TOP.map((x) => vLead(x * 20, 0, 12)).join('')}
${BOTTOM.map((x) => vLead(x * 20, 148, 160)).join('')}
<rect x="6" y="10" width="108" height="140" rx="3" fill="url(#ssBody)"/>
<rect x="12" y="16" width="96" height="128" rx="2" fill="#141416"/>
${segs}
<circle cx="${DP_DOT.x}" cy="${DP_DOT.y}" r="${DP_DOT.r}" fill="${dim}"/>
<text x="60" y="140.5" font-family="Arial, sans-serif" font-size="6" fill="#77797f" text-anchor="middle">0.56" CC</text>
${burned ? '<path d="M40 20L52 60L44 80L58 130" fill="none" stroke="#6b3a20" stroke-width="1.4"/>' : ''}
<path d="M10 14H110" stroke="#fff" stroke-opacity=".12" stroke-width="1.5"/>`;
  return svgDoc(6, 8, defs, body);
}

export const SEVENSEG_ART: PartArt = { cols: 6, rows: 8, svg: sevensegSvg(false) };
export const SEVENSEG_BURNED_SVG = sevensegSvg(true);

/** Lit segments, brightness 0..1 each (canvas in art units). */
export function drawSevensegGlow(ctx: CanvasRenderingContext2D, brightness: Readonly<Partial<Record<SegmentId, number>>>): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [id, b] of Object.entries(brightness) as [SegmentId, number][]) {
    if (!(b > 0)) continue;
    const v = Math.min(1, b);
    ctx.shadowColor = `rgba(255, 50, 30, ${0.9 * v})`;
    ctx.shadowBlur = 6 + 8 * v;
    ctx.fillStyle = `rgba(255, ${Math.round(40 + 120 * v)}, ${Math.round(25 + 90 * v)}, ${0.35 + 0.65 * v})`;
    ctx.beginPath();
    if (id === 'dp') {
      ctx.arc(DP_DOT.x, DP_DOT.y, DP_DOT.r, 0, 2 * Math.PI);
    } else {
      SEGMENT_SHAPES[id].forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.restore();
}
