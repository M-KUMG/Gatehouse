// A copy of the current project in localStorage, so a crash or a closed tab
// loses little. Only a convenience: the real save is the project file.
// Storage can be missing, full or blocked, so every access is guarded.

import type { ProjectFile } from './format';
import type { Project } from './project';
import { readProjectDocument } from './read';

const KEY = 'gatehouse.autosave';
const DELAY_MS = 1000;

interface Stored {
  savedAt: string;
  /** Whether the project had unsaved changes at the time. */
  dirty: boolean;
  project: unknown;
}

export interface Recovered {
  file: ProjectFile;
  dirty: boolean;
  savedAt: string;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The last autosaved project, or null when there is none or it is unusable. */
export function readAutosave(): Recovered | null {
  try {
    const text = storage()?.getItem(KEY);
    if (!text) return null;
    const stored = JSON.parse(text) as Stored;
    return { file: readProjectDocument(stored.project), dirty: stored.dirty === true, savedAt: String(stored.savedAt) };
  } catch {
    return null; // broken or from a newer app: ignore it, it is only a convenience
  }
}

/**
 * Write the project to storage a moment after each change. `flush` writes a
 * pending change now (e.g. when the page is closed); without one it does nothing,
 * so an older copy is not replaced before anything happened.
 */
export function startAutosave(project: Project): { flush(): void } {
  let timer = 0;
  const flush = (): void => {
    if (!timer) return;
    window.clearTimeout(timer);
    timer = 0;
    try {
      const stored: Stored = { savedAt: new Date().toISOString(), dirty: project.dirty, project: project.serialize() };
      storage()?.setItem(KEY, JSON.stringify(stored));
    } catch {
      // Full or blocked storage: nothing to do.
    }
  };
  project.onChange(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => flush(), DELAY_MS);
  });
  return { flush };
}
