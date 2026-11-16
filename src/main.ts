import './style.css';
import { EXAMPLES } from './examples';
import { GridView } from './grid';
import { Editor } from './interaction';
import { Scene } from './model';
import { createPalette } from './palette';
import { Simulation } from './simulation';

const canvas = document.getElementById('grid');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing #grid canvas');

const scene = new Scene();
const view = new GridView(canvas, scene);
// The view asks the simulation to catch up before every frame, so any edit
// (a new wire, a flipped switch, a turned knob) is re-solved automatically.
const sim = new Simulation(scene);
view.sim = sim;
const editor = new Editor(view, scene, sim);
createPalette(
  document.body,
  (typeId, e) => editor.startPlacing(typeId, e),
  EXAMPLES.map((ex) => ({ name: ex.name, hint: ex.hint, run: () => editor.loadExample(ex.state) })),
);
