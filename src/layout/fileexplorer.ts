// The File explorer window: the whole project as a tree. The root row is the
// project (named after its file), then gatehouse.json (generated from the
// circuit, shown read only in the Code editor), then the `boards` folder with
// one folder per board on the grid, each with that board's files and
// subfolders. The board the rest of the app follows (selected on the grid,
// else the last one) is highlighted; it is never the only board shown.
//
// What can change: inside a board folder files and folders can be created,
// renamed, deleted and imported (importfiles.ts, fileimport.ts). The project
// row, gatehouse.json, `boards` and the board folders themselves cannot (a
// board folder lives and dies with its board part; see projectrows.ts for
// what each kind of row allows). New file / new folder with one of those
// selected goes into the active board's folder.
//
// All changes go through project/boardfiles.ts, which tells the project at
// once. This window then calls host.changed() so the undo history records
// the step (the app settles the history and redraws). It also listens to the
// project's change notification, so undo / redo, open, new and board edits
// elsewhere refresh the tree; folded rows and the selection are kept while
// their paths still exist.
//
// Keys (while the tree has focus): arrows move and fold, Enter opens a file
// (or folds a folder), F2 renames, Delete deletes, Ctrl+Z / Ctrl+Y undo and
// redo the project. The tree is focusable, so key presses aimed at it never
// reach the grid shortcuts (see isForOtherWindow in dock.ts). When the Code
// editor has focus instead, its own undo / redo applies, not these.
//
// Opening a file is announced through fileevents.ts and shown by the Code
// editor: a single click on a file opens it (the focus stays in the tree, so
// the arrow keys keep browsing); Enter and double-click also move the focus
// into the editor. A folder click only selects (the arrow toggles it).
//
// A click on a board's row, or on a file or folder inside its folder, also
// selects that board on the grid and pans it into view (host.showBoard); the
// arrow (fold), keys and the project, gatehouse.json and boards rows leave
// the grid alone. The explorer only reads the result back through autoBoard().
//
// Files dragged in from the desktop are imported into the board folder or
// folder under the pointer; the Import button does the same into the
// selected folder (or the file's folder, or the active board's folder).

import './fileexplorer.css';
import {
  createBoardFile, createBoardFolder, deleteBoardPath, listBoardFiles, listBoards, renameBoardPath, type BoardInfo,
} from '../project/boardfiles';
import { ask, toast } from '../project/dialog';
import { ancestors, isInside } from '../project/paths';
import type { Project } from '../project/project';
import { ICONS, type IconName } from './explorericons';
import { emitOpenFile } from './fileevents';
import { baseLength, checkNewName, checkRename, isCodeFile, remapPaths } from './filerows';
import { createFilePicker, filesFromDrop, importFiles, type ImportRequest } from './fileimport';
import { dropTarget, importTarget, type ImportTarget } from './importfiles';
import { MANIFEST_TAB, READ_ONLY_NOTE } from './editortabs';
import {
  PROJECT_ROOT, horizontalMove, isFoldable, lockReason, moveSelection, newItemTarget, projectNodes, reconcile,
  resolveActiveBoard, rowId, rowOps, selectionAfterDelete, visibleRows, type NewTarget, type ProjectNode, type ProjectRow,
} from './projectrows';

export const FILE_EXPLORER_ID = 'file-explorer';

/** What the explorer needs from the app. */
export interface ExplorerHost {
  project: Project;
  /** Part id of the board the rest of the app follows (the active board: selected on the grid, else the last one), or null. */
  autoBoard(): number | null;
  /** A board row (or something in a board's folder) was clicked: select that board part on the grid and bring it into view. */
  showBoard(partId: number): void;
  /** A change was made to the files: record it in the undo history and redraw. */
  changed(): void;
  undo(): void;
  redo(): void;
}

const INDENT = 12;
const NO_BOARD = 'add an Arduino board to the grid first';

interface EditBase {
  value: string;
  error: string | null;
}
interface NewEdit extends EditBase {
  mode: 'new';
  target: NewTarget;
  folder: boolean;
}
interface RenameEdit extends EditBase {
  mode: 'rename';
  /** Row id, board and path inside the board. */
  id: string;
  boardId: string;
  path: string;
}
type Edit = NewEdit | RenameEdit;

