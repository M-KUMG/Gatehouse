# Gatehouse plan

Living notes so later sessions keep the same context. Add a line to "Done" after each task. Do one task at a time.

## Current status (kept honest, update with every task)
**Works** (typecheck, build and 98 unit tests pass; UI checked by hand as noted):
- Grid editor: pan (middle mouse), zoom, parts menu, drag-in placement, select/box-select/move/rotate/duplicate/delete, floating toolbar, wires between pins, wire-to-wire junctions, touching pins connect without a wire, hover readouts. Current dashes animate on their own (frame loop runs only while something moves).
- Parts: AA and 9V battery, ground, resistor (editable value), LED, toggle switch, push button, potentiometer, BJT (BC547-style), Arduino Uno.
- DC circuit solver (src/sim) with LED glow and overcurrent warning; Arduino Uno runs real AVR code (avr8js) on the main thread and drives/reads pins through the mixed-signal bridge. Blink example works.
- Save/Open/New, autosave restore, versioned project file (v2; v1 files are migrated on load).
- Dock layout shell (dockview) with a Windows menu and saved layout. Licensing: MIT LICENSE and generated third-party notices.
- Serial console window: output of one board and port (Board dropdown with Auto, Port dropdown from the board type's data, baud rate), kept per board and port in a bounded store even while the window is closed.

**Placeholders / not built yet**
- Code editor and File explorer windows are empty placeholders. The serial console only shows output (no input line to send text yet).
- No project folder / multi-file source tree yet (project is one JSON file with the loaded hex inside the board).
- No compiler: programs load as precompiled `.hex` only.
- No capacitors or time-stepping solver (DC only), no breadboard, no RP2040, no multi-board wiring, no component database, no undo.
- Emulation is not in a Web Worker. Phone layout (bottom-sheet fallback) not done. No Electron-specific work beyond loading `dist/` (Electron does not warn about unsaved changes on close).

**Verification so far:** the owner tried save/load by hand and reported it works. In a browser I checked: placing parts, the Uno Blink example (LED blinks at 1.00x, serial text appears), autosave restore, opening the dock windows and dropping a part onto the resized grid. Not checked by anyone yet: the self-running current animation, touching-pin contacts and wire-to-wire junctions in the browser (unit-tested only), Pause/Reset, Open .hex with real or broken files, PWM brightness, floating/tabbing/re-docking windows, layout restore after reload, narrow screens, Electron.

## Done
- Template replaced with a TypeScript (Vite) full-window grid. Middle mouse button drag pans it. Nothing else yet.
- Retractable parts menu on the right (battery, BJT TO-92, resistor, LED). Drag a part onto the grid to place it, snapped to cells. Visual only: no pins, no behavior, no selecting or moving placed parts yet.
- Realistic SVG part art (src/art), pointer-based placement with a snapped ghost, and select/move/rotate (button or R)/delete/duplicate (Ctrl+D) of placed parts. PlacedPart is plain data (id, typeId, col, row, rotation).
- Wheel zoom around the cursor (25%-400%, readout bottom-left resets to 100%), selection box + Shift+click multi-select (move/rotate/duplicate/delete as a group, Ctrl+A, Esc), floating rotate/duplicate/delete toolbar, fixed missed-drop/first-click bug.
- Pins, wires between pins, more parts (9V battery, push button, toggle switch, potentiometer, ground), DC circuit simulation (MNA solver in src/sim with 20 unit tests), LED glow, hover readouts, example circuit. Open decisions: DC only (no timing yet); solver runs on the main thread, move to a Web Worker later. The agent that built this hit a usage limit during its own testing, so verification was done by the owner by hand.
- Save/Open/New projects (src/project): versioned JSON file `gatehouse-project` v1 with a `migrate()` step list and strict all-or-nothing validation, File System Access API with download/file-input fallback, Ctrl+S / Ctrl+Shift+S / Ctrl+O, unsaved dot + guards, localStorage autosave with restore offer. `Project` owns scene + camera (serialize/load/onChange). Not browser-tested by the agent.
- First microcontroller: "Arduino Uno" part (20x15 cells, pins d0-d13, a0-a5, 5v, 3v3, gnd/gnd2/gnd3, vin, aref) running real AVR code with avr8js (src/mcu: Intel HEX parser, ATmega328P wrapper, board runtimes) and a one-file mixed-signal bridge (src/mcu/mixedsignal.ts); board panel with Open .hex, Run/Pause/Reset, serial output, board time and speed; built-in Blink program and "Uno blink" example. Not browser-tested by the agent.
- Licensing: Gatehouse is MIT (`LICENSE`). `npm run licenses` (scripts/third-party-licenses.mjs, no dependencies) walks the production dependency tree, writes `THIRD_PARTY_LICENSES.txt` (name, version, licence, full licence text) and fails on any licence outside its allowlist (MIT, ISC, BSD-2/3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0); `npm run build` also copies it into `dist/`. Found: avr8js MIT, dockview MIT, dockview-core MIT.
- Dock layout shell (src/layout): `dockview` 8.9 (MIT, plain TypeScript, floating groups and toJSON/fromJSON built in). The grid is the locked, tab-less centre panel (its canvas redraws on ResizeObserver; all coordinate math already uses the canvas' own rect); the parts menu is a fixed flex column on the right that folds to a thin strip. Placeholder windows Serial console / Code editor / File explorer dock left/top/bottom (right drops beside the grid are refused), stack, tab, float (tab right-click > Float); opened from the new Windows menu in the file bar, which also has Reset layout. Layout saved per user in localStorage (`gatehouse.layout`, not in the project file). File bar, board panel, zoom and status anchor to the grid's area. Not browser-tested by the agent.
- Serial console window (src/layout/serialconsole.ts; DOM-free store src/mcu/serialstore.ts owned by `BoardRuntimes`): Board dropdown ("Auto: selected board" follows the board panel's board, or a fixed "Arduino Uno #<part id>"), Port dropdown from `BoardSpec.serialPorts` (Uno: `usart0` "Serial (USART0)"; emulators report bytes per port id in `SliceResult.serial`), baud from the USART registers shown as the nearest standard rate (9615 shows 9600). Per board and port ~200k chars / 5000 lines (oldest whole lines dropped), cleared on reset or new program, removed with the board; bytes decoded once (CR LF, CR, LF each one line end, other non-printables as `\xNN`). Appends only new text, auto-scroll pauses when scrolled up, Clear, hints. Board panel's output box replaced by a "Serial console" link. Choice is session-only; project format unchanged. Not browser-tested by the agent.

- Three fixes from the owner. (1) Current dashes now move with the mouse idle: GridView runs its own requestAnimationFrame loop that continues only while `needsAnimation` (wire current above 10 uA, or a board running) says so and stops on an idle grid; per-wire dash phase advances by frame time (src/animation.ts, capped at 0.1 s per frame, visual only, never touches the simulation). Root cause of the old freeze: with no board in the project the serial console's update threw every frame (its board dropdown was never built), and the old loop re-armed itself after the render listeners; fixed that, the loop now re-arms before the listeners and each listener is isolated. (2) Touching pins connect: src/contacts.ts derives links from positions (pins of different parts on one grid point; a pin on a wire's waypoint or segment joins that wire), never joins a part's pins to each other, adds junction dots; nothing stored. (3) Wire to wire: a wire can end on (or press-drag to start from) any grid point of another wire; that wire is split there into two wires meeting at a stored junction node (src/junctions.ts). Project format v2 (see Decisions). Not browser-tested by the agent.
- Rough edges: a pin lying mid-wire is linked to the wire's `from` end, so that wire's animated current ignores the tap (net voltages are right). Junction nodes are not selectable on their own (select/delete the wires).

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
- **IDE-style layout (shell and serial console done; code editor and file explorer still placeholders).** The parts menu stays fixed on the right (retractable, not movable). The grid editor fills the centre. Three windows can be docked left/bottom/top (stacked or tabbed, e.g. two on the left one under the other) or floated and resized: **Serial console**, **Code editor**, **File explorer**. Do not hand-build docking: uses `dockview` (MIT, no framework, saves/restores the layout). In v8 the project split into `dockview` (public entry + stylesheet) and `dockview-core` (engine; its README says it is internal and it ships no CSS), so we depend on `dockview`. Layout is per-user (localStorage), NOT part of the project file. The grid canvas must resize with the centre area. Phones: floating windows do not work, plan a one-panel-at-a-time bottom sheet fallback (still open: today the parts menu only starts folded on narrow screens).
  - Serial console: shows output of a selected board; dropdowns for board and serial port (Uno: 1 port; Mega: Serial, Serial1-3; Pico: UART0, UART1, USB serial). Later an input line to send text. Replaces the small output box in the board panel.
  - Code editor: tabs per open file; candidate CodeMirror 6 (lighter than Monaco), C++ and Python highlighting.
  - File explorer: board folders and files, create/rename/delete.
  - Selecting a board on the grid switches explorer and console to it, with an option to pin a window to one board.
- **Folder-based project (planned, project format v3; v2 is now taken by junctions).** A project is a folder: `gatehouse.json` (circuit: parts, wires, boards list, camera, version, same content as today's file) plus `boards/<board-id>/...` source files. Folder name = the stable board id (never reused), the display name lives in `gatehouse.json`. Storage goes behind a small `ProjectStorage` interface (read all files / write file / list) with implementations: single JSON file (today), real folder (Chrome/Edge File System Access API, Electron), zip (Firefox/Safari fallback). Start with an in-memory file tree. Existing v1/v2 files migrate through the `migrate()` list.
- **Time-stepping solver (planned).** The DC solver gives a steady answer per simulated timestamp (enough for LEDs, buttons, transistor switches). Capacitors, RC delays, motors and PWM smoothing need a transient solver (companion models, backward Euler). `SimInput.time` already exists for this. Do it after the first board works end to end.
- **Junctions and project format v2.** A junction is a first-class node `{ id, col, row }` in `junctions`; a wire end is either a pin `{ partId, pinId }` or `{ junctionId }`. Ending a wire on another wire splits that wire at the clicked grid point into two wires meeting at the junction (the route's corners become waypoints, so nothing moves on screen); an existing junction at that point is reused. So a junction never has to "stay on" a wire: wires end at it, and moving or rotating parts just reroutes them. Rule kept by `Scene.tidyJunctions` after every delete: a junction lives only while 3 or more wires meet at it; with 2 left the two wires merge back into one (through the junction's point), with 1 or 0 the junction and the dead-end stub go. Deleting a wire never deletes unrelated wires. Junctions move/rotate/duplicate with a selection only when all their wires lead to selected parts (or such junctions). The solver sees a junction as a `node` component (one pin, no resistance). Implicit contacts (touching pins, pins on wires) are derived from positions on every solve and never stored. v1 -> v2 migration adds `junctions: []`; validation rejects dangling junction references, junctions with fewer than 3 wires, two junctions at one point, duplicate wires and self-loops, all-or-nothing as before.
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

1. ~~**Licensing basics**~~ (done: MIT LICENSE, generated THIRD_PARTY_LICENSES.txt).
2. ~~**Dock layout shell**~~ (done: dockview, placeholder windows, saved layout).

3. ~~**Serial console window**~~ (done: board + port dropdowns, per-board/port store, replaces the board panel's output box).

Next, in this order:
4. **In-memory project file tree** (`boards/<id>/...`), project format v3 with migration, explorer window, then folder/zip storage behind `ProjectStorage`.
5. **Code editor window** (CodeMirror 6), tabs, opens files from the tree.
6. **Compiler decision and interface** (browser WebAssembly research, Electron `arduino-cli`, optional VPS service).
7. **Capacitor + time-stepping solver.**
8. **Breadboard** connectivity part.
9. **RP2040** support (rp2040js), then **several boards wired together** (UART, I2C, SPI).
10. **Component library** with editable specs, SPICE model import, analog solver decision (own vs ngspice WASM).
11. Electron shell, VPS deploy, polish, docs.

## Licensing
- Using MIT libraries does not force a LICENSE file for our own code, but MIT requires keeping each library's copyright notice and licence text when we distribute it (the built site and the Electron installer both count). Done: `THIRD_PARTY_LICENSES.txt` is generated by `scripts/third-party-licenses.mjs` (`npm run licenses`, also run by `npm run build` into `dist/`, which the Electron app loads and must ship). Still to add: the avr-libc BSD notice for the startup code in our built-in Blink hex (not an npm package, so the script does not see it).
- Gatehouse itself: MIT (`LICENSE` at the repo root).
- Check before bundling anything new. Known so far: avr8js MIT, rp2040js MIT, vite/typescript/vitest MIT, dockview + dockview-core MIT (verified), CodeMirror 6 MIT, avr-libc (startup code in our Blink hex) permissive. Watch out: `arduino-cli` is GPLv3 and Arduino core libraries are LGPL: running arduino-cli as a separate program is different from bundling it, and shipping it in an installer has obligations: check before bundling. Manufacturer SPICE models may have restrictive licences.
- Naming rule stays: no Arduino, Raspberry Pi or Pico in the product name.

## Rules to keep
- Timing from cycle counts on a global timeline, never wall-clock timers.
- Deterministic: same project and inputs give the same output.
- Interfaces in `core` before implementations; extend deliberately.
- No Arduino, Raspberry Pi or Pico in the product name. Keep "Gatehouse" in one constant.
