// The name of a project folder (typed in the Save popup): the same rules as
// electron/folderipc.cjs `checkFolderName`, so the popup can say what is wrong
// before anything is sent. Pure.

export const MAX_FOLDER_NAME = 100;
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

/** Why `name` cannot be a project folder name, or null when it can. */
export function folderNameProblem(name: string): string | null {
  const n = name.trim();
  if (n === '') return 'Give the project a name.';
  if (n.length > MAX_FOLDER_NAME) return `The name is longer than ${MAX_FOLDER_NAME} characters.`;
  if (n === '.' || n === '..' || /[\\/:*?"<>|\u0000-\u001f]/.test(n)) return 'The name cannot contain \\ / : * ? " < > |';
  if (/[. ]$/.test(n) || DEVICE_NAME.test(n)) return 'That name is not allowed on Windows.';
  return null;
}

/** "<parent>\<name>" as it will be written (separator taken from the parent), for showing under the fields. */
export function previewPath(parent: string, name: string): string {
  const sep = parent.includes('\\') ? '\\' : '/';
  const base = parent.endsWith('\\') || parent.endsWith('/') ? parent : parent + sep;
  return base + name.trim();
}
