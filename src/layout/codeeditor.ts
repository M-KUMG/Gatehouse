// The Code editor window: one tab per open board file and a CodeMirror
// editor for the one in front. CodeMirror (editorcm.ts) is loaded lazily the
// first time a file opens.
//
// Saving: there is no Save button. Edits are written to the project's files
// in memory (boardfiles.ts) 300 ms after the last keystroke, at once when
// the tab changes or closes, when focus leaves the window or the window
// loses focus, and before the page unloads. A write is followed by
// host.changed() (the app settles the undo history and redraws); writes
// close together fold into one undo step there. Nothing is written when the
// text did not change.
//
// Sync: the project's change notification keeps every open file in step with
// the tree. Each open file remembers the text the tree had when we last read
// or wrote it ("synced"). A change whose tree text equals it is an echo of
// our own write or unrelated (circuit edits), and is ignored; a different
// text came from outside (undo / redo, open, new), so the editor's document
// is replaced by only the differing part (the cursor stays) and any pending
// write is dropped. A file that vanished follows a rename (same text under a
// new path, see findMoved) or its tab closes.
//
// gatehouse.json: the project's generated file opens as a read-only tab (a
// lock on the tab, no caret, text can be selected and copied). Its text comes
// from manifestText() and is refreshed (debounced, scroll and selection stay)
// when the project changes; it is never written back. It is not a board file,
// so the sync above leaves it alone.
//
// Keys: the editor is contenteditable, so the grid shortcuts ignore it and
// CodeMirror's own undo / redo and search keys work. Open tabs are session
// state; they are not saved in the project.

import './codeeditor.css';
import { boardTree, listBoards, readBoardFile, writeBoardFile, type FileOpResult } from '../project/boardfiles';
import { toast } from '../project/dialog';
import type { ReadResult } from '../project/filetree';
import { manifestText } from '../project/manifestfile';
import type { Project } from '../project/project';
import type { CodeSurface } from './editorcm';
import { fileName, languageFor } from './editorlang';
import { findMoved, normalizeEol } from './editorsync';
import {
  MANIFEST_TAB, NO_TABS, READ_ONLY_NOTE, activateTab, closeTab, isVirtualTab, moveTab, openMode, openTab, pruneTabs, sameTab, tabLabels,
  type TabFile, type TabLabel, type TabsState,
} from './editortabs';
import type { OpenFileOptions } from './fileevents';

export const CODE_EDITOR_ID = 'code-editor';

/** Wait this long after the last keystroke before writing to the project. */
export const SAVE_DELAY_MS = 300;
/** Wait this long after the project changed before the generated gatehouse.json is rebuilt. */
export const MANIFEST_REFRESH_MS = 250;

/** What the editor needs from the app. */
export interface CodeEditorHost {
  project: Project;
  /** Show the Code editor window: open it when closed, else bring it to the front. */
  show(): void;
  /** A change was made to the files: record it in the undo history and redraw. */
  changed(): void;
}

/** An open file: its tab plus what the editor and the project's tree agree on. */
interface OpenFile {
  id: number;
  file: TabFile;
  /** Text of the file in the tree as last read or written by us. */
  synced: string;
  /** The user typed since the last write. */
  edited: boolean;
  timer: number;
  /** A generated file: never edited, never written. */
  readOnly: boolean;
}

const key = (f: TabFile): string => `${f.boardId}\n${f.path}`;

const LOCK_ICON =
  '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5.5" width="7" height="5" rx="1"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5"/></svg>';

const CLOSE_ICON =
  '<svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>';

export class CodeEditor {
  /** The window's content; DockLayout adopts it whenever the window opens. */
  readonly element = document.createElement('div');
  private readonly strip = document.createElement('div');
  private readonly note = document.createElement('div');
  private readonly surfaceEl = document.createElement('div');
  private readonly empty = document.createElement('div');

  private tabs: TabsState = NO_TABS;
  private readonly files = new Map<string, OpenFile>();
  private readonly byId = new Map<number, OpenFile>();
  private nextId = 1;
  /** Paths of each board with open files, as of the last sync (to recognise renames). */
  private known = new Map<string, Set<string>>();
  private surface: CodeSurface | null = null;
  private loading: Promise<CodeSurface> | null = null;
  /** True while we write: the notification that comes back is our own. */
  private writing = false;
  private stripSignature = '';
  private manifestTimer = 0;
  /** Focus the editor once the tab in front is shown. */
  private wantFocus = false;

