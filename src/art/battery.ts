import { hLead, svgDoc, type PartArt } from './common';

// AA cell (1.5 V) lying on its side with solder tabs: negative end on the
// left, raised positive button on the right.
// 6 x 2 cells; tabs end at (0, 20) negative and (120, 20) positive.

const defs = `
<linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#8e949b"/>
  <stop offset=".3" stop-color="#f3f5f7"/>
  <stop offset="1" stop-color="#5f646a"/>
</linearGradient>
<linearGradient id="shade" gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="0" y2="36">
  <stop offset="0" stop-color="#000" stop-opacity=".25"/>
  <stop offset=".22" stop-color="#fff" stop-opacity=".42"/>
  <stop offset=".5" stop-color="#fff" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity=".55"/>
</linearGradient>
<clipPath id="wrap"><rect x="10" y="4" width="94" height="32" rx="2.5"/></clipPath>`;

const body = `
${hLead(0, 11, 20, 3)}
${hLead(109, 120, 20, 3)}
<rect x="7.5" y="6" width="5" height="28" rx="2" fill="url(#steel)"/>
<rect x="106" y="12.5" width="5" height="15" rx="1.6" fill="url(#steel)"/>
<rect x="102" y="6" width="4.5" height="28" rx="1.5" fill="url(#steel)"/>
<g clip-path="url(#wrap)">
  <rect x="10" y="4" width="94" height="32" fill="#1d4fa8"/>
  <rect x="80" y="4" width="24" height="32" fill="#c9ced6"/>
  <rect x="78" y="4" width="2" height="32" fill="#0f2c63"/>
</g>
<g font-family="Arial, Helvetica, sans-serif" font-weight="bold" text-anchor="middle">
  <text x="36" y="24.5" font-size="12" fill="#fff">AA</text>
  <text x="62" y="23.5" font-size="8" fill="#dfe8ff">1.5V</text>
  <text x="92" y="25" font-size="15" fill="#1d2633">+</text>
  <text x="17" y="23.5" font-size="11" fill="#dfe8ff">−</text>
</g>
<rect x="10" y="4" width="94" height="32" rx="2.5" fill="url(#shade)"/>
<rect x="10" y="4" width="94" height="32" rx="2.5" fill="none" stroke="#000" stroke-opacity=".45" stroke-width=".7"/>`;

export const BATTERY_ART: PartArt = { cols: 6, rows: 2, svg: svgDoc(6, 2, defs, body) };
