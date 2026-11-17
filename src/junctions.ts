// Connecting a wire to another wire. Ending (or starting) a wire on a grid
// point of an existing wire splits that wire in two at the point and puts a
// junction node there; the new wire attaches to the junction. A junction is
// a stored node like a pin, so it never has to stay "on" a wire: wires end
// at it. Scene.tidyJunctions merges or removes it when wires go. No DOM.

import { copyEnd, sameEnd, type GridPoint, type Junction, type Scene, type Wire, type WireEnd } from './model';
import { endPoint, segmentAt, wireRoute, type EndPoint } from './pins';

/** A grid point on an existing wire, where a new wire is to attach. */
export interface WireTap {
  wireId: number;
  col: number;
  row: number;
}

/** Where a wire being drawn starts or ends: a pin, a junction, or a point on a wire. */
export type Anchor = WireEnd | WireTap;

export function isTap(a: Anchor): a is WireTap {
  return 'wireId' in a;
}

export function anchorPoint(scene: Scene, a: Anchor): EndPoint | null {
  return isTap(a) ? { col: a.col, row: a.row, dir: null } : endPoint(scene, a);
}

/** Same pin, same junction, or the same point on the same wire. */
export function sameAnchor(a: Anchor, b: Anchor): boolean {
  if (isTap(a) || isTap(b)) return isTap(a) && isTap(b) && a.wireId === b.wireId && a.col === b.col && a.row === b.row;
  return sameEnd(a, b);
}

const samePoint = (a: GridPoint, b: GridPoint): boolean => a.col === b.col && a.row === b.row;

/**
 * Split `wire` at a grid point on its path. Returns the wire end now at the
 * point: one of the wire's own ends when the point is an end, else the
 * junction (an existing junction at that point is reused). The two halves
 * keep the drawn shape: the route's corners become waypoints. Returns null
 * when the point is not on the wire.
 */
export function splitWire(scene: Scene, wire: Wire, point: GridPoint): WireEnd | null {
  const path = wireRoute(scene, wire);
  if (!path) return null;
  if (samePoint(point, path[0])) return copyEnd(wire.from);
  if (samePoint(point, path[path.length - 1])) return copyEnd(wire.to);
  const s = segmentAt(path, point);
  if (s < 0) return null;
  const atCorner = samePoint(point, path[s]);
  const firstHalf = path.slice(1, s);
  const secondHalf = path.slice(atCorner ? s + 1 : s, -1);
  const junction = scene.junctionAt(point.col, point.row) ?? scene.addJunction(point.col, point.row);
  const end: WireEnd = { junctionId: junction.id };
  const to = wire.to;
  wire.to = end;
  wire.waypoints = firstHalf;
  scene.addWire(end, to, secondHalf);
  return { junctionId: junction.id };
}

/** Turn an anchor into a wire end, splitting a tapped wire. */
function resolve(scene: Scene, a: Anchor): WireEnd | null {
  if (!isTap(a)) return endPoint(scene, a) ? copyEnd(a) : null;
  const wire = scene.findWire(a.wireId);
  return wire ? splitWire(scene, wire, a) : null;
}

/**
 * Add a wire between two anchors through `waypoints`, splitting tapped
 * wires into junctions. Returns the new wire, or null when it would join an
 * end to itself or only repeat an existing wire (two points of one wire,
 * say); the wires and junctions are then left exactly as they were.
 */
export function connect(scene: Scene, from: Anchor, to: Anchor, waypoints: readonly GridPoint[]): Wire | null {
  const before = JSON.stringify([scene.wires, scene.junctions]);
  const a = resolve(scene, from);
  const b = a && resolve(scene, to);
  const wire = a && b && !sameEnd(a, b) ? scene.addWire(a, b, waypoints) : null;
  if (wire) {
    scene.tidyJunctions(); // a no-op unless the scene was untidy before
    if (scene.wires.includes(wire)) return wire;
  }
  const [wires, junctions] = JSON.parse(before) as [Wire[], Junction[]];
  scene.wires.splice(0, scene.wires.length, ...wires);
  scene.junctions.splice(0, scene.junctions.length, ...junctions);
  return null;
}