export class FileExplorer {
  /** The window's content; DockLayout adopts it whenever the window opens. */
  readonly element = document.createElement('div');
  private readonly newFileButton = toolButton('newFile', 'New file');
  private readonly newFolderButton = toolButton('newFolder', 'New folder');
  private readonly importButton = toolButton('import', 'Import files');
  private readonly renameButton = toolButton('rename', 'Rename (F2)');
  private readonly deleteButton = toolButton('trash', 'Delete (Delete key)');
  private readonly tree = document.createElement('div');
  private readonly picker = createFilePicker((files) => void this.runImport({ files, target: this.pendingTarget ?? this.fallbackTarget() }));

  private boards: BoardInfo[] = [];
  private activeBoardId: string | null = null;
  private nodes: ProjectNode[] = [];
  private rows: ProjectRow[] = [];
  private signature = '';
  private collapsed = new Set<string>();
  private selected: string | null = null;
  private edit: Edit | null = null;
  private input: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;
  private readonly rowEls = new Map<string, HTMLElement>();
  /** Row ids showing the drop highlight while files are dragged over. */
  private dropIds: string[] = [];
  /** Where the files of the open file picker go. */
  private pendingTarget: ImportTarget | null = null;
  /** Focus the name input after the next render and select (part of) its text. */
  private focusEdit = false;
  /** True while the tree is rebuilt: blur events of removed inputs are not "the person left". */
  private rebuilding = false;
  /** True while a change made here is applied: the project notification is ignored, we refresh once afterwards. */
  private applying = false;
  private asking = false;
  /** False until the first update(): the active board may not exist yet before that. */
  private started = false;
  private lastAuto: number | null | undefined;

  constructor(private readonly host: ExplorerHost) {
    const el = this.element;
    el.className = 'file-explorer';

    const toolbar = document.createElement('div');
    toolbar.className = 'fx-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.append(this.newFileButton, this.newFolderButton, this.importButton, this.renameButton, this.deleteButton, this.picker.element);

    const body = document.createElement('div');
    body.className = 'fx-body';
    this.tree.className = 'fx-tree';
    this.tree.tabIndex = 0; // focusable, so key presses aim here and not at the grid
    this.tree.setAttribute('role', 'tree');
    this.tree.setAttribute('aria-label', 'Project files');
    body.append(this.tree);
    el.append(toolbar, body);

    this.newFileButton.addEventListener('click', () => this.startNew(false));
    this.newFolderButton.addEventListener('click', () => this.startNew(true));
    this.importButton.addEventListener('click', () => this.chooseFiles());
    this.renameButton.addEventListener('click', () => this.startRename());
    this.deleteButton.addEventListener('click', () => void this.deleteSelected());
    this.tree.addEventListener('mousedown', this.onMouseDown);
    this.tree.addEventListener('click', this.onClick);
    this.tree.addEventListener('dblclick', this.onDoubleClick);
    this.tree.addEventListener('keydown', this.onKey);
    this.tree.addEventListener('dragenter', this.onDragOver);
    this.tree.addEventListener('dragover', this.onDragOver);
    this.tree.addEventListener('dragleave', this.onDragLeave);
    this.tree.addEventListener('drop', this.onDrop);

    host.project.onChange(() => {
      if (this.started && !this.applying) this.refresh();
    });
  }

  /** Call after every frame and when windows open or close. Cheap; refreshes when the active board changes. */
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
    const project = this.host.project;
    const boards = listBoards(project);
    const active = resolveActiveBoard(boards, this.host.autoBoard());
    const nodes = projectNodes(
      project.name,
      boards.map((b) => ({ boardId: b.boardId, label: b.label, entries: listBoardFiles(project, b.boardId) ?? [] })),
    );
    const signature = `${active}\n${nodes.map((n) => `${n.kind}:${n.id}:${n.name}`).join('\n')}`;
    this.boards = boards;
    this.activeBoardId = active;
    if (signature === this.signature) return;

