// The words and numbers the build UI shows (Build output window, status chip,
// download card), as pure functions of a board's BoardBuildState. No DOM.

import type { BoardBuildState } from './buildlog';
import type { DownloadProgress } from './compiler';

/** 1064 -> "1,064" (fixed format, not the browser's locale). */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const MB = 1024 * 1024;
const KB = 1024;

/** "6.0 MB", "512 KB", "40 bytes". */
export function formatBytes(n: number): string {
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  if (n >= KB) return `${Math.round(n / KB)} KB`;
  return `${Math.round(n)} bytes`;
}

/** "3.2 of 6.0 MB": both numbers in the unit of the total. */
export function formatBytesPair(loaded: number, total: number): string {
  if (total >= MB) return `${(loaded / MB).toFixed(1)} of ${(total / MB).toFixed(1)} MB`;
  if (total >= KB) return `${Math.round(loaded / KB)} of ${Math.round(total / KB)} KB`;
  return `${Math.round(loaded)} of ${Math.round(total)} bytes`;
}

/** "0.42 s" */
export function durationText(ms: number): string {
  return `${(Math.max(ms, 0) / 1000).toFixed(2)} s`;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---- downloads -----------------------------------------------------------------

/** The downloads that really transfer (what came from the offline cache never shows a card). */
export function transferred(downloads: readonly DownloadProgress[]): DownloadProgress[] {
  return downloads.filter((d) => !d.fromCache);
}

/** True while a transferred pack is not complete. */
export function isDownloading(downloads: readonly DownloadProgress[]): boolean {
  return transferred(downloads).some((d) => d.loadedBytes < d.totalBytes);
}

/** Overall percent of the transferred packs (0 to 100), or null when nothing is transferred. */
export function downloadPercent(downloads: readonly DownloadProgress[]): number | null {
  const list = transferred(downloads);
  const total = list.reduce((n, d) => n + d.totalBytes, 0);
  if (list.length === 0) return null;
  if (total <= 0) return 100;
  const loaded = list.reduce((n, d) => n + Math.min(d.loadedBytes, d.totalBytes), 0);
  return Math.min(100, Math.floor((loaded / total) * 100));
}

// ---- progress and header -----------------------------------------------------------

/** What a running build is doing: "Downloading compiler 45%", "Compiling main.ino (1/3)", "Linking". */
export function progressText(state: BoardBuildState): string {
  if (state.status === 'downloading') {
    const pct = downloadPercent(state.downloads);
    return pct === null ? 'Downloading compiler' : `Downloading compiler ${pct}%`;
  }
  return state.progress?.message || 'Building';
}

export function countMessages(state: Pick<BoardBuildState, 'messages'>): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const m of state.messages) {
    if (m.severity === 'error') errors++;
    else if (m.severity === 'warning') warnings++;
  }
  return { errors, warnings };
}

export type HeaderTone = 'idle' | 'busy' | 'ok' | 'error';

export interface BuildHeader {
  tone: HeaderTone;
  text: string;
}

/** The status line at the top of the Build output window. */
export function buildHeader(state: BoardBuildState): BuildHeader {
  switch (state.status) {
    case 'idle':
      return { tone: 'idle', text: 'No build yet. Press Build or Run.' };
    case 'downloading':
      return { tone: 'busy', text: `${progressText(state)}${downloadPercent(state.downloads) === null ? '…' : ''}` };
    case 'building':
      return { tone: 'busy', text: `${progressText(state)}…` };
    case 'failed': {
      const { errors, warnings } = countMessages(state);
      if (errors === 0) return { tone: 'error', text: state.summary || 'Build failed' };
      const parts = [plural(errors, 'error'), ...(warnings > 0 ? [plural(warnings, 'warning')] : [])];
      return { tone: 'error', text: `Build failed: ${parts.join(', ')}` };
    }
    case 'succeeded': {
      if (state.source === 'firmware-file') return { tone: 'ok', text: state.summary || 'Firmware file loaded (not compiled)' };
      const { warnings } = countMessages(state);
      const time = state.durationMs !== undefined ? ` in ${durationText(state.durationMs)}` : '';
      return { tone: 'ok', text: `Build succeeded${time}${warnings > 0 ? ` with ${plural(warnings, 'warning')}` : ''}` };
    }
  }
}

// ---- flash and RAM -----------------------------------------------------------------

export type UsageLevel = 'ok' | 'warn' | 'full';

export interface UsageBar {
  kind: 'flash' | 'ram';
  /** "Flash" or "RAM". */
  label: string;
  /** "Sketch uses 1,064 of 32,256 bytes (3%)" */
  text: string;
  /** Rounded percent of the maximum; may be above 100. */
  percent: number;
  /** Width of the filled part, 0 to 100. */
  fill: number;
  level: UsageLevel;
}

/** Rounded percent used, 0 when the maximum is unknown. */
export function usagePercent(used: number, max: number): number {
  return max > 0 ? Math.round((used / max) * 100) : 0;
}

function usageBar(kind: UsageBar['kind'], used: number, max: number): UsageBar {
  const percent = usagePercent(used, max);
  const lead = kind === 'flash' ? 'Sketch uses' : 'Globals use';
  return {
    kind,
    label: kind === 'flash' ? 'Flash' : 'RAM',
    text: `${lead} ${formatCount(used)} of ${formatCount(max)} bytes (${percent}%)`,
    percent,
    fill: Math.min(100, Math.max(0, percent)),
    level: used > max ? 'full' : percent >= 90 ? 'warn' : 'ok',
  };
}

/** The flash and RAM bars of a finished build (none while the figures are unknown, e.g. a .hex file). */
export function usageBars(state: BoardBuildState): UsageBar[] {
  const bars: UsageBar[] = [];
  if (state.flashBytes !== undefined && state.flashMax !== undefined) bars.push(usageBar('flash', state.flashBytes, state.flashMax));
  if (state.ramBytes !== undefined && state.ramMax !== undefined) bars.push(usageBar('ram', state.ramBytes, state.ramMax));
  return bars;
}
