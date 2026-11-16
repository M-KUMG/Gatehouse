# Gatehouse plan

Living notes so later sessions keep the same context. Add a line to "Done" after each task. Do one task at a time.

## Done
- Template replaced with a TypeScript (Vite) full-window grid. Middle mouse button drag pans it. Nothing else yet.

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
- **Git workflow:** only one person works at a time (friend asks first, uses the shared Claude account). Commit straight to `main`, `git pull` before starting, push when done, tell the other on Messenger. Each person pushes under their own GitHub login. Never put tokens in remote URLs.

## Open decisions
- How compiling works for the demo (see above). Idea: a small research task to check if `avr-gcc` runs as WebAssembly. RP2040 option: MicroPython, no compile needed.
- Analog solver: write a small solver, or ngspice via WebAssembly (needed for accurate transistors).
- Mixed-signal sync between digital firmware and analog circuit (hardest part).
- Updates for the bundled Electron app (installer vs auto-update).

## Suggested order (one small task each)
1. Grid: snap to cells, zoom, place a first object.
2. Core: pin/net model, simulation clock (cycle counts, deterministic), project file format with version.
3. One AVR board running a precompiled blink `.hex` with an LED.
4. Component library and serial monitor.
5. Breadboard connectivity model.
6. RP2040 support.
7. Multi-board wiring and buses.
8. Analog solver and mixed-signal sync.
9. Compiler implementations, Electron shell, polish, docs.

## Rules to keep
- Timing from cycle counts on a global timeline, never wall-clock timers.
- Deterministic: same project and inputs give the same output.
- Interfaces in `core` before implementations; extend deliberately.
- No Arduino, Raspberry Pi or Pico in the product name. Keep "Gatehouse" in one constant.
