// The project file: one self-contained JSON document holding only source
// data (parts, wires, camera). Nothing derived (wire routes, simulation
// results, images) is stored; it is all recomputed after loading.

import type { PlacedPart, Wire } from '../model';

/**
 * Marks a JSON document as a project file. A stable file-format id, not the
 * product name: renaming the app must not break existing files.
 */
export const PROJECT_FORMAT = 'gatehouse-project';

/** The version this app writes. Older files are migrated up to it on load. */
export const PROJECT_VERSION = 1;

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
}

/** Something wrong with a project file, worded for the person opening it. */
export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

export function emptyProject(name = DEFAULT_PROJECT_NAME): ProjectFile {
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, name, parts: [], wires: [] };
}

/** The file's text: readable and diff-friendly. */
export function stringifyProject(file: ProjectFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
