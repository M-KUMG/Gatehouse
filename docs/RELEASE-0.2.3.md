## Gatehouse 0.2.3

Build circuits on a grid and run real firmware on emulated chips, in your browser or on your desktop.

Download **`Gatehouse-Setup-0.2.3.exe`** from the assets below and follow the Windows setup window. Compiler packs come with the installer, so sketch compilation also works offline.

[Web app](https://gatehouse-sim.duckdns.org/app/) · [Main site and downloads](https://gatehouse-sim.duckdns.org/downloads/)

### New in 0.2.3

- **Searchable diode library.** Choose from 33 common presets in the Diode, Schottky, and Zener editors. Examples include 1N4148, 1N4007, 1N5819, SS34, and 1N4733A. You can adjust the settings after choosing a preset, and Gatehouse saves the resulting values in the project.
- **Editable SPDT relay coils.** Set the coil resistance, pull-in voltage, and release voltage. Blank fields follow the selected coil voltage preset, so older projects keep their existing relay behavior.
- **Themed scrollbars.** Glass mode gets rounded blue-gray scroll thumbs and recessed tracks. Solid mode uses flat, opaque colors.

### Fixed

- The transient solver retries difficult steps at shorter intervals. The AVT1476 dusk switch was tested through bright and dark conditions and switched its relay automatically.
- Relay units line up with their fields, the diode editor opens smoothly sideways and downward, and search suggestions have breathing room below the search field.
- Removed a visual streak beneath the web app button on the main site.

### Good to know

- Diode presets use approximate forward curves. Zener presets set the nominal voltage in the existing 1 W model.
- The Windows installer is unsigned, so Windows SmartScreen may show a warning.

### Licences and source

Gatehouse is MIT licensed. Matching GPL and LGPL source and build recipes for the bundled AVR toolchain are available in [Toolchain sources v1](https://github.com/M-KUMG/Gatehouse/releases/tag/toolchain-sources-v1).

### SHA-256 for `Gatehouse-Setup-0.2.3.exe`

`69087fc86afdc1f30920e0a0e7a578f3a01977b6c963cf09c20ab082fd821693`
