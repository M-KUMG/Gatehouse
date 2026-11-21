// The Electron app's "the window is being closed" messages, as the preload
// exposes them (electron/preload.cjs, electron/closeflow.cjs). Only the
// Electron app has them: elsewhere `closeHost()` is null (a browser can only show
// its own generic "Leave site?" prompt, see controller.ts).

export interface CloseHost {
  /** Called when the user closes the window while there are unsaved changes (Electron waits for the answer). */
  onCloseRequest(callback: () => void): void;
  /** 'close' closes the window now; 'stay' keeps it open. */
  answerClose(action: 'close' | 'stay'): void;
}

export function closeHost(): CloseHost | null {
  const host = (globalThis as { gatehouseHost?: Partial<CloseHost> }).gatehouseHost;
  return host && typeof host.onCloseRequest === 'function' && typeof host.answerClose === 'function' ? (host as CloseHost) : null;
}

/** The answer to the window once the user chose in the "Save changes?" popup (`dirtyAfterSave`: the project still has unsaved changes after Save ran). */
export function closeAnswer(choice: 'cancel' | 'discard' | 'save', dirtyAfterSave: boolean): 'close' | 'stay' {
  if (choice === 'cancel') return 'stay';
  if (choice === 'discard') return 'close';
  return dirtyAfterSave ? 'stay' : 'close';
}
