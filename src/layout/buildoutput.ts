// The Build output window: the build log of one board. Board dropdown like
// the Serial console's ("Auto" follows the active board), Build and Clear
// buttons, then the status line, flash and RAM usage and every compiler
// message (errors first). Clicking a message that names a file of the board
// opens it in the Code editor at that line and column.
//
// The text comes from the board runtime's build log (sim.boards.buildLog),
// which keeps collecting while this window is closed. The window redraws when
// the log changes (at most once per frame) and while it is visible; nothing is
// drawn while it is closed or behind another tab. The compiler's status
// ("download needed", "not served here") is asked when the window shows, after
// a build finishes and every few seconds while it is visible.
// The choice of board is session UI state, never saved in the project.

import './buildoutput.css';
import { boardsInOrder } from '../boardcontrols';
import { buildHeader, usageBars } from '../build/buildtext';
import type { BoardBuildState } from '../build/buildlog';
import { browserCompilers } from '../build/wasm/worker/register';
import type { CompilerStatus } from '../build/wasm/worker/packs';
import type { PlacedPart, Scene } from '../model';
import { boardLabelWithId } from '../parts';
import { boardTree } from '../project/boardfiles';
import type { Project } from '../project/project';
import type { Simulation } from '../simulation';
import {
  compilerNote, detailText, groupMessages, locationText, messageTarget, startsExpanded, type CompilerNote, type MessageRow,
} from './buildoutputrows';
import { emitOpenFile } from './fileevents';

export const BUILD_OUTPUT_ID = 'build-output';

const AUTO = 'auto';
/** While the window is visible, the compiler's status is asked again this often. */
const STATUS_REFRESH_MS = 5000;

const ICONS = {
  error: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/></svg>',
  warning: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.2L14.2 13H1.8z"/><path d="M8 6.4v3.2M8 11.4v.2"/></svg>',
  note: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4M8 4.8v.2"/></svg>',
};

export class BuildOutput {
  /** The window's content; DockLayout adopts it whenever the window opens. */
  readonly element = document.createElement('div');
  private readonly boardSelect = document.createElement('select');
  private readonly buildButton = document.createElement('button');
  private readonly clearButton = document.createElement('button');
  private readonly headerEl = document.createElement('div');
  private readonly headerText = document.createElement('span');
  private readonly usageEl = document.createElement('div');
  private readonly compilerEl = document.createElement('div');
  private readonly list = document.createElement('div');
  private readonly hint = document.createElement('div');

  /** AUTO or a board part id (as text, the select's value). */
  private boardChoice = AUTO;
  private boardOptions = '';
  /** The board shown now (part id) and the state last drawn for it. */
  private shown: number | null = null;
  private listKey = '';
  private lastStatus: BoardBuildState['status'] = 'idle';
  private dirty = true;
  private frame = 0;
  private wasVisible = false;
  /** Messages whose details were toggled by hand: the opposite of their default. */
  private readonly toggled = new Set<string>();
  private compiler: CompilerStatus | null = null;
  private compilerProfile = '';
  private asking = false;
  private downloading = false;
  private downloadError = '';

