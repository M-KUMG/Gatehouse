import { hLead, svgDoc, type PartArt } from './common';

// SPDT cube relay (SRD style): a blue plastic block with the coil on the left
// (two pins) and NC / COM / NO on the right. 6 x 4 cells; leads end at the
// grid points x = 0 (coil1 y 20, coil2 y 60) and x = 120 (nc y 20, com y 40,
// no y 60).

export const RELAY_COLS = 6;
export const RELAY_ROWS = 4;
/** Where the contact leads are (art units), for the overlay that lights the closed one. */
export const RELAY_LEADS = { x1: 102, x2: 120, nc: 20, com: 40, no: 60 };

const defs = `
<linearGradient id="relayBody" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#3f7fc4"/><stop offset=".55" stop-color="#2a5f9e"/><stop offset="1" stop-color="#1d4676"/>
</linearGradient>`;

/** The artwork of a relay with this nominal coil voltage printed on it. */
export function relaySvg(coilVolts: number, burned = false): string {
  const body = `
${hLead(0, 20, 20)}
${hLead(0, 20, 60)}
${hLead(RELAY_LEADS.x1, RELAY_LEADS.x2, RELAY_LEADS.nc)}
${hLead(RELAY_LEADS.x1, RELAY_LEADS.x2, RELAY_LEADS.com)}
${hLead(RELAY_LEADS.x1, RELAY_LEADS.x2, RELAY_LEADS.no)}
<rect x="18" y="5" width="86" height="70" rx="4" fill="url(#relayBody)"/>
<rect x="18" y="5" width="86" height="70" rx="4" fill="none" stroke="#0a1a2c" stroke-opacity=".8" stroke-width=".9"/>
<rect x="24" y="11" width="74" height="58" rx="2" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width=".8"/>
<path d="M30 28q3-6 6 0t6 0t6 0t6 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" transform="translate(0 4)"/>
<path d="M66 48H78M78 48L90 38M86 32V32" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.5" stroke-linecap="round"/>
<g font-family="Arial, Helvetica, sans-serif" fill="#fff" font-weight="bold" text-anchor="middle">
  <text x="63" y="22" font-size="9">${coilVolts}V RELAY</text>
  <text x="63" y="66" font-size="5.5" fill-opacity=".75">SPDT 10A</text>
</g>
<g font-family="Arial, Helvetica, sans-serif" fill="#fff" fill-opacity=".8" font-size="5" text-anchor="end">
  <text x="98" y="24">NC</text><text x="98" y="44">COM</text><text x="98" y="64">NO</text>
</g>
${burned ? '<ellipse cx="60" cy="40" rx="26" ry="14" fill="#000" fill-opacity=".35"/><path d="M42 30L56 40L50 48L72 52" fill="none" stroke="#000" stroke-width="1.5"/>' : ''}`;
  return svgDoc(RELAY_COLS, RELAY_ROWS, defs, body);
}

export const RELAY_ART: PartArt = { cols: RELAY_COLS, rows: RELAY_ROWS, svg: relaySvg(5) };

/** Lights the contact lead that is connected to COM (canvas in art units, unrotated). */
export function drawRelayContacts(ctx: CanvasRenderingContext2D, on: boolean): void {
  const { x1, x2, nc, com, no } = RELAY_LEADS;
  ctx.save();
  for (const y of [com, on ? no : nc]) {
    ctx.fillStyle = 'rgba(255, 214, 90, 0.35)';
    ctx.fillRect(x1, y - 3.2, x2 - x1, 6.4);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(x1, y - 1.3, x2 - x1, 2.6);
  }
  ctx.restore();
}
