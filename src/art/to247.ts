import { svgDoc, type PartArt } from './common';

// IGBT in a TO-247 package seen from the front: black epoxy body with the
// mounting hole near the top, the metal tab peeking out above it, a printed
// "IGBT" mark and three flat leads (wide shoulders near the body). The pin
// letters are printed under the mark, so the lead order is visible.
// 4 x 8 cells; leads end at (20, 160), (40, 160) and (60, 160).

const BODY = 'M10 6H70V86Q70 89 67 89H13Q10 89 10 86Z';
const HOLE = 'M40 13A7 7 0 1 0 40 27A7 7 0 1 0 40 13Z';

/** Burned out: a cracked, scorched body (the package of a blown IGBT often splits open). */
const BURN = `
<ellipse cx="40" cy="52" rx="24" ry="20" fill="#6b3a1c" fill-opacity=".35"/>
<path d="M28 36L37 47L33 55L44 63L40 74" fill="none" stroke="#000" stroke-width="1.4"/>
<path d="M37 47L47 44M44 63L53 66" fill="none" stroke="#000" stroke-width="1"/>
<path d="M30 30Q40 22 52 32" fill="none" stroke="#3a2a22" stroke-opacity=".7" stroke-width="3"/>`;

function lead(x: number): string {
  const d = `M${x - 3.4} 89H${x + 3.4}V102L${x + 1.6} 107V160H${x - 1.6}V107L${x - 3.4} 102Z`;
  return `<path d="${d}" fill="url(#lead)"/><path d="${d}" fill="none" stroke="#5b6168" stroke-width=".5"/>`;
}

const defs = `
<linearGradient id="tab" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#8e949b"/><stop offset=".25" stop-color="#e4e7ea"/>
  <stop offset=".6" stop-color="#b3b8be"/><stop offset="1" stop-color="#7c8289"/>
</linearGradient>
<linearGradient id="epoxy" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#18181b"/><stop offset=".15" stop-color="#2b2b30"/>
  <stop offset=".55" stop-color="#1e1e22"/><stop offset="1" stop-color="#0e0e10"/>
</linearGradient>
<linearGradient id="lead" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#7d838b"/><stop offset=".42" stop-color="#f1f3f5"/><stop offset="1" stop-color="#666b72"/>
</linearGradient>`;

function to247(code: string, pinLetters: readonly [string, string, string], burned = false): string {
  const body = `
${lead(20)}${lead(40)}${lead(60)}
<path d="M13 1H67V9H13Z" fill="url(#tab)"/>
<path d="M13 1H67V9H13Z" fill="none" stroke="#4d5359" stroke-width=".6"/>
<path d="${BODY}${HOLE}" fill="url(#epoxy)" fill-rule="evenodd"/>
<path d="${HOLE}" fill="none" stroke="#000" stroke-opacity=".7" stroke-width="1"/>
<path d="M34.5 24A7 7 0 0 0 45.5 24" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="1"/>
<path d="M10.5 6.6H69.5" stroke="#55555d" stroke-width="1"/>
<path d="M13 87.8H67" stroke="#000" stroke-opacity=".6" stroke-width="1"/>
<path d="${BODY}" fill="none" stroke="#000" stroke-opacity=".6" stroke-width=".7"/>
<g font-family="Arial, Helvetica, sans-serif" fill="#b4b7bd" text-anchor="middle">
  <text x="40" y="50" font-size="13" font-weight="bold">IGBT</text>
  <text x="40" y="61" font-size="6.5" fill-opacity=".8">${code}</text>
  <text x="20" y="84" font-size="6" fill-opacity=".75">${pinLetters[0]}</text>
  <text x="40" y="84" font-size="6" fill-opacity=".75">${pinLetters[1]}</text>
  <text x="60" y="84" font-size="6" fill-opacity=".75">${pinLetters[2]}</text>
</g>
<circle cx="40" cy="72" r="2.6" fill="#000" fill-opacity=".3"/>
${burned ? BURN : ''}`;
  return svgDoc(4, 8, defs, body);
}

/** N-channel IGBT: G C E, left to right. */
export const IGBT_ART: PartArt = { cols: 4, rows: 8, svg: to247('G20N60', ['G', 'C', 'E']) };
/** P-channel IGBT: G E C, left to right (the emitter, its positive side, where the N part has its collector). */
export const PIGBT_ART: PartArt = { cols: 4, rows: 8, svg: to247('P-CH 20P60', ['G', 'E', 'C']) };
export const IGBT_BURNED_SVG = to247('G20N60', ['G', 'C', 'E'], true);
export const PIGBT_BURNED_SVG = to247('P-CH 20P60', ['G', 'E', 'C'], true);
