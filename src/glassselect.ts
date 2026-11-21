// Glass dropdowns: every <select> in the page gets a styled button and a glass
// list instead of the browser's own (unstyleable, grey) option popup.
//
// The native <select> stays in the DOM as the source of truth (value,
// selectedIndex, options, `change` events, disabled), hidden visually, so no
// other code changes: it still sets `select.value = ...`, rebuilds options and
// listens for `change`. A MutationObserver enhances selects as they appear
// (installGlassSelects), the button follows the select's value (the instance
// `value` / `selectedIndex` setters are wrapped), options and `disabled`.
//
// Keyboard: Enter / Space / arrow keys open the list on the button; then
// Up / Down / Home / End move, a letter jumps to the next entry starting with
// it, Enter picks, Escape closes. The focus never leaves the button (the list is
// not focusable), so a popup the select lives in (the value editor) keeps its
// own focus logic. Mouse: a press on the list does not take the focus either.

import './glassselect.css';

export interface ListEntry {
  label: string;
  disabled: boolean;
}

/** The next enabled entry from `from` in direction `dir` (+1 / -1), wrapping not; `from` itself when there is none. */
export function stepEntry(entries: readonly ListEntry[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < entries.length; i += dir) if (!entries[i].disabled) return i;
  return from;
}

/** The first / last enabled entry (-1 when there is none). */
export function edgeEntry(entries: readonly ListEntry[], last: boolean): number {
  const order = entries.map((_, i) => i);
  if (last) order.reverse();
  return order.find((i) => !entries[i].disabled) ?? -1;
}

/** Type-ahead: the next enabled entry after `from` whose label starts with `text` (case-insensitive), wrapping; -1 when none. */
export function findByPrefix(entries: readonly ListEntry[], from: number, text: string): number {
  const t = text.toLowerCase();
  if (t === '') return -1;
  for (let k = 1; k <= entries.length; k++) {
    const i = (from + k) % entries.length;
    if (!entries[i].disabled && entries[i].label.toLowerCase().startsWith(t)) return i;
  }
  return -1;
}

const ENHANCED = new WeakSet<HTMLSelectElement>();
let openList: { close(): void } | null = null;

