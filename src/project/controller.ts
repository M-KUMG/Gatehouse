// New / Open / Save / Save as, their shortcuts, the unsaved-changes guard,
// autosave and the offer to restore it at start-up.

import { APP_NAME } from '../app';
import { ask, toast } from './dialog';
import { createFileBar } from './filebar';
import { chooseFileToOpen, chooseSaveTarget, fileNameFor, projectNameFromFile, type SaveTarget } from './files';
import { ProjectError, stringifyProject, type ProjectFile } from './format';
import type { Project } from './project';
import { readProject } from './read';
import { readAutosave, startAutosave } from './autosave';

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
  private busy = false;
  private readonly showState: (name: string, dirty: boolean) => void;

  constructor(
    private readonly project: Project,
    private readonly hooks: LoadHooks,
  ) {
    this.showState = createFileBar({
      newProject: () => void this.newProject(),
      open: () => void this.open(),
      save: () => void this.save(false),
    });
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
      this.hooks.beforeLoad();
      this.project.clear();
      this.hooks.afterLoad(this.project.serialize());
    });
  }

  async open(): Promise<void> {
    await this.run(async () => {
      if (!(await this.confirmDiscard())) return;
      const opened = await chooseFileToOpen();
      if (!opened) return;
      let file: ProjectFile;
      try {
        file = readProject(opened.text); // all checks happen before anything changes
      } catch (e) {
        if (!(e instanceof ProjectError)) throw e;
        toast(`Could not open "${opened.name}": ${e.message}`, 'error');
        return;
      }
      file = { ...file, name: projectNameFromFile(opened.name) };
      this.load(file, false);
      this.target = opened.target;
      toast(`Opened "${opened.name}"`);
    });
  }

  /** Save to the known file, or ask where (always with `as`). */
  async save(as: boolean): Promise<void> {
    await this.run(async () => {
      const target = !as && this.target?.reusable ? this.target : await chooseSaveTarget(fileNameFor(this.project.name));
      if (!target) return;
      const name = projectNameFromFile(target.name);
      const file: ProjectFile = { ...this.project.serialize(), name, savedAt: new Date().toISOString() };
      await target.write(stringifyProject(file));
      this.target = target;
      this.project.markSaved(name);
      toast(target.reusable ? `Saved "${target.name}"` : `Downloaded "${target.name}"`);
    });
  }

  private load(file: ProjectFile, dirty: boolean): void {
    this.hooks.beforeLoad();
    this.project.load(file, dirty);
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
    this.showState(name, dirty);
    document.title = `${dirty ? '● ' : ''}${name} · ${APP_NAME}`;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 's') void this.save(e.shiftKey);
    else if (key === 'o' && !e.shiftKey) void this.open();
    else return;
    e.preventDefault();
  };
}
