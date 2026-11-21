// The Electron app's project-folder commands, as the preload exposes them
// (electron/preload.cjs). Only the Electron app has them: everywhere else
// `folderHost()` is null and the page offers no folder commands.

/** What the dialog found: does not exist yet (created on saving), nothing in it, a Gatehouse project, or other files. */
export type FolderKind = 'empty' | 'project' | 'other' | 'new';

export interface PickedFolder {
  dir: string;
  name: string;
  kind: FolderKind;
}

export type PickResult = PickedFolder | { cancelled: true } | { error: string };

export interface FolderHost {
  /** 'open': native dialog for an existing project folder. */
  pickProjectFolder(mode: 'open'): Promise<PickResult>;
  /** 'parent': native dialog for the folder a new project goes in (the Save popup's Browse button). */
  pickProjectFolder(mode: 'parent'): Promise<{ dir: string; name: string } | { cancelled: true } | { error: string }>;
  /** Where the Save popup starts: the folder used last time, else Documents. */
  defaultProjectParent(): Promise<{ dir: string } | { error: string }>;
  /** <parent>/<name> for a new project; parent must come from the two calls above. */
  createProjectFolder(parent: string, name: string): Promise<PickedFolder | { error: string }>;
  readProjectFolder(dir: string): Promise<{ map: Record<string, string> } | { error: string }>;
  writeProjectFolder(dir: string, map: Record<string, string>): Promise<{ error?: string }>;
}

/** The host when this page runs in the Electron app, else null. */
export function folderHost(): FolderHost | null {
  const host = (globalThis as { gatehouseHost?: Partial<FolderHost> }).gatehouseHost;
  const has = (k: keyof FolderHost): boolean => typeof host?.[k] === 'function';
  return host && has('pickProjectFolder') && has('defaultProjectParent') && has('createProjectFolder') && has('readProjectFolder') && has('writeProjectFolder')
    ? (host as FolderHost)
    : null;
}
