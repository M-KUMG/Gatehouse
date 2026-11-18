import { describe, expect, it } from 'vitest';
import { idleBuildState, type BoardBuildState } from '../build/buildlog';
import { AutoOpen } from './buildautoopen';

const failed = (startedAt: number, finishedAt: number): BoardBuildState => ({ ...idleBuildState(), status: 'failed', startedAt, finishedAt });
const ok = (startedAt: number, finishedAt: number): BoardBuildState => ({ ...idleBuildState(), status: 'succeeded', startedAt, finishedAt });

describe('opening the Build output window after a failed build', () => {
  it('opens a closed window once for a failure', () => {
    const a = new AutoOpen();
    expect(a.shouldOpen(1, failed(10, 20), false)).toBe(true);
    expect(a.shouldOpen(1, failed(10, 20), false)).toBe(false); // the user closed it again: same failure
  });

  it('does not open for a build that is running, succeeded or never ran', () => {
    const a = new AutoOpen();
    expect(a.shouldOpen(1, idleBuildState(), false)).toBe(false);
    expect(a.shouldOpen(1, { ...idleBuildState(), status: 'building', startedAt: 1 }, false)).toBe(false);
    expect(a.shouldOpen(1, ok(1, 2), false)).toBe(false);
  });

  it('does not open an open window, and counts that failure as seen', () => {
    const a = new AutoOpen();
    expect(a.shouldOpen(1, failed(10, 20), true)).toBe(false);
    expect(a.shouldOpen(1, failed(10, 20), false)).toBe(false); // closed afterwards: not again
  });

  it('opens again for the next failure of the same board', () => {
    const a = new AutoOpen();
    a.shouldOpen(1, failed(10, 20), false);
    expect(a.shouldOpen(1, failed(30, 40), false)).toBe(true);
  });

  it('keeps every board apart', () => {
    const a = new AutoOpen();
    expect(a.shouldOpen(1, failed(10, 20), false)).toBe(true);
    expect(a.shouldOpen(2, failed(10, 20), false)).toBe(true);
  });

  it('forgets a deleted board or every board', () => {
    const a = new AutoOpen();
    a.shouldOpen(1, failed(10, 20), false);
    a.shouldOpen(2, failed(10, 20), false);
    a.forget(1);
    expect(a.shouldOpen(1, failed(10, 20), false)).toBe(true);
    expect(a.shouldOpen(2, failed(10, 20), false)).toBe(false);
    a.forget(null);
    expect(a.shouldOpen(2, failed(10, 20), false)).toBe(true);
  });
});
