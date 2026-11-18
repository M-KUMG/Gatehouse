// The small card at the top centre of the grid while the compiler is being
// downloaded for the first time ("Downloading the compiler (first time only)"),
// with a progress bar. It follows the build log (a build that needs the packs)
// and manual downloads (the "Download compiler now" button of the Build output
// window). Rules and texts: buildcardmodel.ts.

import './buildcard.css';
import type { BoardBuildState, BuildLog } from './build/buildlog';
import type { DownloadProgress } from './build/compiler';
import { formatBytesPair } from './build/buildtext';
import { browserCompilers } from './build/wasm/worker/register';
import { ERROR_MS, FINISH_MS, activeDownloads, cardMode, downloadActive, downloadError, summarizeDownloads, type CardMode, type DownloadSummary } from './buildcardmodel';

interface Failure {
  key: string;
  text: string;
  at: number;
}

export class BuildCard {
  private readonly el = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly fill = document.createElement('div');
  private readonly amount = document.createElement('span');
  private readonly pack = document.createElement('span');
  private readonly note = document.createElement('div');
  private readonly bar = document.createElement('div');

  private manual: DownloadProgress[] = [];
  private manualRunning = false;
  private manualError: { text: string; at: number } | null = null;
  private lastDownloadingAt: number | null = null;
  private last: DownloadSummary | null = null;
  /** Never let the bar go backwards while packs after the first one add to the total. */
  private maxPercent = 0;
  /** Errors the person clicked away, by key. */
  private readonly dismissed = new Set<string>();
  private errorKey = '';
  private timer = 0;

  constructor(parent: HTMLElement, private readonly log: BuildLog) {
    const el = this.el;
    el.className = 'build-card';
    el.hidden = true;
    this.title.className = 'build-card-title';
    this.bar.className = 'build-card-bar';
    this.fill.className = 'build-card-fill';
    this.bar.append(this.fill);
    const row = document.createElement('div');
    row.className = 'build-card-row';
    this.amount.className = 'build-card-amount';
    this.pack.className = 'build-card-pack';
    row.append(this.amount, this.pack);
    this.note.className = 'build-card-note';
    el.append(this.title, this.bar, row, this.note);
    el.addEventListener('click', () => {
      if (el.classList.contains('error')) {
        this.dismissed.add(this.errorKey);
        this.update();
      }
    });
    parent.append(el);
    log.onChange(() => this.update());
  }

  /** Download (or load from the offline cache) the compiler for a board profile, with the card showing the progress. */
  async prefetch(profileId: string): Promise<{ ok: boolean; error?: string }> {
    const compilers = browserCompilers();
    if (!compilers) return { ok: false, error: 'The compiler is not available here.' };
    if (this.manualRunning) return { ok: true };
    this.manualRunning = true;
    this.manual = [];
    this.manualError = null;
    this.update();
    try {
      const result = await compilers.client.prefetch(profileId, (d) => {
        this.manual = [...this.manual.filter((x) => x.pack !== d.pack), { ...d }];
        this.update();
      });
      if (!result.ok) this.manualError = { text: result.error ?? 'The download did not finish.', at: Date.now() };
      return result;
    } finally {
      this.manualRunning = false;
      this.update();
    }
  }

  /** Bring the card in line with the build log and the manual download. */
  update(): void {
    const now = Date.now();
    const states = this.log.boards().map((id) => this.log.get(id));
    const manual = this.manualRunning ? this.manual : [];
    const downloading = downloadActive(states, manual);
    if (downloading) {
      this.lastDownloadingAt = now;
      this.last = summarizeDownloads(activeDownloads(states, manual));
    }
    const failure = this.failure(states);
    const error = failure && !this.dismissed.has(failure.key) ? failure : null;
    if (error) this.errorKey = error.key;
    const mode = cardMode({ downloading, lastDownloadingAt: this.lastDownloadingAt, error: error?.text ?? null, errorAt: error?.at ?? null, now });
    this.draw(mode, error?.text ?? '');
    window.clearTimeout(this.timer);
    if (mode === 'finishing' && this.lastDownloadingAt !== null) this.timer = window.setTimeout(() => this.update(), this.lastDownloadingAt + FINISH_MS - now + 20);
    else if (mode === 'error' && error) this.timer = window.setTimeout(() => this.update(), error.at + ERROR_MS - now + 20);
  }

  /** The newest download problem: a failed build, or a manual download that stopped. */
  private failure(states: readonly BoardBuildState[]): Failure | null {
    const ids = this.log.boards();
    let best: Failure | null = null;
    for (let i = 0; i < states.length; i++) {
      const text = downloadError(states[i]);
      const at = states[i].finishedAt;
      if (text !== null && at !== undefined && (best === null || at > best.at)) best = { key: `${ids[i]}:${at}`, text, at };
    }
    const m = this.manualError;
    if (m && (best === null || m.at > best.at)) best = { key: `manual:${m.at}`, text: m.text, at: m.at };
    return best;
  }

  private draw(mode: CardMode, error: string): void {
    const el = this.el;
    if (mode === 'hidden') {
      el.hidden = true;
      this.maxPercent = 0;
      this.last = null;
      return;
    }
    el.hidden = false;
    el.classList.toggle('error', mode === 'error');
    if (mode === 'error') {
      this.title.textContent = 'The compiler could not be downloaded';
      this.note.textContent = error;
      this.note.classList.add('error');
      this.bar.hidden = true;
      this.amount.textContent = '';
      this.pack.textContent = '';
      el.title = 'Click to close';
      return;
    }
    const s = this.last;
    this.title.textContent = mode === 'finishing' ? 'Compiler downloaded' : 'Downloading the compiler (first time only)';
    this.note.textContent = 'Cached for offline use afterwards';
    this.note.classList.remove('error');
    this.bar.hidden = false;
    el.title = '';
    if (!s) return;
    this.maxPercent = mode === 'finishing' ? 100 : Math.max(this.maxPercent, s.percent);
    this.fill.style.width = `${this.maxPercent}%`;
    this.amount.textContent = mode === 'finishing' ? formatBytesPair(s.total, s.total) : s.amount;
    this.pack.textContent = s.pack;
  }
}
