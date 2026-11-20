import { hLead, svgDoc, type PartArt } from './common';

// Small brushed DC motor (toy motor): a metal can lying on its side with two
// solder terminals on the left and the shaft with a two-blade fan on the
// right. 6 x 3 cells; the leads end at (0, 20) pos and (0, 40) neg. The fan
// is drawn by the overlay (it turns with the shaft speed).

export const MOTOR_COLS = 6;
export const MOTOR_ROWS = 3;
/** Centre of the shaft end, art units. */
export const MOTOR_SHAFT = { x: 104, y: 30 };

const defs = `
<linearGradient id="motorCan" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#9aa0a8"/><stop offset=".3" stop-color="#e9ecef"/><stop offset=".65" stop-color="#b4bac1"/><stop offset="1" stop-color="#6b7077"/>
</linearGradient>`;

/** The motor art; `burned` darkens the can. */
export function motorSvg(burned = false): string {
  const body = `
${hLead(0, 24, 20, 2.6)}
${hLead(0, 24, 40, 2.6)}
<rect x="24" y="8" width="58" height="44" rx="6" fill="url(#motorCan)"/>
<rect x="24" y="8" width="58" height="44" rx="6" fill="none" stroke="#000" stroke-opacity=".5" stroke-width=".8"/>
<rect x="78" y="14" width="8" height="32" rx="2" fill="#7b8088"/>
<rect x="86" y="27" width="14" height="6" rx="2" fill="#c9ced4"/>
<circle cx="31" cy="30" r="3" fill="#2a2d31"/>
<g font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="8" fill="#303338" text-anchor="middle">
  <text x="54" y="28">DC MOTOR</text><text x="54" y="39" font-size="6.5" font-weight="normal">6 V</text>
</g>
<text x="16" y="17" font-family="Arial, sans-serif" font-size="8" font-weight="bold" fill="#c0392b">+</text>
${burned ? '<rect x="24" y="8" width="58" height="44" rx="6" fill="#000" fill-opacity=".45"/>' : ''}`;
  return svgDoc(MOTOR_COLS, MOTOR_ROWS, defs, body);
}

export const MOTOR_ART: PartArt = { cols: MOTOR_COLS, rows: MOTOR_ROWS, svg: motorSvg() };

// The fan's drawn angle per placed motor (a stateless part has no stable state object to key on, so the part id is the key).
const phases = new Map<number, { t: number; phase: number }>();

/**
 * Draws the fan on the shaft, turned by the shaft speed (rad/s). The picture
 * spins at most about 6 turns a second (it would only flicker beyond that)
 * and keeps its angle between frames; the angle is only a drawing, nothing
 * in the simulation depends on it.
 */
export function drawMotorFan(ctx: CanvasRenderingContext2D, key: number, omega: number, now = performance.now()): void {
  const last = phases.get(key) ?? { t: now, phase: 0 };
  const dt = Math.min(0.1, Math.max(0, (now - last.t) / 1000));
  const turns = Math.sign(omega) * Math.min(6, Math.abs(omega) / (2 * Math.PI) / 20); // 8000 rpm shows as 6 turns/s
  const phase = (last.phase + turns * dt * 2 * Math.PI) % (2 * Math.PI);
  phases.set(key, { t: now, phase });
  const { x, y } = MOTOR_SHAFT;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(phase);
  ctx.fillStyle = '#2f9e6b';
  ctx.strokeStyle = '#0b3d27';
  ctx.lineWidth = 0.8;
  for (const a of [0, Math.PI]) {
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(8, 0, 8, 3.2, 0, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#d7dbe0';
  ctx.beginPath();
  ctx.arc(0, 0, 2.2, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}
