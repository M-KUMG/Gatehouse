// Upgrading files written by older versions of the app. Each step turns a
// version N document into version N + 1; to introduce a new version, bump
// PROJECT_VERSION and add one `{ from: N, up }` entry to MIGRATIONS.

import { APP_NAME } from '../app';
import { isBoardType, nextBoardId, type BoardCounters } from './boardid';
import { defaultTree, type SourceFiles } from './filetree';
import { PROJECT_VERSION, ProjectError } from './format';

export type RawDocument = Record<string, unknown>;

export interface Migration {
  /** The version this step reads; it produces `from + 1`. */
  from: number;
  /** Returns the upgraded document (may modify and return its argument). */
  up(doc: RawDocument): RawDocument;
}

/**
 * v1 -> v2: v2 adds wire junctions. A v1 file has none, and its pin-to-pin
 * wires are already valid v2 wires, so the step only adds the empty list.
 */
const addJunctions: Migration = {
  from: 1,
  up: (doc) => ('junctions' in doc ? doc : { ...doc, junctions: [] }),
};

/**
 * v2 -> v3: v3 gives every board a boardId and a source tree. Boards get
 * ids in draw order ("uno-1", "uno-2", ...) and the default tree; other
 * parts are untouched. Malformed parts are left for validation to report.
 */
const addBoardFiles: Migration = {
  from: 2,
  up: (doc) => {
    const counters: BoardCounters = {};
    const files: SourceFiles = {};
    const parts = !Array.isArray(doc.parts)
      ? doc.parts
      : doc.parts.map((p: unknown) => {
          if (typeof p !== 'object' || p === null || Array.isArray(p)) return p;
          const { id, typeId, ...rest } = p as RawDocument;
          if (typeof typeId !== 'string' || !isBoardType(typeId) || 'boardId' in rest) return p;
          const boardId = nextBoardId(counters, typeId);
          files[boardId] = defaultTree();
          return { id, typeId, boardId, ...rest };
        });
    return { ...doc, parts, files, boardCounters: counters };
  },
};

/** All known steps, oldest first. */
export const MIGRATIONS: readonly Migration[] = [addJunctions, addBoardFiles];

/** The oldest version any chain of steps can start from. */
function oldestSupported(current: number, migrations: readonly Migration[]): number {
  let v = current;
  while (migrations.some((m) => m.from === v - 1)) v--;
  return v;
}

/**
 * Bring a project document up to `current`. Throws a ProjectError for files
 * from a newer app or versions that cannot be upgraded. Never changes `doc`.
 */
export function migrate(
  doc: RawDocument,
  current: number = PROJECT_VERSION,
  migrations: readonly Migration[] = MIGRATIONS,
): RawDocument {
  const version = doc.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new ProjectError('The project file has no valid "version" number.');
  }
  if (version > current) {
    throw new ProjectError(
      `This project was saved by a newer version of ${APP_NAME} (file format v${version}; ` +
        `this app reads up to v${current}). Update ${APP_NAME} to open it.`,
    );
  }
  const oldest = oldestSupported(current, migrations);
  if (version < oldest) {
    throw new ProjectError(`File format v${version} is too old or unknown; this app reads v${oldest} to v${current}.`);
  }
  let out: RawDocument = structuredClone(doc);
  for (let v = version; v < current; v++) {
    const step = migrations.find((m) => m.from === v);
    if (!step) throw new ProjectError(`No upgrade from file format v${v}.`);
    out = step.up(out);
    out.version = v + 1;
  }
  return out;
}
