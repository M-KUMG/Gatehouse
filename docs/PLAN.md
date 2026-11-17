# Gatehouse plan

Living notes so later sessions keep the same context. Add a line to "Done" after each task. Do one task at a time.

## Done
- Template replaced with a TypeScript (Vite) full-window grid. Middle mouse button drag pans it. Nothing else yet.
- Retractable parts menu on the right (battery, BJT TO-92, resistor, LED). Drag a part onto the grid to place it, snapped to cells. Visual only: no pins, no behavior, no selecting or moving placed parts yet.
- Realistic SVG part art (src/art), pointer-based placement with a snapped ghost, and select/move/rotate (button or R)/delete/duplicate (Ctrl+D) of placed parts. PlacedPart is plain data (id, typeId, col, row, rotation).
- Wheel zoom around the cursor (25%-400%, readout bottom-left resets to 100%), selection box + Shift+click multi-select (move/rotate/duplicate/delete as a group, Ctrl+A, Esc), floating rotate/duplicate/delete toolbar, fixed missed-drop/first-click bug.
- Pins, wires between pins, more parts (9V battery, push button, toggle switch, potentiometer, ground), DC circuit simulation (MNA solver in src/sim with 20 unit tests), LED glow, hover readouts, example circuit. Open decisions: DC only (no timing yet); solver runs on the main thread, move to a Web Worker later. The agent that built this hit a usage limit during its own testing, so verification was done by the owner by hand.
- Save/Open/New projects (src/project): versioned JSON file `gatehouse-project` v1 with a `migrate()` step list and strict all-or-nothing validation, File System Access API with download/file-input fallback, Ctrl+S / Ctrl+Shift+S / Ctrl+O, unsaved dot + guards, localStorage autosave with restore offer. `Project` owns scene + camera (serialize/load/onChange). Not browser-tested by the agent.
- First microcontroller: "Arduino Uno" part (20x15 cells, pins d0-d13, a0-a5, 5v, 3v3, gnd/gnd2/gnd3, vin, aref) running real AVR code with avr8js (src/mcu: Intel HEX parser, ATmega328P wrapper, board runtimes) and a one-file mixed-signal bridge (src/mcu/mixedsignal.ts); board panel with Open .hex, Run/Pause/Reset, serial output, board time and speed; built-in Blink program and "Uno blink" example. Not browser-tested by the agent.

## Vision
Simulator for Arduino (AVR) and Raspberry Pi Pico (RP2040) boards plus circuits, running real firmware on emulated CPUs. Web app and Electron app from one codebase. University project, non-commercial, built entirely with Claude (teacher requirement).

Wanted features:
- Projects with an editable file structure (each board has a multi-file source tree).
- Place boards and parts freely, or on a breadboard.
- Component library with real specs (transistors etc.) that the user can edit.
- Several boards in one project, wired together (GPIO, UART, I2C, SPI).
- Serial monitor, code editor.

## Decisions made
- **Fully local app.** The website is static files only. Simulation runs in the browser (Web Workers, one per board). Can be a PWA that works offline after first load.
- **Projects are saved locally and imported.** One versioned, self-contained file (JSON, or zip if needed). No accounts, no server storage. Add a format version from the start. Browser autosave is only a convenience.
- **Components database = static JSON files** served from the VPS (cacheable locally). No server logic. Start with a small curated library (e.g. 2N2222, BC547, 1N4148, common LEDs, resistors, capacitors) with editable parameters. Later: import SPICE model files. Check model licenses before bundling.
- **Hosting:** static site on the user's Oracle Ampere (ARM64) VPS behind HTTPS.
- **Electron:** same built web app, bundled inside the installer (loads `dist/index.html`), works offline. Desktop-only extras (real files, local `arduino-cli`) come later.
- **Compiling is the one open problem.** Put it behind a swappable "compiler" interface (source files in, `.hex`/`.uf2` out) with implementations: precompiled files only, local `arduino-cli` (Electron), optional VPS compile service (sandboxed: container, no network, CPU/memory/time limits, rate limiting), possibly in-browser WebAssembly. Do not hardcode local paths into the UI.
- **IDE-style layout (planned).** The parts menu stays fixed on the right (retractable, not movable). The grid editor fills the centre. Three windows can be docked left/bottom/top (stacked or tabbed, e.g. two on the left one under the other) or floated and resized: **Serial console**, **Code editor**, **File explorer**. Do not hand-build docking: use a library (candidate: `dockview`, MIT, believed to work without React: verify first) that also saves/restores the layout. Layout is per-user (localStorage), NOT part of the project file. The grid canvas must resize with the centre area. Phones: floating windows do not work, plan a one-panel-at-a-time bottom sheet fallback.
  - Serial console: shows output of a selected board; dropdowns for board and serial port (Uno: 1 port; Mega: Serial, Serial1-3; Pico: UART0, UART1, USB serial). Later an input line to send text. Replaces the small output box in the board panel.
  - Code editor: tabs per open file; candidate CodeMirror 6 (lighter than Monaco), C++ and Python highlighting.
  - File explorer: board folders and files, create/rename/delete.
  - Selecting a board on the grid switches explorer and console to it, with an option to pin a window to one board.
