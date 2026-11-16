import './style.css';
import { GridView } from './grid';
import { Editor } from './interaction';
import { Scene } from './model';
import { createPalette } from './palette';

const canvas = document.getElementById('grid');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing #grid canvas');

const scene = new Scene();
const view = new GridView(canvas, scene);
const editor = new Editor(view, scene);
createPalette(document.body, (typeId, e) => editor.startPlacing(typeId, e));
