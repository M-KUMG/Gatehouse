// New, Import / Export of `.gth` files, and in the Electron app Open folder /
// Save / Save as for a project kept in a real folder (filecommands.ts says which
// exist where), their shortcuts, the unsaved-changes guard,
// autosave, the offer to restore it at start-up, and the undo history
// (reset on every load; its shortcuts live in the editor, see interaction.ts).

import { APP_NAME } from '../app';
import { ask, toast } from './dialog';
import { commandForKey, type FileCommand } from './filecommands';
import { createFileBar, type FileBar } from './filebar';
import { folderHost, type FolderHost } from './folderhost';
import { askSaveLocation } from './saveasdialog';
import { projectFromBytes, projectToGth, type ReadFile } from './diskfile';
import { fileNameFor, projectNameFromFile } from './filename';
import { chooseFileToOpen, chooseSaveTarget, type SaveTarget } from './files';
import { ProjectError, type ProjectFile } from './format';
import { fromFileMap, toFileMap } from './storage';
import type { Project } from './project';
import { readAutosave, startAutosave } from './autosave';
import { UndoManager, type UndoHooks } from './undo';

/** What the rest of the app does around a load. */
export interface LoadHooks {
  /** Before the project content is replaced: stop drags, clear the selection. */
  beforeLoad(): void;
  /** After: redraw, and frame the circuit when the file had no camera. */
  afterLoad(file: ProjectFile): void;
}

// Electron closes the window silently when beforeunload is cancelled, which
// would make it impossible to close; it needs its own prompt in main.js.
const IS_ELECTRON = /\bElectron\//.test(navigator.userAgent);

export class ProjectController {
  /** The file Save writes to, once known. */
  private target: SaveTarget | null = null;
  /** The project folder Save writes to (Electron), once known. */
  private folder: { dir: string; name: string } | null = null;
  /** The Electron app's folder commands; null in the browser. */
  private readonly host: FolderHost | null = folderHost();
  private busy = false;
  /** New / Open / Save / Undo / Redo and the project name. */
  readonly fileBar: FileBar;
  readonly history: UndoManager;

  constructor(
    private readonly project: Project,
    private readonly hooks: LoadHooks & UndoHooks,
    /** Where the file bar goes (the grid's area). */
    fileBarParent: HTMLElement,
  ) {
    this.fileBar = createFileBar(
      fileBarParent,
      {
        command: (command) => void this.runCommand(command),
        undo: () => this.history.undo(),
        redo: () => this.history.redo(),
      },
      this.host !== null,
    );
    this.history = new UndoManager(project, hooks);
    this.history.onChange(() => this.fileBar.showHistory(this.history.canUndo, this.history.canRedo));
    project.onChange(this.refresh);
    this.refresh();

    const recovered = readAutosave(); // read before autosave can replace it
    const autosave = startAutosave(project);
    window.addEventListener('pagehide', () => autosave.flush());
    window.addEventListener('beforeunload', (e) => {
      autosave.flush();
      if (project.dirty && !IS_ELECTRON) {
        e.preventDefault();
        e.returnValue = ''; // older browsers need this to show the prompt
      }
    });
    window.addEventListener('keydown', this.onKeyDown);

    if (recovered && recovered.file.parts.length > 0 && project.empty) void this.offerRestore(recovered.file, recovered.dirty);
  }

  async newProject(): Promise<void> {
    await this.run(async () => {
      if (!(await this.confirmDiscard())) return;
      this.target = null;
      this.folder = null;
      this.hooks.beforeLoad();
      this.project.clear();
      this.history.reset();
      this.hooks.afterLoad(this.project.serialize());
    });
  }

  /** Import: read a `.gth` (or older JSON) file. */
  async open(): Promise<void> {
    await this.run(async () => {
      if (!(await this.confirmDiscard())) return;
      const opened = await chooseFileToOpen();
      if (!opened) return;
      let read: ReadFile;
      try {
        read = projectFromBytes(opened.name, opened.bytes); // all checks happen before anything changes
      } catch (e) {
        if (!(e instanceof ProjectError)) throw e;
        toast(`Could not open "${opened.name}": ${e.message}`, 'error');
        return;
      }
      this.load(read.file, false);
      this.folder = null; // Save (Electron) asks for a folder; the file stays the Export target
      // An older JSON file is not overwritten with a zip: the next Save asks where.
      this.target = read.legacy ? null : opened.target;
      toast(`Opened "${opened.name}"`);
    });
  }

  /** Export: write a `.gth` to the known file, or ask where (always with `as`). */
  async save(as: boolean): Promise<void> {
    await this.run(async () => {
      const target = !as && this.target?.reusable ? this.target : await chooseSaveTarget(fileNameFor(this.project.name));
      if (!target) return;
      const name = projectNameFromFile(target.name);
      const file: ProjectFile = { ...this.project.serialize(), name, savedAt: new Date().toISOString() };
      await target.write(projectToGth(file));
      this.target = target;
      this.project.markSaved(name);
      toast(target.reusable ? `Saved "${target.name}"` : `Downloaded "${target.name}"`);
    });
  }

