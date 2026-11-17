// Which file in a board's folder is its firmware: compiled Intel HEX text
// that the board runs. Pure, no DOM.
//
// Rule: "firmware.hex" at the board root if there is one; otherwise the only
// .hex file at the board root; otherwise an error worded for the person.
// Names compare ignoring letter case, like the tree itself.

import type { BoardTree } from '../project/filetree';

export const FIRMWARE_FILE = 'firmware.hex';

export type FirmwarePick = { ok: true; path: string; hex: string } | { ok: false; error: string };

const isHex = (path: string): boolean => path.toLowerCase().endsWith('.hex');

/** The firmware of a board's tree (only `files` is read). */
export function pickFirmware(tree: { readonly files: Readonly<BoardTree['files']> }): FirmwarePick {
  const atRoot = Object.keys(tree.files).filter((p) => !p.includes('/') && isHex(p)).sort();
  const named = atRoot.find((p) => p.toLowerCase() === FIRMWARE_FILE);
  const path = named ?? (atRoot.length === 1 ? atRoot[0] : undefined);
  if (path !== undefined) return { ok: true, path, hex: tree.files[path] };
  if (atRoot.length === 0) {
    return {
      ok: false,
      error: `No firmware: put a compiled Intel HEX file named ${FIRMWARE_FILE} in the board folder (sketches are not compiled yet).`,
    };
  }
  return {
    ok: false,
    error: `Several .hex files in the board folder (${atRoot.join(', ')}): name the one to run ${FIRMWARE_FILE}.`,
  };
}
