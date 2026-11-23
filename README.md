# Gatehouse
<img width="470" height="357" alt="image" src="https://github.com/user-attachments/assets/d98f5012-a194-44ee-93a9-0102a0bcfbdf" />

Web and Electron simulator for Arduino and (soon RP2040) boards and circuits. A university project, built entirely with Claude (a requirement of the course). Gatehouse itself is MIT licensed (see `LICENSE`).

## Get it

- **Web app** (nothing to install, desktop browser): https://gatehouse-sim.duckdns.org/app/
- **Windows desktop app:** download `Gatehouse-Setup-<version>.exe` from the [latest release](https://github.com/M-KUMG/Gatehouse/releases/latest). It is not code-signed, so Windows SmartScreen asks: choose "More info", then "Run anyway".
- **Main site:** https://gatehouse-sim.duckdns.org/

## Status

Early but working (version 0.2). You can build circuits on a grid, wire them, write an Arduino sketch, compile it on your own machine and run it on an emulated Uno or Nano that drives the circuit.

- **Works:** grid editor (pan, zoom, select, move, rotate, flip, copy, delete, undo/redo), wires, a DC and time-stepping circuit solver (capacitors, inductors, diodes, LEDs, BJTs, MOSFETs, IGBTs, relays, a DC motor, logic gates, a programmable power supply, a function generator), an Arduino Uno and Nano running real AVR code (UART, I2C, SPI and watchdog are emulated on the chip side), **compiling sketches in the browser or desktop app (WebAssembly, no server, offline once loaded)**, a part inspector / scope and a logic analyzer with a UART decoder, simulation start / pause / reset / speed, projects saved as `.gth` files (and, in the desktop app, as real folders), autosave, and an IDE-style window layout with a Serial console, a File explorer, a Code editor and a Build output window.
- **Compiler limits:** Uno and Nano profiles only (no Mega yet), no C compiler (`.c` files are compiled as C++), only the bundled libraries (Wire, SPI, SoftwareSerial, EEPROM, Servo, NeoPixel, HC-SR04). Sketches using `Wire` or SPI compile, but there is no way yet to attach I2C/SPI devices, and the buses are not modelled electrically.
- **Not built yet:** breadboard, Raspberry Pi Pico, several boards wired together, Mega, a component library with editable specs, a schematic view, a phone layout, electrical I2C/SPI buses.

The full roadmap, decisions and honest status are in [`docs/PLAN.md`](docs/PLAN.md).

## Run it

- Install: `npm install`
- Web (dev): `npm run dev`, then open the address it prints
- Electron: `npm start` (builds first)
- Windows installer: `npm run toolchain:fetch`, `npm run toolchain:packs`, then `npm run dist:setup` makes `release/Gatehouse-Setup-<version>.exe`, the installer with Gatehouse's own setup window (`npm run dist` makes the plain NSIS one, `...-classic.exe`). Both are unsigned: Windows SmartScreen asks for "More info" then "Run anyway". The compiler packs are inside the installer, so building sketches works offline.
- Type check: `npm run typecheck`
- Tests: `npm test`
- Build: `npm run build` (output in `dist/`, including `THIRD_PARTY_LICENSES.txt`, `NOTICE` and `licenses/`)
- Licences: `npm run licenses` writes `THIRD_PARTY_LICENSES.txt` (git-ignored, generated) from the production dependencies and fails on a licence outside the allowlist in `scripts/third-party-licenses.mjs`

### Compiler files (needed once, for compiling sketches)

The browser compiler uses a WebAssembly build of the Arduino AVR toolchain from [startabit/avr-gcc-wasm](https://github.com/startabit/avr-gcc-wasm) (release v1, GPL-3.0). The files are not in git. To use the compiler in development:

```
npm run toolchain:fetch     # downloads and verifies about 6 MB into toolchain/ (git-ignored)
npm run toolchain:packs     # packs them for the browser into toolchain/packs/
npm run dev
```

Then press Run (or Build) on a board with sketch files: the first time the browser downloads the compiler packs (about 6 MB, a progress card shows), then it is cached and works offline. Without these two commands the app still works: boards run the `firmware.hex` in their folder and say that the compiler files are not available.

- `npm run toolchain:sources` downloads the matching source archives (about 100 MB) for the GPL source mirror. This is only needed before publishing a build that contains the compiler; the steps are in `scripts/MIRROR.md`.
- The pack format, sizes and how the Worker loads them are in `docs/toolchain-packs.md`.
- `vite build` deliberately does not copy the compiler packs into `dist/`: a web deploy must put `toolchain/packs/` next to the app as `toolchain-packs/` (the live site does, under `/app/toolchain-packs/`, served without `Content-Encoding`). `npm start` (Electron) serves the app and `toolchain/packs/` through a small built-in `gatehouse://app/` address, so compiling works there too after the two toolchain commands; the installer (`npm run dist`) carries the packs inside the app.
- Compiler tests that use the real tools run automatically when `toolchain/` exists and are skipped otherwise: `npx vitest run src/build/wasm`.

## Using it

- Drag a part from the menu on the right onto the grid. Press a part's pin and drag to another pin to wire them; click grid points for bends, `Esc` cancels.
- A wire can also end on (or, by pressing and dragging, start from) any point of another wire: a junction dot joins them. Parts whose pins touch, or a pin placed on a wire, are connected without a wire.
- Click to select, drag to move, drag on empty space for a selection box, `Shift`+click to add to the selection. Dragging with the middle or the right mouse button moves the grid, the wheel zooms.
- Right-click a part (or a wire) for a menu of what you can do with it: board actions (run, build, reset, serial console, rename), edit value, rotate, flip, duplicate, delete. A right-button drag still moves the grid.
- Press `?` (or the round `?` button in the bottom-right corner of the grid) for the full list of keyboard and mouse shortcuts.
- Keys: `R` rotate, `Delete` remove, `Ctrl+D` duplicate, `Ctrl+A` select all, `Esc` clear. Zoom: `+` / `-` step the zoom, `0` goes back to 100%, `F` fits everything in view (the same as the zoom buttons in the bottom-left corner).
- `Ctrl+Z` undoes a circuit edit, `Ctrl+Y` (or `Ctrl+Shift+Z`) redoes it; the arrow buttons in the top-left bar do the same. Flipping switches, turning knobs and running boards are not undone.
- Switches and buttons toggle on click; double-click a part to edit its value (such as a resistor's ohms).
- Try the "LED + switch" or "Uno blink" example at the bottom of the parts menu. Select the Uno: a toolbar appears next to it with Run/Pause, **Build** (compile only), Reset, Serial console and Rename, and the red button on the board resets it.
- **How a board gets its program:** Run builds from the board's sketch files (`.ino`, `.cpp`, `.c`, `.h` in the board folder or its `src/` folder) when the compiler is available. If the build fails, the board shows the error and does not run an old program; open Windows > Build output to see every message, and click one to jump to that line in the editor. If the folder has no sketch files, or the compiler is not available, the board runs the `firmware.hex` in its folder instead (import a compiled one with the explorer's Import button; Arduino IDE: *Sketch > Export Compiled Binary*, the file without `with_bootloader`, named `firmware.hex`). Boards can be renamed with the pencil in the toolbar or `F2` on the board row in the explorer.
- In the browser `Ctrl+S` exports the project, `Ctrl+Shift+S` exports as, `Ctrl+O` imports. In the desktop (Electron) app the project can also live in a real folder: `Ctrl+S` saves to its folder, `Ctrl+Shift+S` saves as a new folder, `Ctrl+O` opens a project folder, `Ctrl+E` exports a `.gth`, `Ctrl+Shift+O` imports one. The folder holds the same files as the `.gth`. A `.gth` file is a zip of a folder holding `gatehouse.json` (the circuit) next to `boards/<board>/...` (each board's source files). Old single-file `.json` projects still open. The Windows button in the top-left bar opens the dockable windows.
- The File explorer shows the whole project: `gatehouse.json` (read-only, generated from the circuit) and a folder per board. Inside a board folder you can add files and subfolders, rename, delete, and import script files (Import button, or drag `.ino`/`.cpp`/`.h`/`.txt`... from your desktop onto a board folder). Clicking a board there selects it on the grid.
- Click a file in the File explorer to edit it in the Code editor. Changes are saved into the project automatically as you type (the project's unsaved dot shows until you save the `.gth`).

## Project layout

- `src/` app code (grid editor, parts, wiring, `sim/` circuit solver, `mcu/` Arduino emulation, `build/` firmware build seam and `build/wasm/` the browser compiler, `project/` save and load, `layout/` dock windows)
- `docs/PLAN.md` plan, decisions and status; `docs/compiler-spike*.md` compiler research; `docs/toolchain-packs.md` compiler pack format
- `scripts/` build and toolchain helpers; `spikes/` reference scripts from the compiler research (not part of the app)
- `licenses/` licence texts for the compiler toolchain; `NOTICE` third-party notices and the GPL source offer

## Licence notes

Gatehouse is MIT. Third-party libraries (currently `avr8js`, `dockview`, CodeMirror 6 and `fflate`, all MIT) keep their own licences, listed in `THIRD_PARTY_LICENSES.txt`. The built-in Blink program contains avr-libc and GCC start-up code, and the browser compiler uses GPL-3.0 and LGPL tools (GCC 7.3.0, binutils 2.42, the Arduino core): their notices and the written source offer are in `NOTICE`, the texts in `licenses/toolchain/`. The corresponding source is published in the [`toolchain-sources-v1` release](https://github.com/M-KUMG/Gatehouse/releases/tag/toolchain-sources-v1) (how it was made: `scripts/MIRROR.md`); publish a new mirror release before shipping a different toolchain build.