  /** Open project folder (Electron). */
  async openFolder(): Promise<void> {
    const host = this.host;
    if (!host) return;
    await this.run(async () => {
      if (!(await this.confirmDiscard())) return;
      const picked = await host.pickProjectFolder('open');
      if ('cancelled' in picked) return;
      if ('error' in picked) return void toast(picked.error, 'error');
      const read = await host.readProjectFolder(picked.dir);
      if ('error' in read) return void toast(`Could not open "${picked.name}": ${read.error}`, 'error');
      let file: ProjectFile;
      try {
        file = { ...fromFileMap(read.map), name: picked.name }; // all checks happen before anything changes
      } catch (e) {
        if (!(e instanceof ProjectError)) throw e;
        return void toast(`Could not open "${picked.name}": ${e.message}`, 'error');
      }
      this.load(file, false);
      this.target = null;
      this.folder = { dir: picked.dir, name: picked.name };
      toast(`Opened folder "${picked.name}"`);
    });
  }

  /** Save to the project's folder, or ask for one (always with `as`, or when it has none yet). Electron only. */
  async saveFolder(as: boolean): Promise<void> {
    const host = this.host;
    if (!host) return;
    await this.run(async () => {
      let folder = as ? null : this.folder;
      if (!folder) {
        const picked = await askSaveLocation(host, this.project.name);
        if (!picked) return;
        if (picked.kind !== 'empty' && picked.kind !== 'new' && !(await this.confirmFolder(picked.name, picked.kind))) return;
        folder = { dir: picked.dir, name: picked.name };
      }
      const file: ProjectFile = { ...this.project.serialize(), name: folder.name, savedAt: new Date().toISOString() };
      const written = await host.writeProjectFolder(folder.dir, toFileMap(file));
      if (written.error) return void toast(`Could not save to "${folder.name}": ${written.error}`, 'error');
      this.folder = folder;
      this.project.markSaved(folder.name);
      toast(`Saved to folder "${folder.name}"`);
    });
  }

  /** Writing into a folder that already holds something: say what will happen. */
  private confirmFolder(name: string, kind: 'project' | 'other'): Promise<boolean> {
    const detail =
      kind === 'project'
        ? `"${name}" already holds a ${APP_NAME} project. Saving here replaces its project files.`
        : `"${name}" is not empty. ${APP_NAME} will add gatehouse.json and a "boards" folder to it and leave your other files alone.`;
    return ask(
      'Save into this folder?',
      detail,
      [
        { label: 'Cancel', value: false },
        { label: 'Save here', value: true, primary: true },
      ],
      false,
    );
  }

  private runCommand(command: FileCommand): Promise<void> {
    switch (command) {
      case 'new': return this.newProject();
      case 'openFolder': return this.openFolder();
      case 'saveFolder': return this.saveFolder(false);
      case 'saveFolderAs': return this.saveFolder(true);
      case 'import': return this.open();
      case 'export': return this.save(false);
      case 'exportAs': return this.save(true);
    }
  }

  private load(file: ProjectFile, dirty: boolean): void {
    this.hooks.beforeLoad();
    this.project.load(file, dirty);
    this.history.reset();
    this.hooks.afterLoad(file);
  }

  private async offerRestore(file: ProjectFile, dirty: boolean): Promise<void> {
    const count = `${file.parts.length} ${file.parts.length === 1 ? 'part' : 'parts'}`;
    const restore = await ask(
      'Restore last session?',
      `"${file.name}" (${count}) was open when ${APP_NAME} was last closed` +
        `${dirty ? ', with unsaved changes' : ''}. This copy is kept in the browser only.`,
      [
        { label: 'Start empty', value: false },
        { label: 'Restore', value: true, primary: true },
      ],
      false,
    );
    // Something may have been built while the question was open.
    if (restore && (this.project.empty || (await this.confirmDiscard()))) {
      this.target = null;
      this.folder = null;
      this.load(file, dirty);
    }
  }

  /** True when there is nothing unsaved or the user agrees to lose it. */
  private async confirmDiscard(): Promise<boolean> {
    if (!this.project.dirty) return true;
    return ask(
      'Unsaved changes',
      `"${this.project.name}" has changes that are not saved. Discard them?`,
      [
        { label: 'Cancel', value: false },
        { label: 'Discard changes', value: true, primary: true },
      ],
      false,
    );
  }

  /** One file command at a time; unexpected failures become a message, never a half-done load. */
  private async run(command: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await command();
    } catch (e) {
      toast(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      this.busy = false;
    }
  }

  private refresh = (): void => {
    const { name, dirty } = this.project;
    this.fileBar.show(name, dirty);
    document.title = `${dirty ? '● ' : ''}${name} · ${APP_NAME}`;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const command = commandForKey(this.host !== null, e.key.toLowerCase(), e.shiftKey);
    if (!command) return;
    void this.runCommand(command);
    e.preventDefault();
  };
}
