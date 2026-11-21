import { describe, expect, it } from 'vitest';
import { shouldShowWelcome } from './welcomemodel';

describe('shouldShowWelcome', () => {
  it('shows on a completely empty grid', () => {
    expect(shouldShowWelcome({ parts: 0, wires: 0, dismissed: false })).toBe(true);
  });

  it('hides as soon as there is a part or a wire', () => {
    expect(shouldShowWelcome({ parts: 1, wires: 0, dismissed: false })).toBe(false);
    expect(shouldShowWelcome({ parts: 0, wires: 2, dismissed: false })).toBe(false);
    expect(shouldShowWelcome({ parts: 3, wires: 5, dismissed: false })).toBe(false);
  });

  it('stays hidden once the user closed it', () => {
    expect(shouldShowWelcome({ parts: 0, wires: 0, dismissed: true })).toBe(false);
  });
});
