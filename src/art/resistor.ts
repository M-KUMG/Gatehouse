import { hLead, svgDoc, type PartArt } from './common';

// Through-hole carbon film resistor, 5% (gold tolerance band). The first
// three bands show the value, so the art is generated per resistance.
// 4 x 2 cells; leads end at (0, 20) and (80, 20).

// Dog-bone body: wider end caps, slimmer middle.
const BODY =
  'M22 12H27Q30 12 31.5 14.2H48.5Q50 12 53 12H58C62.6 12 62.6 28 58 28H53Q50 28 48.5 25.8' +
  'H31.5Q30 28 27 28H22C17.4 28 17.4 12 22 12Z';

const DIGIT_COLORS = [
  '#1b1b1d', '#6b3a1c', '#c62a22', '#e0731a', '#e3c21c', '#2f8f3e', '#2456b8', '#7a3fa3', '#8a8d92', '#f1f1ee',
];
const GOLD = '#c9a640';
const SILVER = '#b9bdc2';
const BAND_X = [23.5, 32.5, 38.5];

/** Two significant digits and a power-of-ten multiplier, e.g. 220 -> [2, 2, 1]. */
export function resistorBands(ohms: number): [number, number, number] {
  if (!(ohms > 0)) return [0, 0, 0];
  let exp = Math.floor(Math.log10(ohms));
  let digits = Math.round(ohms / 10 ** (exp - 1));
  if (digits >= 100) {
    digits = 10;
    exp++;
  }
  return [Math.floor(digits / 10), digits % 10, Math.min(9, Math.max(-2, exp - 1))];
}

const defs = `
<linearGradient id="shade" gradientUnits="userSpaceOnUse" x1="0" y1="12" x2="0" y2="28">
  <stop offset="0" stop-color="#fff" stop-opacity=".05"/>
  <stop offset=".28" stop-color="#fff" stop-opacity=".5"/>
  <stop offset=".55" stop-color="#fff" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity=".5"/>
</linearGradient>
<clipPath id="body"><path d="${BODY}"/></clipPath>`;

const cache = new Map<string, string>();

/** Art for a resistance, with a key that is equal for equal-looking resistors. */
export function resistorArt(ohms: number): { key: string; svg: string } {
  const [d1, d2, mult] = resistorBands(ohms);
  const key = `${d1}${d2}e${mult}`;
  let svg = cache.get(key);
  if (!svg) {
    const multColor = mult === -1 ? GOLD : mult === -2 ? SILVER : DIGIT_COLORS[mult];
    const colors = [DIGIT_COLORS[d1], DIGIT_COLORS[d2], multColor];
    const bands = colors.map((c, i) => `<rect x="${BAND_X[i]}" y="10" width="3.6" height="20" fill="${c}"/>`).join('');
    const body = `
${hLead(0, 80, 20)}
<path d="${BODY}" fill="#d9c39b"/>
<g clip-path="url(#body)">${bands}<rect x="53" y="10" width="3.6" height="20" fill="${GOLD}"/></g>
<path d="${BODY}" fill="url(#shade)"/>
<path d="${BODY}" fill="none" stroke="#3b2f1e" stroke-opacity=".55" stroke-width=".7"/>`;
    svg = svgDoc(4, 2, defs, body);
    cache.set(key, svg);
  }
  return { key, svg };
}

export const RESISTOR_ART: PartArt = { cols: 4, rows: 2, svg: resistorArt(220).svg };
