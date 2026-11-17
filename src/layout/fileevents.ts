// Tiny event channel between the File explorer and the Code editor: the
// explorer says "open this file", whoever shows files listens. No DOM.

export type OpenFileListener = (boardId: string, path: string) => void;

const listeners = new Set<OpenFileListener>();

/** Call `listener` whenever a file is asked to be opened. Returns a function that stops listening. */
export function onOpenFile(listener: OpenFileListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A file of a board was chosen in the explorer (double-click or Enter). */
export function emitOpenFile(boardId: string, path: string): void {
  for (const listener of [...listeners]) listener(boardId, path);
}
