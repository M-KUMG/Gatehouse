import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeWhenPointerLeaves, MENU_LEAVE_MS, setBarMenuOpen } from './barmenu';

// The bar, its two menus and the classes, as plain objects: enough for setBarMenuOpen (no DOM in these tests).
function setup() {
  const classes = new Set<string>();
  const vars = new Map<string, string>();
  const menus = [{ hidden: true, offsetHeight: 100 }, { hidden: true, offsetHeight: 40 }];
  const bar = {
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    style: { setProperty: (k: string, v: string) => vars.set(k, v) },
    querySelector: () => (menus.some((m) => !m.hidden) ? {} : null),
  };
  const wrap = { closest: () => bar } as unknown as HTMLElement;
  const toggle = (i: number, open: boolean): void => {
    menus[i].hidden = !open;
    setBarMenuOpen(wrap, menus[i] as unknown as HTMLElement, open);
  };
  return { classes, vars, toggle };
}

describe('bar menus', () => {
  it('opening sets the bar open with the list height, closing the only open menu folds it', () => {
    const { classes, vars, toggle } = setup();
    toggle(0, true);
    expect(classes.has('menu-open')).toBe(true);
    expect(vars.get('--gh-bar-menu-h')).toBe('100px');
    toggle(0, false);
    expect(classes.has('menu-open')).toBe(false);
  });

  it('a menu that closes late does not fold the bar around the menu opened after it', () => {
    const { classes, vars, toggle } = setup();
    toggle(0, true); // Windows
    toggle(0, false); // an outside press closes it...
    toggle(1, true); // ...and the click opens Graphics
    toggle(0, false); // then the Windows menu's own "mouse left" timer fires
    expect(classes.has('menu-open')).toBe(true);
    expect(vars.get('--gh-bar-menu-h')).toBe('40px');
    toggle(1, false);
    expect(classes.has('menu-open')).toBe(false);
  });
});

describe('closing a bar menu when the pointer leaves', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setup(open = true) {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const handlers = new Map<string, () => void>();
    const wrap = { addEventListener: (type: string, fn: () => void) => handlers.set(type, fn) } as unknown as HTMLElement;
    let isOpen = open;
    let closed = 0;
    const cancel = closeWhenPointerLeaves(wrap, () => isOpen, () => ((isOpen = false), closed++));
    return { handlers, cancel, closed: () => closed, setOpen: (v: boolean) => (isOpen = v) };
  }

  it('closes after the grace period', () => {
    const s = setup();
    s.handlers.get('pointerleave')!();
    vi.advanceTimersByTime(MENU_LEAVE_MS - 1);
    expect(s.closed()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(s.closed()).toBe(1);
  });

  it('stays open when the pointer comes back in time, or when the menu was not open', () => {
    const s = setup();
    s.handlers.get('pointerleave')!();
    vi.advanceTimersByTime(100);
    s.handlers.get('pointerenter')!();
    vi.advanceTimersByTime(1000);
    expect(s.closed()).toBe(0);
    const t = setup(false);
    t.handlers.get('pointerleave')!();
    vi.advanceTimersByTime(1000);
    expect(t.closed()).toBe(0);
  });

  it('cancel drops a pending close (the menu was closed or reopened some other way)', () => {
    const s = setup();
    s.handlers.get('pointerleave')!();
    s.cancel();
    vi.advanceTimersByTime(1000);
    expect(s.closed()).toBe(0);
  });
});
