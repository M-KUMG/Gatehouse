// When the "Downloading the compiler" card shows and what it says, as pure
// functions (the card itself is buildcard.ts). No DOM.
//
// Only packs that really transfer count: what the offline cache serves
// ('fromCache') never shows a card. After the last byte arrives the card stays
// for one more second; a failed build whose cause was a download problem shows
// the reason instead, for a while or until it is clicked.

import type { BoardBuildState } from './build/buildlog';
import { downloadPercent, formatBytesPair, isDownloading, transferred } from './build/buildtext';
import type { DownloadProgress } from './build/compiler';

/** The card stays this long after the download completed. */
export const FINISH_MS = 1000;
/** A download error stays this long (or until it is clicked). */
export const ERROR_MS = 9000;

export type CardMode = 'hidden' | 'downloading' | 'finishing' | 'error';

/**
 * The transferring packs of every board that is downloading (state
 * 'downloading') plus those of a manual download, one entry per pack name (the
 * furthest figures win).
 */
export function activeDownloads(states: readonly BoardBuildState[], manual: readonly DownloadProgress[] = []): DownloadProgress[] {
  const byPack = new Map<string, DownloadProgress>();
  const add = (list: readonly DownloadProgress[]): void => {
    for (const d of transferred(list)) {
      const known = byPack.get(d.pack);
      if (!known || d.loadedBytes > known.loadedBytes || d.totalBytes > known.totalBytes) byPack.set(d.pack, d);
    }
  };
  for (const s of states) if (s.status === 'downloading') add(s.downloads);
  add(manual);
  return [...byPack.values()];
}

export interface DownloadSummary {
  loaded: number;
  total: number;
  /** 0 to 100. */
  percent: number;
  /** "3.2 of 6.0 MB" */
  amount: string;
  /** The pack being fetched now (the last one when all are complete). */
  pack: string;
}

export function summarizeDownloads(downloads: readonly DownloadProgress[]): DownloadSummary | null {
  const list = transferred(downloads);
  if (list.length === 0) return null;
  const total = list.reduce((n, d) => n + d.totalBytes, 0);
  const loaded = list.reduce((n, d) => n + Math.min(d.loadedBytes, d.totalBytes), 0);
  const current = list.find((d) => d.loadedBytes < d.totalBytes) ?? list[list.length - 1];
  return { loaded, total, percent: downloadPercent(list) ?? 100, amount: formatBytesPair(loaded, total), pack: current.pack };
}

/** True while the card should show its progress bar. */
export function downloadActive(states: readonly BoardBuildState[], manual: readonly DownloadProgress[] = []): boolean {
  return isDownloading(activeDownloads(states, manual));
}

const DOWNLOAD_PROBLEM = /download|damaged|gzip|manifest|sha256/i;

/**
 * Why a failed build failed when the cause was getting the compiler (a pack
 * that stopped halfway, or an error that names the download), else null: a
 * code error is for the Build output window, not the card.
 */
export function downloadError(state: BoardBuildState): string | null {
  if (state.status !== 'failed') return null;
  const errors = state.messages.filter((m) => m.severity === 'error');
  const named = errors.find((m) => DOWNLOAD_PROBLEM.test(m.message));
  if (named) return named.message.trim();
  const halfway = transferred(state.downloads).some((d) => d.loadedBytes < d.totalBytes);
  return halfway ? (errors[0]?.message.trim() || state.summary || 'The download did not finish.') : null;
}

export interface ModeInput {
  downloading: boolean;
  /** When a download was last seen in progress (Date.now()), or null. */
  lastDownloadingAt: number | null;
  /** The download problem to show, or null. */
  error: string | null;
  /** When that problem happened. */
  errorAt: number | null;
  now: number;
}

export function cardMode(p: ModeInput): CardMode {
  if (p.downloading) return 'downloading';
  if (p.error !== null && p.errorAt !== null && p.now - p.errorAt < ERROR_MS) return 'error';
  if (p.lastDownloadingAt !== null && p.now - p.lastDownloadingAt < FINISH_MS) return 'finishing';
  return 'hidden';
}
