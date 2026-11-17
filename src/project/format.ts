// The project file: one self-contained JSON document holding only source
// data (parts, wires, junctions, board source files, camera). Nothing derived (wire routes, simulation
// results, images) is stored; it is all recomputed after loading.

import type { Junction, PlacedPart, Wire } from '../model';
import type { BoardCounters } from './boardid';
import type { SourceFiles } from './filetree';

/**
 * Marks a JSON document as a project file. A stable file-format id, not the
 * product name: renaming the app must not break existing files.
 */
export const PROJECT_FORMAT = 'gatehouse-project';

/**
 * The version this app writes. Older files are migrated up to it on load.
 * v1: parts and pin-to-pin wires. v2: adds `junctions`; wire ends may be a
 * junction ({ junctionId }) instead of a pin. v3: board parts carry a
 * `boardId`; adds `files` (each board's source tree) and `boardCounters`.
 * v4: boards no longer hold `state.program`; the firmware is a .hex file in
 * the board's tree (v3 programs become "firmware.hex", see migratefirmware.ts).
 */
export const PROJECT_VERSION = 4;

export const DEFAULT_PROJECT_NAME = 'Untitled';

export interface CameraState {
  /** World position at the top-left corner of the view. */
  x: number;
  y: number;
  zoom: number;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  name: string;
  /** ISO time of the save; informational only. */
  savedAt?: string;
  camera?: CameraState;
  /** Draw order: last is on top. Part types are referenced by their stable string id. */
  parts: PlacedPart[];
  wires: Wire[];
  /** Points where three or more wires meet. Contacts of touching pins are not stored (derived from positions). */
  junctions: Junction[];
  /** Source tree of every board, by boardId (exactly the boards in `parts`). */
  files: SourceFiles;
  /** Last boardId number used per board type slug, so ids of deleted boards are not reused. */
  boardCounters: BoardCounters;
}

/** The circuit part of a project file (what undo/redo snapshots), board files included. */
export type Circuit = Pick<ProjectFile, 'parts' | 'wires' | 'junctions' | 'files'>;

/** Something wrong with a project file, worded for the person opening it. */
export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

export function emptyProject(name = DEFAULT_PROJECT_NAME): ProjectFile {
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, name, parts: [], wires: [], junctions: [], files: {}, boardCounters: {} };
}

/** The file's text: readable and diff-friendly. */
export function stringifyProject(file: ProjectFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
