## Gatehouse 0.2.0

Build circuits on a grid and run real firmware on emulated chips, in your browser or on your desktop. A university project, built entirely with Claude.

**Windows:** download `Gatehouse-Setup-0.2.0.exe` below, run it and follow the window. It is not code-signed yet, so Windows SmartScreen may ask: choose **More info**, then **Run anyway**.
**Web app (nothing to install, desktop browser):** https://gatehouse-sim.duckdns.org/app/
**Main site:** https://gatehouse-sim.duckdns.org/

### New in 0.2.0

- **Gatehouse's own installer:** a setup window in the look of the app, with options for the folder and shortcuts, updates over an older install, and an uninstaller (Windows Settings > Apps, or `Uninstall Gatehouse.exe` in the install folder).
- **New parts:** NTC thermistor, RGB LED, 555 timer and a dual op-amp (LM358-like). The 555, the op-amp and the half-bridge driver now sit in a new **Integrated circuits** section, each with an example project.
- **LED:** clear + and - marks on the realistic LED, and a colour picker (a glass colour wheel, default red; the forward voltage follows the colour).
- **Logic analyzer:** I2C and SPI decoders next to UART.
- **Boards:** a per-board emulated clock (1, 8, 16 or 20 MHz), saved in the project.
- **Look and feel:** a Graphics setting (Glass or Solid, no transparency), a single glass part bar, buzzer sound, a coasting motor fan and menu fixes.

### Good to know

- The Windows download is unsigned and there is no Linux or macOS build yet.
- Not verified on hardware: this is a simulator. The 555 and op-amp models are simplified (no propagation delay for the 555, no bandwidth or slew rate for the op-amp). The full list of limits is in [`docs/PLAN.md`](https://github.com/M-KUMG/Gatehouse/blob/main/docs/PLAN.md).
- The compiler packs are inside the installer, so building sketches works offline.

### Licences and source

Gatehouse is MIT licensed. The compiler uses a WebAssembly build of the Arduino AVR toolchain (GPL and LGPL parts). The matching source and recipe files are published in the [`toolchain-sources-v1`](https://github.com/M-KUMG/Gatehouse/releases/tag/toolchain-sources-v1) release.

### Checksum (SHA-256) of `Gatehouse-Setup-0.2.0.exe`

`60b9cf001c174e5f92d93c2a2873dee5837a360409f2c1679f19a24df727590b`
