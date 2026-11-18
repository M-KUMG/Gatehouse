// The dockable windows beside the grid. All are real: their long-lived
// content comes from serialconsole.ts, buildoutput.ts, codeeditor.ts and fileexplorer.ts (the
// placeholder text is only the fallback for a window the app gives no content).

import type { IContentRenderer } from 'dockview';

/** Panel id and component name of the grid editor in the centre. */
export const EDITOR_ID = 'editor';

export interface WindowSpec {
  /** Panel id and component name (stable: it is stored in saved layouts). */
  id: string;
  title: string;
  /** Text shown when the app provides no content for the window (yet). */
  placeholder: string;
}

export const WINDOWS: readonly WindowSpec[] = [
  { id: 'serial-console', title: 'Serial console', placeholder: 'Serial console' },
  { id: 'build-output', title: 'Build output', placeholder: 'Build output' },
  { id: 'code-editor', title: 'Code editor', placeholder: 'Code editor' },
  { id: 'file-explorer', title: 'File explorer', placeholder: 'File explorer' },
];

export function findWindow(id: string): WindowSpec | undefined {
  return WINDOWS.find((w) => w.id === id);
}

/** Content of a placeholder window. */
export function placeholderRenderer(spec: WindowSpec): IContentRenderer {
  const element = document.createElement('div');
  element.className = 'gh-window';
  element.dataset.ghWindow = spec.id;
  const text = document.createElement('div');
  text.className = 'gh-window-placeholder';
  text.textContent = spec.placeholder;
  element.append(text);
  return { element, init: () => {} };
}

/**
 * Content of a real window: like the editor below, a fresh wrapper adopts
 * the window's one long-lived element, which keeps its state while closed.
 */
export function contentRenderer(spec: WindowSpec, content: HTMLElement): IContentRenderer {
  const element = document.createElement('div');
  element.className = 'gh-window-host';
  element.dataset.ghWindow = spec.id;
  return { element, init: () => element.append(content) };
}

/**
 * Content of the centre panel: a fresh wrapper each time (dockview may build
 * the panel again on restore or reset) that adopts the one long-lived editor
 * area, so the canvas and its listeners survive.
 */
export function editorRenderer(editorArea: HTMLElement): IContentRenderer {
  const element = document.createElement('div');
  element.className = 'gh-editor-host';
  return { element, init: () => element.append(editorArea) };
}
