import { describe, expect, it } from 'vitest';
import { PartFollower, formatQuantity } from './follow';

describe('PartFollower', () => {
  const exists = (ids: number[]) => (id: number) => ids.includes(id);

  it('follows the primary (last added) selected part; nothing selected shows nothing', () => {
    const f = new PartFollower();
    expect(f.current([], exists([1, 2]))).toBeNull();
    expect(f.current([2], exists([1, 2]))).toBe(2);
    expect(f.current(new Set([2, 1]), exists([1, 2]))).toBe(1);
    // Stale ids (a deleted part still in the set) are skipped.
    expect(f.current([1, 9], exists([1, 2]))).toBe(1);
    expect(f.current([9], exists([1, 2]))).toBeNull();
  });

  it('a pinned part stays whatever is selected, until unpinned or deleted', () => {
    const f = new PartFollower();
    f.pin(2);
    expect(f.current([1], exists([1, 2]))).toBe(2);
    expect(f.current([], exists([1, 2]))).toBe(2);
    f.pin(null);
    expect(f.current([1], exists([1, 2]))).toBe(1);
    f.pin(2);
    expect(f.current([1], exists([1]))).toBe(1); // part 2 deleted: following again
    expect(f.pinned).toBeNull();
  });
});

describe('formatQuantity', () => {
  it('formats SI values, text, undefined numbers, percentages and plain ratios', () => {
    expect(formatQuantity({ id: 'ic', label: 'Ic', kind: 'current', unit: 'A', value: 0.0213 })).toBe('21.3 mA');
    expect(formatQuantity({ id: 'region', label: 'Region', kind: 'text', unit: '', value: NaN, text: 'saturation' })).toBe('saturation');
    expect(formatQuantity({ id: 'beta', label: 'β', kind: 'ratio', unit: '', value: NaN })).toBe('–');
    expect(formatQuantity({ id: 'beta', label: 'β', kind: 'ratio', unit: '', value: 287.46 })).toBe('287');
    expect(formatQuantity({ id: 'b', label: 'Brightness', kind: 'ratio', unit: '%', value: 30.78 })).toBe('31 %');
    expect(formatQuantity({ id: 'b', label: 'Brightness', kind: 'ratio', unit: '%', value: 3.21 })).toBe('3.2 %');
  });
});
