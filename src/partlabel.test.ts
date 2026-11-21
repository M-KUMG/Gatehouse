import { describe, expect, it } from 'vitest';
import { selectionLabel } from './partlabel';
import type { PlacedPart } from './model';

const part = (typeId: string, state?: PlacedPart['state']): PlacedPart => ({ id: 1, typeId, col: 0, row: 0, rotation: 0, state }) as PlacedPart;

describe('selectionLabel', () => {
  it('is nothing for an empty selection', () => {
    expect(selectionLabel([])).toBeNull();
  });
  it('counts several parts and shows no value', () => {
    expect(selectionLabel([part('resistor'), part('led')])).toEqual({ title: '2 parts', value: '' });
  });
  it('shows a part with its value, or its default value', () => {
    expect(selectionLabel([part('resistor', { value: 4700 })])).toMatchObject({ title: expect.stringMatching(/resistor/i), value: '4.7 kΩ' });
    const plain = selectionLabel([part('resistor')]);
    expect(plain?.value).toMatch(/Ω$/);
  });
  it('shows a part without a value by its name only, and a board by its own name', () => {
    expect(selectionLabel([part('led')])?.value).toBe('');
    expect(selectionLabel([part('uno')], 'Robot')).toEqual({ title: 'Robot', value: '' });
  });
});
