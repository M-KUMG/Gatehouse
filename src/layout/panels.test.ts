import { describe, expect, it } from 'vitest';
import { EDITOR_ID, WINDOWS, isClosable, tabMenuItems } from './panels';

describe('closable panels', () => {
  it('never closes the Circuit panel', () => {
    expect(isClosable(EDITOR_ID)).toBe(false);
    expect(tabMenuItems(EDITOR_ID)).not.toContain('close');
    expect(tabMenuItems(EDITOR_ID)).toContain('float');
  });

  it('lets every other window close and float', () => {
    for (const w of WINDOWS) {
      expect(isClosable(w.id)).toBe(true);
      expect(tabMenuItems(w.id)).toEqual(['float', 'separator', 'close']);
    }
  });
});
