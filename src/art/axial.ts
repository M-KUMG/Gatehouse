import { hLead, svgDoc, type PartArt } from './common';

// DO-41 axial diodes, 4 x 2 cells like the 1N4148; leads end at (0, 20)
// anode and (80, 20) cathode, the band marks the cathode (right).
//  - Zener (1N4733A-like): orange glass body, lead slugs and die visible,
//    a black cathode band with bent ends (the Zener symbol's bar), 'ZENER'.
//  - Schottky (1N5819): black moulded body, light grey band, '1N5819'.

const BODY = 'M27.5 13.2H52.5Q56 13.2 56 20Q56 26.8 52.5 26.8H27.5Q24 26.8 24 20Q24 13.2 27.5 13.2Z';

const metal = `
<linearGradient id="slug" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#8d9299"/><stop offset=".4" stop-color="#e3e6e9"/><stop offset="1" stop-color="#5f646b"/>
</linearGradient>`;

function zenerSvg(burned: boolean): string {
  const tint = burned ? ['#3b2a20', '#5a4433', '#2a1d15', '#1b120c'] : ['#f0a85a', '#ffe2b8', '#e08a3a', '#9a5418'];
  const defs = `${metal}
<linearGradient id="zglass" gradientUnits="userSpaceOnUse" x1="0" y1="13.2" x2="0" y2="26.8">
  <stop offset="0" stop-color="${tint[0]}" stop-opacity=".6"/>
  <stop offset=".3" stop-color="${tint[1]}" stop-opacity=".78"/>
  <stop offset=".62" stop-color="${tint[2]}" stop-opacity=".5"/>
  <stop offset="1" stop-color="${tint[3]}" stop-opacity=".75"/>
</linearGradient>
<clipPath id="ztube"><path d="${BODY}"/></clipPath>`;
  const body = `
${hLead(0, 27, 20)}
${hLead(53, 80, 20)}
<g clip-path="url(#ztube)">
  <rect x="24" y="13.2" width="32" height="13.6" fill="#c9762c" fill-opacity=".2"/>
  <rect x="25.5" y="16.8" width="11" height="6.4" rx="1" fill="url(#slug)"/>
  <rect x="43.5" y="16.8" width="11" height="6.4" rx="1" fill="url(#slug)"/>
  <rect x="38.4" y="18.4" width="3.2" height="3.2" fill="#4a3020"/>
</g>
<path d="${BODY}" fill="url(#zglass)"/>
<path d="M47 13.2H50V24.6L52.4 26.8H49.4L47 24.6Z M47 13.2L44.6 11V13.2Z" fill="#141416" clip-path="url(#ztube)"/>
<text x="36.5" y="15.9" font-family="Arial, sans-serif" font-size="3.3" font-weight="700" fill="#3a2410" fill-opacity=".85" text-anchor="middle">ZENER</text>
${burned ? '<path d="M30 14L33 20L29.5 25" fill="none" stroke="#000" stroke-opacity=".7" stroke-width=".9"/>' : ''}
<path d="M28.5 14.9H45" stroke="#fff" stroke-opacity="${burned ? 0.15 : 0.6}" stroke-width="1.1" stroke-linecap="round"/>
<path d="${BODY}" fill="none" stroke="#6b3a12" stroke-opacity=".6" stroke-width=".6"/>`;
  return svgDoc(4, 2, defs, body);
}

function schottkySvg(burned: boolean): string {
  const defs = `
<linearGradient id="sbody" gradientUnits="userSpaceOnUse" x1="0" y1="13.2" x2="0" y2="26.8">
  <stop offset="0" stop-color="${burned ? '#2a1f1a' : '#3b3d42'}"/><stop offset=".35" stop-color="${burned ? '#3a2a22' : '#55585e'}"/>
  <stop offset="1" stop-color="#0c0c0e"/>
</linearGradient>
<linearGradient id="sband" gradientUnits="userSpaceOnUse" x1="0" y1="13.2" x2="0" y2="26.8">
  <stop offset="0" stop-color="#9ea3a8"/><stop offset=".35" stop-color="#d8dbde"/><stop offset="1" stop-color="#6c7176"/>
</linearGradient>
<clipPath id="stube"><path d="${BODY}"/></clipPath>`;
  const body = `
${hLead(0, 27, 20)}
${hLead(53, 80, 20)}
<path d="${BODY}" fill="url(#sbody)"/>
<rect x="46.5" y="12" width="4" height="16" fill="url(#sband)" clip-path="url(#stube)"/>
<text x="35.5" y="21.3" font-family="Arial, sans-serif" font-size="3.6" font-weight="700" fill="#c9cdd2" text-anchor="middle">1N5819</text>
${burned ? '<path d="M28 14L32 20L28.5 26" fill="none" stroke="#6b3a20" stroke-width="1"/>' : ''}
<path d="M28.5 14.9H45.5" stroke="#fff" stroke-opacity=".25" stroke-width="1" stroke-linecap="round"/>
<path d="${BODY}" fill="none" stroke="#000" stroke-opacity=".7" stroke-width=".6"/>`;
  return svgDoc(4, 2, defs, body);
}

export const ZENER_ART: PartArt = { cols: 4, rows: 2, svg: zenerSvg(false) };
export const ZENER_BURNED_SVG = zenerSvg(true);
export const SCHOTTKY_ART: PartArt = { cols: 4, rows: 2, svg: schottkySvg(false) };
export const SCHOTTKY_BURNED_SVG = schottkySvg(true);
