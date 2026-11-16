import './style.css';
import { GridView } from './grid';

const canvas = document.getElementById('grid');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing #grid canvas');

new GridView(canvas);