    this.signature = signature;
    this.nodes = nodes;
    const kept = reconcile(nodes, this.collapsed, this.selected);
    this.collapsed = kept.collapsed;
    this.selected = kept.selected;
    if (this.edit && !this.editStillValid(this.edit)) this.edit = null;
    this.render();
  }

  private editStillValid(edit: Edit): boolean {
    const has = (id: string, folder: boolean): boolean => this.nodes.some((n) => n.id === id && (!folder || n.kind === 'folder' || n.kind === 'board'));
    return edit.mode === 'rename' ? has(edit.id, false) : has(edit.target.parentId, true);
  }

  private labelOf(boardId: string): string {
    return this.boards.find((b) => b.boardId === boardId)?.label ?? boardId;
  }

  private selectedRow(): ProjectRow | null {
    return this.rows.find((r) => r.id === this.selected) ?? null;
  }

  private render(): void {
    const hadFocus = this.input !== null && document.activeElement === this.input;
    this.rebuilding = true;
    this.rowEls.clear();
    this.dropIds = [];
    this.input = null;
    this.errorEl = null;
    this.rows = visibleRows(this.nodes, this.collapsed, this.activeBoardId);
    const edit = this.edit;
    const nodes: HTMLElement[] = [];
    for (const row of this.rows) {
      const renaming = edit?.mode === 'rename' && edit.id === row.id ? edit : null;
      const el = this.buildRow(row, this.selected === row.id, renaming);
      this.rowEls.set(row.id, el);
      nodes.push(el);
      if (renaming) nodes.push(this.buildErrorRow(row.depth, renaming));
      else if (edit?.mode === 'new' && edit.target.parentId === row.id) {
        nodes.push(this.buildNewRow(row.depth + 1, edit), this.buildErrorRow(row.depth + 1, edit));
      }
      if (row.kind === 'boards' && row.expanded && this.boards.length === 0) nodes.push(this.buildNote(row.depth + 1));
    }
    this.tree.replaceChildren(...nodes);
    this.rebuilding = false;
    this.updateToolbar();
    const input = this.input as HTMLInputElement | null; // set by makeInput while the rows were built
    if (input && (hadFocus || this.focusEdit)) {
      input.focus();
      if (this.focusEdit && edit) {
        const file = edit.mode === 'new' ? !edit.folder : this.rows.some((r) => r.id === edit.id && r.kind === 'file');
        input.setSelectionRange(0, edit.mode === 'rename' && file ? baseLength(input.value) : input.value.length);
      }
      this.focusEdit = false;
      input.scrollIntoView?.({ block: 'nearest' });
    }
  }

  private iconFor(row: ProjectRow): IconName {
    switch (row.kind) {
      case 'project': return 'project';
      case 'manifest': return 'json';
      case 'boards': return 'boards';
      case 'board': return 'board';
      case 'folder': return 'folder';
      default: return /\.json$/i.test(row.name) ? 'json' : isCodeFile(row.name) ? 'code' : 'file';
    }
  }

  private titleFor(row: ProjectRow): string {
    switch (row.kind) {
      case 'project': return `Project: ${row.name}`;
      case 'manifest': return `${row.name}: ${READ_ONLY_NOTE}`;
      case 'boards': return 'boards: one folder for each board on the grid';
      default: return row.id; // the full path
    }
  }

  private buildRow(row: ProjectRow, selected: boolean, renaming: RenameEdit | null): HTMLElement {
    const d = document.createElement('div');
    d.className = `fx-row k-${row.kind}`;
    if (selected) d.classList.add('selected');
    if (row.active) {
      d.classList.add('active');
      d.setAttribute('aria-current', 'true');
    }
    d.setAttribute('role', 'treeitem');
    d.setAttribute('aria-level', String(row.depth + 1));
    d.setAttribute('aria-selected', String(selected));
    const foldable = isFoldable(row.kind);
    if (foldable) d.setAttribute('aria-expanded', String(row.expanded));
    d.dataset.id = row.id;
    d.style.paddingLeft = `${4 + row.depth * INDENT}px`;

    const twisty = document.createElement('span');
    twisty.className = 'fx-twisty';
    if (foldable) {
      twisty.innerHTML = ICONS.chevron;
      twisty.classList.add('toggle');
      if (row.expanded) twisty.classList.add('open');
    }
    const icon = document.createElement('span');
    const iconName = this.iconFor(row);
    icon.className = `fx-icon ${row.kind === 'file' && iconName === 'code' ? 'code' : row.kind}`;
    icon.innerHTML = ICONS[iconName];
    d.append(twisty, icon);

    if (renaming) {
      d.append(this.makeInput(renaming));
      return d;
    }
    const name = document.createElement('span');
    name.className = 'fx-name';
    name.textContent = row.name;
    d.title = this.titleFor(row);
    d.append(name);
    if (row.secondary) {
      const sub = document.createElement('span');
      sub.className = 'fx-sub';
      sub.textContent = row.secondary;
      d.append(sub);
    }
    if (row.kind === 'manifest') {
      const lock = document.createElement('span');
      lock.className = 'fx-lock';
      lock.innerHTML = ICONS.lock;
      d.append(lock);
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

  /** The hint under an empty `boards` folder. */
  private buildNote(depth: number): HTMLElement {
    const d = document.createElement('div');
    d.className = 'fx-note';
    d.style.paddingLeft = `${4 + depth * INDENT + 20}px`;
    d.textContent = 'Add an Arduino board to the grid to get a folder here';
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
    const row = this.selectedRow();
    const kind = row?.kind ?? null;
    const target = newItemTarget(row, this.activeBoardId);
    const where = target?.redirected ? ` in ${this.labelOf(target.boardId)} (the active board)` : '';
    this.setButton(this.newFileButton, target === null, target ? `New file${where}` : `New file (${NO_BOARD})`);
    this.setButton(this.newFolderButton, target === null, target ? `New folder${where}` : `New folder (${NO_BOARD})`);

    const drop = importTarget(row, this.activeBoardId);
    const into = drop ? ` into ${this.labelOf(drop.boardId)}${drop.folder ? `/${drop.folder}` : ''}` : '';
    this.setButton(this.importButton, drop === null, drop ? `Import files${into}` : `Import files (${NO_BOARD})`);

    const ops = rowOps(kind);
    const locked = lockReason(kind);
    this.setButton(this.renameButton, !ops.rename, locked ?? 'Rename (F2)');
    this.setButton(this.deleteButton, !ops.remove, locked ?? 'Delete (Delete key)');
  }

  private setButton(button: HTMLButtonElement, disabled: boolean, title: string): void {
    button.disabled = disabled;
    button.title = title;
    button.setAttribute('aria-label', title);
  }

  // ---- selection and folding -----------------------------------------------

  private select(id: string | null): void {
    this.selected = id;
    for (const [rid, el] of this.rowEls) {
      const on = rid === id;
      el.classList.toggle('selected', on);
      el.setAttribute('aria-selected', String(on));
    }
    this.updateToolbar();
    if (id !== null) this.rowEls.get(id)?.scrollIntoView?.({ block: 'nearest' });
  }

  private setExpanded(id: string, expanded: boolean): void {
    if (expanded) this.collapsed.delete(id);
    else {
      this.collapsed.add(id);
      if (this.selected !== null && (id === PROJECT_ROOT ? this.selected !== PROJECT_ROOT : isInside(this.selected, id))) this.selected = id; // do not hide the selection
    }
    this.render();
  }

  private rowAt(target: EventTarget | null): ProjectRow | null {
    if (!(target instanceof Element)) return null;
    const el = target.closest<HTMLElement>('.fx-row');
    if (!el || el.classList.contains('editing') || target.closest('.fx-input')) return null;
    return this.rows.find((r) => r.id === el.dataset.id) ?? null;
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('.fx-input'))) return;
    const row = this.rowAt(e.target);
    this.select(row ? row.id : null); // empty space clears the selection
  };

  private onClick = (e: MouseEvent): void => {
    const row = this.rowAt(e.target);
    if (!row || e.button !== 0) return;
    if (isFoldable(row.kind) && e.target instanceof Element && e.target.closest('.fx-twisty')) this.setExpanded(row.id, !row.expanded);
    else {
      if (rowOps(row.kind).open) this.open(row, false);
      this.showOnGrid(row);
    }
  };

  /** A board row, or a file or folder in a board's folder: show that board on the grid (the project, gatehouse.json and boards rows have no board). */
  private showOnGrid(row: ProjectRow): void {
    const board = row.boardId === undefined ? undefined : this.boards.find((b) => b.boardId === row.boardId);
    if (board) this.host.showBoard(board.partId);
  }

  private onDoubleClick = (e: MouseEvent): void => {
    const row = this.rowAt(e.target);
    if (row) this.activate(row);
  };

  /** Show a file in the Code editor (gatehouse.json too, read only). */
  private open(row: ProjectRow, focus: boolean): void {
    if (row.kind === 'manifest') emitOpenFile(MANIFEST_TAB.boardId, MANIFEST_TAB.path, { focus });
    else if (row.kind === 'file' && row.boardId !== undefined && row.path !== undefined) emitOpenFile(row.boardId, row.path, { focus });
  }

  /** Enter or double-click: open a file in the editor and focus it, fold or unfold a folder. */
  private activate(row: ProjectRow): void {
    if (rowOps(row.kind).open) this.open(row, true);
    else if (isFoldable(row.kind)) this.setExpanded(row.id, !row.expanded);
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
    const row = this.selectedRow();
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        this.select(moveSelection(this.rows, this.selected, e.key === 'ArrowDown' ? 1 : -1));
        break;
      case 'Home':
      case 'End':
        e.preventDefault();
        this.select(moveSelection(this.rows, null, e.key === 'Home' ? 1 : -1));
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const move = horizontalMove(this.rows, this.selected, e.key === 'ArrowLeft' ? 'left' : 'right');
        if (move?.kind === 'select') this.select(move.id);
        else if (move) this.setExpanded(move.id, move.kind === 'expand');
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
    const target = newItemTarget(this.selectedRow(), this.activeBoardId);
    if (!target) return;
    if (target.redirected) toast(`New ${folder ? 'folder' : 'file'} goes in ${this.labelOf(target.boardId)}, the active board.`);
    this.unfold(target.parentId);
    this.edit = { mode: 'new', target, folder, value: '', error: null };
    this.focusEdit = true;
    this.render();
  }

  /** Make a row visible: it and every row above it unfold. */
  private unfold(id: string): void {
    for (const p of [PROJECT_ROOT, ...ancestors(id), id]) this.collapsed.delete(p);
  }

  private startRename(): void {
    const row = this.selectedRow();
    if (!row) return;
    if (!rowOps(row.kind).rename || row.boardId === undefined || row.path === undefined) {
      const why = lockReason(row.kind);
      if (why) toast(why);
      return;
    }
    this.edit = { mode: 'rename', id: row.id, boardId: row.boardId, path: row.path, value: row.name, error: null };
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
    if (!edit) return;
    const project = this.host.project;

    if (edit.mode === 'new') {
      const { boardId, parent, parentId } = edit.target;
      const named = checkNewName(parent, edit.value);
      if (!named.ok) return this.setError(named.error);
      const result = this.apply(() => (edit.folder ? createBoardFolder(project, boardId, named.path) : createBoardFile(project, boardId, named.path)));
      if (!result.ok) return this.setError(result.error);
      const id = rowId(boardId, named.path);
      this.unfold(parentId);
      for (const p of ancestors(id)) this.collapsed.delete(p);
      this.finish(id);
      return;
    }

    const named = checkRename(edit.path, edit.value);
    if (!named.ok) return this.setError(named.error);
    if (named.unchanged) return this.cancelEdit();
    const result = this.apply(() => renameBoardPath(project, edit.boardId, edit.path, named.path));
    if (!result.ok) return this.setError(result.error);
    this.collapsed = remapPaths(this.collapsed, edit.id, rowId(edit.boardId, named.path));
    this.finish(rowId(edit.boardId, named.path));
  }

  private async deleteSelected(): Promise<void> {
    const row = this.selectedRow();
    if (this.asking || !row) return;
    if (!rowOps(row.kind).remove || row.boardId === undefined || row.path === undefined) {
      const why = lockReason(row.kind);
      if (why) toast(why);
      return;
    }
    const { boardId, path } = row;
    const what = row.kind === 'folder'
      ? `Delete the folder "${path}" and everything in it?`
      : `Delete the file "${path}"?`;
    this.asking = true;
    const yes = await ask(row.kind === 'folder' ? 'Delete folder' : 'Delete file', `${what} You can undo this with Ctrl+Z.`, [
      { label: 'Cancel', value: false },
      { label: 'Delete', value: true, primary: true },
    ], false);
    this.asking = false;
    if (!yes) {
      this.tree.focus();
      return;
    }
    if (!this.rows.some((r) => r.id === row.id)) return; // it went away while asking
    const next = selectionAfterDelete(this.rows, row.id);
    const result = this.apply(() => deleteBoardPath(this.host.project, boardId, path));
    if (!result.ok) {
      toast(result.error, 'error');
      this.tree.focus();
      return;
    }
    this.finish(next);
  }

  /** Run a change of the files; the project notification is held back until finish(). */
  private apply<T>(op: () => T): T {
    this.applying = true;
    try {
      return op();
    } finally {
      this.applying = false;
    }
  }

  /** After a successful change: select `id`, let the app record the step, show the new tree. */
  private finish(id: string): void {
    this.edit = null;
    this.selected = id;
    this.host.changed();
    this.signature = ''; // force the rebuild
    this.refresh();
    this.tree.focus();
  }

  // ---- importing files -------------------------------------------------------------

  /** The Import button: remember where the files go, then ask for them. */
  private chooseFiles(): void {
    const target = importTarget(this.selectedRow(), this.activeBoardId);
    if (!target) return;
    this.pendingTarget = target;
    this.picker.open();
  }

  private fallbackTarget(): ImportTarget {
    return { boardId: this.activeBoardId ?? '', folder: '' };
  }

  private async runImport(request: ImportRequest): Promise<void> {
    this.pendingTarget = null;
    const done = await importFiles(this.host.project, request, (op) => this.apply(op));
    if (!done) {
      this.signature = ''; // names may have changed even when the import failed halfway
      this.refresh();
      return;
    }
    this.host.changed(); // one undo step for the whole import
    this.unfold(rowId(done.boardId, done.folder));
    this.selected = rowId(done.boardId, done.imported[0]);
    this.signature = '';
    this.refresh();
    this.rowEls.get(this.selected)?.scrollIntoView?.({ block: 'nearest' });
  }

  private static hasFiles(e: DragEvent): boolean {
    return e.dataTransfer !== null && [...e.dataTransfer.types].includes('Files');
  }

  private onDragOver = (e: DragEvent): void => {
    if (!FileExplorer.hasFiles(e)) return;
    e.preventDefault(); // also for refused targets: a drop must never reach the browser's own handling
    const target = dropTarget(this.rowAt(e.target));
    if (e.dataTransfer) e.dataTransfer.dropEffect = target ? 'copy' : 'none';
    this.setDrop(target);
  };

  private onDragLeave = (e: DragEvent): void => {
    if (!(e.relatedTarget instanceof Node && this.tree.contains(e.relatedTarget))) this.setDrop(null);
  };

  private onDrop = (e: DragEvent): void => {
    if (!FileExplorer.hasFiles(e) || !e.dataTransfer) return;
    e.preventDefault();
    this.setDrop(null);
    const target = dropTarget(this.rowAt(e.target));
    if (!target) return;
    const { files, skipped } = filesFromDrop(e.dataTransfer);
    void this.runImport({ files, skipped, target });
  };

  /** Highlight the board folder (and the folder inside it) that would take the files. */
  private setDrop(target: ImportTarget | null): void {
    const ids = target ? [rowId(target.boardId, ''), ...(target.folder ? [rowId(target.boardId, target.folder)] : [])] : [];
    if (ids.join('\n') === this.dropIds.join('\n')) return;
    for (const id of this.dropIds) this.rowEls.get(id)?.classList.remove('drop');
    for (const id of ids) this.rowEls.get(id)?.classList.add('drop');
    this.dropIds = ids;
  }
}

function toolButton(icon: IconName, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fx-button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = ICONS[icon];
  return b;
}
