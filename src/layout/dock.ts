// IDE-style window layout (dockview): the grid editor fills the centre and
// the windows from panels.ts dock around it (left / top / bottom, stacked or
// tabbed) or float. The editor's group is locked and has no tab, so it can
// not be moved, closed or tabbed with a window. The layout is saved per user
// in localStorage (persist.ts) and restored at start-up.

import 'dockview/dist/styles/dockview.css';
import './dock.css';
import {
  createDockview,
  themeDark,
  type AddPanelOptions,
  type DockviewApi,
  type DockviewTheme,
  type IContentRenderer,
  type IDockviewPanel,
} from 'dockview';
import { EDITOR_ID, contentRenderer, editorRenderer, findWindow, placeholderRenderer } from './panels';
import { browserStorage, clearLayout, loadLayout, saveLayout, type LayoutStorage } from './persist';

const THEME: DockviewTheme = { ...themeDark, name: 'gatehouse', className: `${themeDark.className} gh-dock` };
const SAVE_DELAY_MS = 400;

export class DockLayout {
  readonly api: DockviewApi;
  private saveTimer = 0;
  private readonly listeners: (() => void)[] = [];

  constructor(
    host: HTMLElement,
    private readonly editorArea: HTMLElement,
    /** Long-lived content of the windows that are built, by window id (others show their placeholder). */
    private readonly contents: Readonly<Record<string, HTMLElement>> = {},
    private readonly storage: LayoutStorage | null = browserStorage(),
  ) {
    this.api = createDockview(host, {
      theme: THEME,
      createComponent: ({ name }) => this.createComponent(name),
      getTabContextMenuItems: () => ['float', 'separator', 'close'],
      floatingGroupBounds: 'boundedWithinViewport',
    });
    // Windows go left, above or below the grid: its right edge belongs to the parts menu.
    this.api.onWillShowOverlay((e) => {
      if (e.position === 'right' && (e.kind === 'edge' || e.group?.id === this.editorPanel()?.group.id)) e.preventDefault();
    });
    this.restore();
    this.api.onDidLayoutChange(this.scheduleSave);
    this.api.onDidAddPanel(this.changed);
    this.api.onDidRemovePanel(this.changed);
    window.addEventListener('pagehide', this.flush);
  }

  /** Called whenever a window opens or closes. */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  isOpen(id: string): boolean {
    return this.api.getPanel(id) !== undefined;
  }

  /** Show a window: bring it to the front, or dock it at its default place. */
  open(id: string): void {
    const existing = this.api.getPanel(id);
    if (existing) {
      existing.api.setActive();
      return;
    }
    const spec = findWindow(id);
    if (spec) this.api.addPanel({ id, component: id, title: spec.title, ...this.defaultPlace(id) });
  }

  close(id: string): void {
    this.api.getPanel(id)?.api.close();
  }

  /** Back to the first-start layout: only the grid, every window closed. */
  reset(): void {
    clearLayout(this.storage);
    this.buildDefault();
    this.changed();
  }

  private createComponent(name: string): IContentRenderer {
    if (name === EDITOR_ID) return editorRenderer(this.editorArea);
    const spec = findWindow(name);
    if (!spec) throw new Error(`Unknown window "${name}"`);
    const content = this.contents[name];
    return content ? contentRenderer(spec, content) : placeholderRenderer(spec);
  }

  private restore(): void {
    const saved = loadLayout(this.storage, EDITOR_ID);
    if (saved) {
      try {
        this.api.fromJSON(saved);
        if (this.editorPanel()?.group.api.location.type === 'grid') {
          this.lockEditor();
          return;
        }
      } catch {
        // an old or damaged layout: start fresh below
      }
      clearLayout(this.storage);
    }
    this.buildDefault();
  }

  private buildDefault(): void {
    this.api.clear();
    this.api.addPanel({ id: EDITOR_ID, component: EDITOR_ID, title: 'Circuit' });
    this.lockEditor();
  }

  /** No tab, nothing can be dropped into it (only beside it). */
  private lockEditor(): void {
    const group = this.editorPanel()?.group;
    if (!group) return;
    group.locked = true;
    group.header.hidden = true;
  }

  private editorPanel(): IDockviewPanel | undefined {
    return this.api.getPanel(EDITOR_ID);
  }

  /** Where a window opens when it is not open yet. */
  private defaultPlace(id: string): Partial<AddPanelOptions> {
    const docked = (panelId: string): boolean => this.api.getPanel(panelId)?.group.api.location.type === 'grid';
    switch (id) {
      case 'serial-console':
        return { position: { referencePanel: EDITOR_ID, direction: 'below' }, initialHeight: 180 };
      case 'code-editor':
        return docked('file-explorer')
          ? { position: { referencePanel: 'file-explorer', direction: 'below' } }
          : { position: { referencePanel: EDITOR_ID, direction: 'left' }, initialWidth: 360 };
      default:
        return docked('code-editor')
          ? { position: { referencePanel: 'code-editor', direction: 'above' } }
          : { position: { referencePanel: EDITOR_ID, direction: 'left' }, initialWidth: 240 };
    }
  }

  private changed = (): void => {
    for (const listener of this.listeners) listener();
  };

  private scheduleSave = (): void => {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(this.flush, SAVE_DELAY_MS);
  };

  private flush = (): void => {
    window.clearTimeout(this.saveTimer);
    saveLayout(this.storage, this.api.toJSON());
  };
}

/**
 * True when a key press is aimed at a window other than the grid (a tab,
 * a floating window, a window's content), so grid shortcuts leave it alone.
 */
export function isForOtherWindow(target: EventTarget | null, editorArea: HTMLElement): boolean {
  if (!(target instanceof Element) || !target.closest('.dv-shell, .dv-dockview')) return false;
  return !target.closest('.dv-groupview')?.contains(editorArea);
}
