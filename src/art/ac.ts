import { hLead, svgDoc, type PartArt } from './common';

// Artwork of the AC and mains parts (see acparts.ts): the variable AC supply, the 230 V outlet, the incandescent
// and the LED bulb, and the transformer. Static drawings here; the bulbs' glow is drawn live on top by
// drawBulbGlow / drawLedBulbGlow (the canvas is in art units, unrotated).

// ---- AC supply: the bench supply's box with a sine on its display ---------------------------------------------------

export const ACSOURCE_COLS = 6;
export const ACSOURCE_ROWS = 4;

const acDefs = `
<linearGradient id="acBody" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#6d737b"/><stop offset=".5" stop-color="#4b5058"/><stop offset="1" stop-color="#34383e"/>
</linearGradient>
<linearGradient id="acGlass" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#10171a"/><stop offset="1" stop-color="#05090b"/>
</linearGradient>`;

/** The RMS voltage as printed on the display: "12.0 V", "230 V". */
export function acVoltsLabel(volts: number): string {
  const v = Math.max(0, volts);
  return `${v < 100 ? v.toFixed(1) : v.toFixed(0)} V`;
}

/** The frequency as printed: "50 Hz", "1.5 kHz". */
export function acHzLabel(hz: number): string {
  return hz >= 1000 ? `${+(hz / 1000).toFixed(2)} kHz` : `${+hz.toFixed(hz < 10 ? 2 : 1)} Hz`;
}

/** The AC supply's artwork with its settings on the display. */
export function acsourceSvg(vrms: number, hz: number): string {
  const body = `
${hLead(100, 120, 20, 3)}
${hLead(100, 120, 60, 3)}
<rect x="3" y="5" width="98" height="70" rx="5" fill="url(#acBody)"/>
<rect x="3" y="5" width="98" height="70" rx="5" fill="none" stroke="#000" stroke-opacity=".6" stroke-width=".8"/>
<rect x="10" y="12" width="60" height="26" rx="2.5" fill="url(#acGlass)" stroke="#000" stroke-width=".8"/>
<text x="66" y="28" text-anchor="end" font-family="Consolas, 'Courier New', monospace" font-size="14" font-weight="bold" fill="#5ad1ff">${acVoltsLabel(vrms)}</text>
<text x="66" y="36" text-anchor="end" font-family="Consolas, 'Courier New', monospace" font-size="6.5" fill="#5ad1ff" fill-opacity=".85">AC ${acHzLabel(hz)} rms</text>
<path d="M12 25 q3 -10 6 0 t6 0" fill="none" stroke="#5ad1ff" stroke-width="1.2" stroke-linecap="round" stroke-opacity=".8"/>
<circle cx="24" cy="57" r="9" fill="#2b2e33" stroke="#0b0c0e" stroke-width="1"/>
<path d="M24 57L29 50" stroke="#e8eaee" stroke-width="2" stroke-linecap="round"/>
<circle cx="86" cy="20" r="6" fill="#b5651d" stroke="#3a2008" stroke-width="1"/>
<circle cx="86" cy="60" r="6" fill="#1f5fbf" stroke="#07204a" stroke-width="1"/>
<g font-family="Arial, Helvetica, sans-serif" font-weight="bold" text-anchor="middle" fill="#e8eaee">
  <text x="86" y="40" font-size="11">~</text>
  <text x="86" y="52" font-size="11">~</text>
  <text x="46" y="68" font-size="6" fill-opacity=".7">AC POWER SUPPLY</text>
  <text x="72" y="50.5" font-size="5.5" text-anchor="start" fill-opacity=".8">CC</text>
</g>`;
  return svgDoc(ACSOURCE_COLS, ACSOURCE_ROWS, acDefs, body);
}

