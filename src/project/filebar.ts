// Small bar in the top-left corner: New, Open, Save, and the project name
// with a dot while there are unsaved changes.

const svg = (body: string): string =>
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" ' +
  `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  new: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6"/>'),
  open: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  save: svg(
    '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3"/>' +
      '<rect x="7" y="13" width="10" height="6" rx="1"/>',
  ),
};

export interface FileBarActions {
  newProject: () => void;
  open: () => void;
  save: () => void;
}

/** Builds the bar; returns a function that shows the name and unsaved state. */
export function createFileBar(actions: FileBarActions): (name: string, dirty: boolean) => void {
  const bar = document.createElement('div');
  bar.className = 'file-bar';
  const name = document.createElement('span');
  name.className = 'project-name';
  const dot = document.createElement('span');
  dot.className = 'dirty-dot';
  dot.title = 'Unsaved changes';
  dot.textContent = '●';
  bar.append(
    button('New project', ICONS.new, actions.newProject),
    button('Open project… (Ctrl+O)', ICONS.open, actions.open),
    button('Save project (Ctrl+S) · Save as… (Ctrl+Shift+S)', ICONS.save, actions.save),
    name,
    dot,
  );
  document.body.append(bar);

  return (projectName, dirty) => {
    name.textContent = projectName;
    name.title = dirty ? `${projectName} (unsaved changes)` : projectName;
    dot.style.visibility = dirty ? 'visible' : 'hidden';
  };
}

function button(title: string, icon: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'file-button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = icon;
  b.addEventListener('click', onClick);
  return b;
}
