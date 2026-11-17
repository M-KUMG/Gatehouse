// Small line icons of the File explorer (16 x 16, they take the text colour).

const svg = (body: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const FILE = '<path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/>';
const FOLDER = '<path d="M1.5 4h4l1.5 1.5h7.5v8h-13z"/>';

export const ICONS = {
  file: svg(FILE),
  code: svg(`${FILE}<path d="M7 8.5 5.7 10 7 11.5M9 8.5l1.3 1.5L9 11.5"/>`),
  json: svg(`${FILE}<path d="M7 7.5c-1 0-1 .8-1 1.5s-.5 1-1 1c.5 0 1 .3 1 1s0 1.5 1 1.5M9 7.5c1 0 1 .8 1 1.5s.5 1 1 1c-.5 0-1 .3-1 1s0 1.5-1 1.5"/>`),
  folder: svg(FOLDER),
  boards: svg(`${FOLDER}<path d="M5.5 9h5"/>`),
  board: svg('<rect x="3.5" y="3.5" width="9" height="9" rx="1"/><path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2"/>'),
  project: svg('<path d="M8 1.5l6 3v7l-6 3-6-3v-7z"/><path d="M2 4.5l6 3 6-3M8 7.5v7"/>'),
  lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
  chevron: svg('<path d="M6 4l4 4-4 4"/>'),
  newFile: svg(`${FILE}<path d="M8 8v4M6 10h4"/>`),
  newFolder: svg(`${FOLDER}<path d="M8 7.5v4M6 9.5h4"/>`),
  import: svg('<path d="M8 2v7M5.5 6.5 8 9l2.5-2.5M2.5 10v3.5h11V10"/>'),
  rename: svg('<path d="M3 13l.5-3L11 2.5 13.5 5 6 12.5z"/><path d="M9.5 4l2.5 2.5"/>'),
  trash: svg('<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5"/>'),
};

export type IconName = keyof typeof ICONS;
