import { describe, expect, it } from 'vitest';
import { idleBuildState, type BoardBuildState } from './buildlog';
import type { DownloadProgress } from './compiler';
import { buildHeader, downloadPercent, durationText, formatBytes, formatBytesPair, formatCount, isDownloading, progressText, usageBars } from './buildtext';
import type { BuildMessage } from './wasm/diagnostics';

const state = (s: Partial<BoardBuildState>): BoardBuildState => ({ ...idleBuildState(), ...s });
const msg = (severity: BuildMessage['severity'], message = 'm'): BuildMessage => ({ severity, message, raw: message });
const dl = (pack: string, loadedBytes: number, totalBytes: number, fromCache = false): DownloadProgress => ({ pack, loadedBytes, totalBytes, fromCache });

describe('numbers', () => {
  it('groups thousands the same way everywhere', () => {
    expect(formatCount(1064)).toBe('1,064');
    expect(formatCount(32256)).toBe('32,256');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('shows sizes in the unit of the total', () => {
    expect(formatBytes(6 * 1024 * 1024)).toBe('6.0 MB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(40)).toBe('40 bytes');
    expect(formatBytesPair(3.2 * 1024 * 1024, 6 * 1024 * 1024)).toBe('3.2 of 6.0 MB');
    expect(formatBytesPair(100 * 1024, 512 * 1024)).toBe('100 of 512 KB');
    expect(durationText(420)).toBe('0.42 s');
    expect(durationText(12345)).toBe('12.35 s');
  });
});

describe('usage bars', () => {
  it('say how much of the flash and RAM the sketch uses', () => {
    const bars = usageBars(state({ status: 'succeeded', flashBytes: 1064, flashMax: 32256, ramBytes: 9, ramMax: 2048 }));
    expect(bars.map((b) => b.text)).toEqual(['Sketch uses 1,064 of 32,256 bytes (3%)', 'Globals use 9 of 2,048 bytes (0%)']);
    expect(bars[0]).toMatchObject({ kind: 'flash', label: 'Flash', percent: 3, fill: 3, level: 'ok' });
    expect(bars[1]).toMatchObject({ kind: 'ram', label: 'RAM', percent: 0, fill: 0 });
  });

  it('turn amber near the limit and red over it, with the bar capped at full', () => {
    expect(usageBars(state({ flashBytes: 29000, flashMax: 32256, ramBytes: 0, ramMax: 1 }))[0]).toMatchObject({ level: 'warn', percent: 90 });
    const over = usageBars(state({ flashBytes: 40000, flashMax: 32256, ramBytes: 1, ramMax: 2048 }))[0];
    expect(over).toMatchObject({ level: 'full', percent: 124, fill: 100 });
  });

  it('are missing when the figures are unknown (a .hex file)', () => {
    expect(usageBars(state({ status: 'succeeded', source: 'firmware-file' }))).toEqual([]);
    expect(usageBars(state({ flashBytes: 10, flashMax: 100 })).map((b) => b.kind)).toEqual(['flash']);
  });
});

describe('the header line', () => {
  it('has a message for a board that never built', () => {
    expect(buildHeader(state({}))).toEqual({ tone: 'idle', text: 'No build yet. Press Build or Run.' });
  });

  it('a successful compile names the time, and warnings', () => {
    expect(buildHeader(state({ status: 'succeeded', source: 'compiled', durationMs: 420 }))).toEqual({ tone: 'ok', text: 'Build succeeded in 0.42 s' });
    const warned = buildHeader(state({ status: 'succeeded', source: 'compiled', durationMs: 1500, messages: [msg('warning'), msg('note')] }));
    expect(warned.text).toBe('Build succeeded in 1.50 s with 1 warning');
    expect(buildHeader(state({ status: 'succeeded', source: 'compiled', messages: [msg('warning'), msg('warning')] })).text).toBe('Build succeeded with 2 warnings');
  });

  it('a firmware file says it was not compiled', () => {
    expect(buildHeader(state({ status: 'succeeded', source: 'firmware-file', summary: 'Running firmware.hex (not compiled).' }))).toEqual({
      tone: 'ok', text: 'Running firmware.hex (not compiled).',
    });
  });

  it('a failed build counts errors and warnings', () => {
    const header = (messages: BuildMessage[], summary = '') => buildHeader(state({ status: 'failed', messages, summary }));
    expect(header([msg('error'), msg('error'), msg('warning'), msg('note')])).toEqual({ tone: 'error', text: 'Build failed: 2 errors, 1 warning' });
    expect(header([msg('error')]).text).toBe('Build failed: 1 error');
    expect(header([], 'The program is not valid.').text).toBe('The program is not valid.');
    expect(header([]).text).toBe('Build failed');
  });

  it('a running build says what it does', () => {
    const compiling = state({ status: 'building', progress: { phase: 'compile', message: 'Compiling main.ino (2/3)', current: 2, total: 3 } });
    expect(buildHeader(compiling)).toEqual({ tone: 'busy', text: 'Compiling main.ino (2/3)…' });
    expect(buildHeader(state({ status: 'building' })).text).toBe('Building…');
    expect(buildHeader(state({ status: 'downloading', downloads: [dl('compiler', 450, 1000)] })).text).toBe('Downloading compiler 45%');
    expect(buildHeader(state({ status: 'downloading' })).text).toBe('Downloading compiler…');
  });
});

describe('progress text', () => {
  it('follows the phase of the build', () => {
    expect(progressText(state({ status: 'building', progress: { phase: 'link', message: 'Linking' } }))).toBe('Linking');
    expect(progressText(state({ status: 'building', progress: { phase: 'compile', message: 'Compiling main.ino (1/3)' } }))).toBe('Compiling main.ino (1/3)');
    expect(progressText(state({ status: 'building' }))).toBe('Building');
  });

  it('shows the download percentage, packs from the cache excluded', () => {
    const downloads = [dl('compiler', 300, 1000), dl('core', 50, 50, true)];
    expect(progressText(state({ status: 'downloading', downloads }))).toBe('Downloading compiler 30%');
    expect(downloadPercent(downloads)).toBe(30);
    expect(downloadPercent([dl('core', 50, 50, true)])).toBeNull();
    expect(downloadPercent([dl('a', 100, 100), dl('b', 0, 100)])).toBe(50);
    expect(downloadPercent([dl('empty', 0, 0)])).toBe(100);
  });

  it('knows when a download is in progress', () => {
    expect(isDownloading([dl('a', 1, 10)])).toBe(true);
    expect(isDownloading([dl('a', 10, 10)])).toBe(false);
    expect(isDownloading([dl('a', 1, 10, true)])).toBe(false);
    expect(isDownloading([])).toBe(false);
  });
});
