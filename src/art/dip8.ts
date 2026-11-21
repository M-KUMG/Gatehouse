import { svgDoc, type PartArt } from './common';

// An 8-pin DIP chip seen from above (the look of the half-bridge driver in
// driver.ts): black epoxy body lying horizontally, the notch on the left end,
// pin 1 marked with a dot. Pins 1-4 along the bottom edge left to right, pins
// 5-8 along the top edge right to left, as on the real package. Plain printed
// marks (a type name and a line below it), no vendor logo.
// 5 x 4 cells; leads end at x = 20, 40, 60, 80 on y = 0 and y = 80.

const XS = [20, 40, 60, 80];
const BODY = 'M6 20H94Q96 20 96 22V58Q96 60 94 60H6Q4 60 4 58V22Q4 20 6 20Z';

function lead(x: number, top: boolean): string {
  // A flat DIP leg: wide shoulder at the body, narrow pin to the grid point.
  const d = top
    ? `M${x - 3.5} 22H${x + 3.5}V16L${x + 1.6} 12V0H${x - 1.6}V12L${x - 3.5} 16Z`
    : `M${x - 3.5} 58H${x + 3.5}V64L${x + 1.6} 68V80H${x - 1.6}V68L${x - 3.5} 64Z`;
  return `<path d="${d}" fill="url(#dipLead)"/><path d="${d}" fill="none" stroke="#5b6168" stroke-width=".5"/>`;
}

const DEFS = `
<linearGradient id="dipLead" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#7d838b"/><stop offset=".42" stop-color="#f1f3f5"/><stop offset="1" stop-color="#666b72"/>
</linearGradient>
<linearGradient id="dipBody" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#2d2d33"/><stop offset=".5" stop-color="#1d1d21"/><stop offset="1" stop-color="#121215"/>
</linearGradient>`;

const BURN = `
<ellipse cx="50" cy="40" rx="22" ry="12" fill="#6b3a1c" fill-opacity=".45"/>
<path d="M36 30L45 38L41 44L54 50" fill="none" stroke="#000" stroke-width="1.3"/>
<path d="M45 38L56 34" fill="none" stroke="#000" stroke-opacity=".9" stroke-width=".9"/>`;

export interface Dip8Labels {
  /** Pin labels 1..4 (bottom, left to right) and 8..5 (top, left to right). */
  bottom: readonly string[];
  top: readonly string[];
  /** The big printed type name and the small line under it. */
  title: string;
  subtitle: string;
}

/** The chip's art; `burned` adds the scorch marks. */
export function dip8Svg(l: Dip8Labels, burned: boolean): string {
  const labels = (names: readonly string[], y: number): string =>
    names.map((n, i) => `<text x="${XS[i]}" y="${y}" font-size="4.6">${n}</text>`).join('');
  const body = `
${XS.map((x) => lead(x, true)).join('')}${XS.map((x) => lead(x, false)).join('')}
<path d="${BODY}" fill="url(#dipBody)"/>
<path d="${BODY}" fill="none" stroke="#000" stroke-opacity=".7" stroke-width=".7"/>
<path d="M4 34A6 6 0 0 1 4 46" fill="#0b0b0d" stroke="#000" stroke-opacity=".6" stroke-width=".6"/>
<circle cx="12" cy="53" r="2" fill="#000" fill-opacity=".45"/>
<g font-family="Arial, Helvetica, sans-serif" fill="#b4b7bd" text-anchor="middle">
  <text x="52" y="39" font-size="9" font-weight="bold">${l.title}</text>
  <text x="52" y="47" font-size="5.5" fill-opacity=".8">${l.subtitle}</text>
  <g fill-opacity=".7">${labels(l.top, 27)}${labels(l.bottom, 57)}</g>
</g>
${burned ? BURN : ''}`;
  return svgDoc(5, 4, DEFS, body);
}

export interface Dip8Pin {
  id: string;
  name: string;
  x: number;
  y: number;
}

/** Pin positions (grid points in the 5 x 4 box) for pins 1..8 given as [model pin id, readout name]: 1-4 along the bottom, 5-8 along the top (5 at the right). */
export function dip8Pins(pins: readonly (readonly [string, string])[]): Dip8Pin[] {
  return pins.map(([id, name], k) => ({ id, name, x: k < 4 ? k + 1 : 8 - k, y: k < 4 ? 4 : 0 }));
}

export function dip8Art(l: Dip8Labels): { art: PartArt; burned: string } {
  return { art: { cols: 5, rows: 4, svg: dip8Svg(l, false) }, burned: dip8Svg(l, true) };
}
