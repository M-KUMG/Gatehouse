// Strict checks on a (migrated) project document. Returns a fresh, clean
// ProjectFile or throws a ProjectError that says what is wrong and where.

import { MAX_ZOOM, MIN_ZOOM } from '../camera';
import { DIODE_FIELDS, isDiodeFamily, isDiodeField, isDiodePresetName } from '../diodepresets';
import { isLedColor } from '../ledcolor';
import { CLOCK_CHOICES } from '../mcu/clock';
import {
  endKey, isPinEnd, sameEnd, type GridPoint, type Junction, type PinRef, type PlacedPart, type Rotation, type Wire, type WireEnd,
} from '../model';
import { canMirror, getPart, type PartState } from '../parts';
import { isBoardType } from './boardid';
import { normalizeBoardName } from './boardname';
import { PROJECT_FORMAT, PROJECT_VERSION, ProjectError, type CameraState, type ProjectFile } from './format';
import { boardsAndFiles, partBoardId } from './validateboards';

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

/** A board's custom name: only boards have one, and it follows the rules of boardname.ts. Returns it cleaned up. */
function boardName(text: string, typeId: string, where: string): string {
  if (!isBoardType(typeId)) fail(`${where} is only allowed on boards, but a ${typeId} part is not a board.`);
  const named = normalizeBoardName(text);
  if (!named.ok) fail(`${where} is not a valid board name. ${named.error}`);
  if (named.name === null) fail(`${where} must not be empty (leave it out for the default name).`);
  return named.name;
}

const MAX_BURN_REASON = 200;

