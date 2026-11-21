// The "Save project" popup of the Electron app: the project's name and the
// folder it goes in (with a Browse button), in the app's own dialog style. It
// resolves with the folder the project will be written to (the folder does not
// exist yet unless the name is one that does), or null when cancelled.

import { leave } from '../leave';
import { folderNameProblem, previewPath } from './foldername';
import type { FolderHost, PickedFolder } from './folderhost';

export async function askSaveLocation(host: FolderHost, suggestedName: string): Promise<PickedFolder | null> {
  const start = await host.defaultProjectParent();
  if ('error' in start) return null;
  let parent = start.dir;

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const box = document.createElement('form');
    box.className = 'dialog save-dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.noValidate = true;

    const h = document.createElement('h3');
    h.textContent = 'Save project';

    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.spellcheck = false;
    nameInput.autocomplete = 'off';
    nameInput.value = suggestedName;
    nameLabel.append(nameInput);

    const placeLabel = document.createElement('label');
    placeLabel.textContent = 'Location';
    const place = document.createElement('div');
    place.className = 'save-place';
    const placeText = document.createElement('input');
    placeText.type = 'text';
    placeText.readOnly = true;
    placeText.tabIndex = -1;
    const browse = document.createElement('button');
    browse.type = 'button';
    browse.className = 'dialog-button';
    browse.textContent = 'Browse…';
    place.append(placeText, browse);
    placeLabel.append(place);

    const note = document.createElement('p');
    note.className = 'save-note';

    const row = document.createElement('div');
    row.className = 'dialog-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'dialog-button';
    cancel.textContent = 'Cancel';
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'dialog-button primary';
    save.textContent = 'Save';
    row.append(cancel, save);
    box.append(h, nameLabel, placeLabel, note, row);
    backdrop.append(box);

    let busy = false;
    const refresh = (): void => {
      placeText.value = parent;
      placeText.title = parent;
      const problem = folderNameProblem(nameInput.value);
      nameInput.classList.toggle('invalid', problem !== null && nameInput.value !== '');
      note.classList.toggle('error', problem !== null && nameInput.value !== '');
      note.textContent = problem !== null ? problem : `The project goes in ${previewPath(parent, nameInput.value)}`;
      save.disabled = problem !== null || busy;
    };
    const finish = (value: PickedFolder | null): void => {
      window.removeEventListener('keydown', onKey, true);
      leave(backdrop);
      resolve(value);
    };
    // While open, keys belong to the dialog, not the editor underneath.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(null);
      e.stopPropagation();
    };

    nameInput.addEventListener('input', refresh);
    cancel.addEventListener('click', () => finish(null));
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) finish(null);
    });
    browse.addEventListener('click', () => {
      void (async () => {
        const picked = await host.pickProjectFolder('parent');
        if ('dir' in picked) parent = picked.dir;
        else if ('error' in picked) {
          note.textContent = picked.error;
          note.classList.add('error');
          return;
        }
        refresh();
      })();
    });
    box.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy || folderNameProblem(nameInput.value) !== null) return;
      busy = true;
      refresh();
      void (async () => {
        const made = await host.createProjectFolder(parent, nameInput.value);
        busy = false;
        if ('error' in made) {
          refresh();
          note.textContent = made.error;
          note.classList.add('error');
          return;
        }
        finish(made);
      })();
    });

    window.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    refresh();
    nameInput.focus();
    nameInput.select();
  });
}
