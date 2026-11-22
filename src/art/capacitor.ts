import { hLead, svgDoc, type PartArt } from './common';

// Ceramic capacitor (MLCC style): a rounded blue epoxy-dipped body with a
// yellow marking panel, two tinned leads.
// 4 x 2 cells; leads end at (0, 20) and (80, 20).

const BODY = 'M31 10H49Q54 10 54 15V25Q54 30 49 30H31Q26 30 26 25V15Q26 10 31 10Z';

const defs = `
<linearGradient id="shade" gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="0" y2="30">
  <stop offset="0" stop-color="#fff" stop-opacity=".1"/>
  <stop offset=".25" stop-color="#fff" stop-opacity=".45"/>
  <stop offset=".55" stop-color="#fff" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity=".45"/>
</linearGradient>
<clipPath id="body"><path d="${BODY}"/></clipPath>`;

/** The rating on the yellow panel: 50 -> "50V". */
const label = (volts: number): string => `${Number.isInteger(volts) ? volts : volts.toFixed(1)}V`;

function capacitorSvg(volts: number, burned: boolean): string {
  const body = `
${hLead(0, 28, 20)}
${hLead(52, 80, 20)}
<path d="${BODY}" fill="${burned ? '#2a2523' : '#2d63b4'}"/>
<g clip-path="url(#body)">
  <rect x="31" y="14" width="18" height="12" rx="1.5" fill="${burned ? '#5a4f3c' : '#e8c431'}"/>
  <rect x="26" y="10" width="3" height="20" fill="#000" fill-opacity=".12"/>
</g>
<path d="M33 18H47" stroke="#6b5410" stroke-width="1.2" stroke-linecap="round" stroke-opacity=".75"/>
<text x="40" y="24.6" font-family="Arial, Helvetica, sans-serif" font-size="5.6" font-weight="bold" fill="#6b5410" fill-opacity=".9" text-anchor="middle">${label(volts)}</text>${burned ? `
<path d="M44 10L40 17L45 21L38 30" fill="none" stroke="#000" stroke-opacity=".75" stroke-width="1.1"/>` : ''}
<path d="${BODY}" fill="url(#shade)"/>
<path d="${BODY}" fill="none" stroke="#10285a" stroke-opacity=".6" stroke-width=".7"/>`;
  return svgDoc(4, 2, defs, body);
}

export const CAPACITOR_ART: PartArt = { cols: 4, rows: 2, svg: capacitorSvg(50, false) };

const cache = new Map<string, string>();
/** The capacitor with another rated voltage printed on it, or burned (cached). */
export function capacitorArt(volts: number, burned: boolean): { key: string; svg: string } {
  const key = burned ? (volts === 50 ? 'burned' : `burned${volts}`) : `v${volts}`;
  let svg = cache.get(key);
  if (!svg) {
    svg = capacitorSvg(volts, burned);
    cache.set(key, svg);
  }
  return { key, svg };
}
