import './tokens.css';
import './style.css';
import { ActiveBoard } from './boardcontrols';
import { BuildCard } from './buildcard';
import { EXAMPLES } from './examples';
import { CameraPan } from './camerapan';
import { cellBoxToWorld, revealTarget } from './camerareveal';
import { GRID_SIZE, GridView } from './grid';
import { Editor } from './interaction';
import { AutoOpen } from './layout/buildautoopen';
import { BUILD_OUTPUT_ID, BuildOutput } from './layout/buildoutput';
import { CODE_EDITOR_ID, CodeEditor } from './layout/codeeditor';
import { DockLayout, isForOtherWindow } from './layout/dock';
import { onOpenFile } from './layout/fileevents';
import { FILE_EXPLORER_ID, FileExplorer } from './layout/fileexplorer';
import { SCOPE_ID, ScopeWindow } from './layout/inspector';
import { LOGIC_ANALYZER_ID, LogicAnalyzerWindow } from './layout/logicanalyzer';
import { SERIAL_CONSOLE_ID, SerialConsole } from './layout/serialconsole';
import { createWindowsMenu } from './layout/windowsmenu';
import { registerCompiler } from './build/registry';
import { registerBrowserCompilers } from './build/wasm/worker/register';
import { boundsOf, footprint } from './model';
import { makeDraggable } from './draggablebar';
import { createPalette } from './palette';
import { renameBoard } from './project/boardfiles';
import { ProjectController } from './project/controller';
import { Project } from './project/project';
import { openSimWorker } from './sim/worker/client';
import { Simulation, buildNetlist } from './simulation';
import { TransportBar } from './transport';
// Last on purpose: the glass look overrides the plain styles above.
import './glass.css';

const app = document.getElementById('app');
const dock = document.getElementById('dock');
if (!app || !dock) throw new Error('Missing #app or #dock');

// The grid's area: the canvas plus the overlays anchored to it (file bar,
// zoom, status; the toolbar and board chip float over it). It lives in the
// Circuit panel's view, a row with the parts menu on its right (added at the end).
const circuitView = document.createElement('div');
circuitView.className = 'circuit-view';
const editorArea = document.createElement('div');
editorArea.className = 'editor-area';
const canvas = document.createElement('canvas');
canvas.id = 'grid';
editorArea.append(canvas);
circuitView.append(editorArea);

// Compile sketches in the browser (a Worker, toolchain packs from /toolchain-packs/)
// for the boards with a compiler profile; where the packs are not served
// (a host without them, Electron without toolchain/packs/) boards keep running their .hex file. See browserCompilers().
registerBrowserCompilers(registerCompiler);