- **Folder-based project (planned, project format v2).** A project is a folder: `gatehouse.json` (circuit: parts, wires, boards list, camera, version, same content as today's file) plus `boards/<board-id>/...` source files. Folder name = the stable board id (never reused), the display name lives in `gatehouse.json`. Storage goes behind a small `ProjectStorage` interface (read all files / write file / list) with implementations: single JSON file (today), real folder (Chrome/Edge File System Access API, Electron), zip (Firefox/Safari fallback). Start with an in-memory file tree. Existing v1 files migrate through the `migrate()` list.
- **Time-stepping solver (planned).** The DC solver gives a steady answer per simulated timestamp (enough for LEDs, buttons, transistor switches). Capacitors, RC delays, motors and PWM smoothing need a transient solver (companion models, backward Euler). `SimInput.time` already exists for this. Do it after the first board works end to end.
- **Git workflow:** only one person works at a time (friend asks first, uses the shared Claude account). Commit straight to `main`, `git pull` before starting, push when done, tell the other on Messenger. Each person pushes under their own GitHub login. Never put tokens in remote URLs.

## Open decisions
- How compiling works for the demo (see above). Idea: a small research task to check if `avr-gcc` runs as WebAssembly. RP2040 option: MicroPython, no compile needed.
- Analog solver: write a small solver, or ngspice via WebAssembly (needed for accurate transistors).
- Mixed-signal sync between digital firmware and analog circuit. First version (src/mcu/mixedsignal.ts): fixed 1 ms slices of simulated time; pin changes are cycle-stamped, each distinct pin setup is DC-solved once (cached) and results are time-weighted, then smoothed over 10 ms (PWM shows as a mean brightness, a first approximation); inputs/ADC are fed back at slice ends (up to 1 ms lag). Output = vcc/0 V behind 25 ohm, INPUT_PULLUP = 30 kohm to vcc, input = 100 Mohm; thresholds >3 V high, <1.5 V low. The board's gnd is a 0 V reference like a ground part. Revisit with a transient solver (SimInput.time is already there).
- Emulation runs on the main thread (BoardClock, requestAnimationFrame) through a plain-data BoardEmulator interface (run(cycles) -> SliceResult, setInputs), so it can move to a Web Worker later; it is not in one yet because the bridge needs synchronous solves between slices. Time comes only from CPU cycles; the wall clock only picks how many slices to run per frame (speed shown as e.g. 1.00x).
- Built-in Blink hex: our own C program (src/mcu/programs/blink.c, Arduino-style millis on Timer0, serial at 9600) compiled locally with WinAVR avr-gcc 4.3.3; not the Arduino core. Real Arduino sketches load via Open .hex.
- Updates for the bundled Electron app (installer vs auto-update).

## Suggested order (one small task each)
Done: grid, zoom, parts, wires, DC solver, save/load, first AVR board running Blink (see Done above).

Next, in this order:
1. **Licensing basics:** add a LICENSE for Gatehouse itself (owner decides which) and a third-party notices file generated from dependencies (see Licensing). Small, do it early.
2. **Dock layout shell:** `dockview` (or similar), grid in the centre, fixed retractable parts menu, empty placeholder windows, saved layout.
3. **Serial console window** (board + port dropdowns), replacing the board panel's output box.
4. **In-memory project file tree** (`boards/<id>/...`), project format v2 with migration, explorer window, then folder/zip storage behind `ProjectStorage`.
5. **Code editor window** (CodeMirror 6), tabs, opens files from the tree.
6. **Compiler decision and interface** (browser WebAssembly research, Electron `arduino-cli`, optional VPS service).
7. **Capacitor + time-stepping solver.**
8. **Breadboard** connectivity part.
9. **RP2040** support (rp2040js), then **several boards wired together** (UART, I2C, SPI).
10. **Component library** with editable specs, SPICE model import, analog solver decision (own vs ngspice WASM).
11. Electron shell, VPS deploy, polish, docs.

## Licensing
- Using MIT libraries does not force a LICENSE file for our own code, but MIT requires keeping each library's copyright notice and licence text when we distribute it (the built site and the Electron installer both count). Plan: a generated `THIRD_PARTY_LICENSES` file (from the dependency tree) shipped with the app, e.g. with a licence-checker tool at build time.
- Gatehouse itself: with no LICENSE file the default is "all rights reserved" (others may not reuse it). Owner decides (e.g. MIT, or none while it is a uni project) and adds a `LICENSE` file at the repo root.
- Check before bundling anything new. Known so far: avr8js MIT, rp2040js MIT, vite/typescript/vitest MIT, dockview MIT (verify), CodeMirror 6 MIT, avr-libc (startup code in our Blink hex) permissive. Watch out: `arduino-cli` is GPLv3 and Arduino core libraries are LGPL: running arduino-cli as a separate program is different from bundling it, and shipping it in an installer has obligations: check before bundling. Manufacturer SPICE models may have restrictive licences.
- Naming rule stays: no Arduino, Raspberry Pi or Pico in the product name.

## Rules to keep
- Timing from cycle counts on a global timeline, never wall-clock timers.
- Deterministic: same project and inputs give the same output.
- Interfaces in `core` before implementations; extend deliberately.
- No Arduino, Raspberry Pi or Pico in the product name. Keep "Gatehouse" in one constant.