function partState(v: unknown, typeId: string, where: string): PartState {
  const o = obj(v, where);
  // v4: a board's program is a .hex file in its folder, no longer part state.
  onlyKeys(o, ['closed', 'position', 'value', 'burned', 'burnedBy', 'name', 'clockHz', 'vcc', 'lux', 'temp', 'color', 'wave', 'amp', 'offset', 'duty', 'limit', 'freq', 'volts', 'coilOhms', 'pullVolts', 'releaseVolts',
    'diodePreset', ...DIODE_FIELDS.map((field) => field.key)], where);
  const type = getPart(typeId);
  const state: PartState = {};
  for (const key of Object.keys(o)) {
    if (key === 'closed' || key === 'burned') {
      state[key] = bool(o, key, where);
    } else if (key === 'burnedBy') {
      // Why the part burned (readout text only): optional, plain and short.
      const reason = str(o, key, where);
      if (reason === '' || reason.length > MAX_BURN_REASON) fail(`${where}.burnedBy must be 1 to ${MAX_BURN_REASON} characters.`);
      state.burnedBy = reason;
    } else if (key === 'name') {
      state.name = boardName(str(o, key, where), typeId, `${where}.name`);
    } else if (key === 'clockHz') {
      if (!isBoardType(typeId)) fail(`${where}.clockHz is only allowed on boards, but a ${typeId} part is not a board.`);
      const hz = num(o, key, where);
      if (!CLOCK_CHOICES.includes(hz)) fail(`${where}.clockHz must be one of ${CLOCK_CHOICES.join(', ')} Hz (got ${hz}).`);
      state.clockHz = hz;
    } else if (key === 'position') {
      const p = num(o, key, where);
      if (p < 0 || p > 1) fail(`${where}.position must be between 0 and 1 (got ${p}).`);
      state.position = p;
    } else if (key === 'diodePreset') {
      const preset = str(o, key, where);
      if (!isDiodeFamily(typeId) || !isDiodePresetName(preset)) fail(`${where}.diodePreset must be a valid diode part number.`);
      state.diodePreset = preset;
    } else if (key === 'wave' || key === 'amp' || key === 'offset' || key === 'duty' || key === 'limit' || key === 'freq' || key === 'volts'
        || key === 'coilOhms' || key === 'pullVolts' || key === 'releaseVolts' || isDiodeField(key)) {
      const field = type?.fields?.find((f) => f.key === key);
      if (!field) fail(`${where}.${key} is only allowed on parts that have this setting. A ${typeId} part has no such setting.`);
      if (key === 'wave') {
        const w = str(o, key, where);
        if (!field.choices?.includes(w)) fail(`${where}.wave must be one of ${field.choices?.join(', ')} (got ${JSON.stringify(w)}).`);
        state.wave = w as NonNullable<PartState['wave']>;
      } else {
        const v = num(o, key, where);
        if (v < field.min || v > field.max) fail(`${where}.${key} must be between ${field.min} and ${field.max} ${field.unit} (got ${v}).`);
        state[key] = v;
      }
    } else if (key === 'lux') {
      // An LDR's light level: only on parts whose value popup edits it, within its range.
      const lux = num(o, key, where);
      const spec = getPart(typeId)?.value;
      if (spec?.key !== 'lux') fail(`${where}.lux is only allowed on light-dependent resistors, but a ${typeId} part has no light level.`);
      if (lux < spec.min || lux > spec.max) fail(`${where}.lux must be between ${spec.min} and ${spec.max} lx (got ${lux}).`);
      state.lux = lux;
    } else if (key === 'color') {
      // A normal LED's color: "#rrggbb" in lower case, only on parts whose bar offers a color wheel.
      const color = str(o, key, where);
      if (!getPart(typeId)?.colorable) fail(`${where}.color is only allowed on LEDs, but a ${typeId} part has no color.`);
      if (!isLedColor(color)) fail(`${where}.color must be a color like "#3da5ff" (got ${JSON.stringify(color)}).`);
      state.color = color;
    } else if (key === 'temp') {
      // A thermistor's temperature: only on parts whose value popup edits it, within its range.
      const temp = num(o, key, where);
      const spec = getPart(typeId)?.value;
      if (spec?.key !== 'temp') fail(`${where}.temp is only allowed on thermistors, but a ${typeId} part has no temperature.`);
      if (temp < spec.min || temp > spec.max) fail(`${where}.temp must be between ${spec.min} and ${spec.max} °C (got ${temp}).`);
      state.temp = temp;
    } else if (key === 'vcc') {
      // A logic gate's supply level: only on parts whose value popup edits it, one of its choices.
      const v = num(o, key, where);
      const spec = getPart(typeId)?.value;
      if (spec?.key !== 'vcc') fail(`${where}.vcc is only allowed on logic gates, but a ${typeId} part has no supply level.`);
      if (spec.options && !spec.options.includes(v)) fail(`${where}.vcc must be one of ${spec.options.join(', ')} V (got ${v}).`);
      state.vcc = v;
    } else {
      const value = num(o, key, where);
      const spec = getPart(typeId)?.value;
      if (spec && (value < spec.min || value > spec.max)) {
        fail(`${where}.value must be between ${spec.min} and ${spec.max} ${spec.unit} (got ${value}).`);
      }
      state.value = value;
    }
  }
  const settingsError = type?.validateSettings?.(state);
  if (settingsError) fail(`${where}: ${settingsError}`);
  return state;
}

