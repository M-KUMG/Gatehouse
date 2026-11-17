import './style.css';
import { BoardClock } from './boardclock';
import { BoardPanel } from './boardpanel';
import { EXAMPLES } from './examples';
import { GridView } from './grid';
import { Editor } from './interaction';
import { DockLayout, isForOtherWindow } from './layout/dock';
import { SERIAL_CONSOLE_ID, SerialConsole } from './layout/serialconsole';
import { createWindowsMenu } from './layout/windowsmenu';
import { boundsOf } from './model';
import { createPalette } from './palette';
import { ProjectController } from './project/controller';
import { Project } from './project/project';
import { Simulation } from './simulation';

const app = document.getElementById('app');
const dock = document.getElementById('dock');
if (!app || !dock) throw new Error('Missing #app or #dock');

// The grid's area: the canvas plus the overlays anchored to it (file bar,
// board panel, zoom, status). It lives in the dock's centre panel.
const editorArea = document.createElement('div');
editorArea.className = 'editor-area';
const canvas = document.createElement('canvas');
canvas.id = 'grid';
editorArea.append(canvas);

// The project owns the circuit and camera; everything below works on them in place.
const project = new Project();
const scene = project.scene;
// The view asks the simulation to catch up before every frame, so any edit
// (a new wire, a flipped switch, a turned knob) is re-solved automatically.
const sim = new Simulation(scene);
// Serial output of the boards; "Auto" shows the board panel's board. Made
// before the layout, which may restore the console window straight away.
const serialConsole = new SerialConsole(scene, sim, () => boardPanel.boardId);
const layout = new DockLayout(dock, editorArea, { [SERIAL_CONSOLE_ID]: serialConsole.element });
const view = new GridView(canvas, scene, project.camera);
// Overlays beside the selection follow the canvas when windows move around it.
layout.api.onDidLayoutChange(view.requestRender);
view.sim = sim;
const editor = new Editor(view, scene, sim, editorArea);
editor.ignoreKey = (e) => isForOtherWindow(e.target, editorArea);
// Boards run on animation frames while one is running; the panel shows the selected board.
const clock = new BoardClock(sim, view.requestRender);
const controller = new ProjectController(
  project,
  {
    beforeLoad: () => {
      editor.reset();
      sim.boards.clear(); // a loaded project starts with every board stopped
    },
    afterLoad: (file) => {
      const box = boundsOf(scene.parts);
      if (!file.camera && box) view.centerOn(box);
      view.cameraChanged();
    },
  },
  editorArea,
);
const bar = controller.fileBar.element;
bar.insertBefore(createWindowsMenu(layout), bar.querySelector('.project-name'));
const boardPanel = new BoardPanel(scene, view, sim, clock, editorArea, (partId) => {
  layout.open(SERIAL_CONSOLE_ID);
  serialConsole.showBoard(partId);
});
view.renderListeners.push(() => boardPanel.update());
view.renderListeners.push(() => serialConsole.update()); // after the panel: Auto follows its board
layout.onChange(() => serialConsole.update());
// Every edit is followed by a frame, so this notices all of them.
view.renderListeners.push(() => project.checkForChanges());
// Fixed column right of the dock; the dock reflows when it folds.
createPalette(
  app,
  (typeId, e) => editor.startPlacing(typeId, e),
  EXAMPLES.map((ex) => ({ name: ex.name, hint: ex.hint, run: () => editor.loadExample(ex.state) })),
);
