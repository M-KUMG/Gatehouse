## Gatehouse 0.2.4

Search by manufacturer part number in more component editors, and try Gatehouse on 64-bit Linux.

[Web app](https://gatehouse-sim.duckdns.org/app/) · [Main site and downloads](https://gatehouse-sim.duckdns.org/downloads/)

### New in 0.2.4

- **Expanded part library.** Added 97 presets for relays, bridge rectifiers, resistors, capacitors, inductors, potentiometers, photoresistors, thermistors, switches, transformers, lamps, buzzers, and DC motors. With the three existing diode catalogs, Gatehouse now includes 130 presets across 21 part types.
- **Editable settings.** Pick a part number to fill in values such as coil thresholds, winding resistance, power ratings, light and temperature response, or motor speed and current. You can fine-tune the values afterward. Gatehouse saves the selected part number and your settings with the circuit, so the presets work offline.
- **Linux x64 preview.** The portable archive includes Gatehouse and the offline compiler packs. Extract it, then run `./Gatehouse-0.2.4-linux-x64/gatehouse` from the parent folder.

### Fixed

- Numeric settings now accept scientific notation such as `4.5e-9` alongside SI shorthand such as `4.5n`.

### Good to know

- Download `Gatehouse-Setup-0.2.4.exe` for Windows or `Gatehouse-0.2.4-linux-x64.tar.gz` for Linux. The Windows installer is unsigned, so Windows SmartScreen may show a warning.
- Existing projects retain their original component settings. Presets use the simulation models available for each part, with typical values or datasheet limits where appropriate. Transistor presets are planned for 0.3.0.

### SHA-256

- `Gatehouse-Setup-0.2.4.exe` — `04228298e760fff07bd527f79a31a195c7c4be8b5f3a0098a10afa465331c313`
- `Gatehouse-0.2.4-linux-x64.tar.gz` — `58d3f5f4845edddb9d86e738204a4135f6b2954d8558ea08d448763d80a4bea7`

### Licences and source

Gatehouse is MIT licensed. Matching GPL and LGPL source and build recipes for the bundled AVR toolchain are available in [Toolchain sources v1](https://github.com/M-KUMG/Gatehouse/releases/tag/toolchain-sources-v1).
