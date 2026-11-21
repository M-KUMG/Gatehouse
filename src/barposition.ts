// Where a movable bar (the file bar, the transport bar) sits inside the grid
// area: clamping so it can never be lost off-screen, and reading saved
// positions. Pure data and maths, no DOM; draggablebar.ts uses it.

export interface BarPosition {
  /** Pixels from the left edge of the grid area. */
  left: number;
  /** Pixels from the top edge of the grid area. */
  top: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Keep a bar of `bar` size fully inside an area of `area` size, at least `margin` from every edge. */
export function clampPosition(pos: BarPosition, bar: Size, area: Size, margin = 4): BarPosition {
  const maxLeft = Math.max(margin, area.width - bar.width - margin);
  const maxTop = Math.max(margin, area.height - bar.height - margin);
  return {
    left: Math.round(Math.min(Math.max(pos.left, margin), maxLeft)),
    top: Math.round(Math.min(Math.max(pos.top, margin), maxTop)),
  };
}

/** A saved position from storage, or null when it is missing or not two finite numbers. */
export function parsePosition(value: unknown): BarPosition | null {
  if (typeof value !== 'object' || value === null) return null;
  const { left, top } = value as Record<string, unknown>;
  if (typeof left !== 'number' || typeof top !== 'number' || !Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, top };
}

/** All saved positions (one per bar id) from the stored JSON text; anything unreadable gives an empty record. */
export function parseSavedPositions(text: string | null): Record<string, BarPosition> {
  if (!text) return {};
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) return {};
    const out: Record<string, BarPosition> = {};
    for (const [id, value] of Object.entries(raw)) {
      const pos = parsePosition(value);
      if (pos) out[id] = pos;
    }
    return out;
  } catch {
    return {};
  }
}

/** Distance in pixels a key press moves the bar: 10, or 40 with Shift. */
export function keyStep(shift: boolean): number {
  return shift ? 40 : 10;
}
