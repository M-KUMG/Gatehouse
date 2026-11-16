// Shared helpers for part artwork. Artwork is plain SVG markup drawn in
// "art units" where ART_CELL units equal one grid cell, so a part that is
// cols x rows cells has a (cols * ART_CELL) x (rows * ART_CELL) viewBox.
// Leads must end exactly on multiples of ART_CELL (grid points): pins will
// be attached there later.

export const ART_CELL = 20;

export interface PartArt {
  cols: number;
  rows: number;
  svg: string;
}

// Tinned copper wire: light centre line, darker edges.
const METAL_DEFS = `
<linearGradient id="wireH" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#7d838b"/><stop offset=".42" stop-color="#f1f3f5"/><stop offset="1" stop-color="#666b72"/>
</linearGradient>
<linearGradient id="wireV" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#7d838b"/><stop offset=".42" stop-color="#f1f3f5"/><stop offset="1" stop-color="#666b72"/>
</linearGradient>`;

export function svgDoc(cols: number, rows: number, defs: string, body: string): string {
  const w = cols * ART_CELL;
  const h = rows * ART_CELL;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs>${METAL_DEFS}${defs}</defs>${body}</svg>`
  );
}

/** Horizontal wire lead from x1 to x2, centred on y. */
export function hLead(x1: number, x2: number, y: number, width = 2.4): string {
  return `<rect x="${x1}" y="${y - width / 2}" width="${x2 - x1}" height="${width}" fill="url(#wireH)"/>`;
}

/** Vertical wire lead from y1 to y2, centred on x. */
export function vLead(x: number, y1: number, y2: number, width = 2.4): string {
  return `<rect x="${x - width / 2}" y="${y1}" width="${width}" height="${y2 - y1}" fill="url(#wireV)"/>`;
}
