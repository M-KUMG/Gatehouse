// Connections made by position instead of by a wire: pins of different
// parts on the same grid point touch, and a pin lying on a wire (anywhere
// but its ends) is connected to it. Nothing here is stored; it is worked
// out again from the positions whenever the circuit is built, so moving,
// rotating or deleting a part changes it at once. No DOM.

import { endKey, isPinEnd, type GridPoint, type Scene, type WireEnd } from './model';
import { pathPoints, pinsOf, wireRoute } from './pins';
import { NODE_PIN, type Terminal } from './sim';

/** The solver's terminal of a wire end; a junction is the single pin of a `node` component. */
export function endTerminal(end: WireEnd): Terminal {
  return isPinEnd(end) ? { part: end.partId, pin: end.pinId } : { part: end.junctionId, pin: NODE_PIN };
}

interface Touch {
  end: WireEnd;
  /** Part the pin belongs to; null for a junction. */
  part: number | null;
}

/** A grid point where things connect without a wire end of their own, for a junction dot. */
export interface ContactPoint extends GridPoint {
  /** One of the things there (its voltage is the point's voltage). */
  end: WireEnd;
}

export interface Contacts {
  /** Ideal connections to add to the netlist, besides the wires. */
  links: [Terminal, Terminal][];
  points: ContactPoint[];
}

const pointKey = (col: number, row: number): string => `${col},${row}`;

/** Two pins of one part in a list: joining those would short the part. */
function repeatsPart(touches: readonly Touch[]): boolean {
  const parts = touches.map((t) => t.part).filter((p) => p !== null);
  return new Set(parts).size !== parts.length;
}

export function findContacts(scene: Scene): Contacts {
  const at = new Map<string, Touch[]>();
  const put = (col: number, row: number, touch: Touch): void => {
    const key = pointKey(col, row);
    const list = at.get(key);
    if (list) list.push(touch);
    else at.set(key, [touch]);
  };
  for (const part of scene.parts) {
    for (const pin of pinsOf(part)) put(pin.col, pin.row, { end: pin.ref, part: part.id });
  }
  for (const j of scene.junctions) put(j.col, j.row, { end: { junctionId: j.id }, part: null });

  const links: [Terminal, Terminal][] = [];
  const points = new Map<string, ContactPoint>();

  // Pins (and junction nodes) sharing a grid point. A part's own pins are
  // never joined to each other, so a point with two pins of one part joins nothing.
  for (const [key, touches] of at) {
    if (touches.length < 2 || repeatsPart(touches)) continue;
    const first = endTerminal(touches[0].end);
    for (const t of touches.slice(1)) links.push([first, endTerminal(t.end)]);
    const [col, row] = key.split(',').map(Number);
    points.set(key, { col, row, end: touches[0].end });
  }

  // Pins on a wire's path between its ends (its ends are pins or junctions,
  // which the step above already handles). A pin of a part the wire starts
  // or ends on is left alone, and so is a part with two leads on the wire:
  // either would short the part.
  for (const wire of scene.wires) {
    const path = wireRoute(scene, wire);
    if (!path) continue;
    const ownParts = new Set([wire.from, wire.to].filter(isPinEnd).map((e) => e.partId));
    const byPart = new Map<number, { touch: Touch; point: GridPoint }[]>();
    for (const p of pathPoints(path).slice(1, -1)) {
      for (const touch of at.get(pointKey(p.col, p.row)) ?? []) {
        if (touch.part === null || ownParts.has(touch.part)) continue;
        const list = byPart.get(touch.part) ?? [];
        if (!list.some((x) => endKey(x.touch.end) === endKey(touch.end))) list.push({ touch, point: p });
        byPart.set(touch.part, list);
      }
    }
    const start = endTerminal(wire.from);
    for (const list of byPart.values()) {
      if (list.length !== 1) continue;
      const { touch, point } = list[0];
      links.push([start, endTerminal(touch.end)]);
      points.set(pointKey(point.col, point.row), { col: point.col, row: point.row, end: touch.end });
    }
  }
  return { links, points: [...points.values()] };
}
