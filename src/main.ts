import './style.css';
import { BoardClock } from './boardclock';
import { ActiveBoard } from './boardcontrols';
import { EXAMPLES } from './examples';
import { CameraPan } from './camerapan';
import { cellBoxToWorld, revealTarget } from './camerareveal';
import { GRID_SIZE, GridView } from './grid';
import { Editor } from './interaction';
import { CODE_EDITOR_ID, CodeEditor } from './layout/codeeditor';
import { DockLayout, isForOtherWindow } from './layout/dock';
import { onOpenFile } from './layout/fileevents';
import { FILE_EXPLORER_ID, FileExplorer } from './layout/fileexplorer';
import { SERIAL_CONSOLE_ID, SerialConsole } from './layout/serialconsole';
import { createWindowsMenu } from './layout/windowsmenu';
import { boundsOf, footprint } from './model';
import { createPalette } from './palette';
import { ProjectController } from './project/controller';
import { Project } from './project/project';
import { Simulation } from './simulation';

const app = document.getElementById('app');
const dock = document.getElementById('dock');
if (!app || !dock) throw new Error('Missing #app or #dock');

// The grid's area: the canvas plus the overlays anchored to it (file bar,
// zoom, status; the toolbar and board chip float over it). It lives in the dock's centre panel.
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
// The board the other windows follow: the one selected on the grid, else the
// last one. Updated after every frame (the view comes later in this file).
const activeBoard = new ActiveBoard(() => scene.parts, () => view.selected);
// Serial output of the boards; "Auto" shows the active board. Made before the
// layout, which may restore the console window straight away.
const serialConsole = new SerialConsole(scene, sim, () => activeBoard.partId);
// File explorer: the source files of the boards. A change is recorded in the
// undo history at once (settle) and the grid redraws (requestRender).
const fileExplorer = new FileExplorer({
  project,
  autoBoard: () => activeBoard.partId,
  showBoard: (partId) => showBoardOnGrid(partId),
  changed: () => {
    controller.history.settle();
    view.requestRender();
  },
  undo: () => controller.history.undo(),
  redo: () => controller.history.redo(),
});
// Code editor: opens the files the explorer announces and writes edits into
// the project's files (debounced); same hand-off as the explorer for the history.
const codeEditor = new CodeEditor({
  project,
  show: () => layout.open(CODE_EDITOR_ID),
  changed: () => {
    controller.history.settle();
    view.requestRender();
  },
});
onOpenFile((boardId, path, options) => codeEditor.open(boardId, path, options));
const layout = new DockLayout(dock, editorArea, {
  [SERIAL_CONSOLE_ID]: serialConsole.element,
  [CODE_EDITOR_ID]: codeEditor.element,
  [FILE_EXPLORER_ID]: fileExplorer.element,
});
const view = new GridView(canvas, scene, project.camera);
// Overlays beside the selection follow the canvas when windows move around it.
layout.api.onDidLayoutChange(view.requestRender);
view.sim = sim;
const editor = new Editor(view, scene, sim, editorArea);
editor.ignoreKey = (e) => isForOtherWindow(e.target, editorArea);
// A board picked in the File explorer: select it as if clicked on the grid and,
// unless it is fully in view, pan to centre it (same zoom). Neither is circuit
// data, so no undo step and no unsaved mark. A press or the wheel on the grid ends the pan.
const cameraPan = new CameraPan(project.camera, () => view.cameraChanged());
for (const type of ['pointerdown', 'wheel']) canvas.addEventListener(type, () => cameraPan.cancel(), { capture: true, passive: true });
function showBoardOnGrid(partId: number): void {
  const part = scene.find(partId);
  if (!part || !editor.selectPart(partId)) return;
  const rect = cellBoxToWorld(footprint(part), GRID_SIZE);
  const target = revealTarget(project.camera, { width: canvas.clientWidth, height: canvas.clientHeight }, rect);
  if (target) cameraPan.panTo(target.x, target.y);
}
// Boards run on animation frames while one is running.
const clock = new BoardClock(sim, view.requestRender);
// Run / Pause / Reset (toolbar, the board's reset button) and finished builds
// (async) start the clock and redraw (which also refreshes the board chip).
sim.boards.onChange(() => {
  clock.wake();
  view.requestRender();
});
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
    // Undo / redo. Board runtimes follow the parts through sim.update(): a
    // board that comes back starts stopped with empty serial buffers, a
    // board that is gone loses its emulator; the others keep running (file
    // changes take effect at the next Run from fresh or Reset).
    busy: () => editor.busy,
    beforeRestore: () => {
      editor.cancelGesture();
      sim.update(); // drop runtimes of boards deleted since the last frame
    },
    afterRestore: () => {
      editor.circuitRestored();
      sim.update();
      view.requestRender();
    },
  },
  editorArea,
);
const bar = controller.fileBar.element;
bar.insertBefore(createWindowsMenu(layout), bar.querySelector('.project-name'));
// The toolbar's console button: open (or bring forward) the Serial console on that board.
editor.onOpenConsole = (partId) => {
  layout.open(SERIAL_CONSOLE_ID);
  serialConsole.showBoard(partId);
};
view.renderListeners.push(() => activeBoard.update());
view.renderListeners.push(() => serialConsole.update()); // after the active board: Auto follows it
view.renderListeners.push(() => fileExplorer.update()); // the highlighted board follows it too
layout.onChange(() => serialConsole.update());
layout.onChange(() => fileExplorer.update());
// Every edit is followed by a frame, so this notices all of them; the
// history then records the edit once no gesture is in progress.
view.renderListeners.push(() => project.checkForChanges());
view.renderListeners.push(() => controller.history.settle());
editor.onUndo = () => controller.history.undo();
editor.onRedo = () => controller.history.redo();
// Fixed column right of the dock; the dock reflows when it folds.
createPalette(
  app,
  (typeId, e) => editor.startPlacing(typeId, e),
  EXAMPLES.map((ex) => ({ name: ex.name, hint: ex.hint, run: () => editor.loadExample(ex.state) })),
);
