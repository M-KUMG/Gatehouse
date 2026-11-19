// Parts that react to the mouse: push buttons, toggle switches and knobs.
// These only change the part's plain state; the editor decides when.

import { POT_SWEEP } from './art/pot';
import type { PlacedPart } from './model';
import { getPart } from './parts';
import { unrotatePoint } from './pins';

/** Offset of a cell point from the knob centre in the unrotated part, or null without a knob. */
function fromKnob(part: PlacedPart, col: number, row: number): { dx: number; dy: number; r: number } | null {
  const type = getPart(part.typeId);
  if (!type?.knob) return null;
  const p = unrotatePoint(col - part.col, row - part.row, type, part);
  return { dx: p.x - type.knob.x, dy: p.y - type.knob.y, r: type.knob.r };
}

export function isOnKnob(part: PlacedPart, col: number, row: number): boolean {
  const k = fromKnob(part, col, row);
  return k !== null && Math.hypot(k.dx, k.dy) <= k.r;
}

/** Knob position 0..1 that points at the cell point, or null too close to the centre. */
export function knobPositionAt(part: PlacedPart, col: number, row: number): number | null {
  const k = fromKnob(part, col, row);
  if (!k || Math.hypot(k.dx, k.dy) < 0.12) return null;
  const degrees = (Math.atan2(k.dx, -k.dy) * 180) / Math.PI; // 0 is up, clockwise positive
  return (Math.min(POT_SWEEP, Math.max(-POT_SWEEP, degrees)) + POT_SWEEP) / (2 * POT_SWEEP);
}

export function knobPosition(part: PlacedPart): number {
  return part.state?.position ?? 0.5;
}

export function setKnob(part: PlacedPart, position: number): void {
  // Whole percent steps keep the value tidy in project files and readouts.
  part.state = { ...part.state, position: Math.round(Math.min(1, Math.max(0, position)) * 100) / 100 };
}

/** Hold or release a momentary button. Returns false for other parts. */
export function setPressed(part: PlacedPart, down: boolean): boolean {
  if (getPart(part.typeId)?.control !== 'momentary') return false;
  part.state = { ...part.state, closed: down };
  return true;
}

/** A click without dragging: flips a toggle switch, replaces a burned part. */
export function clickPart(part: PlacedPart): void {
  if (part.state?.burned) {
    part.state = { ...part.state, burned: false };
  } else if (getPart(part.typeId)?.control === 'toggle') {
    part.state = { ...part.state, closed: !part.state?.closed };
  }
}
