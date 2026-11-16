import { svgDoc, vLead, type PartArt } from './common';

// Ground symbol (0 V reference): a short lead and three shrinking bars.
// 2 x 2 cells; the lead ends at (20, 0).

const bar = (x: number, y: number, w: number): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="3.4" rx="1.2" fill="url(#wireH)" stroke="#2a2d31" stroke-width=".5"/>`;

const body = `
${vLead(20, 0, 19, 3)}
${bar(5, 18, 30)}
${bar(10.5, 25, 19)}
${bar(15.5, 32, 9)}`;

export const GROUND_ART: PartArt = { cols: 2, rows: 2, svg: svgDoc(2, 2, '', body) };
