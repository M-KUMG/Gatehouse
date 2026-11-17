// Reading and ordering boardIds such as "uno-1" (no dependencies, so parts.ts
// can use it for labels). See boardid.ts for how they are made.

const BOARD_ID = /^([a-z0-9]+)-([1-9][0-9]{0,5})$/;

/** The slug and number of a boardId, or null when it is not one. */
export function parseBoardId(boardId: string): { slug: string; n: number } | null {
  const m = BOARD_ID.exec(boardId);
  return m ? { slug: m[1], n: Number(m[2]) } : null;
}

/**
 * Natural order of boardIds: by type slug, then by the number (uno-2 before
 * uno-10). Anything that is not a boardId sorts after those, by plain text.
 */
export function compareBoardIds(a: string, b: string): number {
  const pa = parseBoardId(a);
  const pb = parseBoardId(b);
  if (pa && pb) return pa.slug < pb.slug ? -1 : pa.slug > pb.slug ? 1 : pa.n - pb.n;
  if (pa) return -1;
  if (pb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
