// The dockable windows beside the grid. All are real: their long-lived
// content comes from serialconsole.ts, buildoutput.ts, codeeditor.ts, fileexplorer.ts and scope.ts (the
// placeholder text is only the fallback for a window the app gives no content).

import type { IContentRenderer, ITabRenderer } from 'dockview';

/**
 * Panel id and component name of the Circuit panel (the grid editor with the
 * parts menu). It can be moved anywhere but never closed.
 */
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
  { id: 'scope', title: 'Scope', placeholder: 'Scope' },
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
 * Content of the Circuit panel: a fresh wrapper each time (dockview may build
 * the panel again on restore or reset) that adopts the one long-lived circuit
 * view (grid area + parts menu), so the canvas and its listeners survive.
 */
export function editorRenderer(circuitView: HTMLElement): IContentRenderer {
  const element = document.createElement('div');
  element.className = 'gh-editor-host';
  return { element, init: () => element.append(circuitView) };
}

/** False for the Circuit panel, which can be moved but never closed. */
export function isClosable(id: string): boolean {
  return id !== EDITOR_ID;
}

/** Items of a tab's context menu: no "Close" for a panel that can not be closed. */
export function tabMenuItems(id: string): ('float' | 'separator' | 'close')[] {
  return isClosable(id) ? ['float', 'separator', 'close'] : ['float'];
}

/** Marks the tab of a panel that can not be closed (see dock.ts, which guards the Delete key on it). */
export const FIXED_TAB_ATTR = 'data-gh-fixed-tab';

/**
 * Tab of a panel that can be moved but not closed: dockview's default tab
 * look (same classes) without its close button.
 */
export function fixedTabRenderer(): ITabRenderer {
  const element = document.createElement('div');
  element.className = 'dv-default-tab gh-fixed-tab';
  element.setAttribute(FIXED_TAB_ATTR, '');
  const content = document.createElement('div');
  content.className = 'dv-default-tab-content';
  element.append(content);
  let subscription: { dispose(): void } | null = null;
  return {
    element,
    init: (params) => {
      content.textContent = params.title ?? '';
      subscription = params.api.onDidTitleChange((e) => {
        content.textContent = e.title;
      });
    },
    dispose: () => subscription?.dispose(),
  };
}
