import { hLead, svgDoc, type PartArt } from './common';

// Miniature SPST toggle switch seen from above: blue body, hex nut, and a
// steel lever that leans right when the switch is closed (ON), left when open.
// 4 x 2 cells; leads end at (0, 20) and (80, 20).

const defs = `
<linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#8e949b"/>
  <stop offset=".35" stop-color="#f6f7f9"/>
  <stop offset="1" stop-color="#60656b"/>
</linearGradient>
<linearGradient id="shade" gradientUnits="userSpaceOnUse" x1="0" y1="5" x2="0" y2="35">
  <stop offset="0" stop-color="#fff" stop-opacity=".1"/>
  <stop offset=".25" stop-color="#fff" stop-opacity=".3"/>
  <stop offset=".55" stop-color="#fff" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity=".45"/>
</linearGradient>`;

function toggleBody(on: boolean): string {
  const dir = on ? 1 : -1;
  const tip = 40 + dir * 21;
  const lever = `M40 17.4L${tip - dir * 4} 16.2Q${tip} 16.2 ${tip} 20Q${tip} 23.8 ${tip - dir * 4} 23.8L40 22.6Z`;
  const lamp = on ? '#7ee08a' : '#59606b';
  return `
${hLead(0, 20, 20, 3)}
${hLead(60, 80, 20, 3)}
<rect x="16" y="5" width="48" height="30" rx="2.5" fill="#22478f"/>
<rect x="16" y="5" width="48" height="30" rx="2.5" fill="url(#shade)"/>
<rect x="16" y="5" width="48" height="30" rx="2.5" fill="none" stroke="#000" stroke-opacity=".5" stroke-width=".7"/>
<g font-family="Arial, Helvetica, sans-serif" font-size="5" font-weight="bold" text-anchor="middle">
  <text x="24" y="32" fill="#cdd9f3" fill-opacity="${on ? 0.45 : 1}">OFF</text>
  <text x="57" y="32" fill="#cdd9f3" fill-opacity="${on ? 1 : 0.45}">ON</text>
</g>
<circle cx="57" cy="10.5" r="1.8" fill="${lamp}"/>
<path d="M40 10.5L48.2 15.25V24.75L40 29.5L31.8 24.75V15.25Z" fill="url(#steel)" stroke="#33373c" stroke-width=".6"/>
<circle cx="40" cy="20" r="5.6" fill="#4b5057"/>
<path d="${lever}" transform="translate(${dir * 1.2} 1.6)" fill="#000" fill-opacity=".35"/>
<path d="${lever}" fill="url(#steel)" stroke="#33373c" stroke-width=".6"/>
<circle cx="40" cy="20" r="3" fill="#d9dce0" stroke="#33373c" stroke-width=".6"/>`;
}

export const TOGGLE_ART: PartArt = { cols: 4, rows: 2, svg: svgDoc(4, 2, defs, toggleBody(false)) };
export const TOGGLE_ON_SVG = svgDoc(4, 2, defs, toggleBody(true));
