import { hLead, svgDoc, type PartArt } from './common';

// Bridge rectifier: a black epoxy block with the diamond of four diodes on its face, the AC pins (~) on the left
// and the DC pins (+ top, - bottom) on the right, the voltage and current rating printed under the symbol.
// 4 x 4 cells; leads end at (0, 20) and (0, 60) (AC) and (80, 20) + and (80, 60) - (DC).

const defs = `
<linearGradient id="brBody" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#4a4d52"/><stop offset=".12" stop-color="#2b2d31"/><stop offset="1" stop-color="#17181b"/>
</linearGradient>`;

const label = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** A triangle (diode) pointing from (x1, y1) towards (x2, y2) with its bar, drawn along one side of the diamond. */
function diode(x: number, y: number, angle: number): string {
  return `<g transform="translate(${x} ${y}) rotate(${angle})" fill="none" stroke="#e9ebee" stroke-width="1.1" stroke-linejoin="round">
  <path d="M-3.4 -3.2L3 0L-3.4 3.2Z" fill="#e9ebee" fill-opacity=".85"/><path d="M3.8 -3.4V3.4"/>
</g>`;
}

function bridgeSvg(volts: number, amps: number, burned: boolean): string {
  const ink = burned ? '#6b6260' : '#e9ebee';
  const body = `
${hLead(0, 18, 20)}
${hLead(0, 18, 60)}
${hLead(62, 80, 20)}
${hLead(62, 80, 60)}
<rect x="18" y="6" width="44" height="68" rx="4" fill="${burned ? '#1b1816' : 'url(#brBody)'}" stroke="#0c0d0f" stroke-width=".8"/>
<path d="M26 36L40 22L54 36L40 50Z" fill="none" stroke="${ink}" stroke-width="1.1" stroke-opacity=".6"/>
${diode(33, 29, -45)}${diode(47, 29, -135)}${diode(33, 43, -135)}${diode(47, 43, -45)}
<g font-family="Arial, Helvetica, sans-serif" font-weight="bold" fill="${ink}" text-anchor="middle">
  <text x="25" y="23" font-size="8">~</text><text x="25" y="63" font-size="8">~</text>
  <text x="55" y="23" font-size="8">+</text><text x="55" y="64" font-size="8">\u2212</text>
  <text x="40" y="58" font-size="5.2">${label(volts)} V</text>
  <text x="40" y="66" font-size="5.2">${label(amps)} A</text>
</g>
${burned ? `<path d="M52 9L45 18L50 24L42 34" fill="none" stroke="#000" stroke-opacity=".8" stroke-width="1.1"/>
<ellipse cx="40" cy="40" rx="20" ry="30" fill="#000" fill-opacity=".25"/>` : ''}`;
  return svgDoc(4, 4, defs, body);
}

export const BRIDGE_ART: PartArt = { cols: 4, rows: 4, svg: bridgeSvg(400, 2, false) };

const cache = new Map<string, string>();
/** The bridge with its ratings printed on it, or burned (cached per rating). */
export function bridgeArt(volts: number, amps: number, burned: boolean): { key: string; svg: string } {
  const key = `${burned ? 'burned' : 'r'}-${volts}-${amps}`;
  let svg = cache.get(key);
  if (!svg) {
    svg = bridgeSvg(volts, amps, burned);
    cache.set(key, svg);
  }
  return { key, svg };
}
