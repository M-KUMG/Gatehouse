// v3 -> v4: a board's program moves from its part state into its folder.
// v3 boards kept `state.program` ({ name, hex }); v4 boards run the
// firmware file in their tree (see src/build/firmware.ts). The hex is written
// as "firmware.hex" (the name is dropped). Files already there are never
// touched: when "firmware.hex" exists with other text, the old program goes
// to "firmware-old.hex" (or "firmware-old-2.hex"...); identical text is
// skipped. Malformed parts are left for validation to report.

import { FIRMWARE_FILE } from '../build/firmware';
import type { Migration } from './migrate';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Free name for the old program when firmware.hex is taken (names compare ignoring case). */
function oldName(files: Obj): string {
  const taken = new Set(Object.keys(files).map((p) => p.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'firmware-old.hex' : `firmware-old-${n}.hex`;
    if (!taken.has(name)) return name;
  }
}

/** Put `hex` into a tree's files as described above. */
function addFirmware(files: Obj, hex: string): void {
  const existing = Object.keys(files).find((p) => p.toLowerCase() === FIRMWARE_FILE);
  if (existing === undefined) files[FIRMWARE_FILE] = hex;
  else if (files[existing] !== hex) files[oldName(files)] = hex;
}

export const programToFirmware: Migration = {
  from: 3,
  up: (doc) => {
    if (!Array.isArray(doc.parts) || !isObj(doc.files)) return doc;
    const trees = doc.files;
    const parts = doc.parts.map((p: unknown) => {
      if (!isObj(p) || !isObj(p.state) || !('program' in p.state)) return p;
      const { program, ...state } = p.state;
      const boardId = p.boardId;
      const tree = typeof boardId === 'string' && Object.hasOwn(trees, boardId) ? trees[boardId] : undefined;
      if (!isObj(program) || typeof program.hex !== 'string' || !isObj(tree) || !isObj(tree.files)) return p;
      addFirmware(tree.files, program.hex);
      const out: Obj = { ...p };
      if (Object.keys(state).length > 0) out.state = state;
      else delete out.state;
      return out;
    });
    return { ...doc, parts };
  },
};
