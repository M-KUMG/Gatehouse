// The File explorer window: the source files and folders of one board, as a
// tree. Board dropdown on top ("Auto" follows the board selected on the
// grid, like the serial console), a small toolbar (new file, new folder,
// rename, delete) and the tree of the chosen board.
//
// All changes go through project/boardfiles.ts, which tells the project at
// once. This window then calls host.changed() so the undo history records
// the step (the app settles the history and redraws). It also listens to the
// project's change notification, so undo / redo, open, new and board edits
// elsewhere refresh the tree; expanded folders and the selection are kept
// while their paths still exist.
//
// Keys (while the tree has focus): arrows move and fold, Enter opens a file
// (or folds a folder), F2 renames, Delete deletes, Ctrl+Z / Ctrl+Y undo and
// redo the project. The tree is focusable, so key presses aimed at it never
// reach the grid shortcuts (see isForOtherWindow in dock.ts).
//
// Opening a file is announced through fileevents.ts; nothing shows it yet.

import './fileexplorer.css';
import {
  createBoardFile, createBoardFolder, deleteBoardPath, listBoardFiles, listBoards, renameBoardPath,
  type BoardInfo, type FileOpResult,
} from '../project/boardfiles';
import { ask, toast } from '../project/dialog';
import type { TreeEntry } from '../project/filetree';
import { ancestors, isInside } from '../project/paths';
import type { Project } from '../project/project';
import { emitOpenFile } from './fileevents';
import {
  ROOT, baseLength, checkNewName, checkRename, horizontalMove, isCodeFile, moveSelection, newItemParent, reconcile,
  remapPaths, selectionAfterDelete, visibleRows, type TreeRow,
} from './filerows';

export const FILE_EXPLORER_ID = 'file-explorer';

/** What the explorer needs from the app. */
export interface ExplorerHost {
  project: Project;
  /** Part id of the board "Auto" stands for (the board panel's board), or null. */
  autoBoard(): number | null;
  /** A change was made to the files: record it in the undo history and redraw. */
  changed(): void;
  undo(): void;
  redo(): void;
}

const AUTO = 'auto';
const INDENT = 12;

/** Per board, what survives refreshes and switching boards. */
interface ViewState {
  collapsed: Set<string>;
  selected: string | null;
}

interface EditBase {
  board: string;
  value: string;
  error: string | null;
}
interface NewEdit extends EditBase {
  mode: 'new';
  parent: string;
  folder: boolean;
}
interface RenameEdit extends EditBase {
  mode: 'rename';
  path: string;
}
type Edit = NewEdit | RenameEdit;

