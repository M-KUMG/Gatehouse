// IDE-style window layout (dockview). The Circuit panel (the grid editor with
// its parts menu) is an ordinary panel: it can be docked anywhere, tabbed with
// other windows or floated, but it can not be closed (its tab has no close
// button, its tab menu no "Close", Delete on its tab does nothing). The other
// windows from panels.ts dock around it or float. The layout is saved per user
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
import {
  EDITOR_ID,
  FIXED_TAB_ATTR,
  contentRenderer,
  editorRenderer,
  findWindow,
  fixedTabRenderer,
  isClosable,
  placeholderRenderer,
  tabMenuItems,
} from './panels';
import { installDropPreview } from './droppreview';
import { browserStorage, clearLayout, loadLayout, saveLayout, type LayoutStorage } from './persist';

// 'absolute': the drop preview is ONE overlay that glides from window to window
// (the default draws a separate rectangle inside each window, which cannot animate across them).
const THEME: DockviewTheme = { ...themeDark, name: 'gatehouse', className: `${themeDark.className} gh-dock`, dndOverlayMounting: 'absolute' };
const SAVE_DELAY_MS = 400;
/** Tab component name of every panel; createTabComponent picks the tab by panel id. */
const TAB_COMPONENT = 'gh-tab';

export class DockLayout {
  readonly api: DockviewApi;
  private saveTimer = 0;
  private readonly listeners: (() => void)[] = [];

  constructor(
    host: HTMLElement,
    /** Long-lived content of the Circuit panel (grid area and parts menu). */
    private readonly circuitView: HTMLElement,
    /** Long-lived content of the windows that are built, by window id (others show their placeholder). */
    private readonly contents: Readonly<Record<string, HTMLElement>> = {},
    private readonly storage: LayoutStorage | null = browserStorage(),
  ) {
    this.api = createDockview(host, {
      theme: THEME,
      createComponent: ({ name }) => this.createComponent(name),
      // Returning undefined gives dockview's default tab (with its close button).
      defaultTabComponent: TAB_COMPONENT,
      createTabComponent: ({ id }) => (isClosable(id) ? undefined : fixedTabRenderer()),
      getTabContextMenuItems: ({ panel }) => tabMenuItems(panel.id),
      floatingGroupBounds: 'boundedWithinViewport',
    });
    // dockview closes a focused tab on Delete / Backspace: not this one. Capture
    // on the host runs before dockview's own listener on the tab strip.
    host.addEventListener(
      'keydown',
      (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && e.target instanceof Element && e.target.querySelector(`[${FIXED_TAB_ATTR}]`)) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true,
    );
    // One card for the "where will it land" preview, which also glides from window to window.
    installDropPreview(host);
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

  /**
   * Show a window without taking the keyboard focus from where it is (a window
   * that opens by itself, such as the Build output after a failed build).
   */
  openQuietly(id: string): void {
    const before = document.activeElement;
    this.open(id);
    if (before instanceof HTMLElement && before.isConnected && document.activeElement !== before) before.focus({ preventScroll: true });
  }

  /** Show a window (or the Circuit panel): bring it to the front, or dock it at its default place. */
  open(id: string): void {
    const existing = this.api.getPanel(id);
    if (existing) {
      existing.api.setActive();
      return;
    }
    if (id === EDITOR_ID) return this.reset(); // can not happen (it is never closed), but never leave the app without its grid
    const spec = findWindow(id);
    if (spec) this.api.addPanel({ id, component: id, title: spec.title, ...this.defaultPlace(id) });
  }

  /** Close a window; the Circuit panel stays. */
  close(id: string): void {
    if (isClosable(id)) this.api.getPanel(id)?.api.close();
  }

  /** Back to the first-start layout: only the Circuit panel, every window closed. */
  reset(): void {
    clearLayout(this.storage);
    this.buildDefault();
    this.changed();
  }

  private createComponent(name: string): IContentRenderer {
    if (name === EDITOR_ID) return editorRenderer(this.circuitView);
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
        if (this.editorPanel()) return;
      } catch {
        // a damaged layout: start fresh below
      }
      clearLayout(this.storage);
    }
    this.buildDefault();
  }

  private buildDefault(): void {
    this.api.clear();
    this.api.addPanel({ id: EDITOR_ID, component: EDITOR_ID, title: 'Circuit' });
  }

  private editorPanel(): IDockviewPanel | undefined {
    return this.api.getPanel(EDITOR_ID);
  }

  /**
   * Where a window opens when it is not open yet: beside the Circuit panel when
   * it is docked in the grid, else (it floats) at the dock's own edges.
   */
  private defaultPlace(id: string): Partial<AddPanelOptions> {
    const docked = (panelId: string): boolean => this.api.getPanel(panelId)?.group.api.location.type === 'grid';
    const beside = (direction: 'left' | 'below'): Partial<AddPanelOptions> =>
      docked(EDITOR_ID) ? { position: { referencePanel: EDITOR_ID, direction } } : { position: { direction } };
    switch (id) {
      case 'serial-console':
        return { ...beside('below'), initialHeight: 180 };
      case 'build-output':
        // Next to the console as a tab when it is docked, else under the grid.
        return docked('serial-console')
          ? { position: { referencePanel: 'serial-console', direction: 'within' } }
          : { ...beside('below'), initialHeight: 180 };
      case 'scope':
      case 'logic-analyzer': {
        // Like the Build output: a tab beside the console (or the other of these two) when it is docked, else under the grid.
        const neighbour = ['serial-console', id === 'scope' ? 'logic-analyzer' : 'scope', 'build-output'].find(docked);
        return neighbour
          ? { position: { referencePanel: neighbour, direction: 'within' } }
          : { ...beside('below'), initialHeight: 240 };
      }
      case 'code-editor':
        return docked('file-explorer')
          ? { position: { referencePanel: 'file-explorer', direction: 'below' } }
          : { ...beside('left'), initialWidth: 360 };
      default:
        return docked('code-editor')
          ? { position: { referencePanel: 'code-editor', direction: 'above' } }
          : { ...beside('left'), initialWidth: 240 };
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
 * True when a key press is aimed at a window other than the grid (a tab strip,
 * a floating window, a window's content), so grid shortcuts leave it alone.
 * Tab strips (the Circuit tab too) belong to dockview's own keys.
 */
export function isForOtherWindow(target: EventTarget | null, editorArea: HTMLElement): boolean {
  if (!(target instanceof Element) || !target.closest('.dv-shell, .dv-dockview')) return false;
  if (target.closest('.dv-tabs-and-actions-container')) return true;
  return !target.closest('.dv-groupview')?.contains(editorArea);
}
