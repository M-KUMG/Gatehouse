// The optional display name of a board (part state `name`). Pure, no DOM.
//
// Rules: surrounding white space is dropped, inner runs of white space become
// one space, and what is left must be 1 to 40 characters (code points, so an
// emoji counts once) without control characters or line breaks. Letters of any
// script, digits and punctuation are fine, and two boards may share a name.
// An empty name means "no custom name": the board shows its default label
// ("Arduino Uno #1"). The folder id (uno-1) is not affected by any of this.

export const MAX_BOARD_NAME_LENGTH = 40;

/** Control characters (also tab and newline) and the Unicode line / paragraph separators. */
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** `name` is null when the input was empty: remove the custom name. */
export type BoardNameResult = { ok: true; name: string | null } | { ok: false; error: string };

export function normalizeBoardName(input: string): BoardNameResult {
  if (FORBIDDEN.test(input)) return { ok: false, error: 'A board name cannot contain control characters or line breaks.' };
  const name = input.trim().replace(/\s+/g, ' ');
  if (name === '') return { ok: true, name: null };
  const length = [...name].length;
  if (length > MAX_BOARD_NAME_LENGTH) {
    return { ok: false, error: `A board name can be at most ${MAX_BOARD_NAME_LENGTH} characters (this one has ${length}).` };
  }
  return { ok: true, name };
}
