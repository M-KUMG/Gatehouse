import type { GateFn } from '../sim/gates';
import { hLead, svgDoc } from './common';

// Ideal logic gates: a small dark square chip with the gate's ANSI schematic
// symbol (distinctive shapes, inversion bubble) printed on top in a light
// colour, short leads: inputs A (and B) on the left, output Y on the right.
// The chip has no supply pins (see sim/gates.ts); the supply level it runs
// at is printed under the symbol ("5V").
// 4 x 4 cells; body 52 x 52 at (14, 14). Leads end on grid points:
// 2 inputs: A (0, 20), B (0, 60); 1 input: A (0, 40); Y (80, 40).

export const GATE_COLS = 4;
export const GATE_ROWS = 4;
/** The output lead (art units): the overlay lights it while Y is high. */
export const GATE_Y_LEAD = { x1: 66, x2: 80, y: 40 };

const INK = '#ffffff';
const BODY = 'M18 14H62Q66 14 66 18V62Q66 66 62 66H18Q14 66 14 62V18Q14 14 18 14Z';

const defs = `
<linearGradient id="gateBody" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#2f3036"/><stop offset=".5" stop-color="#1e1f23"/><stop offset="1" stop-color="#131417"/>
</linearGradient>`;

const BURN = `
<ellipse cx="40" cy="40" rx="17" ry="12" fill="#6b3a1c" fill-opacity=".5"/>
<path d="M28 31L37 39L33 45L48 50" fill="none" stroke="#000" stroke-width="1.3"/>`;

/** The symbol's outline (and extras) for a function, drawn around x 28..52, y 28..52. */
function symbol(fn: GateFn): string {
  const bubble = fn === 'not' || fn === 'nand' || fn === 'nor' || fn === 'xnor';
  // One stroke-width per element: a duplicate attribute makes the SVG invalid XML and the image does not render at all.
  const strokeW = (w: number): string => `fill="none" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"`;
  const stroke = strokeW(2);
  let shape = '';
  let tip = 52; // x where the output leaves the shape
  if (fn === 'not' || fn === 'buf') {
    shape = `<path d="M29 29L49 40L29 51Z" ${stroke}/>`;
    tip = 49;
  } else if (fn === 'and' || fn === 'nand') {
    shape = `<path d="M28 29H39A11 11 0 0 1 39 51H28Z" ${stroke}/>`;
    tip = 50;
  } else {
    // OR family: curved back, pointed front.
    shape = `<path d="M27 29Q41 29 51 40Q41 51 27 51Q32 40 27 29Z" ${stroke}/>`;
    tip = 51;
    if (fn === 'xor' || fn === 'xnor') shape += `<path d="M23 29Q28 40 23 51" ${stroke}/>`;
  }
  const out = bubble ? `<circle cx="${tip + 2.6}" cy="40" r="2.6" ${stroke}/>` : '';
  const from = bubble ? tip + 5.2 : tip;
  // Printed traces from the shape to the body edges (inputs at y 34 / 46, or 40).
  const ins = fn === 'not' || fn === 'buf' ? [40] : [34, 46];
  const back = fn === 'not' || fn === 'buf' ? 29 : fn === 'and' || fn === 'nand' ? 28 : 29;
  const traces = ins.map((y) => `<path d="M17 ${y}H${back}" ${strokeW(1.2)}/>`).join('')
    + `<path d="M${from} 40H63" ${strokeW(1.2)}/>`;
  return shape + out + traces;
}

const NAMES: Record<GateFn, string> = {
  not: 'NOT', buf: 'BUF', and: 'AND', nand: 'NAND', or: 'OR', nor: 'NOR', xor: 'XOR', xnor: 'XNOR',
};

/** Supply level as printed: 5 -> "5V", 3.3 -> "3.3V". */
export function vccLabel(vcc: number): string {
  return `${+vcc.toFixed(1)}V`;
}

/** The artwork of a gate chip. */
export function gateSvg(fn: GateFn, vcc: number, burned = false): string {
  const two = !(fn === 'not' || fn === 'buf');
  const leads = (two ? hLead(0, 15, 20) + hLead(0, 15, 60) : hLead(0, 15, 40)) + hLead(65, 80, 40);
  const pinLabels = two
    ? `<text x="18" y="22">A</text><text x="18" y="62">B</text>`
    : `<text x="18" y="38">A</text>`;
  // Inputs enter the body at their pins and run to the symbol's inputs.
  const joins = two
    ? `<path d="M15 20H17V34M15 60H17V46" fill="none" stroke="${INK}" stroke-width="1.2" stroke-opacity=".75"/>`
    : '';
  const body = `
${leads}
<path d="${BODY}" fill="url(#gateBody)"/>
<path d="${BODY}" fill="none" stroke="#000" stroke-opacity=".7" stroke-width=".7"/>
<circle cx="20" cy="20" r="1.4" fill="#000" fill-opacity=".5"/>
<g stroke-opacity=".95">${symbol(fn)}</g>
${joins}
<g font-family="Arial, Helvetica, sans-serif" fill="${INK}" font-size="5">
  <g fill-opacity=".75">${pinLabels}<text x="62" y="36" text-anchor="end">Y</text></g>
  <text x="40" y="23" text-anchor="middle" font-size="6" font-weight="bold">${NAMES[fn]}</text>
  <text x="40" y="62" text-anchor="middle" fill-opacity=".8">${vccLabel(vcc)}</text>
</g>
${burned ? BURN : ''}`;
  return svgDoc(GATE_COLS, GATE_ROWS, defs, body);
}

/** Lights the output lead while Y is high (canvas in art units, unrotated). */
export function drawGateOutput(ctx: CanvasRenderingContext2D, high: boolean): void {
  if (!high) return;
  const { x1, x2, y } = GATE_Y_LEAD;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 214, 90, 0.35)';
  ctx.fillRect(x1, y - 3.2, x2 - x1, 6.4);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(x1, y - 1.3, x2 - x1, 2.6);
  ctx.restore();
}
