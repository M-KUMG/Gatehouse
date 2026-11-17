// The text of the project's generated gatehouse.json, for showing it (read
// only) in the Code editor. It is exactly what Save writes for that file, so
// what people read is what is in the .gth. No DOM.

import type { Project } from './project';
import { MANIFEST, toFileMap } from './storage';

/** gatehouse.json as the folder layout holds it for the project as it is now (pretty printed, ends with a newline). */
export function manifestText(project: Project): string {
  return toFileMap(project.serialize())[MANIFEST];
}
