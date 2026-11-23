# Gatehouse

Gatehouse is a circuit and microcontroller simulator for the web and desktop. Build circuits on a grid, write Arduino sketches, and run them on an emulated Uno or Nano.

[Open the web app](https://gatehouse-sim.duckdns.org/app/) · [Desktop downloads and release notes](https://github.com/M-KUMG/Gatehouse/releases/latest) · [Project website](https://gatehouse-sim.duckdns.org/)

<img width="470" height="357" alt="image" src="https://github.com/user-attachments/assets/d98f5012-a194-44ee-93a9-0102a0bcfbdf" alt="Gatehouse. Build circuits and run real firmware on emulated chips, in your browser or on your desktop." />

## Try your first circuit

1. Open Gatehouse in a desktop browser and choose **Uno blink** from **Examples** in the Parts menu.
2. Select the Uno on the grid and click **Run**. Open **Code editor** and **Serial console** from the **Windows** menu to see the sketch and its output.
3. Drag a component from **Parts** onto the grid and wire it by dragging between pins. Select a part and click its name in the toolbar to edit its settings or search its presets. Press `?` to see the controls.

For a first circuit without code, try the **LED + switch** example.

## Desktop downloads

- **Windows x64** — Run `Gatehouse-Setup-<version>.exe` from the latest release. Windows may show a SmartScreen warning because the installer is unsigned.
- **Linux x64 preview** — Extract `Gatehouse-<version>-linux-x64.tar.gz` and run `./gatehouse` inside the extracted folder.

Both desktop packages include the compiler packs for offline sketch builds.

## What Gatehouse supports

- **Circuit simulation.** Build analog and digital circuits with DC and time-stepping simulation. Edit component values or search for manufacturer part numbers in supported editors, including diodes, relays, capacitors, sensors, switches, and motors.
- **Arduino firmware.** Compile Uno and Nano sketches locally with a WebAssembly AVR toolchain and the bundled libraries. In the browser, compiler packs are cached as they are used. You can also import precompiled `.hex` firmware.
- **Debugging.** Monitor serial output, probe voltage and current in the scope, and decode UART, I²C, and SPI signals in the logic analyzer.
- **Projects.** Save a portable `.gth` file with your circuit and source code. The desktop app can also open and save a project as a folder.

The current board models are the Arduino Uno and classic Nano. Raspberry Pi Pico (RP2040) and additional boards are on the [roadmap](docs/PLAN.md).

## Develop locally

Use Node.js 24, the version used by the Linux build workflow.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. To enable sketch compilation in a local checkout, prepare the compiler packs before starting the app.

```sh
npm run toolchain:fetch
npm run toolchain:packs
```

- `npm start` builds and opens the Electron app.
- `npm run typecheck` and `npm test` check the code.
- `npm run build` builds the web app in `dist/`. See the [compiler pack guide](docs/toolchain-packs.md) for web deployment and offline compiler details.
- `npm run dist:setup` builds the Windows installer. On Linux, `npm run dist:linux` builds the AppImage. `npm run dist:linux:portable` builds the Linux x64 archive.

## About and licences

Gatehouse began as a university project built with Claude as part of the course requirements. Gatehouse is [MIT licensed](LICENSE). Third-party notices are in [NOTICE](NOTICE), and the matching AVR toolchain source is available in [Toolchain sources v1](https://github.com/M-KUMG/Gatehouse/releases/tag/toolchain-sources-v1).
