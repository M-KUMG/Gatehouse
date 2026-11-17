// Reading and writing project files on the user's disk. Uses the File
// System Access API where it exists (Chrome, Edge, Electron), so Save can
// write back to the same file; otherwise a hidden file input for opening
// and a normal download for saving. Bytes only: what they mean is
// diskfile.ts's business.

import { GTH_EXTENSION } from './filename';

/** Where Save writes. `reusable` targets (real files) can be written again without asking. */
export interface SaveTarget {
  /** File name, e.g. "blink.gth". */
  name: string;
  reusable: boolean;
  write(bytes: Uint8Array): Promise<void>;
}

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  /** For saving back to the same file, when the browser allows it. */
  target: SaveTarget | null;
}

// The few File System Access API bits used here (not in every TS DOM lib).
interface Writable {
  write(data: BufferSource): Promise<void>;
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

const GTH_TYPE: PickerType = { description: 'Gatehouse project', accept: { 'application/zip': [GTH_EXTENSION] } };
const LEGACY_TYPE: PickerType = { description: 'Older project file (JSON)', accept: { 'application/json': ['.json'] } };
const ANY_PROJECT: PickerType = {
  description: 'Gatehouse projects',
  accept: { 'application/zip': [GTH_EXTENSION], 'application/json': ['.json'] },
};
const SAVE_TYPES = [GTH_TYPE];
const OPEN_TYPES = [ANY_PROJECT, GTH_TYPE, LEGACY_TYPE];
const fsa = window as unknown as FsaWindow;

/** The user closed the picker without choosing. */
function cancelled(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

function handleTarget(handle: FileHandle): SaveTarget {
  return {
    name: handle.name,
    reusable: true,
    async write(bytes) {
      const out = await handle.createWritable();
      await out.write(bytes as Uint8Array<ArrayBuffer>);
      await out.close();
    },
  };
}

function downloadTarget(name: string): SaveTarget {
  return {
    name,
    reusable: false,
    async write(bytes) {
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
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
    return handleTarget(await fsa.showSaveFilePicker({ suggestedName, types: SAVE_TYPES }));
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

/** Let the user pick a file to open. Null when cancelled. */
export async function chooseFileToOpen(): Promise<OpenedFile | null> {
  if (fsa.showOpenFilePicker) {
    try {
      const [handle] = await fsa.showOpenFilePicker({ types: OPEN_TYPES });
      const file = await handle.getFile();
      return { name: file.name, bytes: await bytesOf(file), target: handleTarget(handle) };
    } catch (e) {
      if (cancelled(e)) return null;
      throw e;
    }
  }
  const file = await pickWithInput();
  return file ? { name: file.name, bytes: await bytesOf(file), target: null } : null;
}

async function bytesOf(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${GTH_EXTENSION},.json,application/json`;
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
