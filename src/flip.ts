// Mirroring placed parts on screen ('h': left/right, 'v': top/bottom), one
// part or a group. No DOM.
//
// A group is mirrored like a real mirror of the layout, around the centre of
// its bounding box: every part's box, and the corners and junctions of the
// wires between the parts, move to their reflected places. Then each part's
// own orientation:
//   - mirrorable parts (PartType.mirrorable) get the local mirror toggled
//     (flipOrientation), so every pin lands exactly on its reflected place;
//   - boards only move, their orientation unchanged (a mirrored board does
//     not exist);
//   - other non-mirrorable parts (symmetric ones: a mirror equals a half turn
//     or nothing) keep their rotation or turn by 180 degrees, whichever puts
//     the pins on their reflected places. A resistor lying across the mirror
//     line turns by 180 (pin a goes where its reflection is, so it stays next
//     to what it was wired to); one lying along it keeps its rotation. Pins
//     that are the same metal (PartType.links, the push button's pairs) count
//     as the same place, so a button keeps its pairs on their rows.
// Wires to parts outside the group keep their corners and reroute from the
// moved pins, like after a rotation.

import {
  boundsOf, flipOrientation, footprint, isMirrorable, setOrientation, type CellBox, type FlipAxis, type Orientation, type PlacedPart,
  type Rotation, type Scene,
} from './model';
import { getPart, type PartType } from './parts';
import { rotatePoint } from './pins';

/** True when flipping these parts does something: at least one of them can be mirrored. */
export function canFlip(parts: readonly PlacedPart[]): boolean {
  return parts.some((p) => isMirrorable(p.typeId));
}

/** Pin ids that are the same piece of metal, as one group name per pin. */
function linkGroups(type: PartType): Map<string, string> {
  const group = new Map(type.pins.map((p) => [p.id, p.id]));
  const find = (id: string): string => {
    let g = id;
    while (group.get(g) !== g) g = group.get(g) ?? g;
    return g;
  };
  for (const [a, b] of type.links ?? []) group.set(find(a), find(b));
  return new Map(type.pins.map((p) => [p.id, find(p.id)]));
}

/**
 * Orientation for a symmetric (non-mirrorable, non-board) part after a flip:
 * its rotation or a half turn, whichever puts more pins (by link group) on
 * the reflected places of the old pins. A tie keeps the rotation.
 */
function symmetricOrientation(type: PartType, o: Orientation, box: CellBox, axis: FlipAxis): Orientation {
  const groups = linkGroups(type);
  // Reflected pin places, relative to the (same sized) box.
  const wanted = type.pins.map((pin) => {
    const p = rotatePoint(pin.x, pin.y, type, o);
    return { group: groups.get(pin.id), x: axis === 'h' ? box.cols - p.x : p.x, y: axis === 'v' ? box.rows - p.y : p.y };
  });
  const score = (c: Orientation): number =>
    wanted.filter((w) =>
      type.pins.some((pin) => {
        const p = rotatePoint(pin.x, pin.y, type, c);
        return groups.get(pin.id) === w.group && p.x === w.x && p.y === w.y;
      }),
    ).length;
  const turned: Orientation = { ...o, rotation: ((o.rotation + 180) % 360) as Rotation };
  return score(turned) > score(o) ? turned : o;
}

/**
 * Mirror parts as one block around the centre of their bounding box (one
 * part flips in place). Returns false, changing nothing, when none of them
 * can be mirrored.
 */
export function flipGroup(scene: Scene, parts: readonly PlacedPart[], axis: FlipAxis): boolean {
  const box = boundsOf(parts);
  if (!box || !canFlip(parts)) return false;
  // Whole cells: the mirror line is on a grid line or halfway, so points stay on the grid.
  const left = 2 * box.col + box.cols;
  const top = 2 * box.row + box.rows;
  const inner = scene.within(new Set(parts.map((p) => p.id)));
  for (const point of [...inner.wires.flatMap((wire) => wire.waypoints), ...inner.junctions]) {
    if (axis === 'h') point.col = left - point.col;
    else point.row = top - point.row;
  }
  for (const part of parts) {
    const b = footprint(part);
    const type = getPart(part.typeId);
    if (isMirrorable(part.typeId)) setOrientation(part, flipOrientation(part, axis));
    else if (type && type.board === undefined) setOrientation(part, symmetricOrientation(type, part, b, axis));
    // Same box size either way, so the reflected box is the same for all three.
    if (axis === 'h') part.col = left - b.col - b.cols;
    else part.row = top - b.row - b.rows;
  }
  return true;
}
