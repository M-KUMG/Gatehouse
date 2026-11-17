import { hLead, svgDoc, type PartArt } from './common';

// 1N4148 small-signal diode in a DO-35 glass package: a slim, faintly amber
// glass tube showing the two lead slugs and the tiny die between them, with
// the black cathode band at the right end.
// 4 x 2 cells; leads end at (0, 20) anode and (80, 20) cathode.

const GLASS = 'M30.5 14.6H49.5Q53 14.6 53 20Q53 25.4 49.5 25.4H30.5Q27 25.4 27 20Q27 14.6 30.5 14.6Z';

const defs = `
<linearGradient id="glass" gradientUnits="userSpaceOnUse" x1="0" y1="14.6" x2="0" y2="25.4">
  <stop offset="0" stop-color="#f3c98a" stop-opacity=".55"/>
  <stop offset=".3" stop-color="#fff4dc" stop-opacity=".75"/>
  <stop offset=".6" stop-color="#e2a85a" stop-opacity=".45"/>
  <stop offset="1" stop-color="#9b6526" stop-opacity=".7"/>
</linearGradient>
<linearGradient id="slug" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#8d9299"/><stop offset=".4" stop-color="#e3e6e9"/><stop offset="1" stop-color="#5f646b"/>
</linearGradient>
<linearGradient id="band" gradientUnits="userSpaceOnUse" x1="0" y1="14.6" x2="0" y2="25.4">
  <stop offset="0" stop-color="#3a3a3f"/><stop offset=".35" stop-color="#55555c"/><stop offset="1" stop-color="#0d0d0f"/>
</linearGradient>
<clipPath id="tube"><path d="${GLASS}"/></clipPath>`;

const body = `
${hLead(0, 30, 20)}
${hLead(50, 80, 20)}
<g clip-path="url(#tube)">
  <rect x="27" y="14.6" width="26" height="10.8" fill="#c98a3c" fill-opacity=".18"/>
  <rect x="28.5" y="17.2" width="9.6" height="5.6" rx="1" fill="url(#slug)"/>
  <rect x="41.9" y="17.2" width="9.6" height="5.6" rx="1" fill="url(#slug)"/>
  <rect x="38.4" y="18.6" width="3.2" height="2.8" fill="#4a4030"/>
  <path d="M38.1 20H41.9" stroke="#d8d2c0" stroke-width=".5"/>
</g>
<path d="${GLASS}" fill="url(#glass)"/>
<rect x="45.6" y="14" width="3.6" height="12" fill="url(#band)" clip-path="url(#tube)"/>
<path d="M31 16.6H44.6M50.4 16.6H50.8" stroke="#fff" stroke-opacity=".7" stroke-width="1.1" stroke-linecap="round"/>
<path d="M45.9 16.6H48.9" stroke="#fff" stroke-opacity=".25" stroke-width="1.1"/>
<path d="${GLASS}" fill="none" stroke="#6b4a1e" stroke-opacity=".55" stroke-width=".6"/>`;

export const DIODE_ART: PartArt = { cols: 4, rows: 2, svg: svgDoc(4, 2, defs, body) };
