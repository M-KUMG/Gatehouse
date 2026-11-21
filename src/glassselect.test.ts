import { describe, expect, it } from 'vitest';
import { edgeEntry, findByPrefix, stepEntry, type ListEntry } from './glassselect';

const e = (label: string, disabled = false): ListEntry => ({ label, disabled });
const list = [e('Auto'), e('Sine'), e('Square', true), e('Triangle'), e('Sawtooth')];

describe('dropdown list navigation', () => {
  it('steps over disabled entries and stops at the ends', () => {
    expect(stepEntry(list, 1, 1)).toBe(3);
    expect(stepEntry(list, 3, -1)).toBe(1);
    expect(stepEntry(list, 4, 1)).toBe(4);
    expect(stepEntry(list, 0, -1)).toBe(0);
  });
  it('finds the first and last enabled entry', () => {
    expect(edgeEntry(list, false)).toBe(0);
    expect(edgeEntry(list, true)).toBe(4);
    expect(edgeEntry([e('x', true)], false)).toBe(-1);
    expect(edgeEntry([], true)).toBe(-1);
  });
  it('jumps to the next entry that starts with the typed text, wrapping, skipping disabled', () => {
    expect(findByPrefix(list, 0, 's')).toBe(1);
    expect(findByPrefix(list, 1, 's')).toBe(4); // Square is disabled
    expect(findByPrefix(list, 4, 's')).toBe(1); // wraps
    expect(findByPrefix(list, 0, 'TRI')).toBe(3);
    expect(findByPrefix(list, 0, 'z')).toBe(-1);
    expect(findByPrefix(list, 0, '')).toBe(-1);
  });
});
