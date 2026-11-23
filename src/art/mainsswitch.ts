import { hLead, svgDoc, type PartArt } from './common';

// Mains rocker switch (a wall light switch): a white plate with a rocker that is pressed in at the top (OFF) or
// at the bottom (ON), the lit end showing the state. 4 x 2 cells; leads end at (0, 20) and (80, 20).

const defs = `
<linearGradient id="msPlate" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#fbfaf6"/><stop offset="1" stop-color="#cfccc1"/>
</linearGradient>
<linearGradient id="msRock" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#f2f0ea"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="#c3c0b5"/>
</linearGradient>`;

export function mainsSwitchSvg(on: boolean, amps = 10): string {
  // OFF: the upper half pressed (darker); ON: the lower half pressed.
  const upper = on ? '#ffffff' : '#bfbcb1';
  const lower = on ? '#bfbcb1' : '#ffffff';
  return svgDoc(4, 2, defs, `
${hLead(0, 18, 20, 3)}
${hLead(62, 80, 20, 3)}
<rect x="17" y="3" width="46" height="34" rx="4" fill="url(#msPlate)" stroke="#7a776d" stroke-width=".8"/>
<rect x="27" y="7" width="26" height="26" rx="3" fill="url(#msRock)" stroke="#8f8c81" stroke-width=".8"/>
<rect x="28" y="8" width="24" height="12" rx="2" fill="${upper}" fill-opacity=".85"/>
<rect x="28" y="20" width="24" height="12" rx="2" fill="${lower}" fill-opacity=".85"/>
<path d="M28 20h24" stroke="#8f8c81" stroke-width=".8"/>
<circle cx="40" cy="${on ? 26 : 14}" r="1.7" fill="${on ? '#4fcf6a' : '#8a8f96'}"/>
<g font-family="Arial, Helvetica, sans-serif" font-size="4.6" font-weight="bold" fill="#6a675e" text-anchor="middle">
  <text x="22" y="9">${amps} A</text>
  <text x="58" y="9">230 V</text>
</g>`);
}

export const MAINS_SWITCH_ART: PartArt = { cols: 4, rows: 2, svg: mainsSwitchSvg(false) };
export const MAINS_SWITCH_ON_SVG = mainsSwitchSvg(true);

// ---- Changeover (SPDT) ----------------------------------------------------------------------------------------------
// The same wall switch with three leads: COM on the left (0, 40), NC on the right at the top (80, 20) and NO on the
// right at the bottom (80, 60), 4 x 4 cells. The rocker's pressed half and the green dot show where COM is joined.

export function changeoverSvg(no: boolean, amps = 10): string {
  const upper = no ? '#ffffff' : '#bfbcb1';
  const lower = no ? '#bfbcb1' : '#ffffff';
  return svgDoc(4, 4, defs, `
${hLead(0, 18, 40, 3)}
${hLead(62, 80, 20, 3)}
${hLead(62, 80, 60, 3)}
<rect x="17" y="6" width="46" height="68" rx="4" fill="url(#msPlate)" stroke="#7a776d" stroke-width=".8"/>
<rect x="27" y="14" width="26" height="52" rx="3" fill="url(#msRock)" stroke="#8f8c81" stroke-width=".8"/>
<rect x="28" y="15" width="24" height="25" rx="2" fill="${upper}" fill-opacity=".85"/>
<rect x="28" y="40" width="24" height="25" rx="2" fill="${lower}" fill-opacity=".85"/>
<path d="M28 40h24" stroke="#8f8c81" stroke-width=".8"/>
<circle cx="40" cy="${no ? 54 : 27}" r="1.9" fill="#4fcf6a"/>
<g font-family="Arial, Helvetica, sans-serif" font-size="4.6" font-weight="bold" fill="#6a675e" text-anchor="middle">
  <text x="22" y="40.8" font-size="4">COM</text>
  <text x="58" y="22">NC</text>
  <text x="58" y="62">NO</text>
  <text x="40" y="11">${amps} A 230 V</text>
</g>`);
}

export const CHANGEOVER_ART: PartArt = { cols: 4, rows: 4, svg: changeoverSvg(false) };
export const CHANGEOVER_ON_SVG = changeoverSvg(true);
