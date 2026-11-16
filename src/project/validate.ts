// Strict checks on a (migrated) project document. Returns a fresh, clean
// ProjectFile or throws a ProjectError that says what is wrong and where.

import { MAX_ZOOM, MIN_ZOOM } from '../camera';
import type { GridPoint, PinRef, PlacedPart, Rotation, Wire } from '../model';
import { getPart, type PartState } from '../parts';
import { PROJECT_FORMAT, PROJECT_VERSION, ProjectError, type CameraState, type ProjectFile } from './format';

type Obj = Record<string, unknown>;

function fail(message: string): never {
  throw new ProjectError(message);
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (v === undefined) return 'nothing';
  const text = JSON.stringify(v);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

function obj(v: unknown, where: string): Obj {
  return isObj(v) ? v : fail(`${where} must be an object (got ${describe(v)}).`);
}

function list(v: unknown, where: string): unknown[] {
  return Array.isArray(v) ? v : fail(`${where} must be a list (got ${describe(v)}).`);
}

function onlyKeys(o: Obj, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(o)) {
    if (!allowed.includes(key)) fail(`${where} has an unknown field "${key}".`);
  }
}

function num(o: Obj, key: string, where: string): number {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fail(`${where}.${key} must be a number (got ${describe(v)}).`);
}

function int(o: Obj, key: string, where: string): number {
  const v = num(o, key, where);
  return Number.isInteger(v) ? v : fail(`${where}.${key} must be a whole number (got ${v}).`);
}

function str(o: Obj, key: string, where: string): string {
  const v = o[key];
  return typeof v === 'string' ? v : fail(`${where}.${key} must be text (got ${describe(v)}).`);
}

function bool(o: Obj, key: string, where: string): boolean {
  const v = o[key];
  return typeof v === 'boolean' ? v : fail(`${where}.${key} must be true or false (got ${describe(v)}).`);
}

const ROTATIONS: readonly number[] = [0, 90, 180, 270];

function partState(v: unknown, typeId: string, where: string): PartState {
  const o = obj(v, where);
  onlyKeys(o, ['closed', 'position', 'value', 'burned'], where);
  const state: PartState = {};
  for (const key of Object.keys(o)) {
    if (key === 'closed' || key === 'burned') {
      state[key] = bool(o, key, where);
    } else if (key === 'position') {
      const p = num(o, key, where);
      if (p < 0 || p > 1) fail(`${where}.position must be between 0 and 1 (got ${p}).`);
      state.position = p;
    } else {
      const value = num(o, key, where);
      const spec = getPart(typeId)?.value;
      if (spec && (value < spec.min || value > spec.max)) {
        fail(`${where}.value must be between ${spec.min} and ${spec.max} ${spec.unit} (got ${value}).`);
      }
      state.value = value;
    }
  }
  return state;
}

function part(v: unknown, where: string): PlacedPart {
  const o = obj(v, where);
  onlyKeys(o, ['id', 'typeId', 'col', 'row', 'rotation', 'state'], where);
  const id = int(o, 'id', where);
  const typeId = str(o, 'typeId', where);
  if (!getPart(typeId)) fail(`${where} uses an unknown part type "${typeId}". It may need a newer version of the app.`);
  const rotation = int(o, 'rotation', where);
  if (!ROTATIONS.includes(rotation)) fail(`${where}.rotation must be 0, 90, 180 or 270 (got ${rotation}).`);
  const out: PlacedPart = { id, typeId, col: int(o, 'col', where), row: int(o, 'row', where), rotation: rotation as Rotation };
  if (o.state !== undefined) out.state = partState(o.state, typeId, `${where}.state`);
  return out;
}

function point(v: unknown, where: string): GridPoint {
  const o = obj(v, where);
  onlyKeys(o, ['col', 'row'], where);
  return { col: int(o, 'col', where), row: int(o, 'row', where) };
}

function pinRef(v: unknown, parts: ReadonlyMap<number, PlacedPart>, where: string): PinRef {
  const o = obj(v, where);
  onlyKeys(o, ['partId', 'pinId'], where);
  const partId = int(o, 'partId', where);
  const pinId = str(o, 'pinId', where);
  const target = parts.get(partId);
  if (!target) fail(`${where} is connected to part ${partId}, which is not in the project.`);
  if (!getPart(target.typeId)?.pins.some((p) => p.id === pinId)) {
    fail(`${where} is connected to pin "${pinId}", which part ${partId} (${target.typeId}) does not have.`);
  }
  return { partId, pinId };
}

function wire(v: unknown, parts: ReadonlyMap<number, PlacedPart>, where: string): Wire {
  const o = obj(v, where);
  onlyKeys(o, ['id', 'from', 'to', 'waypoints'], where);
  const id = int(o, 'id', where);
  const from = pinRef(o.from, parts, `${where}.from`);
  const to = pinRef(o.to, parts, `${where}.to`);
  if (from.partId === to.partId && from.pinId === to.pinId) fail(`${where} connects a pin to itself.`);
  const waypoints = list(o.waypoints, `${where}.waypoints`).map((p, i) => point(p, `${where}.waypoints[${i}]`));
  return { id, from, to, waypoints };
}

function camera(v: unknown): CameraState {
  const o = obj(v, 'camera');
  onlyKeys(o, ['x', 'y', 'zoom'], 'camera');
  const zoom = num(o, 'zoom', 'camera');
  if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) fail(`camera.zoom must be between ${MIN_ZOOM} and ${MAX_ZOOM} (got ${zoom}).`);
  return { x: num(o, 'x', 'camera'), y: num(o, 'y', 'camera'), zoom };
}

/** Validate a document that is already at PROJECT_VERSION. */
export function validateProject(doc: Obj): ProjectFile {
  onlyKeys(doc, ['format', 'version', 'name', 'savedAt', 'camera', 'parts', 'wires'], 'The project');
  if (doc.format !== PROJECT_FORMAT) fail(`"format" must be "${PROJECT_FORMAT}".`);
  if (doc.version !== PROJECT_VERSION) fail(`"version" must be ${PROJECT_VERSION}.`);

  const ids = new Set<number>(); // parts and wires share one id space
  const claim = (id: number, where: string): void => {
    if (id < 1) fail(`${where}.id must be 1 or more (got ${id}).`);
    if (ids.has(id)) fail(`${where}.id ${id} is used more than once.`);
    ids.add(id);
  };

  const parts = list(doc.parts, 'parts').map((p, i) => {
    const out = part(p, `parts[${i}]`);
    claim(out.id, `parts[${i}]`);
    return out;
  });
  const byId = new Map(parts.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const wires = list(doc.wires, 'wires').map((w, i) => {
    const out = wire(w, byId, `wires[${i}]`);
    claim(out.id, `wires[${i}]`);
    const ends = [`${out.from.partId}.${out.from.pinId}`, `${out.to.partId}.${out.to.pinId}`].sort().join('|');
    if (seen.has(ends)) fail(`wires[${i}] duplicates another wire between the same two pins.`);
    seen.add(ends);
    return out;
  });

  const name = str(doc, 'name', 'The project');
  const savedAt = doc.savedAt === undefined ? undefined : str(doc, 'savedAt', 'The project');
  const view = doc.camera === undefined ? undefined : camera(doc.camera);
  // Fixed key order, the same as Project.serialize writes.
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name,
    ...(savedAt === undefined ? {} : { savedAt }),
    ...(view ? { camera: view } : {}),
    parts,
    wires,
  };
}