/** The AC supply's CC lamp, lit while the current limit holds the output back (same place as the DC supply's). */
export function drawAcLamp(ctx: CanvasRenderingContext2D, limiting: boolean): void {
  ctx.save();
  ctx.fillStyle = limiting ? '#ff3b30' : '#3a1512';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(62, 48, 3.2, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export const ACSOURCE_ART: PartArt = { cols: ACSOURCE_COLS, rows: ACSOURCE_ROWS, svg: acsourceSvg(12, 50) };

// ---- 230 V outlet ------------------------------------------------------------------------------------------------

const outletDefs = `
<linearGradient id="outPlate" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#f4f2ec"/><stop offset="1" stop-color="#c9c5ba"/>
</linearGradient>
<radialGradient id="outWell" cx=".4" cy=".35" r=".8">
  <stop offset="0" stop-color="#d6d2c7"/><stop offset="1" stop-color="#9d998e"/>
</radialGradient>`;

/** A wall socket with two leads (live above, neutral below). 4 x 4 cells; the leads end at (80, 20) and (80, 60). */
export function outletSvg(): string {
  const body = `
${hLead(58, 80, 20, 3)}
${hLead(58, 80, 60, 3)}
<rect x="3" y="3" width="56" height="74" rx="9" fill="url(#outPlate)" stroke="#6f6c64" stroke-width="1"/>
<circle cx="31" cy="38" r="22" fill="url(#outWell)" stroke="#7d796e" stroke-width="1"/>
<circle cx="22" cy="38" r="3.8" fill="#14120f"/>
<circle cx="40" cy="38" r="3.8" fill="#14120f"/>
<rect x="28" y="14.5" width="6" height="4" rx="1" fill="#b9bdc2" stroke="#6b6f74" stroke-width=".6"/>
<rect x="28" y="57.5" width="6" height="4" rx="1" fill="#b9bdc2" stroke="#6b6f74" stroke-width=".6"/>
<g font-family="Arial, Helvetica, sans-serif" text-anchor="middle" fill="#55524a">
  <text x="31" y="71" font-size="6.5" font-weight="bold">230 V ~ 50 Hz</text>
  <text x="49" y="16" font-size="6" font-weight="bold" fill="#8a4b12">L</text>
  <text x="49" y="55" font-size="6" font-weight="bold" fill="#1f4f9f">N</text>
</g>
<path d="M58 20h-4" stroke="#8a4b12" stroke-width="3"/>
<path d="M58 60h-4" stroke="#1f4f9f" stroke-width="3"/>`;
  return svgDoc(4, 4, outletDefs, body);
}

export const OUTLET_ART: PartArt = { cols: 4, rows: 4, svg: outletSvg() };

// ---- Bulbs -------------------------------------------------------------------------------------------------------

const bulbDefs = `
<radialGradient id="bulbGlass" cx=".38" cy=".3" r=".85">
  <stop offset="0" stop-color="#ffffff" stop-opacity=".75"/><stop offset=".6" stop-color="#dfe9f0" stop-opacity=".28"/><stop offset="1" stop-color="#9fb4c2" stop-opacity=".3"/>
</radialGradient>
<radialGradient id="ledGlass" cx=".38" cy=".3" r=".85">
  <stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#ecebe4"/><stop offset="1" stop-color="#c9c8bf"/>
</radialGradient>
<linearGradient id="bulbThread" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#8d939a"/><stop offset=".4" stop-color="#f0f2f4"/><stop offset="1" stop-color="#6c7178"/>
</linearGradient>`;

/** The screw cap and the two leads (shell left, tip right), shared by both bulbs. 4 x 6 cells; the leads end at (20, 120) and (60, 120). */
function cap(top: number): string {
  const ridges = Array.from({ length: 4 }, (_, i) => `<path d="M30 ${top + 6 + i * 5.5}h20" stroke="#4b5055" stroke-opacity=".55" stroke-width="1.1"/>`).join('');
  return `
<path d="M31 ${top + 26} L20 ${top + 38} V120" fill="none" stroke="#222" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M31 ${top + 26} L20 ${top + 38} V120" fill="none" stroke="#dfe3e6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M40 ${top + 33} L60 ${top + 46} V120" fill="none" stroke="#222" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M40 ${top + 33} L60 ${top + 46} V120" fill="none" stroke="#dfe3e6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="30" y="${top}" width="20" height="26" rx="3" fill="url(#bulbThread)" stroke="#3c4045" stroke-width=".7"/>
${ridges}
<path d="M33 ${top + 26} h14 l-2 6 h-10 Z" fill="#3b3f44"/>
<rect x="36" y="${top + 31}" width="8" height="4" rx="2" fill="#c9ced3" stroke="#3c4045" stroke-width=".6"/>`;
}

/** The incandescent bulb: clear glass, a coiled filament on two supports, a screw cap. `burned`: the filament is broken and the glass dark. */
export function bulbSvg(burned = false): string {
  const glass = 'M31 62 L31 55 C18 47 13 35 17 24 C21 12 31 7 40 7 C49 7 59 12 63 24 C67 35 62 47 49 55 L49 62 Z';
  const filament = burned
    ? '<path d="M36 60V40M44 60V44" stroke="#2c2c2c" stroke-width="1.2"/><path d="M36 40l2-3 2 3M44 44l-2 3" fill="none" stroke="#2c2c2c" stroke-width="1"/>'
    : '<path d="M36 60V38M44 60V38" stroke="#4d4f52" stroke-width="1.2"/><path d="M36 38l2-4 2 4 2-4 2 4 2-4" fill="none" stroke="#3b3b3b" stroke-width="1.3" stroke-linejoin="round"/>';
  const body = `
${cap(62)}
<path d="${glass}" fill="url(#bulbGlass)" stroke="#7f95a3" stroke-width="1"/>
${filament}
<path d="M24 22 C26 17 31 13 36 12" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>
${burned ? `<path d="${glass}" fill="#000" fill-opacity=".5"/>` : ''}`;
  return svgDoc(4, 6, bulbDefs, body);
}

/** The LED bulb: a frosted dome on a white body with the screw cap. `burned` darkens it. */
export function ledbulbSvg(burned = false): string {
  const dome = 'M27 50 C14 44 12 30 17 21 C22 12 31 8 40 8 C49 8 58 12 63 21 C68 30 66 44 53 50 Z';
  const dots = [32, 40, 48].map((x) => `<rect x="${x - 1.5}" y="28" width="3" height="9" rx="1.2" fill="#e6b93d" fill-opacity=".55"/>`).join('');
  const body = `
${cap(62)}
<path d="M28 50 H52 L50 62 H30 Z" fill="#f3f1ea" stroke="#9a978d" stroke-width=".9"/>
<path d="M30 55 H50 M30 58.5 H50" stroke="#c8c5ba" stroke-width=".8"/>
<path d="${dome}" fill="url(#ledGlass)" stroke="#a9a79b" stroke-width="1"/>
${dots}
<path d="M23 22 C25 17 30 13 35 12" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="2" stroke-linecap="round"/>
${burned ? `<path d="${dome}" fill="#000" fill-opacity=".5"/>` : ''}`;
  return svgDoc(4, 6, bulbDefs, body);
}

export const BULB_ART: PartArt = { cols: 4, rows: 6, svg: bulbSvg() };
export const LEDBULB_ART: PartArt = { cols: 4, rows: 6, svg: ledbulbSvg() };

/** Light colour of a filament of `kelvin`: dull red at first, orange, warm white at the rated 2700 K, a little whiter above. */
export function filamentRgb(kelvin: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [900, [150, 25, 10]], [1500, [255, 70, 20]], [2100, [255, 150, 50]], [2700, [255, 214, 150]], [3200, [255, 240, 220]],
  ];
  if (kelvin <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [k1, c1] = stops[i];
    if (kelvin <= k1) {
      const [k0, c0] = stops[i - 1];
      const w = (kelvin - k0) / (k1 - k0);
      return [0, 1, 2].map((j) => c0[j] + (c1[j] - c0[j]) * w) as [number, number, number];
    }
  }
  return stops[stops.length - 1][1];
}

const rgba = (c: readonly number[], a: number): string => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;

/** The light of a lamp: `light` 0..1.6 (1 = rated), `rgb` its colour, around (cx, cy). */
function drawLampGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, light: number, rgb: readonly number[], hot: readonly number[]): void {
  if (!(light > 0.01)) return;
  const b = Math.min(1, light);
  ctx.globalCompositeOperation = 'lighter';
  const core = ctx.createRadialGradient(cx, cy, 1, cx, cy, 24);
  core.addColorStop(0, rgba(hot, 0.95 * b));
  core.addColorStop(0.45, rgba(rgb, 0.55 * b));
  core.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = core;
  ctx.fillRect(cx - 26, cy - 26, 52, 52);
  const reach = 30 + 40 * Math.min(1.6, light);
  const halo = ctx.createRadialGradient(cx, cy, 8, cx, cy, reach);
  halo.addColorStop(0, rgba(rgb, 0.38 * b));
  halo.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(cx - reach, cy - reach, 2 * reach, 2 * reach);
  ctx.globalCompositeOperation = 'source-over';
}

