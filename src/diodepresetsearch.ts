import { loadDiodeCatalog, type DiodeFamily, type DiodePreset } from './diodepresets';
import { attachDrop } from './droplight';
import { searchNamed } from './partsearch';

/** Search stays local to the bottom of the editor. Focus remains in the search field. */
export function diodePresetSearch(family: DiodeFamily, current: string | undefined, apply: (preset: DiodePreset) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'diode-preset-search';

  const input = document.createElement('input');
  input.type = 'search';
  input.spellcheck = false;
  input.autocomplete = 'off';
  const label = { diode: 'diode', schottky: 'Schottky', zener: 'Zener' }[family];
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', `Search ${label} presets`);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'diode-preset-options');
  input.placeholder = current ?? `Search ${label} presets`;

  const fold = document.createElement('div');
  fold.className = 'diode-preset-fold';
  const inner = document.createElement('div');
  const list = document.createElement('div');
  list.className = 'diode-preset-options';
  list.id = 'diode-preset-options';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', `${label} presets`);
  const status = document.createElement('div');
  status.className = 'diode-preset-status';
  status.setAttribute('role', 'status');
  inner.append(list, status);
  fold.append(inner);
  row.append(input, fold);

  const drop = attachDrop(list, '.gs-item', { manual: true });
  let catalog: DiodePreset[] | undefined;
  let matches: DiodePreset[] = [];
  let active = -1;
  let open = false;
  let loading = false;

  const highlight = (index: number): void => {
    const previous = list.children[active];
    if (previous instanceof HTMLElement) previous.classList.remove('active');
    active = index;
    const option = index >= 0 ? list.children[index] as HTMLElement : null;
    option?.classList.add('active');
    if (option) input.setAttribute('aria-activedescendant', option.id);
    else input.removeAttribute('aria-activedescendant');
    drop.moveTo(option);
  };

  const setOpen = (next: boolean): void => {
    open = next;
    input.setAttribute('aria-expanded', String(next));
    fold.classList.toggle('open', next);
    fold.inert = !next;
    if (!next) highlight(-1);
  };

  const choose = (preset: DiodePreset): void => {
    current = preset.name;
    input.value = '';
    input.placeholder = preset.name;
    setOpen(false);
    apply(preset);
  };

  const render = (): void => {
    highlight(-1);
    matches = catalog ? searchNamed(catalog, input.value) : [];
    const options = matches.map((preset, index) => {
      const option = document.createElement('div');
      option.className = 'gs-item';
      option.id = `diode-preset-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(current === preset.name));
      option.textContent = preset.name;
      const hint = document.createElement('span');
      hint.className = 'diode-preset-hint';
      hint.textContent = preset.hint;
      option.append(hint);
      option.addEventListener('pointerenter', () => highlight(index));
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => choose(preset));
      return option;
    });
    list.replaceChildren(...options);
    status.textContent = loading ? 'Loading presets…' : !catalog ? 'Diode presets are unavailable. Search again to retry.'
      : matches.length === 0 ? 'No matching diode presets.' : '';
    status.hidden = status.textContent === '';
  };

  const show = (): void => {
    setOpen(true);
    if (catalog || loading) {
      render();
      return;
    }
    loading = true;
    render();
    void loadDiodeCatalog(family).then((data) => { catalog = data; }, () => undefined).finally(() => {
      loading = false;
      if (open) render();
    });
  };

  setOpen(false);
  input.addEventListener('focus', show);
  input.addEventListener('click', () => { if (!open) show(); });
  input.addEventListener('input', show);
  input.addEventListener('blur', () => setOpen(false));
  input.addEventListener('keydown', (event) => {
    const key = event.key;
    if (key === 'Escape' && open) setOpen(false);
    else if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (!open) show();
      if (matches.length) {
        const next = key === 'ArrowDown' ? Math.min(active + 1, matches.length - 1)
          : active < 0 ? matches.length - 1 : Math.max(0, active - 1);
        highlight(next);
        list.children[next]?.scrollIntoView({ block: 'nearest' });
      }
    } else if (key === 'Enter' && open && matches.length) choose(matches[Math.max(active, 0)]);
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  return row;
}