  constructor(private readonly host: CodeEditorHost) {
    const el = this.element;
    el.className = 'code-editor';

    this.strip.className = 'ce-tabs';
    this.strip.setAttribute('role', 'tablist');
    this.strip.setAttribute('aria-label', 'Open files');
    const body = document.createElement('div');
    body.className = 'ce-body';
    this.note.className = 'ce-note';
    this.note.innerHTML = `<span class="ce-note-icon">${LOCK_ICON}</span>`;
    this.note.append(READ_ONLY_NOTE);
    this.note.hidden = true;
    this.surfaceEl.className = 'ce-surface';
    this.empty.className = 'ce-empty';
    this.empty.textContent = 'Open a file from the File explorer';
    body.append(this.surfaceEl, this.empty);
    el.append(this.strip, this.note, body);
    this.renderStrip();
    this.showFront();

    this.strip.addEventListener('click', this.onStripClick);
    this.strip.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault(); // no autoscroll cursor on a middle click
    });
    this.strip.addEventListener('auxclick', this.onStripAux);
    this.strip.addEventListener('keydown', this.onStripKey);
    el.addEventListener('focusout', this.flushAll);
    // Saving or opening a project (Ctrl+S / Ctrl+O, handled on the window after this) must see the latest typing.
    el.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'o')) this.flushAll();
    });
    window.addEventListener('blur', this.flushAll);
    window.addEventListener('pagehide', this.flushAll);
    window.addEventListener('beforeunload', this.flushAll);
    new ResizeObserver(() => this.surface?.measure()).observe(body);

    host.project.onChange(this.onProjectChange);
  }

  // ---- opening and closing ---------------------------------------------------

  /** Open a file in the front tab (from the File explorer). */
  open(boardId: string, path: string, options: OpenFileOptions = {}): void {
    const file: TabFile = { boardId, path };
    const mode = openMode(file);
    if (mode === 'refuse') {
      toast(`"${fileName(path)}" cannot be edited here.`);
      return;
    }
    const read = this.readFile(file);
    if (!read.ok) {
      toast(read.error, 'error');
      return;
    }
    const before = document.activeElement;
    this.host.show();
    // Showing a window may move the focus to it; a single click should leave it in the explorer.
    if (!options.focus && before instanceof HTMLElement && before.isConnected && document.activeElement !== before) {
      before.focus({ preventScroll: true });
    }
    if (!this.files.has(key(file))) {
      const open: OpenFile = { id: this.nextId++, file, synced: read.content, edited: false, timer: 0, readOnly: mode === 'read-only' };
      this.files.set(key(file), open);
      this.byId.set(open.id, open);
      if (!isVirtualTab(file)) this.takeSnapshot(boardId);
    }
    this.setTabs(openTab(this.tabs, file), options.focus === true);
  }

  /** The text of a tab's file: from the board's tree, or generated for gatehouse.json. */
  private readFile(file: TabFile): ReadResult {
    return isVirtualTab(file) ? { ok: true, content: manifestText(this.host.project) } : readBoardFile(this.host.project, file.boardId, file.path);
  }

  private closeFile(file: TabFile): void {
    this.setTabs(closeTab(this.tabs, file), false); // writes what is pending first
    this.forget(file);
  }

  /** Drop what the editor holds for a file that is no longer open. */
  private forget(file: TabFile): void {
    const open = this.files.get(key(file));
    if (!open) return;
    window.clearTimeout(open.timer);
    this.surface?.drop(open.id);
    this.byId.delete(open.id);
    this.files.delete(key(file));
  }

  /** Switch to a new tab state: write what is pending, redraw the strip, show the front file. */
  private setTabs(next: TabsState, focus: boolean): void {
    this.flushAll();
    this.tabs = next;
    this.wantFocus = focus;
    this.renderStrip();
    this.showFront();
  }

  // ---- showing the file in front --------------------------------------------------

  private showFront(): void {
    const front = this.tabs.active;
    this.empty.hidden = front !== null;
    this.surfaceEl.hidden = front === null;
    this.note.hidden = !(front && this.files.get(key(front))?.readOnly);
    if (!front) return;
    void this.load().then((surface) => {
      // The front tab may have changed while CodeMirror was loading.
      const now = this.tabs.active;
      const open = now ? this.files.get(key(now)) : undefined;
      if (!open) return;
      if (!surface.has(open.id)) {
        const read = this.readFile(open.file);
        if (!read.ok) return;
        open.synced = read.content;
        surface.open(open.id, normalizeEol(read.content), languageFor(open.file.path), open.readOnly);
      } else if (open.readOnly) {
        this.refreshManifest(); // the circuit may have changed (or the camera moved) while another tab was in front
      }
      surface.show(open.id);
      surface.measure();
      if (this.wantFocus) surface.focus();
      this.wantFocus = false;
    }, (error: unknown) => {
      toast(`Could not load the code editor: ${error instanceof Error ? error.message : String(error)}`, 'error');
    });
  }

  /** CodeMirror, loaded on first use. */
  private load(): Promise<CodeSurface> {
    if (this.surface) return Promise.resolve(this.surface);
    this.loading ??= import('./editorcm').then(
      (m) => {
        this.surface = m.createSurface(this.surfaceEl, (id) => this.onEdit(id));
        return this.surface;
      },
      (error: unknown) => {
        this.loading = null; // try again next time
        throw error;
      },
    );
    return this.loading;
  }

  // ---- saving ----------------------------------------------------------------

  private onEdit(id: number): void {
    const open = this.byId.get(id);
    if (!open || open.readOnly) return;
    open.edited = true;
    window.clearTimeout(open.timer);
    open.timer = window.setTimeout(() => this.flushFile(open), SAVE_DELAY_MS);
  }

  private flushAll = (): void => {
    for (const open of this.files.values()) this.flushFile(open);
  };

  /** Write the file's text into the project if the user changed it. */
  private flushFile(open: OpenFile): void {
    window.clearTimeout(open.timer);
    open.timer = 0;
    if (open.readOnly || !open.edited || !this.surface?.has(open.id)) return;
    open.edited = false;
    const text = this.surface.text(open.id);
    if (text === normalizeEol(open.synced)) return; // nothing changed (typed and undone)
    this.writing = true;
    let result: FileOpResult;
    try {
      result = writeBoardFile(this.host.project, open.file.boardId, open.file.path, text);
    } finally {
      this.writing = false;
    }
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    open.synced = text;
    this.host.changed();
  }

  // ---- following the project ---------------------------------------------------

  private onProjectChange = (): void => {
    this.scheduleManifestRefresh();
    if (this.writing || this.files.size === 0) return;
    const project = this.host.project;
    let state = this.tabs;
    const claimed = new Map<string, Set<string>>(); // per board: paths a renamed file moved to
    for (const open of [...this.files.values()]) {
      const old = open.file;
      if (open.readOnly) continue; // generated, not in any board's tree
      const read = readBoardFile(project, old.boardId, old.path);
      if (read.ok) {
        this.applyFromProject(open, read.content);
        continue;
      }
      // Gone from the tree: renamed (then the same text is under a new path), or deleted.
      const tree = boardTree(project, old.boardId);
      const before = this.known.get(old.boardId);
      const taken = claimed.get(old.boardId) ?? new Set<string>();
      const target = tree && before ? findMoved(old.path, open.synced, before, tree.files, taken) : null;
      if (target) {
        claimed.set(old.boardId, taken.add(target));
        state = moveTab(state, old, target);
        // The same document under the new name: cursor, history and unsaved typing stay.
        this.files.delete(key(old));
        open.file = { boardId: old.boardId, path: target };
        this.files.set(key(open.file), open);
        if (languageFor(old.path) !== languageFor(target)) {
          this.surface?.drop(open.id); // shown again with the new highlighting
          open.edited = false;
        }
      } else {
        state = pruneTabs(state, (t) => !sameTab(t, old));
        this.forget(old);
      }
    }
    const boards = new Set([...this.files.values()].filter((o) => !o.readOnly).map((o) => o.file.boardId));
    for (const boardId of boards) this.takeSnapshot(boardId);
    for (const boardId of [...this.known.keys()]) if (!boards.has(boardId)) this.known.delete(boardId);
    if (state !== this.tabs) {
      this.tabs = state;
      this.renderStrip();
      this.showFront();
    } else {
      this.renderStrip(); // board labels may have changed
    }
  };

  /** Rebuild the open gatehouse.json a moment after the project changed (a burst of changes makes one rebuild). */
  private scheduleManifestRefresh(): void {
    if (!this.files.has(key(MANIFEST_TAB))) return;
    window.clearTimeout(this.manifestTimer);
    this.manifestTimer = window.setTimeout(() => this.refreshManifest(), MANIFEST_REFRESH_MS);
  }

  /** Put the current generated text into the open gatehouse.json; only the changed part is replaced, so scroll and selection stay. */
  private refreshManifest(): void {
    window.clearTimeout(this.manifestTimer);
    const open = this.files.get(key(MANIFEST_TAB));
    if (!open) return;
    const text = manifestText(this.host.project);
    if (text === open.synced) return;
    open.synced = text;
    this.surface?.replace(open.id, normalizeEol(text));
  }

  /** The tree holds `text` for this file now. Take it over unless it is what we know already. */
  private applyFromProject(open: OpenFile, text: string): void {
    if (text === open.synced) return; // our own write coming back, or an unrelated change
    open.synced = text;
    open.edited = false;
    window.clearTimeout(open.timer);
    open.timer = 0;
    this.surface?.replace(open.id, normalizeEol(text));
  }

  private takeSnapshot(boardId: string): void {
    const tree = boardTree(this.host.project, boardId);
    if (tree) this.known.set(boardId, new Set(Object.keys(tree.files)));
    else this.known.delete(boardId);
  }

  // ---- the tab strip -------------------------------------------------------------

  private renderStrip(): void {
    const labels = this.labels();
    const signature = labels
      .map((l) => `${l.tab.boardId}\n${l.tab.path}\n${l.board ?? ''}\n${l.title}\n${this.tabs.active && sameTab(l.tab, this.tabs.active) ? 1 : 0}`)
      .join('\u0001');
    if (signature === this.stripSignature) return;
    this.stripSignature = signature;
    const nodes = labels.map((l) => this.buildTab(l, this.tabs.active !== null && sameTab(l.tab, this.tabs.active)));
    this.strip.replaceChildren(...nodes);
    this.strip.querySelector('.ce-tab.active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  private labels(): TabLabel[] {
    const names = new Map(listBoards(this.host.project).map((b) => [b.boardId, b.labelWithId]));
    return tabLabels(this.tabs.tabs, (id) => names.get(id) ?? id);
  }

  private buildTab(label: TabLabel, active: boolean): HTMLElement {
    const tab = document.createElement('div');
    tab.className = active ? 'ce-tab active' : 'ce-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = 0;
    tab.title = label.title;
    tab.dataset.board = label.tab.boardId;
    tab.dataset.path = label.tab.path;
    const name = document.createElement('span');
    name.className = 'ce-tab-name';
    name.textContent = label.name;
    if (label.readOnly) {
      const lock = document.createElement('span');
      lock.className = 'ce-tab-lock';
      lock.innerHTML = LOCK_ICON;
      tab.classList.add('readonly');
      tab.append(lock);
    }
    tab.append(name);
    if (label.board) {
      const board = document.createElement('span');
      board.className = 'ce-tab-board';
      board.textContent = label.board;
      tab.append(board);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ce-tab-close';
    close.tabIndex = -1;
    close.title = 'Close';
    close.setAttribute('aria-label', `Close ${label.name}`);
    close.innerHTML = CLOSE_ICON;
    tab.append(close);
    return tab;
  }

  private tabOf(target: EventTarget | null): TabFile | null {
    if (!(target instanceof Element)) return null;
    const el = target.closest<HTMLElement>('.ce-tab');
    const board = el?.dataset.board;
    const path = el?.dataset.path;
    return board !== undefined && path !== undefined ? { boardId: board, path } : null;
  }

  private onStripClick = (e: MouseEvent): void => {
    const tab = this.tabOf(e.target);
    if (!tab || e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest('.ce-tab-close')) this.closeFile(tab);
    else this.setTabs(activateTab(this.tabs, tab), true);
  };

  private onStripAux = (e: MouseEvent): void => {
    const tab = this.tabOf(e.target);
    if (tab && e.button === 1) {
      e.preventDefault();
      this.closeFile(tab);
    }
  };

  private onStripKey = (e: KeyboardEvent): void => {
    const tab = this.tabOf(e.target);
    if (!tab || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.setTabs(activateTab(this.tabs, tab), true);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      this.closeFile(tab);
    }
  };
}
