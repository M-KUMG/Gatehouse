// What the right-click menu on the grid contains, as plain data (no DOM): built
// from the same facts as the selection toolbar (boardcontrols.ts toolbarButtons),
// so the menu and the toolbar can never disagree about what is possible.
// contextmenu.ts draws it and the Editor runs the chosen action.

import type { ToolbarButtons } from './boardcontrols';

export type MenuItemId = 'run' | 'build' | 'reset' | 'console' | 'rename' | 'edit' | 'rotate' | 'flipH' | 'flipV' | 'duplicate' | 'delete';

export interface MenuItem {
  kind: 'item';
  id: MenuItemId;
  label: string;
  /** The keyboard shortcut, as the keys of a chord ("Ctrl", "D"), or a short note like "Double-click". */
  hint?: readonly string[];
  disabled?: boolean;
  danger?: boolean;
}

export interface MenuSeparator {
  kind: 'separator';
}

export type MenuEntry = MenuItem | MenuSeparator;

export interface MenuModel {
  /** A small heading: what the menu is about ("Resistor", "3 parts"). */
  title: string;
  entries: readonly MenuEntry[];
}

const item = (id: MenuItemId, label: string, extra: Partial<MenuItem> = {}): MenuItem => ({ kind: 'item', id, label, ...extra });

/** Groups of items, joined with one separator between non-empty groups (never at the ends, never doubled). */
function joinGroups(groups: readonly (readonly MenuItem[])[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    if (out.length > 0) out.push({ kind: 'separator' });
    out.push(...group);
  }
  return out;
}

/** The label of the Run entry: the toolbar button's own words, shortened (an error title is a long sentence). */
export function runLabel(run: { icon: 'run' | 'pause'; title: string; error: boolean }): string {
  if (run.error) return 'Build and run again';
  return run.title.split('\n')[0] ?? (run.icon === 'pause' ? 'Pause' : 'Run');
}

/** The menu for the current selection of parts. `buttons` is what the toolbar shows for it; `title` the heading. */
export function partMenu(buttons: ToolbarButtons, title: string): MenuModel {
  const board: MenuItem[] = [];
  if (buttons.board) {
    const b = buttons.board;
    board.push(
      item('run', runLabel(b.run), { disabled: b.run.disabled }),
      item('build', 'Build (compile only)', { disabled: b.build.disabled }),
      item('reset', 'Reset (rebuild from files)', { disabled: b.reset.disabled }),
      item('console', 'Open serial console', { disabled: b.console.disabled }),
      item('rename', 'Rename board…', { disabled: b.rename.disabled }),
    );
  }

  const edit: MenuItem[] = buttons.edit ? [item('edit', 'Edit value…', { hint: ['Double-click'] })] : [];

  const orient: MenuItem[] = [];
  if (buttons.rotate) orient.push(item('rotate', 'Rotate', { hint: ['R'] }));
  if (buttons.flipH) orient.push(item('flipH', 'Flip horizontally', { hint: ['H'] }));
  if (buttons.flipV) orient.push(item('flipV', 'Flip vertically', { hint: ['V'] }));

  const copy: MenuItem[] = buttons.duplicate ? [item('duplicate', 'Duplicate', { hint: ['Ctrl', 'D'] })] : [];
  const remove: MenuItem[] = [item('delete', 'Delete', { hint: ['Del'], danger: true })];

  return { title, entries: joinGroups([board, edit, orient, copy, remove]) };
}

/** The menu for a wire. */
export function wireMenu(): MenuModel {
  return { title: 'Wire', entries: [item('delete', 'Delete wire', { hint: ['Del'], danger: true })] };
}

/** "3 parts" or the part's own name for a single one. */
export function menuTitle(count: number, singleName: string): string {
  return count === 1 ? singleName : `${count} parts`;
}

/** The keys of a hint shown as one string: "Ctrl+D", or "⌘D" on a Mac (where Ctrl is Command and the plus is dropped). */
export function formatHint(hint: readonly string[], mac: boolean): string {
  if (!mac) return hint.join('+');
  return hint.map((k) => (k === 'Ctrl' ? '⌘' : k === 'Del' ? '⌦' : k)).join('');
}