/** Gives one select a glass button and list (nothing happens twice for the same select). */
export function enhanceSelect(select: HTMLSelectElement): void {
  if (ENHANCED.has(select)) return;
  ENHANCED.add(select);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${select.className} gs-trigger`.trim();
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  label.className = 'gs-label';
  button.append(label);
  select.classList.add('gs-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.after(button);

  const sync = (): void => {
    const option = select.selectedOptions[0] ?? select.options[select.selectedIndex];
    label.textContent = option?.textContent ?? '';
    button.disabled = select.disabled;
    const tip = select.title || select.getAttribute('aria-label');
    if (tip) button.title = tip;
    const aria = select.getAttribute('aria-label');
    if (aria) button.setAttribute('aria-label', aria);
    button.classList.toggle('gs-empty', select.options.length === 0);
  };

  // Code that sets the value from outside (select.value = ...) must show up on the button.
  const proto = HTMLSelectElement.prototype;
  const wrap = (name: 'value' | 'selectedIndex'): void => {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc?.get || !desc.set) return;
    Object.defineProperty(select, name, {
      configurable: true,
      get: () => desc.get!.call(select),
      set: (v: never) => {
        desc.set!.call(select, v);
        sync();
      },
    });
  };
  wrap('value');
  wrap('selectedIndex');
  // Focus requests go to the visible button.
  select.focus = (options?: FocusOptions) => button.focus(options);

  const watcher = new MutationObserver(sync);
  watcher.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label', 'title'] });
  select.addEventListener('change', sync);
  sync();

  let list: HTMLDivElement | null = null;
  let active = -1;
  let typed = '';
  let typedAt = 0;

  const entries = (): ListEntry[] => Array.from(select.options).map((o) => ({ label: o.textContent ?? '', disabled: o.disabled || o.parentElement?.hasAttribute('disabled') === true }));

  const close = (): void => {
    if (!list) return;
    const el = list;
    list = null;
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-activedescendant');
    el.classList.remove('open');
    window.setTimeout(() => el.remove(), 180);
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('blur', close);
    document.removeEventListener('scroll', onScroll, true);
    if (openList === handle) openList = null;
  };
  const handle = { close };

  const onOutside = (e: Event): void => {
    const t = e.target;
    if (t instanceof Node && (button.contains(t) || list?.contains(t))) return;
    close();
  };
  const onScroll = (e: Event): void => {
    if (e.target instanceof Node && list?.contains(e.target)) return;
    close();
  };

  const pick = (index: number): void => {
    const option = select.options[index];
    if (!option || option.disabled) return;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    close();
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const highlight = (index: number): void => {
    active = index;
    if (!list) return;
    for (const item of list.querySelectorAll<HTMLElement>('.gs-item')) {
      const on = Number(item.dataset.index) === index;
      item.classList.toggle('active', on);
      if (on) {
        item.scrollIntoView({ block: 'nearest' });
        button.setAttribute('aria-activedescendant', item.id);
      }
    }
  };

  const place = (el: HTMLElement): void => {
    const r = button.getBoundingClientRect();
    const margin = 8;
    el.style.minWidth = `${Math.round(r.width)}px`;
    el.style.maxHeight = `${Math.max(120, Math.min(300, window.innerHeight - margin * 2))}px`;
    const height = el.offsetHeight;
    const below = window.innerHeight - r.bottom - margin;
    const above = r.top - margin;
    const up = height > below && above > below;
    el.classList.toggle('up', up);
    el.style.top = `${Math.round(up ? Math.max(margin, r.top - 4 - height) : Math.min(r.bottom + 4, window.innerHeight - margin - height))}px`;
    el.style.left = `${Math.round(Math.max(margin, Math.min(r.left, window.innerWidth - margin - el.offsetWidth)))}px`;
  };

  const open = (): void => {
    if (list || select.disabled || select.options.length === 0) return;
    openList?.close();
    const el = document.createElement('div');
    el.className = 'gs-list';
    el.setAttribute('role', 'listbox');
    el.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the focus on the button
    let group: string | null = null;
    Array.from(select.options).forEach((option, i) => {
      const g = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : null;
      if (g !== group) {
        group = g;
        if (g) {
          const head = document.createElement('div');
          head.className = 'gs-group';
          head.textContent = g;
          el.append(head);
        }
      }
      const item = document.createElement('div');
      item.className = 'gs-item';
      item.id = `gs-${Math.random().toString(36).slice(2, 9)}-${i}`;
      item.dataset.index = String(i);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(i === select.selectedIndex));
      if (option.disabled) item.setAttribute('aria-disabled', 'true');
      item.textContent = option.textContent;
      item.addEventListener('pointermove', () => {
        if (!option.disabled && active !== i) highlight(i);
      });
      item.addEventListener('click', () => pick(i));
      el.append(item);
    });
    document.body.append(el);
    list = el;
    button.setAttribute('aria-expanded', 'true');
    place(el);
    highlight(select.selectedIndex);
    requestAnimationFrame(() => el.classList.add('open'));
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    document.addEventListener('scroll', onScroll, true);
    openList = handle;
  };

  button.addEventListener('click', () => (list ? close() : open()));
  button.addEventListener('blur', () => close());
  button.addEventListener('keydown', (e) => {
    const all = entries();
    if (!list) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        open();
      }
      return;
    }
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': highlight(stepEntry(all, active, 1)); break;
      case 'ArrowUp': highlight(stepEntry(all, active, -1)); break;
      case 'Home': highlight(edgeEntry(all, false)); break;
      case 'End': highlight(edgeEntry(all, true)); break;
      case 'Enter':
      case ' ': pick(active); break;
      case 'Escape': close(); break;
      case 'Tab': close(); handled = false; break;
      default: {
        handled = false;
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const now = performance.now();
          typed = now - typedAt > 700 ? e.key : typed + e.key;
          typedAt = now;
          const found = findByPrefix(all, typed.length > 1 ? active - 1 : active, typed);
          if (found >= 0) highlight(found);
          handled = true;
        }
      }
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

/** Enhances every select now and every select added later (call once at start-up). */
export function installGlassSelects(root: HTMLElement = document.body): void {
  const scan = (node: ParentNode): void => {
    if (node instanceof HTMLSelectElement) enhanceSelect(node);
    node.querySelectorAll?.('select').forEach((s) => enhanceSelect(s));
  };
  scan(root);
  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement) scan(n);
      });
    }
  }).observe(root, { childList: true, subtree: true });
}