/** The incandescent bulb's glow, from its brightness (1 = rated) and filament temperature. */
export function drawBulbGlow(ctx: CanvasRenderingContext2D, light: number, kelvin: number): void {
  if (!(light > 0.01)) return;
  const rgb = filamentRgb(kelvin);
  drawLampGlow(ctx, 40, 32, light, rgb, filamentRgb(Math.min(3200, kelvin + 500)));
  // The lit filament itself.
  ctx.save();
  ctx.strokeStyle = rgba(filamentRgb(Math.min(3200, kelvin + 300)), Math.min(1, 0.3 + light));
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(36, 38);
  for (let i = 0; i < 4; i++) ctx.lineTo(36 + (i + 1) * 2, i % 2 === 0 ? 34 : 38);
  ctx.stroke();
  ctx.restore();
}

/** The LED bulb's glow, from its brightness (1 = rated): a cool warm-white. */
export function drawLedBulbGlow(ctx: CanvasRenderingContext2D, light: number): void {
  drawLampGlow(ctx, 40, 30, light, [255, 236, 190], [255, 252, 238]);
}

// ---- Transformer -------------------------------------------------------------------------------------------------

const xfmrDefs = `
<linearGradient id="xCore" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#a3a8ae"/><stop offset=".5" stop-color="#7c8188"/><stop offset="1" stop-color="#5d6269"/>
</linearGradient>
<linearGradient id="xCoil" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#e29a4b"/><stop offset=".5" stop-color="#b8661f"/><stop offset="1" stop-color="#7d440f"/>
</linearGradient>`;

