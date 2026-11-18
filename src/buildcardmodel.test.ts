import { describe, expect, it } from 'vitest';
import { idleBuildState, type BoardBuildState } from './build/buildlog';
import type { DownloadProgress } from './build/compiler';
import { ERROR_MS, FINISH_MS, activeDownloads, cardMode, downloadActive, downloadError, summarizeDownloads } from './buildcardmodel';

const MB = 1024 * 1024;
const state = (s: Partial<BoardBuildState>): BoardBuildState => ({ ...idleBuildState(), ...s });
const dl = (pack: string, loadedBytes: number, totalBytes: number, fromCache = false): DownloadProgress => ({ pack, loadedBytes, totalBytes, fromCache });
const err = (message: string) => ({ severity: 'error' as const, message, raw: message });

describe('which downloads the card shows', () => {
  it('shows a pack that is transferring for a board in the downloading state', () => {
    const s = state({ status: 'downloading', downloads: [dl('compiler', 3.2 * MB, 6 * MB)] });
    expect(downloadActive([s])).toBe(true);
    expect(activeDownloads([s])).toEqual([dl('compiler', 3.2 * MB, 6 * MB)]);
  });

  it('never shows loads from the offline cache', () => {
    const s = state({ status: 'building', downloads: [dl('compiler', 6 * MB, 6 * MB, true)] });
    expect(downloadActive([s])).toBe(false);
    expect(downloadActive([state({ status: 'downloading', downloads: [dl('compiler', 1, 6 * MB, true)] })])).toBe(false);
    expect(activeDownloads([s])).toEqual([]);
  });

  it('is not active once every pack is complete, or when no board is downloading', () => {
    expect(downloadActive([state({ status: 'downloading', downloads: [dl('a', 10, 10), dl('b', 5, 5)] })])).toBe(false);
    expect(downloadActive([state({ status: 'building', downloads: [dl('a', 1, 10)] })])).toBe(false);
    expect(downloadActive([])).toBe(false);
  });

  it('follows a manual download too, one entry per pack with the furthest figures', () => {
    expect(downloadActive([], [dl('compiler', 1, 10)])).toBe(true);
    const merged = activeDownloads([state({ status: 'downloading', downloads: [dl('compiler', 5, 10)] })], [dl('compiler', 8, 10), dl('core', 0, 4)]);
    expect(merged).toEqual([dl('compiler', 8, 10), dl('core', 0, 4)]);
  });
});

describe('what the card says', () => {
  it('shows the amount, the percentage and the pack in progress', () => {
    const s = summarizeDownloads([dl('core', 2 * MB, 2 * MB), dl('compiler', 1.2 * MB, 4 * MB)]);
    expect(s).toMatchObject({ amount: '3.2 of 6.0 MB', percent: 53, pack: 'compiler' });
  });

  it('names the last pack when all are complete, and nothing without a transfer', () => {
    expect(summarizeDownloads([dl('a', 1, 1), dl('b', 2, 2)])?.pack).toBe('b');
    expect(summarizeDownloads([dl('a', 1, 1, true)])).toBeNull();
    expect(summarizeDownloads([])).toBeNull();
  });
});

describe('when the card shows', () => {
  const base = { downloading: false, lastDownloadingAt: null, error: null, errorAt: null, now: 100_000 };

  it('is hidden without a download', () => {
    expect(cardMode(base)).toBe('hidden');
  });

  it('shows progress while downloading, whatever happened before', () => {
    expect(cardMode({ ...base, downloading: true })).toBe('downloading');
    expect(cardMode({ ...base, downloading: true, lastDownloadingAt: 1 })).toBe('downloading');
  });

  it('stays one second after the download completed, then goes', () => {
    expect(cardMode({ ...base, lastDownloadingAt: base.now - 10 })).toBe('finishing');
    expect(cardMode({ ...base, lastDownloadingAt: base.now - (FINISH_MS - 1) })).toBe('finishing');
    expect(cardMode({ ...base, lastDownloadingAt: base.now - FINISH_MS })).toBe('hidden');
  });

  it('shows a download error for a while, ahead of the finishing state', () => {
    const failed = { ...base, error: 'Could not download compiler.pack', errorAt: base.now - 500, lastDownloadingAt: base.now - 500 };
    expect(cardMode(failed)).toBe('error');
    expect(cardMode({ ...failed, errorAt: base.now - ERROR_MS, lastDownloadingAt: null })).toBe('hidden');
  });
});

describe('failures that belong on the card', () => {
  it('a download that stopped halfway is a download problem, with the compiler message', () => {
    const s = state({ status: 'failed', downloads: [dl('compiler', 2, 10)], messages: [err('The build failed: network error')] });
    expect(downloadError(s)).toBe('The build failed: network error');
  });

  it('an error that names the download counts even before the first byte', () => {
    expect(downloadError(state({ status: 'failed', messages: [err('Could not download compiler.pack.gz: HTTP 404')] }))).toBe('Could not download compiler.pack.gz: HTTP 404');
    expect(downloadError(state({ status: 'failed', messages: [err('x.pack.gz is damaged: its sha256 does not match the manifest')] }))).toContain('damaged');
  });

  it('a code error, a missing .hex file or a finished download is not', () => {
    expect(downloadError(state({ status: 'failed', downloads: [dl('compiler', 10, 10)], messages: [err("'foo' was not declared")] }))).toBeNull();
    expect(downloadError(state({ status: 'failed', messages: [err('No firmware: import a .hex into the board folder'), err('Sketch files are not compiled: compiler files not available here')] }))).toBeNull();
    expect(downloadError(state({ status: 'succeeded', downloads: [dl('compiler', 2, 10)] }))).toBeNull();
    expect(downloadError(state({ status: 'building', downloads: [dl('compiler', 2, 10)] }))).toBeNull();
  });

  it('ignores a cached pack that is "incomplete"', () => {
    expect(downloadError(state({ status: 'failed', downloads: [dl('compiler', 2, 10, true)], messages: [err('x')] }))).toBeNull();
  });
});
