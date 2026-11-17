// The one object that owns the editor's document: the circuit (Scene), the
// camera and the project name. The grid, editor and simulation read and
// change the Scene and camera in place; this object turns them into a
// ProjectFile and back, and tells listeners when the circuit changed (for
// the unsaved-changes marker and autosave). No DOM here.

import { clampZoom, type Camera } from '../camera';
import { Scene } from '../model';
import { DEFAULT_PROJECT_NAME, PROJECT_FORMAT, PROJECT_VERSION, emptyProject, type ProjectFile } from './format';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class Project {
  readonly scene = new Scene();
  readonly camera: Camera = { x: 0, y: 0, zoom: 1 };
  private currentName = DEFAULT_PROJECT_NAME;
  /** Circuit content as last seen, and as last saved; equal means clean. */
  private seen: string;
  private saved: string;
  private readonly listeners: (() => void)[] = [];

  constructor() {
    this.seen = this.saved = this.signature();
  }

  get name(): string {
    return this.currentName;
  }

  get dirty(): boolean {
    return this.seen !== this.saved;
  }

  get empty(): boolean {
    return this.scene.parts.length === 0 && this.scene.wires.length === 0;
  }

  /** Call `listener` after any change to the content, name or saved state. */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** The project as plain source data (a deep copy). */
  serialize(): ProjectFile {
    const { x, y, zoom } = this.camera;
    return {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      name: this.currentName,
      camera: { x, y, zoom },
      parts: copy(this.scene.parts),
      wires: copy(this.scene.wires),
      junctions: copy(this.scene.junctions),
    };
  }

  /**
   * Replace everything with a validated file (see readProject). Without a
   * camera in the file the camera goes back to the origin at 100%.
   * `dirty` marks the loaded content as not saved (e.g. a restored autosave).
   */
  load(file: ProjectFile, dirty = false): void {
    this.scene.replace(copy(file.parts), copy(file.wires), copy(file.junctions));
    const cam = file.camera ?? { x: 0, y: 0, zoom: 1 };
    this.camera.x = cam.x;
    this.camera.y = cam.y;
    this.camera.zoom = clampZoom(cam.zoom);
    this.currentName = file.name || DEFAULT_PROJECT_NAME;
    this.seen = this.signature();
    this.saved = dirty ? '' : this.seen;
    this.notify();
  }

  /** Start over with an empty, unnamed project. */
  clear(): void {
    this.load(emptyProject());
  }

  /** The current content was written to a file (named `name`). */
  markSaved(name: string = this.currentName): void {
    this.currentName = name || DEFAULT_PROJECT_NAME;
    this.seen = this.saved = this.signature();
    this.notify();
  }

  /**
   * Notice edits made directly on the Scene. Cheap enough to call after
   * every frame; notifies only when the circuit really changed.
   */
  checkForChanges(): void {
    const now = this.signature();
    if (now === this.seen) return;
    this.seen = now;
    this.notify();
  }

  /** What counts as an edit: the circuit, not the camera or the name. */
  private signature(): string {
    return JSON.stringify([this.scene.parts, this.scene.wires, this.scene.junctions]);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
