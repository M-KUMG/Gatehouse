// Project names <-> file names. No DOM here.

/** A project is saved as one `.gth` file: a zip of the project folder. */
export const GTH_EXTENSION = '.gth';

const NAME_EXTENSIONS = /(\.gth|\.gatehouse\.json|\.json)$/i;

/** "blink.gth" (or the older "blink.gatehouse.json" / "blink.json") -> "blink". */
export function projectNameFromFile(fileName: string): string {
  return fileName.replace(NAME_EXTENSIONS, '') || fileName;
}

/** A project name usable as a file or folder name on every system. */
export function safeBaseName(projectName: string): string {
  const cleaned = projectName
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim()
    .replace(/[. ]+$/, ''); // Windows drops trailing dots and spaces
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? 'project' : cleaned;
}

/** The `.gth` file name for a project name. */
export function fileNameFor(projectName: string): string {
  return safeBaseName(projectName) + GTH_EXTENSION;
}
