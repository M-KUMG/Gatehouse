// Every keyboard and mouse shortcut of the app, as plain data for the
// shortcuts sheet (shortcutsheet.ts). No DOM here. When a shortcut is added or
// changed in the code, change it here too (the key handlers are in
// interaction.ts, project/controller.ts, palette.ts and draggablebar.ts).

/** One way to do something: the keys of a chord, pressed together ("Ctrl", "Shift", "Z") or one mouse gesture. */
export type Chord = readonly string[];

export interface Shortcut {
  label: string;
  /** Alternatives: any one of them does it. */
  keys: readonly Chord[];
}

export interface ShortcutGroup {
  title: string;
  items: readonly Shortcut[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Editing',
    items: [
      { label: 'Select a part or wire', keys: [['Click']] },
      { label: 'Add to the selection', keys: [['Shift', 'Click']] },
      { label: 'Selection box', keys: [['Drag on empty grid']] },
      { label: 'Select all', keys: [['Ctrl', 'A']] },
      { label: 'Rotate (also while placing)', keys: [['R']] },
      { label: 'Flip horizontally / vertically', keys: [['H'], ['V']] },
      { label: 'Duplicate', keys: [['Ctrl', 'D']] },
      { label: 'Delete', keys: [['Delete'], ['Backspace']] },
      { label: 'Edit the value of a part', keys: [['Double-click']] },
      { label: 'Clear the selection / cancel', keys: [['Esc']] },
      { label: 'Undo', keys: [['Ctrl', 'Z']] },
      { label: 'Redo', keys: [['Ctrl', 'Y'], ['Ctrl', 'Shift', 'Z']] },
    ],
  },
  {
    title: 'Wiring',
    items: [
      { label: 'Start a wire', keys: [['Drag from a pin']] },
      { label: 'Add a corner', keys: [['Click on the grid']] },
      { label: 'Finish on a pin or a wire', keys: [['Click it']] },
      { label: 'Remove the last corner', keys: [['Backspace']] },
      { label: 'Cancel the wire', keys: [['Esc']] },
    ],
  },
  {
    title: 'View',
    items: [
      { label: 'Move the grid', keys: [['Middle drag'], ['Right drag']] },
      { label: 'Zoom', keys: [['Mouse wheel']] },
      { label: 'Zoom in / out one step', keys: [['+'], ['−']] },
      { label: 'Back to 100%', keys: [['0']] },
      { label: 'Fit everything in view', keys: [['F']] },
    ],
  },
  {
    title: 'Simulation',
    items: [{ label: 'Start / pause everything', keys: [['Space']] }],
  },
  {
    title: 'Project',
    items: [
      { label: 'Save', keys: [['Ctrl', 'S']] },
      { label: 'Save as…', keys: [['Ctrl', 'Shift', 'S']] },
      { label: 'Open…', keys: [['Ctrl', 'O']] },
    ],
  },
  {
    title: 'Parts menu',
    items: [
      { label: 'Move between sections and parts', keys: [['↑'], ['↓'], ['←'], ['→']] },
      { label: 'Open / close a section', keys: [['Enter'], ['Space']] },
      { label: 'Add the focused part to the grid', keys: [['Enter'], ['Space']] },
      { label: 'Drag a part onto the grid', keys: [['Drag']] },
    ],
  },
  {
    title: 'Help',
    items: [
      { label: 'This sheet', keys: [['?']] },
      { label: 'Close it', keys: [['Esc']] },
    ],
  },
];

const MAC_KEYS: Readonly<Record<string, string>> = { Ctrl: '⌘', Shift: '⇧', Alt: '⌥', Delete: '⌦', Backspace: '⌫', Enter: '↩' };

/** How a key is shown: "Ctrl" is "⌘" on a Mac (and Shift, Alt, Delete... get the Mac symbols); everything else is as written. */
export function formatKey(key: string, mac: boolean): string {
  return mac ? (MAC_KEYS[key] ?? key) : key;
}

/** True on a Mac (where Ctrl shortcuts are Command shortcuts). */
export function isMacPlatform(platform: string): boolean {
  return /^Mac|iPhone|iPad|iPod/.test(platform);
}
