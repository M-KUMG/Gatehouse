## Gatehouse 0.2.1: AC and mains

Build circuits on a grid and run real firmware on emulated chips, in your browser or on your desktop. A university project, built entirely with Claude.

**Windows:** download `Gatehouse-Setup-0.2.1.exe` below, run it and follow the window. It is not code-signed yet, so Windows SmartScreen may ask: choose **More info**, then **Run anyway**. It updates an older Gatehouse install (your circuits and settings stay).
**Web app (nothing to install, desktop browser):** https://gatehouse-sim.duckdns.org/app/
**Main site and downloads:** https://gatehouse-sim.duckdns.org/

### New in 0.2.1

- **AC power supply (variable):** a sine source set by its RMS voltage (up to 500 V), its frequency (1 Hz to 1 kHz) and an RMS current limit. A lamp on the front shows when the limit holds the output back.
- **Mains outlet (230 V):** 230 V RMS, 50 Hz, behind a 16 A breaker (a short circuit holds the current at the limit). Live above neutral; needs no ground part, like a real outlet.
- **Light bulb (incandescent):** a tungsten filament whose resistance follows its temperature. A cold bulb takes several times its running current when switched on, then heats up in a few hundredths of a second and glows, from dull red to warm white. On a lower voltage it is dim and orange; on far too high a voltage the filament burns out. Power (1 to 1000 W) and rated voltage are settable.
- **Light bulb (LED):** a mains LED lamp: nothing flows while the mains is low, current only near the peaks. Its light follows the average power, so it dims on a lower voltage. Any wattage from 0.5 to 100 W.
- **Mains switch (10 A):** a wall light switch, rated for mains (the small toggle switch is only rated 1 A, so a lamp's switch-on surge would warn it).
- **Transformer:** two coupled windings (50 VA) with settable primary and secondary voltage. 230 V in gives the set voltage out, falling a few percent under load. On DC it draws a huge current and burns, like a real one.
- **A new menu section, AC & mains,** and four new examples: Mains lamp, 60 W bulb vs 9 W LED bulb, Transformer 230 V to 12 V and AC rectifier.

### Good to know

- The simulator already ran AC in the time domain (capacitors, inductors, diodes and transistors on a sine); now it has proper AC sources and mains parts. Not in yet: a frequency sweep (Bode plot), RMS, peak and frequency readouts on the scope, and mains-frequency effects beyond 1 kHz. They are planned.
- The transformer has no core saturation or core losses; the bulbs have no ageing. The LED bulb is a simplified driver (a threshold and a series resistance chosen for the rated power).
- The Windows download is unsigned and there is no Linux or macOS build yet. Not verified on hardware: this is a simulator.
- The compiler packs are inside the installer, so building sketches works offline.

### Licences and source

Gatehouse is MIT licensed. The compiler uses a WebAssembly build of the Arduino AVR toolchain (GPL and LGPL parts). The matching source and recipe files are published in the [`toolchain-sources-v1`](https://github.com/M-KUMG/Gatehouse/releases/tag/toolchain-sources-v1) release.

### Checksum (SHA-256) of `Gatehouse-Setup-0.2.1.exe`

`796cbf85add1a20e4c4cf4ac2b26090ddcb3f0d918f2427f25ba5035e94488be`
