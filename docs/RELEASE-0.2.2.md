## Gatehouse 0.2.2: bridge rectifier, changeover switch, capacitor ratings and two fixes

Build circuits on a grid and run real firmware on emulated chips, in your browser or on your desktop. A university project, built entirely with Claude.

**Windows:** download `Gatehouse-Setup-0.2.2.exe` below, run it and follow the window. It is not code-signed yet, so Windows SmartScreen may ask: choose **More info**, then **Run anyway**. It updates an older Gatehouse install (your circuits and settings stay).
**Web app (nothing to install, desktop browser):** https://gatehouse-sim.duckdns.org/app/
**Main site and downloads:** https://gatehouse-sim.duckdns.org/

### New in 0.2.2

- **Bridge rectifier:** four diodes in a diamond (AC in on the left, DC out on the right). Set its rated current (0.1 to 50 A, also sets its voltage drop) and rated reverse voltage (10 to 2000 V); both are printed on the part. It warns and burns on too high a reverse voltage, on too much average current (so the short current pulses of a smoothed rectifier do not trip it) and on a huge surge. New example: Bridge rectifier.
- **Mains switch (changeover, SPDT):** a wall two-way switch with COM, NC and NO, rated 10 A. Click it to move COM from NC to NO.
- **Capacitor voltage rating:** both the ordinary and the electrolytic capacitor have a "Rated voltage" setting (1 to 1000 V). It is printed on the part, the part warns near it and burns above it (the ordinary one in either polarity), and a burned capacitor is an open circuit. The ordinary capacitor now defaults to 50 V, so an old circuit with one above 50 V will warn: set its rating.

### Fixed

- An LED bulb with nothing connected made the simulation fail ("no stable point").
- A relay coil switched off through a switch was reported burned with "millions of volts". That was the coil's own switch-off spike; the coil is now judged by the current through it, so a spike no longer burns it, while a lasting overvoltage still does.

### Good to know

- The bridge has no heat model beyond its average current, and no switching losses. The changeover switch does not model break-before-make.
- The Windows download is unsigned and there is no Linux or macOS build yet. Not verified on hardware: this is a simulator.
- The compiler packs are inside the installer, so building sketches works offline.

### Licences and source

Gatehouse is MIT licensed. The compiler uses a WebAssembly build of the Arduino AVR toolchain (GPL and LGPL parts). The matching source and recipe files are published in the [`toolchain-sources-v1`](https://github.com/M-KUMG/Gatehouse/releases/tag/toolchain-sources-v1) release.

### Checksum (SHA-256) of `Gatehouse-Setup-0.2.2.exe`

`822ad66c6f2836fbf8a4fa666eed8c1bb73412df69017e904d998d1c1675804c`
