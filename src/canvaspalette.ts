// The colours of the circuit drawing on the grid (grid lines, selection, wires,
// pins, labels), in one place, matching the glass look of the interface
// (tokens.css has the same blue as --gh-accent). The drawing is on a canvas, so it
// cannot use the CSS variables: change a colour here instead. No DOM in this file.

export const PALETTE = {
  // The grid
  background: 'rgba(10, 12, 18, 0.1)', // translucent: the glass backdrop shows through the canvas
  gridMinor: 'rgba(255, 255, 255, 0.06)',
  gridMajor: 'rgba(255, 255, 255, 0.13)',
  gridDot: 'rgba(255, 255, 255, 0.3)', // a small bright dot where two major lines cross

  // The accent (the same blue as --gh-accent) in the shapes the drawing needs
  accent: '#4ea1ff',
  accentBright: 'rgba(130, 190, 255, 0.95)',
  accentFill: 'rgba(78, 161, 255, 0.1)',
  accentFillStrong: 'rgba(78, 161, 255, 0.3)',
  accentGlow: 'rgba(78, 161, 255, 0.55)',
  accentSoft: 'rgba(78, 161, 255, 0.16)',

  // Parts: hovered, selected, and the ghost while a part is dragged in
  hoverEdge: 'rgba(255, 255, 255, 0.4)',
  hoverFill: 'rgba(255, 255, 255, 0.05)',
  selectInner: 'rgba(255, 255, 255, 0.22)', // thin light line just inside the selection outline
  ghostFill: 'rgba(78, 161, 255, 0.07)',

  // Wires
  wireCasing: 'rgba(8, 10, 16, 0.6)',
  wireHoverGlowOuter: 'rgba(255, 255, 255, 0.08)',
  wireHoverGlowInner: 'rgba(255, 255, 255, 0.2)',
  wireSelectGlowOuter: 'rgba(78, 161, 255, 0.2)',
  wireSelectGlowInner: 'rgba(78, 161, 255, 0.5)',
  flowDash: 'rgba(255, 255, 255, 0.78)',
  junctionHalo: 'rgba(255, 255, 255, 0.16)',

  // Pins
  pinDot: 'rgba(255, 255, 255, 0.85)',
  pinDotActive: '#ffffff',
  pinEdge: 'rgba(0, 0, 0, 0.6)',

  // The badge on an overstressed part
  warning: '#ff5a5f',
  warningGlow: 'rgba(255, 90, 95, 0.7)',

  // The name tag next to a board
  labelFill: 'rgba(16, 18, 28, 0.72)',
  labelEdge: 'rgba(255, 255, 255, 0.28)',
  labelText: '#e8eaed',
} as const;

/** Wire colour at 0 V and at the highest voltage in the circuit (RGB). */
export const VOLTAGE_LOW: readonly [number, number, number] = [98, 134, 164];
export const VOLTAGE_HIGH: readonly [number, number, number] = [240, 124, 70];

/**
 * The colour of a wire at `volts` when `max` is the highest voltage in the
 * circuit: cool blue at 0 V, warm orange at the top, blended in between. An
 * unknown voltage, or a circuit with no voltage at all, is the cool colour.
 */
export function voltageColor(volts: number | undefined, max: number): string {
  const t = volts === undefined || !(max >= 1e-6) || Number.isNaN(volts) ? 0 : Math.min(1, Math.max(0, volts / max));
  const c = VOLTAGE_LOW.map((low, i) => Math.round(low + ((VOLTAGE_HIGH[i] ?? low) - low) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
