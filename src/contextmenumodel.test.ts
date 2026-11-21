import { describe, expect, it } from 'vitest';
import type { ToolbarButtons } from './boardcontrols';
import { formatHint, menuTitle, partMenu, runLabel, wireMenu, type MenuEntry } from './contextmenumodel';

const simple: ToolbarButtons = { rotate: true, flipH: false, flipV: false, duplicate: true, edit: false, board: null };
const board = (over: Partial<ToolbarButtons['board'] & object> = {}): ToolbarButtons => ({
  rotate: true,
  flipH: false,
  flipV: false,
  duplicate: true,
  edit: false,
  board: {
    run: { icon: 'run', title: 'Run', disabled: false, error: false },
    build: { title: 'Build (compile only)', disabled: false, error: false },
    reset: { title: 'Reset (rebuild from files)', disabled: false },
    console: { title: 'Open serial console', disabled: false },
    rename: { title: 'Rename board (display name only)', disabled: false },
    ...over,
  },
});

const ids = (entries: readonly MenuEntry[]): string[] => entries.map((e) => (e.kind === 'separator' ? '---' : e.id));

describe('partMenu for a plain part', () => {
  it('offers rotate, duplicate and delete, grouped, with delete last and marked dangerous', () => {
    const m = partMenu(simple, 'Resistor');
    expect(m.title).toBe('Resistor');
    expect(ids(m.entries)).toEqual(['rotate', '---', 'duplicate', '---', 'delete']);
    const last = m.entries.at(-1);
    expect(last).toMatchObject({ kind: 'item', id: 'delete', danger: true });
  });

  it('adds Edit value first when the part has a value, and the flips when it can be mirrored', () => {
    const m = partMenu({ ...simple, edit: true, flipH: true, flipV: true }, 'LED');
    expect(ids(m.entries)).toEqual(['edit', '---', 'rotate', 'flipH', 'flipV', '---', 'duplicate', '---', 'delete']);
  });

  it('never starts or ends with a separator or doubles one', () => {
    for (const buttons of [simple, board(), { ...simple, rotate: false, duplicate: false }]) {
      const entries = partMenu(buttons, 'x').entries;
      expect(entries[0]?.kind).toBe('item');
      expect(entries.at(-1)?.kind).toBe('item');
      entries.forEach((e, i) => {
        if (e.kind === 'separator') expect(entries[i + 1]?.kind).toBe('item');
      });
    }
  });

  it('still offers Delete when nothing else applies', () => {
    expect(ids(partMenu({ ...simple, rotate: false, duplicate: false }, 'x').entries)).toEqual(['delete']);
  });
});

describe('partMenu for a board', () => {
  it('puts the board actions first', () => {
    const m = partMenu(board(), 'Arduino Uno #1');
    expect(ids(m.entries).slice(0, 6)).toEqual(['run', 'build', 'reset', 'console', 'rename', '---']);
  });

  it('carries the disabled state of the toolbar buttons', () => {
    const m = partMenu(board({ run: { icon: 'run', title: 'Building…', disabled: true, error: false }, build: { title: 'Building…', disabled: true, error: false } }), 'Uno');
    const get = (id: string) => m.entries.find((e) => e.kind === 'item' && e.id === id);
    expect(get('run')).toMatchObject({ disabled: true });
    expect(get('build')).toMatchObject({ disabled: true });
    expect(get('console')).toMatchObject({ disabled: false });
  });
});

describe('runLabel', () => {
  it('uses the toolbar words', () => {
    expect(runLabel({ icon: 'run', title: 'Run', error: false })).toBe('Run');
    expect(runLabel({ icon: 'pause', title: 'Pause', error: false })).toBe('Pause');
    expect(runLabel({ icon: 'run', title: 'Run (continue)', error: false })).toBe('Run (continue)');
  });

  it('shortens an error title to something that fits a menu', () => {
    expect(runLabel({ icon: 'run', title: 'Error: avr-gcc exploded\nClick to build and run again', error: true })).toBe('Build and run again');
  });
});

describe('wireMenu, menuTitle and formatHint', () => {
  it('has just Delete wire', () => {
    expect(ids(wireMenu().entries)).toEqual(['delete']);
  });

  it('titles a single part by name and several by count', () => {
    expect(menuTitle(1, 'Resistor')).toBe('Resistor');
    expect(menuTitle(3, 'Resistor')).toBe('3 parts');
  });

  it('writes a hint with plus signs, or with Mac symbols and no plus on a Mac', () => {
    expect(formatHint(['Ctrl', 'D'], false)).toBe('Ctrl+D');
    expect(formatHint(['Ctrl', 'D'], true)).toBe('⌘D');
    expect(formatHint(['Double-click'], false)).toBe('Double-click');
    expect(formatHint(['Del'], true)).toBe('⌦');
  });
});
