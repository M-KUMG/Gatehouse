import { hLead, svgDoc, type PartArt } from './common';

// 9 V block battery lying on its side, both snap terminals on the right.
// 5 x 3 cells; leads end at (100, 20) positive and (100, 40) negative.

const defs = `
<linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#8e949b"/>
  <stop offset=".3" stop-color="#f3f5f7"/>
  <stop offset="1" stop-color="#5f646a"/>
</linearGradient>
<linearGradient id="shade" gradientUnits="userSpaceOnUse" x1="0" y1="5" x2="0" y2="55">
  <stop offset="0" stop-color="#000" stop-opacity=".2"/>
  <stop offset=".16" stop-color="#fff" stop-opacity=".34"/>
  <stop offset=".45" stop-color="#fff" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity=".5"/>
</linearGradient>
<clipPath id="wrap"><rect x="3" y="5" width="74" height="50" rx="3"/></clipPath>`;

const body = `
${hLead(84, 100, 20, 3)}
${hLead(85, 100, 40, 3)}
<rect x="77" y="15" width="7.5" height="10" rx="2.4" fill="url(#steel)"/>
<path d="M77 33H83.5L86.5 36.5V43.5L83.5 47H77Z" fill="url(#steel)"/>
<g clip-path="url(#wrap)">
  <rect x="3" y="5" width="74" height="50" fill="#17181b"/>
  <rect x="3" y="5" width="46" height="50" fill="#c98a2b"/>
  <rect x="49" y="5" width="2" height="50" fill="#7a4f12"/>
  <rect x="71" y="5" width="6" height="50" fill="#3a3c41"/>
</g>
<g font-family="Arial, Helvetica, sans-serif" font-weight="bold" text-anchor="middle">
  <text x="26" y="36" font-size="17" fill="#1b1305">9V</text>
  <text x="61" y="24.5" font-size="12" fill="#e8eaee">+</text>
  <text x="61" y="43.5" font-size="12" fill="#e8eaee">−</text>
</g>
<rect x="3" y="5" width="74" height="50" rx="3" fill="url(#shade)"/>
<rect x="3" y="5" width="74" height="50" rx="3" fill="none" stroke="#000" stroke-opacity=".45" stroke-width=".7"/>`;

export const BATTERY_9V_ART: PartArt = { cols: 5, rows: 3, svg: svgDoc(5, 3, defs, body) };
