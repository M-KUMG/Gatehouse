// Arrow-key movement inside the parts menu: pure index maths, no DOM.
// Tiles sit in a grid (`columns` per row); section headers are a column
// (`columns` = 1). The caller turns a null result into "leave this list".

export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

export function isNavKey(key: string): key is NavKey {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End';
}

/**
 * Index to move to from `current` in a list of `count` items laid out in rows
 * of `columns`. Returns `current` when the key does nothing here (left/right in
 * a single column, or already at the end of a row), and null when the key leads
 * out of the list (up from the first row, down from the last).
 */
export function moveIndex(current: number, key: NavKey, count: number, columns: number): number | null {
  if (count <= 0) return null;
  const cols = Math.max(1, Math.floor(columns));
  const last = count - 1;
  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return last;
    case 'ArrowLeft':
      return cols === 1 ? current : current % cols === 0 ? current : current - 1;
    case 'ArrowRight':
      return cols === 1 ? current : current % cols === cols - 1 || current >= last ? current : current + 1;
    case 'ArrowUp':
      return current - cols >= 0 ? current - cols : null;
    case 'ArrowDown': {
      if (current + cols <= last) return current + cols;
      // A short last row: from an item above it, go to the last item rather than leaving.
      const row = Math.floor(current / cols);
      const lastRow = Math.floor(last / cols);
      return row < lastRow ? last : null;
    }
  }
}
