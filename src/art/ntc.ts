import { hLead, svgDoc, type PartArt } from './common';

// 10 k NTC thermistor (MF52 type): a glossy dark-blue epoxy bead on two
// leads, seen from the front, with three small heat waves above it.
// 4 x 2 cells; leads end at (0, 20) and (80, 20); symmetric.

function ntcSvg(burned: boolean): string {
  const defs = `
<radialGradient id="ntcBead" cx=".38" cy=".3" r=".8">
  <stop offset="0" stop-color="${burned ? '#3a3330' : '#4f7fd6'}"/>
  <stop offset=".55" stop-color="${burned ? '#221c1a' : '#1c3f8f'}"/>
  <stop offset="1" stop-color="${burned ? '#100c0b' : '#0b1f4d'}"/>
</radialGradient>`;
  const body = `
${hLead(0, 31, 20)}
${hLead(49, 80, 20)}
<ellipse cx="40" cy="21.5" rx="11" ry="12.5" fill="url(#ntcBead)"/>
<ellipse cx="40" cy="21.5" rx="11" ry="12.5" fill="none" stroke="${burned ? '#000' : '#071433'}" stroke-opacity=".7" stroke-width=".7"/>
<path d="M33.5 14Q35 10.6 39 10" fill="none" stroke="#fff" stroke-opacity="${burned ? 0.15 : 0.6}" stroke-width="2" stroke-linecap="round"/>
<ellipse cx="46.5" cy="28" rx="1.4" ry="2.6" fill="#fff" fill-opacity="${burned ? 0.05 : 0.22}"/>
<text x="40" y="26.5" font-family="Arial, sans-serif" font-size="6.2" font-weight="700" fill="#cfe0ff" fill-opacity="${burned ? 0.25 : 0.85}" text-anchor="middle">NTC</text>
${burned ? '<path d="M34 11L38 19L34 25L39 33" fill="none" stroke="#000" stroke-opacity=".75" stroke-width="1"/>' : `
<g fill="none" stroke="#e8573a" stroke-width="1.1" stroke-linecap="round">
  <path d="M31 6Q29.5 4 31 2Q32.5 0 31 -1.5" transform="translate(0 2.5)"/>
  <path d="M40 4Q38.5 2 40 0"/>
  <path d="M49 6Q47.5 4 49 2Q50.5 0 49 -1.5" transform="translate(0 2.5)"/>
</g>`}`;
  return svgDoc(4, 2, defs, body);
}

export const NTC_ART: PartArt = { cols: 4, rows: 2, svg: ntcSvg(false) };
export const NTC_BURNED_SVG = ntcSvg(true);
