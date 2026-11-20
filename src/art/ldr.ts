import { hLead, svgDoc, type PartArt } from './common';

// 5 mm CdS photoresistor (LDR) seen from the front: a round ceramic disc
// with the orange cadmium-sulphide layer and the dark serpentine electrode
// track under clear lacquer, two small light rays falling on it.
// 4 x 2 cells; leads end at (0, 20) and (80, 20); symmetric.

function ldrSvg(burned: boolean): string {
  const defs = `
<radialGradient id="ldrDisc" cx=".4" cy=".35" r=".7">
  <stop offset="0" stop-color="${burned ? '#4a3a2c' : '#f6efe2'}"/><stop offset="1" stop-color="${burned ? '#241a12' : '#cfc3ad'}"/>
</radialGradient>
<radialGradient id="ldrCds" cx=".45" cy=".4" r=".7">
  <stop offset="0" stop-color="${burned ? '#4d2a12' : '#f2a24a'}"/><stop offset="1" stop-color="${burned ? '#2a160a' : '#c0661c'}"/>
</radialGradient>
<clipPath id="ldrClip"><circle cx="40" cy="20" r="10.6"/></clipPath>`;
  // The track: interleaved combs, drawn as one serpentine line.
  let track = 'M30 13';
  for (let k = 0; k < 5; k++) {
    const y = 13 + k * 3.5;
    track += k % 2 === 0 ? `H50V${y + 1.75}` : `H30V${y + 1.75}`;
    track += k % 2 === 0 ? `H50V${y + 3.5}` : `H30V${y + 3.5}`;
  }
  const body = `
${hLead(0, 27, 20)}
${hLead(53, 80, 20)}
<circle cx="40" cy="20" r="13.6" fill="url(#ldrDisc)"/>
<circle cx="40" cy="20" r="10.6" fill="url(#ldrCds)"/>
<g clip-path="url(#ldrClip)">
  <path d="${track}" fill="none" stroke="${burned ? '#0d0a08' : '#3a2a1a'}" stroke-width="1.4" stroke-linejoin="round"/>
  <rect x="28" y="8" width="3" height="24" fill="#b9b9b9"/>
  <rect x="49" y="8" width="3" height="24" fill="#b9b9b9"/>
</g>
${burned ? '<path d="M34 9L38 17L34 23L39 31" fill="none" stroke="#000" stroke-opacity=".75" stroke-width="1"/>' : ''}
<ellipse cx="35" cy="13" rx="4" ry="2" fill="#fff" fill-opacity="${burned ? 0.08 : 0.35}"/>
<circle cx="40" cy="20" r="13.6" fill="none" stroke="#6d6250" stroke-width=".7"/>
<g stroke="#e0a400" stroke-width="1.1" stroke-linecap="round" fill="#e0a400">
  <path d="M4 2.5L14.5 9.5"/><path d="M14.5 9.5L10.6 9.2L12.6 6.3Z"/>
  <path d="M11 1L21.5 8"/><path d="M21.5 8L17.6 7.7L19.6 4.8Z"/>
</g>`;
  return svgDoc(4, 2, defs, body);
}

export const LDR_ART: PartArt = { cols: 4, rows: 2, svg: ldrSvg(false) };
export const LDR_BURNED_SVG = ldrSvg(true);
