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

const body = `
${hLead(0, 28, 20)}
${hLead(52, 80, 20)}
<path d="${BODY}" fill="#2d63b4"/>
<g clip-path="url(#body)">
  <rect x="31" y="14" width="18" height="12" rx="1.5" fill="#e8c431"/>
  <rect x="26" y="10" width="3" height="20" fill="#000" fill-opacity=".12"/>
</g>
<path d="M33 18H47M33 22H43" stroke="#6b5410" stroke-width="1.2" stroke-linecap="round" stroke-opacity=".75"/>
<path d="${BODY}" fill="url(#shade)"/>
<path d="${BODY}" fill="none" stroke="#10285a" stroke-opacity=".6" stroke-width=".7"/>`;

export const CAPACITOR_ART: PartArt = { cols: 4, rows: 2, svg: svgDoc(4, 2, defs, body) };
