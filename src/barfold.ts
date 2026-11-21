// Where the value and name editors go while a part is selected: INTO the part bar
// (toolbar.ts), which unfolds downward to hold them, instead of a popup window
// appearing from nowhere. The editors work against this small interface; with no
// host (the bar is not on screen) they fall back to their old popup.

export interface FoldHost {
  /** True when the bar is on screen and can hold an editor. */
  available(): boolean;
  /** Put `content` in the bar's fold and unfold it. */
  show(content: HTMLElement): void;
  /** Fold the bar back up if `content` is still what it shows (and remove the content when the fold has closed). */
  hide(content: HTMLElement): void;
}

export type FoldHostProvider = () => FoldHost | null;
