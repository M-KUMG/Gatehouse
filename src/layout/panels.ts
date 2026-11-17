// The dockable windows beside the grid. Each is a placeholder for now; the
// later tasks fill them in (serial console, code editor, file explorer).

import type { IContentRenderer } from 'dockview';

/** Panel id and component name of the grid editor in the centre. */
export const EDITOR_ID = 'editor';

export interface WindowSpec {
  /** Panel id and component name (stable: it is stored in saved layouts). */
  id: string;
  title: string;
  /** Text shown until the real window exists. */
  placeholder: string;
}

export const WINDOWS: readonly WindowSpec[] = [
  { id: 'serial-console', title: 'Serial console', placeholder: 'Serial console: coming next' },
  { id: 'code-editor', title: 'Code editor', placeholder: 'Code editor: coming later' },
  { id: 'file-explorer', title: 'File explorer', placeholder: 'File explorer: coming later' },
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
 * Content of the centre panel: a fresh wrapper each time (dockview may build
 * the panel again on restore or reset) that adopts the one long-lived editor
 * area, so the canvas and its listeners survive.
 */
export function editorRenderer(editorArea: HTMLElement): IContentRenderer {
  const element = document.createElement('div');
  element.className = 'gh-editor-host';
  return { element, init: () => element.append(editorArea) };
}