const svg = (body: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const FILE = '<path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/>';
const FOLDER = '<path d="M1.5 4h4l1.5 1.5h7.5v8h-13z"/>';
const ICONS = {
  file: svg(FILE),
  code: svg(`${FILE}<path d="M7 8.5 5.7 10 7 11.5M9 8.5l1.3 1.5L9 11.5"/>`),
  folder: svg(FOLDER),
  board: svg('<rect x="3.5" y="3.5" width="9" height="9" rx="1"/><path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2"/>'),
  chevron: svg('<path d="M6 4l4 4-4 4"/>'),
  newFile: svg(`${FILE}<path d="M8 8v4M6 10h4"/>`),
  newFolder: svg(`${FOLDER}<path d="M8 7.5v4M6 9.5h4"/>`),
  rename: svg('<path d="M3 13l.5-3L11 2.5 13.5 5 6 12.5z"/><path d="M9.5 4l2.5 2.5"/>'),
  trash: svg('<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5"/>'),
};

export class FileExplorer {
  /** The window's content; DockLayout adopts it whenever the window opens. */
  readonly element = document.createElement('div');
  private readonly boardSelect = document.createElement('select');
  private readonly newFileButton = toolButton('newFile', 'New file');
  private readonly newFolderButton = toolButton('newFolder', 'New folder');
  private readonly renameButton = toolButton('rename', 'Rename (F2)');
  private readonly deleteButton = toolButton('trash', 'Delete (Delete key)');
  private readonly tree = document.createElement('div');
  private readonly hint = document.createElement('div');

  /** AUTO or a boardId. */
  private choice = AUTO;
  private boardOptions = '';
  private boardId: string | null = null;
  private entries: TreeEntry[] = [];
  private rows: TreeRow[] = [];
  private signature = '';
  private readonly views = new Map<string, ViewState>();
  private edit: Edit | null = null;
  private input: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;
  private readonly rowEls = new Map<string, HTMLElement>();
  /** Focus the name input after the next render and select (part of) its text. */
  private focusEdit = false;
  /** True while the tree is rebuilt: blur events of removed inputs are not "the person left". */
  private rebuilding = false;
  /** True while a change made here is applied: the project notification is ignored, we refresh once afterwards. */
  private applying = false;
  private asking = false;
  /** False until the first update(): the board panel (Auto) may not exist yet before that. */
  private started = false;
  private lastAuto: number | null | undefined;

  constructor(private readonly host: ExplorerHost) {
    const el = this.element;
    el.className = 'file-explorer';

    const bar = document.createElement('div');
    bar.className = 'fx-bar';
    this.boardSelect.className = 'fx-select';
    this.boardSelect.title = 'Board whose files are shown';
    this.boardSelect.setAttribute('aria-label', 'Board');
    const field = document.createElement('label');
    field.className = 'fx-field';
    const caption = document.createElement('span');
    caption.textContent = 'Board';
    field.append(caption, this.boardSelect);
    bar.append(field);

    const toolbar = document.createElement('div');
    toolbar.className = 'fx-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.append(this.newFileButton, this.newFolderButton, this.renameButton, this.deleteButton);

    const body = document.createElement('div');
    body.className = 'fx-body';
    this.tree.className = 'fx-tree';
    this.tree.tabIndex = 0; // focusable, so key presses aim here and not at the grid
    this.tree.setAttribute('role', 'tree');
    this.tree.setAttribute('aria-label', 'Board files');
    this.hint.className = 'fx-hint';
    body.append(this.tree, this.hint);
    el.append(bar, toolbar, body);

    this.boardSelect.addEventListener('change', () => {
      this.choice = this.boardSelect.value;
      this.edit = null;
      this.refresh();
    });
    this.newFileButton.addEventListener('click', () => this.startNew(false));
    this.newFolderButton.addEventListener('click', () => this.startNew(true));
    this.renameButton.addEventListener('click', () => this.startRename());
    this.deleteButton.addEventListener('click', () => void this.deleteSelected());
    this.tree.addEventListener('mousedown', this.onMouseDown);
    this.tree.addEventListener('click', this.onClick);
    this.tree.addEventListener('dblclick', this.onDoubleClick);
    this.tree.addEventListener('keydown', this.onKey);

    host.project.onChange(() => {
      if (this.started && !this.applying) this.refresh();
    });
  }

  /** Call after every frame and when windows open or close. Cheap; refreshes when "Auto" points to another board. */
  update(): void {
    const auto = this.host.autoBoard();
    if (this.started && auto === this.lastAuto) return;
    this.started = true;
    this.lastAuto = auto;
    this.refresh();
  }

  // ---- model -> DOM ------------------------------------------------------

  /** Bring everything in line with the project; rebuilds the tree only when it changed. */
  private refresh(): void {
    const boards = listBoards(this.host.project);
    if (this.choice !== AUTO && !boards.some((b) => b.boardId === this.choice)) this.choice = AUTO;
    const info = this.resolveBoard(boards);
    this.updateBoardSelect(boards, info);

    const boardId = info?.boardId ?? null;
    const entries = boardId ? listBoardFiles(this.host.project, boardId) ?? [] : [];
    const signature = `${boardId}\n${entries.map((e) => `${e.kind}:${e.path}`).join('\n')}`;
    for (const id of [...this.views.keys()]) if (!boards.some((b) => b.boardId === id)) this.views.delete(id);
    if (signature === this.signature) return;

    this.signature = signature;
    this.boardId = boardId;
    this.entries = entries;
    const view = this.view();
    if (view) {
      const kept = reconcile(entries, view.collapsed, view.selected);
      view.collapsed = kept.collapsed;
      view.selected = kept.selected;
    }
    if (this.edit && !this.editStillValid(this.edit)) this.edit = null;
    this.render();
  }

  private editStillValid(edit: Edit): boolean {
    if (edit.board !== this.boardId) return false;
    const has = (path: string, kind: string): boolean => this.entries.some((e) => e.path === path && e.kind === kind);
    return edit.mode === 'rename' ? this.entries.some((e) => e.path === edit.path) : edit.parent === ROOT || has(edit.parent, 'folder');
  }

  /** The board to show: the fixed choice, else Auto's board, else the first board. */
  private resolveBoard(boards: readonly BoardInfo[]): BoardInfo | null {
    if (boards.length === 0) return null;
    if (this.choice !== AUTO) return boards.find((b) => b.boardId === this.choice) ?? null;
    const auto = this.host.autoBoard();
    return boards.find((b) => b.partId === auto) ?? boards[0];
  }

  private updateBoardSelect(boards: readonly BoardInfo[], info: BoardInfo | null): void {
    const sel = this.boardSelect;
    const signature = boards.map((b) => `${b.boardId}=${b.label}`).join('|');
    // Rebuild only when the list changes, so an open dropdown is not disturbed.
    if (signature !== this.boardOptions || sel.options.length === 0) {
      this.boardOptions = signature;
      sel.replaceChildren(option(AUTO, ''), ...boards.map((b) => option(b.boardId, b.label)));
    }
    const autoText = boards.length === 0 ? 'No board in the project' : this.choice === AUTO && info
      ? `Auto: selected board (${info.label})` : 'Auto: selected board';
    const auto = sel.options[0];
    if (auto.textContent !== autoText) auto.textContent = autoText;
    if (sel.value !== this.choice) sel.value = this.choice;
    sel.disabled = boards.length === 0;
  }

  private view(): ViewState | null {
    if (!this.boardId) return null;
    let v = this.views.get(this.boardId);
    if (!v) {
      v = { collapsed: new Set(), selected: null };
      this.views.set(this.boardId, v);
    }
    return v;
  }

  private render(): void {
    const view = this.view();
    const hadFocus = this.input !== null && document.activeElement === this.input;
    this.rebuilding = true;
    this.rowEls.clear();
    this.input = null;
    this.errorEl = null;
    this.rows = view && this.boardId ? visibleRows(this.entries, view.collapsed, `boards/${this.boardId}`) : [];
    const edit = this.edit;
    const nodes: HTMLElement[] = [];
    for (const row of this.rows) {
      const renaming = edit?.mode === 'rename' && edit.path === row.path ? edit : null;
      const el = this.buildRow(row, view?.selected === row.path, renaming);
      this.rowEls.set(row.path, el);
      nodes.push(el);
      if (renaming) nodes.push(this.buildErrorRow(row.depth, renaming));
      else if (edit?.mode === 'new' && edit.parent === row.path) {
        nodes.push(this.buildNewRow(row.depth + 1, edit), this.buildErrorRow(row.depth + 1, edit));
      }
    }
    this.tree.replaceChildren(...nodes);
    this.rebuilding = false;
    this.hint.textContent = 'No board in the project';
    this.hint.hidden = this.boardId !== null;
    this.updateToolbar();
    const input = this.currentInput(); // set by makeInput while the rows were built
    if (input && (hadFocus || this.focusEdit)) {
      input.focus();
      if (this.focusEdit && edit) {
        const folder = edit.mode === 'new' ? edit.folder : this.entries.some((e) => e.path === edit.path && e.kind === 'folder');
        input.setSelectionRange(0, edit.mode === 'rename' && !folder ? baseLength(input.value) : input.value.length);
      }
      this.focusEdit = false;
      input.scrollIntoView?.({ block: 'nearest' });
    }
  }

  private currentInput(): HTMLInputElement | null {
    return this.input;
  }

  private buildRow(row: TreeRow, selected: boolean, renaming: RenameEdit | null): HTMLElement {
    const d = document.createElement('div');
    d.className = 'fx-row';
    if (selected) d.classList.add('selected');
    d.setAttribute('role', 'treeitem');
    d.setAttribute('aria-level', String(row.depth + 1));
    d.setAttribute('aria-selected', String(selected));
    if (row.kind !== 'file') d.setAttribute('aria-expanded', String(row.expanded));
    d.dataset.path = row.path;
    d.style.paddingLeft = `${4 + row.depth * INDENT}px`;

    const twisty = document.createElement('span');
    twisty.className = 'fx-twisty';
    if (row.kind === 'folder') {
      twisty.innerHTML = ICONS.chevron;
      twisty.classList.add('toggle');
      if (row.expanded) twisty.classList.add('open');
    }
    const icon = document.createElement('span');
    icon.className = `fx-icon ${row.kind === 'file' ? (isCodeFile(row.name) ? 'code' : 'file') : row.kind}`;
    icon.innerHTML = row.kind === 'root' ? ICONS.board : row.kind === 'folder' ? ICONS.folder : isCodeFile(row.name) ? ICONS.code : ICONS.file;
    d.append(twisty, icon);

    if (renaming) {
      d.append(this.makeInput(renaming));
    } else {
      const name = document.createElement('span');
      name.className = 'fx-name';
      name.textContent = row.name;
      d.title = row.kind === 'root' ? `Source files of this board (${row.name})` : row.path;
      d.append(name);
    }
    return d;
  }

  /** The row where a new item's name is typed (first child of the folder it goes in). */
  private buildNewRow(depth: number, edit: NewEdit): HTMLElement {
    const d = document.createElement('div');
    d.className = 'fx-row editing';
    d.style.paddingLeft = `${4 + depth * INDENT}px`;
    const spacer = document.createElement('span');
    spacer.className = 'fx-twisty';
    const icon = document.createElement('span');
    icon.className = `fx-icon ${edit.folder ? 'folder' : 'file'}`;
    icon.innerHTML = edit.folder ? ICONS.folder : ICONS.file;
    d.append(spacer, icon, this.makeInput(edit));
    return d;
  }

  private buildErrorRow(depth: number, edit: Edit): HTMLElement {
    const d = document.createElement('div');
    d.className = 'fx-error';
    d.setAttribute('role', 'alert');
    d.style.paddingLeft = `${4 + (depth + 1) * INDENT + 20}px`;
    d.textContent = edit.error ?? '';
    d.hidden = edit.error === null;
    this.errorEl = d;
    return d;
  }

  private makeInput(edit: Edit): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'fx-input';
    input.value = edit.value;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', edit.mode === 'rename' ? 'New name' : edit.folder ? 'Folder name' : 'File name');
    if (edit.mode === 'new') input.placeholder = edit.folder ? 'Folder name' : 'File name (lib/led.h makes the folder too)';
    input.addEventListener('input', () => {
      edit.value = input.value;
      if (edit.error !== null) this.setError(null);
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing belongs to the field, not to the tree or the grid
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelEdit();
      }
    });
    input.addEventListener('blur', () => {
      // Leaving the field cancels, like Escape.
      if (this.rebuilding || this.edit !== edit) return;
      this.edit = null;
      this.render();
    });
    this.input = input;
    return input;
  }

  private setError(message: string | null): void {
    if (this.edit) this.edit.error = message;
    if (this.errorEl) {
      this.errorEl.textContent = message ?? '';
      this.errorEl.hidden = message === null;
    }
    if (this.input) this.input.setAttribute('aria-invalid', String(message !== null));
  }

  private updateToolbar(): void {
    const has = this.boardId !== null;
    const selected = this.view()?.selected ?? null;
    this.newFileButton.disabled = !has;
    this.newFolderButton.disabled = !has;
    this.renameButton.disabled = !has || selected === null || selected === ROOT;
    this.deleteButton.disabled = this.renameButton.disabled;
  }

  // ---- selection and folding -----------------------------------------------

  private select(path: string | null): void {
    const view = this.view();
    if (!view) return;
    view.selected = path;
    for (const [p, el] of this.rowEls) {
      const on = p === path;
      el.classList.toggle('selected', on);
      el.setAttribute('aria-selected', String(on));
    }
    this.updateToolbar();
    if (path !== null) this.rowEls.get(path)?.scrollIntoView?.({ block: 'nearest' });
  }

  private setExpanded(path: string, expanded: boolean): void {
    const view = this.view();
    if (!view) return;
    if (expanded) view.collapsed.delete(path);
    else {
      view.collapsed.add(path);
      if (view.selected !== null && isInside(view.selected, path)) view.selected = path; // do not hide the selection
    }
    this.render();
  }

  private rowAt(target: EventTarget | null): TreeRow | null {
    if (!(target instanceof Element)) return null;
    const el = target.closest<HTMLElement>('.fx-row');
    if (!el || el.classList.contains('editing') || target.closest('.fx-input')) return null;
    return this.rows.find((r) => r.path === el.dataset.path) ?? null;
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('.fx-input'))) return;
    const row = this.rowAt(e.target);
    this.select(row ? row.path : null); // empty space clears the selection
  };

  private onClick = (e: MouseEvent): void => {
    const row = this.rowAt(e.target);
    if (row?.kind === 'folder' && e.target instanceof Element && e.target.closest('.fx-twisty')) this.setExpanded(row.path, !row.expanded);
  };

  private onDoubleClick = (e: MouseEvent): void => {
    const row = this.rowAt(e.target);
    if (row) this.activate(row);
  };

  /** Enter or double-click: open a file, fold or unfold a folder. */
  private activate(row: TreeRow): void {
    if (row.kind === 'file' && this.boardId) emitOpenFile(this.boardId, row.path);
    else if (row.kind === 'folder') this.setExpanded(row.path, !row.expanded);
  }

  // ---- keyboard --------------------------------------------------------------

  private onKey = (e: KeyboardEvent): void => {
    if (e.target !== this.tree) return;
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      const redo = !e.altKey && (key === 'y' || (key === 'z' && e.shiftKey));
      const undo = !e.altKey && key === 'z' && !e.shiftKey;
      if (undo || redo) {
        e.preventDefault();
        if (undo) this.host.undo();
        else this.host.redo();
      }
      return;
    }
    if (e.altKey) return;
    const view = this.view();
    const selected = view?.selected ?? null;
    const row = this.rows.find((r) => r.path === selected) ?? null;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        this.select(moveSelection(this.rows, selected, e.key === 'ArrowDown' ? 1 : -1));
        break;
      case 'Home':
      case 'End':
        e.preventDefault();
        this.select(moveSelection(this.rows, null, e.key === 'Home' ? 1 : -1));
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const move = horizontalMove(this.rows, selected, e.key === 'ArrowLeft' ? 'left' : 'right');
        if (move?.kind === 'select') this.select(move.path);
        else if (move) this.setExpanded(move.path, move.kind === 'expand');
        break;
      }
      case 'Enter':
        e.preventDefault();
        if (row) this.activate(row);
        break;
      case 'F2':
        e.preventDefault();
        this.startRename();
        break;
      case 'Delete':
        e.preventDefault();
        void this.deleteSelected();
        break;
    }
  };

  // ---- changes -----------------------------------------------------------------

  private startNew(folder: boolean): void {
    const view = this.view();
    if (!view || !this.boardId) return;
    const parent = newItemParent(this.rows, view.selected);
    // Make the new row visible: the folder and every folder above it unfold.
    for (const p of [...ancestors(parent), parent]) view.collapsed.delete(p);
    this.edit = { mode: 'new', board: this.boardId, parent, folder, value: '', error: null };
    this.focusEdit = true;
    this.render();
  }

  private startRename(): void {
    const view = this.view();
    const row = this.rows.find((r) => r.path === view?.selected);
    if (!view || !this.boardId || !row || row.kind === 'root') return;
    this.edit = { mode: 'rename', board: this.boardId, path: row.path, value: row.name, error: null };
    this.focusEdit = true;
    this.render();
  }

  private cancelEdit(): void {
    if (!this.edit) return;
    this.edit = null;
    this.render();
    this.tree.focus();
  }

  private commit(): void {
    const edit = this.edit;
    const boardId = this.boardId;
    const view = this.view();
    if (!edit || !boardId || !view) return;
    const project = this.host.project;

    if (edit.mode === 'new') {
      const named = checkNewName(edit.parent, edit.value);
      if (!named.ok) return this.setError(named.error);
      const result = this.apply(() => (edit.folder ? createBoardFolder(project, boardId, named.path) : createBoardFile(project, boardId, named.path)));
      if (!result.ok) return this.setError(result.error);
      for (const p of [...ancestors(named.path), edit.parent]) view.collapsed.delete(p);
      this.finish(view, named.path);
      return;
    }

    const named = checkRename(edit.path, edit.value);
    if (!named.ok) return this.setError(named.error);
    if (named.unchanged) return this.cancelEdit();
    const result = this.apply(() => renameBoardPath(project, boardId, edit.path, named.path));
    if (!result.ok) return this.setError(result.error);
    view.collapsed = remapPaths(view.collapsed, edit.path, named.path);
    this.finish(view, named.path);
  }

  private async deleteSelected(): Promise<void> {
    const boardId = this.boardId;
    const view = this.view();
    const path = view?.selected;
    const entry = this.entries.find((e) => e.path === path);
    if (this.asking || !boardId || !view || !path || !entry) return;
    const what = entry.kind === 'folder'
      ? `Delete the folder "${path}" and everything in it?`
      : `Delete the file "${path}"?`;
    this.asking = true;
    const yes = await ask(entry.kind === 'folder' ? 'Delete folder' : 'Delete file', `${what} You can undo this with Ctrl+Z.`, [
      { label: 'Cancel', value: false },
      { label: 'Delete', value: true, primary: true },
    ], false);
    this.asking = false;
    if (!yes) {
      this.tree.focus();
      return;
    }
    if (this.boardId !== boardId) return; // the board went away while asking
    const next = selectionAfterDelete(this.rows, path);
    const result = this.apply(() => deleteBoardPath(this.host.project, boardId, path));
    if (!result.ok) {
      toast(result.error, 'error');
      this.tree.focus();
      return;
    }
    this.finish(view, next);
  }

  /** Run a change of the files; the project notification is held back until finish(). */
  private apply(op: () => FileOpResult): FileOpResult {
    this.applying = true;
    try {
      return op();
    } finally {
      this.applying = false;
    }
  }

  /** After a successful change: select `path`, let the app record the step, show the new tree. */
  private finish(view: ViewState, path: string): void {
    this.edit = null;
    view.selected = path;
    this.host.changed();
    this.signature = ''; // force the rebuild
    this.refresh();
    this.tree.focus();
  }
}

function option(value: string, text: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

function toolButton(icon: keyof typeof ICONS, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fx-button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = ICONS[icon];
  return b;
}
