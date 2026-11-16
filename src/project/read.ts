// Turning file text into a project: parse, recognise, migrate, validate.
// Any problem throws a ProjectError; nothing is half-loaded.

import { APP_NAME } from '../app';
import { PROJECT_FORMAT, ProjectError, type ProjectFile } from './format';
import { migrate } from './migrate';
import { validateProject } from './validate';

/** A parsed JSON value that should be a project document. */
export function readProjectDocument(doc: unknown): ProjectFile {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc) || !('format' in doc) || doc.format !== PROJECT_FORMAT) {
    throw new ProjectError(`This is not a ${APP_NAME} project file.`);
  }
  return validateProject(migrate(doc as Record<string, unknown>));
}

/** The text of a project file. */
export function readProject(text: string): ProjectFile {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ProjectError(`This is not a ${APP_NAME} project file (it is not valid JSON).`);
  }
  return readProjectDocument(doc);
}