/** "230 V" / "12 V" on a winding. */
function xfmrVolts(volts: number): string {
  return `${+volts.toFixed(volts < 10 ? 2 : volts < 100 ? 1 : 0)} V`;
}

/** The transformer: an iron core with a primary winding (left) and a secondary (right), the nameplate voltages on the windings. 6 x 5 cells. */
export function transformerSvg(primaryVolts: number, secondaryVolts: number, burned = false): string {
  const wires = (x0: number) => Array.from({ length: 6 }, (_, i) => `<path d="M${x0 + 3 + i * 3.6} 26 l-2 48" stroke="#f0b070" stroke-opacity=".55" stroke-width=".9"/>`).join('');
  const body = `
${hLead(0, 33, 20, 3)}
${hLead(0, 33, 80, 3)}
${hLead(87, 120, 20, 3)}
${hLead(87, 120, 80, 3)}
<rect x="30" y="12" width="60" height="76" rx="3" fill="url(#xCore)" stroke="#2a2d31" stroke-width=".8"/>
<rect x="58" y="12" width="4" height="76" fill="#2a2d31" fill-opacity=".55"/>
<rect x="33" y="22" width="25" height="56" rx="4" fill="url(#xCoil)" stroke="#4a2808" stroke-width=".8"/>
<rect x="62" y="22" width="25" height="56" rx="4" fill="url(#xCoil)" stroke="#4a2808" stroke-width=".8"/>
${wires(33)}${wires(62)}
<g font-family="Arial, Helvetica, sans-serif" font-weight="bold" text-anchor="middle" fill="#fff" stroke="#3a2008" stroke-width=".4" paint-order="stroke">
  <text x="45.5" y="53" font-size="7.5">${xfmrVolts(primaryVolts)}</text>
  <text x="74.5" y="53" font-size="7.5">${xfmrVolts(secondaryVolts)}</text>
</g>
<circle cx="10" cy="12.5" r="2" fill="#e8eaee"/>
<circle cx="110" cy="12.5" r="2" fill="#e8eaee"/>
${burned ? '<rect x="30" y="12" width="60" height="76" rx="3" fill="#000" fill-opacity=".5"/>' : ''}`;
  return svgDoc(6, 5, xfmrDefs, body);
}

export const TRANSFORMER_ART: PartArt = { cols: 6, rows: 5, svg: transformerSvg(230, 12) };
