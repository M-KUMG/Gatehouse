import { describe, expect, it } from 'vitest';
import { closeAnswer, closeHost } from './closehost';

describe('closeAnswer', () => {
  it('Cancel keeps the window, Don\'t save closes it', () => {
    expect(closeAnswer('cancel', true)).toBe('stay');
    expect(closeAnswer('discard', true)).toBe('close');
  });
  it('Save closes only when the changes really got saved (a cancelled or failed save keeps the window)', () => {
    expect(closeAnswer('save', false)).toBe('close');
    expect(closeAnswer('save', true)).toBe('stay');
  });
  it('there is no close host outside Electron', () => {
    expect(closeHost()).toBeNull();
  });
});
