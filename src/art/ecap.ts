import { hLead, svgDoc, type PartArt } from './common';

// Electrolytic (polarized) capacitor, an axial aluminium can lying along the
// leads: dark blue sleeve with the light polarity stripe and its minus signs
// along the bottom, the bare aluminium bottom of the can at the − end, the
// crimp ring at the + end and a red "+" beside the + lead.
// 4 x 2 cells; leads end at (0, 20) + and (80, 20) −. The pins sit on the
// centre line, so a mirror is a 180-degree turn (not mirrorable).

const CAN = 'M16 6H64Q68 6 68 10V30Q68 34 64 34H16Q12 34 12 30V10Q12 6 16 6Z';

const defs = `
<linearGradient id="shade" gradientUnits="userSpaceOnUse" x1="0" y1="6" x2="0" y2="34">
  <stop offset="0" stop-color="#fff" stop-opacity=".08"/>
  <stop offset=".22" stop-color="#fff" stop-opacity=".4"/>
  <stop offset=".5" stop-color="#fff" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity=".5"/>
</linearGradient>
<linearGradient id="alu" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#9aa1a9"/><stop offset=".5" stop-color="#e3e6ea"/><stop offset="1" stop-color="#8a9097"/>
</linearGradient>
<clipPath id="can"><path d="${CAN}"/></clipPath>`;

/** The rating as printed on the can: 16 -> "16V". */
const label = (volts: number): string => `${Number.isInteger(volts) ? volts : volts.toFixed(1)}V`;

function ecapSvg(burned: boolean, volts = 16): string {
  const sleeve = burned ? '#1d1a1a' : '#1f3d78';
  const stripe = burned ? '#4a4240' : '#c9d4e4';
  const print = burned ? '#6b6260' : '#dfe6f0';
  const body = `
${hLead(0, 14, 20)}
${hLead(66, 80, 20)}
<path d="M3.5 11.5H9.5M6.5 8.5V14.5" stroke="#d42b22" stroke-width="1.8" stroke-linecap="round"/>
<path d="${CAN}" fill="${sleeve}"/>
<g clip-path="url(#can)">
  <rect x="12" y="24" width="56" height="10" fill="${stripe}"/>
  <path d="M27 29H32M39 29H44M51 29H56" stroke="${sleeve}" stroke-width="1.8" stroke-linecap="round"/>
  <rect x="64" y="6" width="4" height="28" fill="url(#alu)"/>
  <rect x="19" y="6" width="2.4" height="28" fill="#000" fill-opacity=".35"/>
  <rect x="21.4" y="6" width="1" height="28" fill="#fff" fill-opacity=".18"/>
</g>
<path d="M26 14.5H31M28.5 12V17" stroke="${print}" stroke-width="1.3" stroke-linecap="round"/>
<text x="46" y="17.6" font-family="Arial, Helvetica, sans-serif" font-size="6.2" font-weight="bold" fill="${print}" text-anchor="middle">${label(volts)}</text>
${burned ? `<path d="M62 8L56 15L60 19L53 26" fill="none" stroke="#000" stroke-opacity=".75" stroke-width="1.1"/>
<ellipse cx="40" cy="20" rx="26" ry="12" fill="#000" fill-opacity=".25"/>
<path d="M68 12Q72 20 68 28" fill="none" stroke="#2b2522" stroke-width="2.4"/>` : ''}
<path d="${CAN}" fill="url(#shade)"/>
<path d="${CAN}" fill="none" stroke="#0b1a38" stroke-opacity=".7" stroke-width=".7"/>`;
  return svgDoc(4, 2, defs, body);
}

export const ECAP_ART: PartArt = { cols: 4, rows: 2, svg: ecapSvg(false) };
/** Burned out: charred sleeve, crack and a bulged bottom. */
export const ECAP_BURNED_SVG = ecapSvg(true);

const cache = new Map<string, string>();
/** The can with another rated voltage printed on it (cached per voltage). */
export function ecapArt(volts: number, burned: boolean): { key: string; svg: string } {
  const key = burned ? (volts === 16 ? 'burned' : `burned${volts}`) : `v${volts}`;
  let svg = cache.get(key);
  if (!svg) {
    svg = ecapSvg(burned, volts);
    cache.set(key, svg);
  }
  return { key, svg };
}