function part(v: unknown, where: string): PlacedPart {
  const o = obj(v, where);
  onlyKeys(o, ['id', 'typeId', 'boardId', 'col', 'row', 'rotation', 'mirrorX', 'mirrorY', 'state'], where);
  const id = int(o, 'id', where);
  const typeId = str(o, 'typeId', where);
  const type = getPart(typeId);
  if (!type) fail(`${where} uses an unknown part type "${typeId}". It may need a newer version of the app.`);
  const boardId = partBoardId(o, typeId, where);
  const rotation = int(o, 'rotation', where);
  if (!ROTATIONS.includes(rotation)) fail(`${where}.rotation must be 0, 90, 180 or 270 (got ${rotation}).`);
  const out: PlacedPart = {
    id, typeId, ...(boardId ? { boardId } : {}), col: int(o, 'col', where), row: int(o, 'row', where), rotation: rotation as Rotation,
  };
  // Optional (absent = false, older files lack them); kept only when true, and
  // only on a part that can be mirrored: a file saved when more parts could be
  // keeps loading, the flag is dropped.
  for (const key of ['mirrorX', 'mirrorY'] as const) {
    if (o[key] !== undefined && bool(o, key, where) && canMirror(type)) out[key] = true;
  }
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

function junction(v: unknown, where: string): Junction {
  const o = obj(v, where);
  onlyKeys(o, ['id', 'col', 'row'], where);
  return { id: int(o, 'id', where), col: int(o, 'col', where), row: int(o, 'row', where) };
}

/** A wire end: a pin ({ partId, pinId }) or a junction ({ junctionId }). */
function wireEnd(v: unknown, parts: ReadonlyMap<number, PlacedPart>, junctions: ReadonlySet<number>, where: string): WireEnd {
  const o = obj(v, where);
  if (!('junctionId' in o)) return pinRef(o, parts, where);
  onlyKeys(o, ['junctionId'], where);
  const junctionId = int(o, 'junctionId', where);
  if (!junctions.has(junctionId)) fail(`${where} is connected to junction ${junctionId}, which is not in the project.`);
  return { junctionId };
}

function wire(v: unknown, parts: ReadonlyMap<number, PlacedPart>, junctions: ReadonlySet<number>, where: string): Wire {
  const o = obj(v, where);
  onlyKeys(o, ['id', 'from', 'to', 'waypoints'], where);
  const id = int(o, 'id', where);
  const from = wireEnd(o.from, parts, junctions, `${where}.from`);
  const to = wireEnd(o.to, parts, junctions, `${where}.to`);
  if (sameEnd(from, to)) fail(`${where} connects ${isPinEnd(from) ? 'a pin' : 'a junction'} to itself.`);
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
  onlyKeys(doc, ['format', 'version', 'name', 'savedAt', 'camera', 'parts', 'wires', 'junctions', 'files', 'boardCounters'], 'The project');
  if (doc.format !== PROJECT_FORMAT) fail(`"format" must be "${PROJECT_FORMAT}".`);
  if (doc.version !== PROJECT_VERSION) fail(`"version" must be ${PROJECT_VERSION}.`);

  const ids = new Set<number>(); // parts, wires and junctions share one id space
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
  const points = new Map<string, number>();
  const junctions = list(doc.junctions, 'junctions').map((j, i) => {
    const out = junction(j, `junctions[${i}]`);
    claim(out.id, `junctions[${i}]`);
    const at = `${out.col},${out.row}`;
    const other = points.get(at);
    if (other !== undefined) fail(`junctions[${i}] is at the same point (${at}) as junctions[${other}].`);
    points.set(at, i);
    return out;
  });
  const junctionIds = new Set(junctions.map((j) => j.id));
  const seen = new Set<string>();
  const wires = list(doc.wires, 'wires').map((w, i) => {
    const out = wire(w, byId, junctionIds, `wires[${i}]`);
    claim(out.id, `wires[${i}]`);
    const ends = [endKey(out.from), endKey(out.to)].sort().join('|');
    if (seen.has(ends)) fail(`wires[${i}] duplicates another wire between the same two ends.`);
    seen.add(ends);
    return out;
  });
  // A junction only exists where three or more wires meet (see Scene.tidyJunctions).
  junctions.forEach((j, i) => {
    const count = wires.filter((w) => [w.from, w.to].some((e) => !isPinEnd(e) && e.junctionId === j.id)).length;
    if (count < 3) fail(`junctions[${i}] (id ${j.id}) has ${count} wire${count === 1 ? '' : 's'}; a junction joins 3 or more.`);
  });

  const boards = boardsAndFiles(parts, doc.files, doc.boardCounters);
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
    junctions,
    files: boards.files,
    boardCounters: boards.boardCounters,
  };
}
