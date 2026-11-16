import { svgDoc, vLead, type PartArt } from './common';

// 5 mm red LED seen from the side: domed epoxy body, flange with the
// cathode flat on the left, lead frame visible through the epoxy.
// 3 x 4 cells; legs end at (20, 80) cathode and (40, 80) anode.

const DOME = 'M10 44V22A20 20 0 0 1 50 22V44Z';
const RIM = 'M10 39.5H51.5Q53 39.5 53 41V45Q53 46.5 51.5 46.5H10Z';

const defs = `
<linearGradient id="epoxy" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#6d0907"/>
  <stop offset=".3" stop-color="#d42b22"/>
  <stop offset=".55" stop-color="#f2463a"/>
  <stop offset="1" stop-color="#5e0605"/>
</linearGradient>
<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#e2463c"/>
  <stop offset="1" stop-color="#7a0d0a"/>
</linearGradient>
<radialGradient id="glow" cx=".5" cy=".3" r=".55">
  <stop offset="0" stop-color="#ff9b8c" stop-opacity=".55"/>
  <stop offset="1" stop-color="#ff9b8c" stop-opacity="0"/>
</radialGradient>`;

const body = `
${vLead(20, 44, 80)}
${vLead(40, 44, 80)}
<g fill="#a7adb3">
  <path d="M18.8 44V29H14.5V23.5Q20 21 26 23.5V29H21.2V44Z"/>
  <rect x="38.8" y="27" width="2.4" height="17"/>
  <rect x="35.5" y="25.5" width="6" height="2.2" rx=".6"/>
</g>
<path d="M36 25.8Q31 19 23 22.6" fill="none" stroke="#e8e1c8" stroke-width=".5"/>
<path d="${DOME}" fill="url(#epoxy)" fill-opacity=".84"/>
<path d="${DOME}" fill="url(#glow)"/>
<path d="${RIM}" fill="url(#rim)"/>
<path d="M15 37V22Q15 11 22.5 6.5" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2.4" stroke-linecap="round"/>
<ellipse cx="42" cy="15" rx="1.6" ry="3.6" fill="#fff" fill-opacity=".3"/>
<path d="${DOME}" fill="none" stroke="#3d0302" stroke-opacity=".6" stroke-width=".7"/>
<path d="${RIM}" fill="none" stroke="#3d0302" stroke-opacity=".6" stroke-width=".7"/>`;

export const LED_ART: PartArt = { cols: 3, rows: 4, svg: svgDoc(3, 4, defs, body) };
