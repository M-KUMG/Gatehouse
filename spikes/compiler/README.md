# Compiler spike scripts (reference only)

Scratch scripts from the browser-compiler feasibility spike (see `docs/compiler-spike.md`).
They drive the `@horang-corp/avr-gcc-wasm` tools directly from Node. They are NOT part of the
app and are not built or tested. Paths inside them point at the spike's original scratch folder
and a locally installed copy of the package (which Gatehouse must not redistribute: see the
licence section of the report), so they need adjusting before they can run again.
Reusable ideas: `q1-direct.mjs` (driving the tools), `sketch.mjs` (.ino preprocessing),
`corebuild.mjs` and `ar.mjs` (rebuilding the Arduino core and archives), `build-all.mjs`
(Uno/Nano/Mega builds), `emu-results.json` (what ran in our emulator), `sketches/` (test sketches).
