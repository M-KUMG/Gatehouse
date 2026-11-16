// Reading and writing project files on the user's disk. Uses the File
// System Access API where it exists (Chrome, Edge, Electron), so Save can
// write back to the same file; otherwise a hidden file input for opening
// and a normal download for saving.

export const FILE_EXTENSION = '.gatehouse.json';

/** Where Save writes. `reusable` targets (real files) can be written again without asking. */
export interface SaveTarget {
  /** File name, e.g. "blink.gatehouse.json". */
  name: string;
  reusable: boolean;
  write(text: string): Promise<void>;
}

export interface OpenedFile {
  name: string;
  text: string;
  /** For saving back to the same file, when the browser allows it. */
  target: SaveTarget | null;
}

// The few File System Access API bits used here (not in every TS DOM lib).
interface Writable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<Writable>;
}
interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
interface FsaWindow {
  showOpenFilePicker?(options: { types: PickerType[]; excludeAcceptAllOption?: boolean }): Promise<FileHandle[]>;
  showSaveFilePicker?(options: { suggestedName: string; types: PickerType[] }): Promise<FileHandle>;
}

const TYPES: PickerType[] = [{ description: 'Project files', accept: { 'application/json': ['.json'] } }];
const fsa = window as unknown as FsaWindow;

/** "blink.gatehouse.json" -> "blink". */
export function projectNameFromFile(fileName: string): string {
  return fileName.replace(/\.gatehouse\.json$/i, '').replace(/\.json$/i, '') || fileName;
}

/** A safe file name for a project name. */
export function fileNameFor(projectName: string): string {
  const base = projectName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'project';
  return base + FILE_EXTENSION;
}

/** The user closed the picker without choosing. */
function cancelled(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

function handleTarget(handle: FileHandle): SaveTarget {
  return {
    name: handle.name,
    reusable: true,
    async write(text) {
      const out = await handle.createWritable();
      await out.write(text);
      await out.close();
    },
  };
}

function downloadTarget(name: string): SaveTarget {
  return {
    name,
    reusable: false,
    async write(text) {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}

/** Ask where to save (or, without the API, download under the suggested name). Null when cancelled. */
export async function chooseSaveTarget(suggestedName: string): Promise<SaveTarget | null> {
  if (!fsa.showSaveFilePicker) return downloadTarget(suggestedName);
  try {
    return handleTarget(await fsa.showSaveFilePicker({ suggestedName, types: TYPES }));
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

/** Let the user pick a file to open. Null when cancelled. */
export async function chooseFileToOpen(): Promise<OpenedFile | null> {
  if (fsa.showOpenFilePicker) {
    try {
      const [handle] = await fsa.showOpenFilePicker({ types: TYPES });
      const file = await handle.getFile();
      return { name: file.name, text: await file.text(), target: handleTarget(handle) };
    } catch (e) {
      if (cancelled(e)) return null;
      throw e;
    }
  }
  const file = await pickWithInput();
  return file ? { name: file.name, text: await file.text(), target: null } : null;
}

function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    const done = (file: File | null): void => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.append(input);
    input.click();
  });
}
