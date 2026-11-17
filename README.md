# Gatehouse

Web and Electron simulator for Arduino and RP2040 boards and circuits. A university project, built entirely with Claude (a requirement of the course). Gatehouse itself is MIT licensed (see `LICENSE`).

## Status

Early but working. You can build circuits on a grid, wire them, and run a real Arduino Uno program that drives them.

- **Works:** grid editor (pan, zoom, select, move, rotate, copy, delete, undo/redo), wires, battery / ground / resistor / LED / switch / push button / potentiometer / transistor parts, a DC circuit solver, an Arduino Uno running real AVR code (load a compiled `.hex`, with a built-in Blink example), save/open projects, autosave, and an IDE-style window layout.
- **Placeholders:** the Serial console, Code editor and File explorer windows are empty for now.
- **Not built yet:** compiling sketches inside the app (load a precompiled `.hex` for now), a project folder with source files, capacitors and time-based circuits, breadboard, Raspberry Pi Pico, several boards at once, component database.

The full roadmap, decisions and honest status are in [`docs/PLAN.md`](docs/PLAN.md).

## Run it

- Install: `npm install`
- Web (dev): `npm run dev`, then open the address it prints
- Electron: `npm start` (builds first)
- Type check: `npm run typecheck`
- Tests: `npm test`
- Build: `npm run build` (output in `dist/`, including `THIRD_PARTY_LICENSES.txt` and `NOTICE`)
- Licences: `npm run licenses` writes `THIRD_PARTY_LICENSES.txt` (git-ignored, generated) from the production dependencies and fails on a licence outside the allowlist in `scripts/third-party-licenses.mjs`

## Using it

- Drag a part from the menu on the right onto the grid. Press a part's pin and drag to another pin to wire them; click grid points for bends, `Esc` cancels.
- A wire can also end on (or, by pressing and dragging, start from) any point of another wire: a junction dot joins them. Parts whose pins touch, or a pin placed on a wire, are connected without a wire.
- Click to select, drag to move, drag on empty space for a selection box, `Shift`+click to add to the selection. Middle mouse button drags the grid, the wheel zooms.
- Keys: `R` rotate, `Delete` remove, `Ctrl+D` duplicate, `Ctrl+A` select all, `Esc` clear.
- `Ctrl+Z` undoes a circuit edit, `Ctrl+Y` (or `Ctrl+Shift+Z`) redoes it; the arrow buttons in the top-left bar do the same. Flipping switches, turning knobs and running boards are not undone.
- Switches and buttons toggle on click; double-click a part to edit its value (such as a resistor's ohms).
- Try the "LED + switch" or "Uno blink" example at the bottom of the parts menu. Select the Uno, press Run, and use **Open .hex...** to load your own program (Arduino IDE: *Sketch > Export Compiled Binary*, use the file without `with_bootloader`).
- `Ctrl+S` saves the project, `Ctrl+Shift+S` saves as, `Ctrl+O` opens. The Windows button in the top-left bar opens the dockable windows.

## Project layout

- `src/` app code (grid editor, parts, wiring, `sim/` circuit solver, `mcu/` Arduino emulation, `project/` save and load, `layout/` dock windows)
- `docs/PLAN.md` plan, decisions and status
- `scripts/` build helpers

## Licence notes

Gatehouse is MIT. Third-party libraries (currently `avr8js` and `dockview`, both MIT) keep their own licences, listed in `THIRD_PARTY_LICENSES.txt`. The built-in Blink program contains avr-libc and GCC start-up code; their notices are in `NOTICE`.