  constructor(
    private readonly scene: Scene,
    private readonly sim: Simulation,
    private readonly project: Project,
    /** The board "Auto" stands for (the active board), or null. */
    private readonly autoBoard: () => number | null,
    /** Download the compiler for a board profile (the grid's card shows the progress). */
    private readonly prefetch: (profileId: string) => Promise<{ ok: boolean; error?: string }>,
  ) {
    const el = this.element;
    el.className = 'build-output';

    const bar = document.createElement('div');
    bar.className = 'bo-bar';
    this.boardSelect.className = 'bo-select';
    this.boardSelect.title = 'Board whose build output is shown';
    this.boardSelect.setAttribute('aria-label', 'Board');
    const field = document.createElement('label');
    field.className = 'bo-field';
    const fieldName = document.createElement('span');
    fieldName.textContent = 'Board';
    field.append(fieldName, this.boardSelect);
    const spacer = document.createElement('span');
    spacer.className = 'bo-spacer';
    for (const [b, text, title] of [
      [this.buildButton, 'Build', 'Compile this board\'s files (without running them)'],
      [this.clearButton, 'Clear', 'Clear the build output of this board'],
    ] as const) {
      b.type = 'button';
      b.className = 'bo-button';
      b.textContent = text;
      b.title = title;
    }
    bar.append(field, spacer, this.buildButton, this.clearButton);

    this.headerEl.className = 'bo-header';
    const dot = document.createElement('span');
    dot.className = 'bo-dot';
    this.headerText.className = 'bo-header-text';
    this.headerEl.append(dot, this.headerText);
    this.usageEl.className = 'bo-usage';
    this.compilerEl.className = 'bo-compiler';
    this.compilerEl.hidden = true;
    const top = document.createElement('div');
    top.className = 'bo-top';
    top.append(this.headerEl, this.usageEl, this.compilerEl);

    const body = document.createElement('div');
    body.className = 'bo-body';
    this.list.className = 'bo-list';
    this.list.tabIndex = 0; // focusable, so key presses aim here and not at the grid
    this.list.setAttribute('aria-label', 'Build messages');
    this.hint.className = 'bo-hint';
    body.append(this.list, this.hint);
    el.append(bar, top, body);

    this.boardSelect.addEventListener('change', () => {
      this.boardChoice = this.boardSelect.value;
      this.dirty = true;
      this.update();
    });
    this.buildButton.addEventListener('click', () => {
      if (this.shown !== null) void this.sim.boards.buildBoard(this.shown);
    });
    this.clearButton.addEventListener('click', () => {
      if (this.shown !== null) this.sim.boards.buildLog.clear(this.shown);
    });
    this.list.addEventListener('click', this.onListClick);
    this.list.addEventListener('keydown', this.onListKey);
    this.compilerEl.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('.bo-download')) void this.download();
    });
    this.sim.boards.buildLog.onChange(() => this.schedule());
    // The window shows or hides (opened, closed, another tab in front).
    new ResizeObserver(() => this.update()).observe(this.element);
    window.setInterval(() => {
      if (this.visible()) void this.askCompiler();
    }, STATUS_REFRESH_MS);
  }

  /** Show a board (from the status chip of a failed build). Stays on "Auto" when Auto already shows it. */
  showBoard(partId: number): void {
    if (!(this.boardChoice === AUTO && this.autoBoard() === partId)) this.boardChoice = String(partId);
    this.dirty = true;
    this.update();
  }

  /** Call after every frame and when the window opens. Cheap when nothing changed. */
  update(): void {
    const boards = boardsInOrder(this.scene.parts);
    if (this.boardChoice !== AUTO && !boards.some((p) => String(p.id) === this.boardChoice)) this.boardChoice = AUTO;
    const part = this.resolveBoard(boards);
    this.updateBoardSelect(boards, part);
    if ((part?.id ?? null) !== this.shown) {
      this.shown = part?.id ?? null;
      this.dirty = true;
    }
    const visible = this.visible();
    if (visible && !this.wasVisible) {
      this.dirty = true;
      void this.askCompiler();
    }
    this.wasVisible = visible;
    if (!visible || !this.dirty) return;
    this.dirty = false;
    this.render(part);
  }

  /** Redraw at the next frame (a build log can change many times per frame while downloading). */
  private schedule(): void {
    this.dirty = true;
    if (this.frame !== 0 || !this.visible()) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  private visible(): boolean {
    return this.element.isConnected && this.element.getClientRects().length > 0;
  }

  /** The board to show: the fixed choice, else Auto's board, else the first board. */
  private resolveBoard(boards: readonly PlacedPart[]): PlacedPart | null {
    if (boards.length === 0) return null;
    const wanted = this.boardChoice === AUTO ? this.autoBoard() : Number(this.boardChoice);
    return boards.find((p) => p.id === wanted) ?? boards[0];
  }

  private updateBoardSelect(boards: readonly PlacedPart[], part: PlacedPart | null): void {
    const sel = this.boardSelect;
    const items: [string, string][] = boards.map((p) => [String(p.id), boardLabelWithId(p)]);
    const signature = items.map(([v, t]) => `${v}=${t}`).join('|');
    // Rebuild only when the list changes, so an open dropdown is not disturbed every frame.
    if (signature !== this.boardOptions || sel.options.length === 0) {
      this.boardOptions = signature;
      sel.replaceChildren(option(AUTO, ''), ...items.map(([v, t]) => option(v, t)));
    }
    const autoText = boards.length === 0 ? 'No board in the project' : this.boardChoice === AUTO && part
      ? `Auto: selected board (${boardLabelWithId(part)})` : 'Auto: selected board';
    const auto = sel.options[0];
    if (auto.textContent !== autoText) auto.textContent = autoText;
    if (sel.value !== this.boardChoice) sel.value = this.boardChoice;
    sel.disabled = boards.length === 0;
  }

  // ---- drawing --------------------------------------------------------------------

  private render(part: PlacedPart | null): void {
    const state = part ? this.sim.boards.buildLog.get(part.id) : null;
    const busy = state !== null && (state.status === 'building' || state.status === 'downloading');
    this.buildButton.disabled = !part || busy || (this.sim.boards.get(part.id)?.building ?? false);
    this.clearButton.disabled = !state || state.status === 'idle' || busy;

    if (!part || !state) {
      this.headerEl.hidden = true;
      this.usageEl.replaceChildren();
      this.list.replaceChildren();
      this.listKey = '';
      this.hint.textContent = 'No board in the project';
      this.hint.hidden = false;
      this.renderCompiler();
      return;
    }

    const header = buildHeader(state);
    this.headerEl.hidden = false;
    this.headerEl.className = `bo-header ${header.tone}`;
    if (this.headerText.textContent !== header.text) this.headerText.textContent = header.text;

    this.renderUsage(state);
    this.renderList(part, state);
    this.hint.hidden = state.status !== 'idle';
    this.hint.textContent = state.status === 'idle' ? 'No build yet. Press Build or Run.' : '';

    // A finished build may have downloaded the compiler or changed what is stored: ask again.
    const finished = (state.status === 'succeeded' || state.status === 'failed') && this.lastStatus !== state.status;
    this.lastStatus = state.status;
    if (finished) void this.askCompiler();
    this.renderCompiler();
  }

  private renderUsage(state: BoardBuildState): void {
    const bars = state.status === 'succeeded' ? usageBars(state) : [];
    const key = bars.map((b) => b.text + b.fill).join('|');
    if (this.usageEl.dataset.key === key) return;
    this.usageEl.dataset.key = key;
    this.usageEl.replaceChildren(
      ...bars.map((b) => {
        const row = document.createElement('div');
        row.className = 'bo-usage-row';
        const label = document.createElement('span');
        label.className = 'bo-usage-label';
        label.textContent = b.label;
        const track = document.createElement('div');
        track.className = `bo-usage-bar ${b.level}`;
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-label', `${b.label} usage`);
        track.setAttribute('aria-valuenow', String(Math.min(b.percent, 100)));
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        const fill = document.createElement('div');
        fill.className = 'bo-usage-fill';
        fill.style.width = `${b.fill}%`;
        track.append(fill);
        const text = document.createElement('span');
        text.className = 'bo-usage-text';
        text.textContent = b.text;
        row.append(label, track, text);
        return row;
      }),
    );
  }

  private renderList(part: PlacedPart, state: BoardBuildState): void {
    const key = `${part.id}|${state.startedAt ?? 0}|${state.finishedAt ?? 0}|${state.messages.length}`;
    if (key === this.listKey) return;
    this.listKey = key;
    const files = new Set(Object.keys(part.boardId ? (boardTree(this.project, part.boardId)?.files ?? {}) : {}));
    const rows = groupMessages(state.messages);
    this.list.replaceChildren(
      ...rows.map((r) => this.buildRow(r, part, state, part.boardId ? messageTarget(r.message, part.boardId, files) : null)),
    );
    this.list.hidden = rows.length === 0;
  }

  private buildRow(r: MessageRow, part: PlacedPart, state: BoardBuildState, target: ReturnType<typeof messageTarget>): HTMLElement {
    const m = r.message;
    const id = `${part.id}:${state.startedAt ?? 0}:${r.index}`;
    const details = detailText(m);
    const expanded = details !== '' && startsExpanded(m) !== this.toggled.has(id);

    const row = document.createElement('div');
    row.className = `bo-msg ${m.severity}${r.indent ? ' indent' : ''}`;
    row.dataset.id = id;
    const head = document.createElement('div');
    head.className = 'bo-msg-head';
    if (target) {
      row.classList.add('clickable');
      head.tabIndex = 0;
      head.setAttribute('role', 'button');
      head.title = `Open ${target.path} at line ${target.line}`;
      head.dataset.board = target.boardId;
      head.dataset.path = target.path;
      head.dataset.line = String(target.line);
      if (target.column !== undefined) head.dataset.column = String(target.column);
    }
    const icon = document.createElement('span');
    icon.className = 'bo-icon';
    icon.innerHTML = ICONS[m.severity];
    icon.title = m.severity;
    head.append(icon);
    const loc = locationText(m);
    if (loc) {
      const where = document.createElement('span');
      where.className = 'bo-loc';
      where.textContent = loc;
      head.append(where);
    }
    const text = document.createElement('span');
    text.className = 'bo-text';
    text.textContent = m.message;
    head.append(text);
    if (details) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'bo-toggle';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? 'Hide details' : 'Show details';
      head.append(toggle);
    }
    row.append(head);
    if (details) {
      const pre = document.createElement('pre');
      pre.className = 'bo-detail';
      pre.textContent = details;
      pre.hidden = !expanded;
      row.append(pre);
    }
    return row;
  }

  private onListClick = (e: MouseEvent): void => {
    if (!(e.target instanceof Element)) return;
    const toggle = e.target.closest<HTMLElement>('.bo-toggle');
    const row = e.target.closest<HTMLElement>('.bo-msg');
    if (toggle && row?.dataset.id) {
      e.stopPropagation();
      this.toggleDetails(row, toggle);
      return;
    }
    const head = e.target.closest<HTMLElement>('.bo-msg-head');
    if (head) this.openFromHead(head);
  };

  private onListKey = (e: KeyboardEvent): void => {
    if ((e.key !== 'Enter' && e.key !== ' ') || !(e.target instanceof HTMLElement) || !e.target.classList.contains('bo-msg-head')) return;
    e.preventDefault();
    this.openFromHead(e.target);
  };

  private toggleDetails(row: HTMLElement, toggle: HTMLElement): void {
    const id = row.dataset.id ?? '';
    if (!this.toggled.delete(id)) this.toggled.add(id);
    const pre = row.querySelector<HTMLElement>('.bo-detail');
    if (!pre) return;
    pre.hidden = !pre.hidden;
    toggle.setAttribute('aria-expanded', String(!pre.hidden));
    toggle.textContent = pre.hidden ? 'Show details' : 'Hide details';
  }

  private openFromHead(head: HTMLElement): void {
    const { board, path, line, column } = head.dataset;
    if (board === undefined || path === undefined || line === undefined) return;
    emitOpenFile(board, path, { focus: true, line: Number(line), ...(column !== undefined ? { column: Number(column) } : {}) });
  }

  // ---- the compiler row -------------------------------------------------------------

  /** Which compiler profile the shown board needs (its type id when the browser compiler knows it, else 'uno'). */
  private profile(): string {
    const compilers = browserCompilers();
    const part = this.scene.parts.find((p) => p.id === this.shown);
    return part && compilers?.boardTypes.includes(part.typeId) ? part.typeId : 'uno';
  }

  private async askCompiler(): Promise<void> {
    const compilers = browserCompilers();
    if (!compilers) {
      if (this.compiler !== null) {
        this.compiler = null;
        this.renderCompiler();
      }
      return;
    }
    if (this.asking) return;
    this.asking = true;
    try {
      const profile = this.profile();
      const status = await compilers.client.getCompilerStatus(profile);
      this.compilerProfile = profile;
      if (JSON.stringify(status) !== JSON.stringify(this.compiler)) {
        this.compiler = status;
        this.renderCompiler();
      }
    } finally {
      this.asking = false;
    }
  }

  private renderCompiler(): void {
    const note: CompilerNote | null = compilerNote(this.compiler);
    const key = `${JSON.stringify(note)}|${this.downloading}|${this.downloadError}`;
    if (this.compilerEl.dataset.key === key) return;
    this.compilerEl.dataset.key = key;
    this.compilerEl.hidden = note === null;
    this.compilerEl.className = `bo-compiler ${note?.kind ?? ''}`;
    if (!note) {
      this.compilerEl.replaceChildren();
      return;
    }
    const text = document.createElement('div');
    text.className = 'bo-compiler-text';
    text.textContent = note.text;
    const nodes: HTMLElement[] = [text];
    if (note.kind === 'download') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bo-button bo-download';
      button.textContent = this.downloading ? 'Downloading…' : note.button;
      button.disabled = this.downloading;
      nodes.push(button);
      if (this.downloadError) {
        const error = document.createElement('div');
        error.className = 'bo-compiler-error';
        error.textContent = this.downloadError;
        nodes.push(error);
      }
    } else {
      const hint = document.createElement('div');
      hint.className = 'bo-compiler-hint';
      hint.textContent = note.hint;
      nodes.push(hint);
      if (note.reason) {
        const reason = document.createElement('div');
        reason.className = 'bo-compiler-hint';
        reason.textContent = note.reason;
        nodes.push(reason);
      }
    }
    this.compilerEl.replaceChildren(...nodes);
  }

  private async download(): Promise<void> {
    if (this.downloading) return;
    this.downloading = true;
    this.downloadError = '';
    this.renderCompiler();
    try {
      const result = await this.prefetch(this.compilerProfile || this.profile());
      if (!result.ok) this.downloadError = result.error ?? 'The download did not finish.';
    } finally {
      this.downloading = false;
      await this.askCompiler();
      this.renderCompiler();
    }
  }
}

function option(value: string, text: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}
