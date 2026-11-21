import { describe, expect, it } from 'vitest';
import { dropBox } from './droplight';

describe('dropBox', () => {
  it('is the option box inside its container', () => {
    expect(dropBox({ offsetLeft: 4, offsetTop: 62, offsetWidth: 180, offsetHeight: 28 })).toEqual({ left: 4, top: 62, width: 180, height: 28 });
  });
});

describe('offsetWithin', () => {
  it('adds up the offsets of the wrappers between an option and its container', async () => {
    const { offsetWithin } = await import('./droplight');
    const container = { offsetLeft: 0, offsetTop: 0, offsetParent: null } as unknown as HTMLElement;
    const wrapper = { offsetLeft: 30, offsetTop: 2, offsetParent: container } as unknown as HTMLElement;
    const item = { offsetLeft: 4, offsetTop: 1, offsetParent: wrapper } as unknown as HTMLElement;
    expect(offsetWithin(item, container)).toEqual({ left: 34, top: 3 });
    const direct = { offsetLeft: 7, offsetTop: 9, offsetParent: container } as unknown as HTMLElement;
    expect(offsetWithin(direct, container)).toEqual({ left: 7, top: 9 });
    const stray = { offsetLeft: 5, offsetTop: 6, offsetParent: null } as unknown as HTMLElement;
    expect(offsetWithin(stray, container)).toEqual({ left: 5, top: 6 });
  });
});
