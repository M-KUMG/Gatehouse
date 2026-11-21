import { describe, expect, it } from 'vitest';
import { EMPTY_PREVIEW, GRACE_MS, stepPreview, type Box } from './droppreview';

const a: Box = { left: 0, top: 0, width: 300, height: 400 };
const b: Box = { left: 300, top: 0, width: 200, height: 400 };

describe('drop preview card', () => {
  it('appears without sliding in from the last place, at the first rectangle', () => {
    const s = stepPreview(EMPTY_PREVIEW, a, 100);
    expect(s).toMatchObject({ visible: true, jump: true, box: a });
    expect(s.state).toEqual({ shown: true, box: a, lastSeen: 100 });
  });
  it('glides to the next rectangle of the same window', () => {
    const s1 = stepPreview(EMPTY_PREVIEW, a, 0).state;
    const s2 = stepPreview(s1, { ...a, width: 150 }, 50);
    expect(s2.jump).toBe(false);
    expect(s2.box?.width).toBe(150);
  });
  it('stays where it was while the pointer is between two windows, then glides to the next one', () => {
    const s1 = stepPreview(EMPTY_PREVIEW, a, 0).state;
    const gap = stepPreview(s1, null, 60);
    expect(gap).toMatchObject({ visible: true, jump: false, box: a });
    const next = stepPreview(gap.state, b, 120);
    expect(next).toMatchObject({ visible: true, jump: false, box: b });
  });
  it('fades out when no rectangle comes back within the grace time, and keeps its last place', () => {
    const s1 = stepPreview(EMPTY_PREVIEW, a, 0).state;
    const gone = stepPreview(s1, null, GRACE_MS + 1);
    expect(gone.visible).toBe(false);
    expect(gone.box).toEqual(a);
    expect(gone.state.shown).toBe(false);
    // Coming back later starts fresh (a jump, no slide from the old place).
    expect(stepPreview(gone.state, b, GRACE_MS + 50).jump).toBe(true);
  });
  it('nothing to show without a rectangle from the start', () => {
    expect(stepPreview(EMPTY_PREVIEW, null, 10)).toMatchObject({ visible: false, box: null });
  });
});
