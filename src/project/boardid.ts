// Board identity: every board part has a `boardId` such as "uno-1" (type
// slug + number). It names the board's source folder, so it is stable and
// never reused inside a project: a per-type counter (saved in the project)
// only goes up, even when boards are deleted or an undo removes one.

import { getPart } from '../parts';

/** Last number used per type slug, e.g. { uno: 3 }. */
export type BoardCounters = Record<string, number>;

const BOARD_ID = /^([a-z0-9]+)-([1-9][0-9]{0,5})$/;

/** True for part types that are microcontroller boards (they get a boardId and files). */
export function isBoardType(typeId: string): boolean {
  return getPart(typeId)?.board !== undefined;
}

/** The folder-name prefix of a board type: lower-case letters and digits only. */
export function boardSlug(typeId: string): string {
  return typeId.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'board';
}

/** The slug and number of a boardId, or null when it is not one. */
export function parseBoardId(boardId: string): { slug: string; n: number } | null {
  const m = BOARD_ID.exec(boardId);
  return m ? { slug: m[1], n: Number(m[2]) } : null;
}

/** A fresh boardId for a new board of `typeId`; advances `counters` (changed in place). */
export function nextBoardId(counters: BoardCounters, typeId: string): string {
  const slug = boardSlug(typeId);
  const n = (Object.hasOwn(counters, slug) ? counters[slug] : 0) + 1;
  counters[slug] = n;
  return `${slug}-${n}`;
}

/** `counters` raised so that none of `boardIds` can be handed out again (a new object). */
export function coveringCounters(counters: BoardCounters, boardIds: Iterable<string>): BoardCounters {
  const out: BoardCounters = { ...counters };
  for (const id of boardIds) {
    const parsed = parseBoardId(id);
    if (parsed && parsed.n > (Object.hasOwn(out, parsed.slug) ? out[parsed.slug] : 0)) out[parsed.slug] = parsed.n;
  }
  return sortedCounters(out);
}

/** Same counters, keys sorted (stable file text). */
export function sortedCounters(counters: BoardCounters): BoardCounters {
  return Object.fromEntries(Object.keys(counters).sort().map((k) => [k, counters[k]]));
}