// The project owns the circuit and camera; everything below works on them in place.
const project = new Project();
const scene = project.scene;
// The view asks the simulation to catch up before every frame, so any edit
// (a new wire, a flipped switch, a turned knob) is re-solved automatically.
// The engine runs in a Web Worker (src/sim/worker); `?sim=main` (or
// localStorage 'gatehouse.sim' = 'main') or a missing Worker keeps it on this thread.
const sim = new Simulation(scene, buildNetlist, { link: openSimWorker() });
// The board the other windows follow: the one selected on the grid, else the
// last one. Updated after every frame (the view comes later in this file).
const activeBoard = new ActiveBoard(() => scene.parts, () => view.selected);
// Serial output of the boards; "Auto" shows the active board. Made before the
// layout, which may restore the console window straight away.
const serialConsole = new SerialConsole(scene, sim, () => activeBoard.partId);
// Logic analyzer: digital traces of armed pins (sim.recorder) with UART decoding; the channel list is session-only.
const logicAnalyzer = new LogicAnalyzerWindow(scene, sim, () => activeBoard.partId);
// Scope: the values of the selected (or pinned) part, live and over time (sim.analog); UI-only state.
const scope = new ScopeWindow(scene, sim, () => view.selected);
// Build output: the build log of one board (Auto follows the active board). Made
// before the layout, which may restore the window straight away. The card at the
// top of the grid shows the first-time compiler download (from a build or from
// the window's "Download compiler now" button).
const buildCard = new BuildCard(editorArea, sim.boards.buildLog);
const buildOutput = new BuildOutput(scene, sim, project, () => activeBoard.partId, (profile) => buildCard.prefetch(profile));
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
const layout = new DockLayout(dock, circuitView, {
  [SERIAL_CONSOLE_ID]: serialConsole.element,
  [BUILD_OUTPUT_ID]: buildOutput.element,
  [CODE_EDITOR_ID]: codeEditor.element,
  [FILE_EXPLORER_ID]: fileExplorer.element,
  [SCOPE_ID]: scope.element,
  [LOGIC_ANALYZER_ID]: logicAnalyzer.element,
});
const view = new GridView(canvas, scene, project.camera);
// Overlays beside the selection follow the canvas when windows move around it.
layout.api.onDidLayoutChange(view.requestRender);
// The Circuit tab moved to the back (or front) of its group: hide or show those overlays.
layout.api.onDidActivePanelChange(view.requestRender);
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
// Simulated time moves while a board runs or the circuit clock (global Start)
// runs a circuit with capacitors or inductors: in the Worker (each frame it
// posts redraws), or on animation frames when the engine is on this thread.
const clock = sim.clock(view.requestRender);
// Global Start / Pause, Reset, speed and simulated time (top-right of the grid; UI-only state).
const transport = new TransportBar(editorArea, sim, clock, () => {
  clock.wake();
  view.requestRender();
});
editor.onToggleTransport = () => transport.toggle();
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
      sim.reset(); // and the circuit clock stopped at 0
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
// The two small bars on the grid can be grabbed and moved (position saved per user, not in the project).
makeDraggable({ id: 'file', bar, area: editorArea, label: 'file bar' });
makeDraggable({ id: 'transport', bar: transport.element, area: editorArea, label: 'run controls' });
// The toolbar's rename button: the project keeps the name (circuit data, so one undo step and a redraw: the
// grid label, File explorer, Serial console and status chip all follow).
editor.onRenameBoard = (partId, input) => renameBoard(project, partId, input);
// The toolbar's console button: open (or bring forward) the Serial console on that board.
editor.onOpenConsole = (partId) => {
  layout.open(SERIAL_CONSOLE_ID);
  serialConsole.showBoard(partId);
};
// The chip of a failed build: show that board's messages in the Build output window.
editor.onOpenBuildOutput = (partId) => {
  layout.open(BUILD_OUTPUT_ID);
  buildOutput.showBoard(partId);
};
// A failed build opens the Build output window once (without taking the keyboard from where it is);
// closing it again does not bring it back for the same failure.
const autoOpen = new AutoOpen();
sim.boards.buildLog.onChange((partId) => {
  if (partId === null) return autoOpen.forget(null);
  const state = sim.boards.buildLog.get(partId);
  if (state.status === 'idle') return autoOpen.forget(partId);
  if (autoOpen.shouldOpen(partId, state, layout.isOpen(BUILD_OUTPUT_ID))) {
    buildOutput.showBoard(partId);
    layout.openQuietly(BUILD_OUTPUT_ID);
  }
});
view.renderListeners.push(() => activeBoard.update());
view.renderListeners.push(() => transport.update());
// An edit can make time move (a capacitor added while the circuit clock runs).
view.renderListeners.push(() => clock.wake());
view.renderListeners.push(() => serialConsole.update()); // after the active board: Auto follows it
view.renderListeners.push(() => buildOutput.update());
view.renderListeners.push(() => fileExplorer.update()); // the highlighted board follows it too
view.renderListeners.push(() => logicAnalyzer.update());
view.renderListeners.push(() => scope.update()); // follows the selection and the newest result
layout.onChange(() => serialConsole.update());
layout.onChange(() => buildOutput.update());
layout.onChange(() => fileExplorer.update());
layout.onChange(() => logicAnalyzer.update());
layout.onChange(() => scope.update());
// Every edit is followed by a frame, so this notices all of them; the
// history then records the edit once no gesture is in progress.
view.renderListeners.push(() => project.checkForChanges());
view.renderListeners.push(() => controller.history.settle());
editor.onUndo = () => controller.history.undo();
editor.onRedo = () => controller.history.redo();
// Foldable column on the right of the grid, inside the Circuit panel.
createPalette(
  circuitView,
  (typeId, e) => editor.startPlacing(typeId, e),
  EXAMPLES.map((ex) => ({ name: ex.name, hint: ex.hint, run: () => editor.loadExample(ex.state) })),
  (typeId) => editor.placeAtCentre(typeId) !== null,
);
