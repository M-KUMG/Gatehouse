// The Build output window's message list as plain data: grouping and order,
// the location text, and which messages can be clicked (they name a file that
// exists in the board's tree and a line). No DOM.

import { formatBytes } from '../build/buildtext';
import type { BuildMessage, Severity } from '../build/wasm/diagnostics';
import type { CompilerStatus } from '../build/wasm/worker/packs';

const RANK: Record<Severity, number> = { error: 0, warning: 1, note: 2 };

export interface MessageRow {
  message: BuildMessage;
  /** Position in the build's message list (a stable key). */
  index: number;
  /** A note shown under the error or warning it belongs to. */
  indent: boolean;
}

/**
 * Errors first, then warnings, then loose notes; the order the compiler gave
 * is kept inside each kind. A "note:" explains the message before it ("declared
 * here"), so notes stay right under their error or warning and move with it.
 */
export function groupMessages(messages: readonly BuildMessage[]): MessageRow[] {
  const groups: MessageRow[][] = [];
  messages.forEach((message, index) => {
    const last = groups[groups.length - 1];
    if (message.severity === 'note' && last) last.push({ message, index, indent: last[0].message.severity !== 'note' });
    else groups.push([{ message, index, indent: false }]);
  });
  // Array.prototype.sort is stable, so equal severities keep the compiler's order.
  return groups.sort((a, b) => RANK[a[0].message.severity] - RANK[b[0].message.severity]).flat();
}

/** "main.ino:5:3", "main.ino:5", "main.ino" or "" (no file). */
export function locationText(m: Pick<BuildMessage, 'file' | 'line' | 'column'>): string {
  if (!m.file) return '';
  if (!m.line) return m.file;
  return `${m.file}:${m.line}${m.column ? `:${m.column}` : ''}`;
}

/** Where a click on a message goes. */
export interface MessageTarget {
  boardId: string;
  /** Path in the board's tree. */
  path: string;
  line: number;
  column?: number;
}

/** "./src\\a.cpp" -> "src/a.cpp" (the tree's path style). */
export function treePath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

/**
 * The file and position a message points at, or null when it cannot be opened:
 * no file or line, or a file that is not in the board's tree (a library header,
 * a generated file, a file deleted since the build). `files`: the tree's file paths.
 */
export function messageTarget(
  message: Pick<BuildMessage, 'file' | 'line' | 'column'>,
  boardId: string,
  files: ReadonlySet<string> | readonly string[],
): MessageTarget | null {
  if (!message.file || !message.line || message.line < 1) return null;
  const path = treePath(message.file);
  const has = files instanceof Set ? files.has(path) : (files as readonly string[]).includes(path);
  if (!has) return null;
  return { boardId, path, line: message.line, ...(message.column && message.column > 0 ? { column: message.column } : {}) };
}

/** What the collapsible part shows: the "In function ..." lines, then the code and caret lines. */
export function detailText(m: Pick<BuildMessage, 'context' | 'detail'>): string {
  return [m.context, m.detail].filter((x): x is string => x !== undefined && x !== '').join('\n');
}

/** Errors start expanded, warnings and notes collapsed. */
export function startsExpanded(m: Pick<BuildMessage, 'severity'>): boolean {
  return m.severity === 'error';
}

// ---- the compiler row ---------------------------------------------------------------

export type CompilerNote =
  | { kind: 'download'; text: string; button: string }
  | { kind: 'unavailable'; text: string; hint: string; reason: string };

const DEV_HINT = 'In development, run npm run toolchain:fetch and npm run toolchain:packs, then reload. Boards still run their .hex file.';

/** What the window says about the compiler: nothing when it is ready (or not asked yet), a download button, or why it cannot be used. */
export function compilerNote(status: CompilerStatus | null): CompilerNote | null {
  if (!status || status.status === 'ready') return null;
  if (status.status === 'needs-download') {
    return {
      kind: 'download',
      text: 'The compiler is not downloaded yet. It downloads by itself the first time you build, and stays stored for offline use.',
      button: `Download compiler now (${formatBytes(status.downloadBytes)})`,
    };
  }
  const served = /not served/i.test(status.reason);
  const offline = /offline/i.test(status.reason);
  return {
    kind: 'unavailable',
    text: served ? 'The compiler files are not served here' : status.reason,
    hint: offline ? 'Connect once to download them; they stay stored for offline use afterwards.' : DEV_HINT,
    reason: served ? status.reason : '',
  };
}
