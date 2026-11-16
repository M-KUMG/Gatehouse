import './style.css';
import { EXAMPLES } from './examples';
import { GridView } from './grid';
import { Editor } from './interaction';
import { boundsOf } from './model';
import { createPalette } from './palette';
import { ProjectController } from './project/controller';
import { Project } from './project/project';
import { Simulation } from './simulation';

const canvas = document.getElementById('grid');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing #grid canvas');

// The project owns the circuit and camera; everything below works on them in place.
const project = new Project();
const scene = project.scene;
const view = new GridView(canvas, scene, project.camera);
// The view asks the simulation to catch up before every frame, so any edit
// (a new wire, a flipped switch, a turned knob) is re-solved automatically.
const sim = new Simulation(scene);
view.sim = sim;
const editor = new Editor(view, scene, sim);
// Every edit is followed by a frame, so this notices all of them.
view.renderListeners.push(() => project.checkForChanges());
createPalette(
  document.body,
  (typeId, e) => editor.startPlacing(typeId, e),
  EXAMPLES.map((ex) => ({ name: ex.name, hint: ex.hint, run: () => editor.loadExample(ex.state) })),
);
new ProjectController(project, {
  beforeLoad: () => editor.reset(),
  afterLoad: (file) => {
    const box = boundsOf(scene.parts);
    if (!file.camera && box) view.centerOn(box);
    view.cameraChanged();
  },
});
