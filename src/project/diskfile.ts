// A whole project <-> the bytes of the file on disk. Saving always writes a
// `.gth`; opening also takes the older single JSON files (v1 to v4). No DOM.

import { ProjectError, type ProjectFile } from './format';
import { GTH_EXTENSION, projectNameFromFile } from './filename';
import { decodeGth, encodeGth, isZip } from './gth';
import { readProject } from './read';
import { fromFileMap, toFileMap } from './storage';

/** The `.gth` bytes for a project. */
export function projectToGth(file: ProjectFile): Uint8Array {
  return encodeGth(file.name, toFileMap(file));
}

export interface ReadFile {
  file: ProjectFile;
  /** True for the older single JSON file: Save must not overwrite it with a zip. */
  legacy: boolean;
}

/**
 * A project from a file's name and bytes, named after the file. Every check
 * runs before anything is returned; any problem throws a ProjectError.
 */
export function projectFromBytes(fileName: string, bytes: Uint8Array): ReadFile {
  const name = projectNameFromFile(fileName);
  if (isZip(bytes)) return { file: { ...fromFileMap(decodeGth(bytes).fileMap), name }, legacy: false };
  if (fileName.toLowerCase().endsWith(GTH_EXTENSION)) {
    throw new ProjectError('This .gth file is damaged: it is not a zip archive.');
  }
  return { file: { ...readProject(new TextDecoder().decode(bytes)), name }, legacy: true };
}
