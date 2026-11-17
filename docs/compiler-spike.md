# Compiler spike: Arduino sketches compiled in the browser with WebAssembly

Spike date: 2026-11-17. Subject: npm `@horang-corp/avr-gcc-wasm` 0.2.0 (published 2026-05-29).
Everything below was run on Windows 11, Node 24.20.0. One browser check was run in the Claude
desktop app's built-in browser (Chromium 156). Nothing was added to Gatehouse's `package.json`,
and the app source was not changed. The spike scripts live in the session scratchpad (see the
last section).

## Summary and recommendation

**Verdict: the technique works. Build our own pipeline in the same style, with our own
WebAssembly toolchain build. Do not ship this package's binaries.**

The facts behind it:

1. **It works, and it is fast.** GCC 7.3.0 `cc1plus` and binutils 2.42 (`as`, `ld`, `objcopy`)
   run as WebAssembly in Node and in a browser Worker. I drove them directly from my own code
   (not through the package's `compile()`) and built 11 test sketches for the Uno, 2 for the
   Nano and 5 for the Mega, including a multi-file sketch. Blink takes about 40 ms once the
   tools are loaded. The first build in Node takes about 220-300 ms. The package's own
   `compile()` in the browser takes about 440 ms per build, because it starts a new Worker and
   fetches 54 MB every time.
2. **The hex files run in Gatehouse's emulator.** These all behave correctly: Blink, Serial at
   9600 baud, PWM on pin 9 (490 Hz, 25.1 % duty), `analogRead` (2.5 V reads 512), INT0 button
   interrupts, Servo, EEPROM, SoftwareSerial, a Timer1 interrupt, the multi-file sketch and the
   Nano. **Wire hangs in `twi_writeTo` and SPI hangs in `SPI.transfer`,** because TWI and SPI are
   not connected in `atmega328p.ts`.
3. **The licence blocks us from shipping these binaries.** The GPLv3 GCC and binutils wasm files
   come with no corresponding source, no patches and no build scripts. An open issue (#2, opened
   2026-11-02, no reply) asks for exactly that. The package has no LICENSE file
   (`"license": "SEE LICENSE IN THIRD_PARTY_NOTICES.md"`, GitHub reports `license: null`), so
   its own JavaScript is all-rights-reserved by default. If we redistributed its wasm files, we
   could not meet GPLv3 §6.
4. **We can rebuild every asset ourselves.** Everything except the 4 tool binaries can be made
   from public sources:
   - The package's `libc.a` and `libgcc.a` are byte-identical to Arduino's
     `avr-gcc-7.3.0-atmel3.6.1-arduino7` toolchain.
   - I rebuilt the whole Arduino AVR core 1.8.7, plus Wire, SPI and SoftwareSerial, from source
     using only the wasm tools. That took about 1-1.4 s per board, for Uno, Nano and Mega.
5. **As shipped, the package covers the Uno only and has real gaps:**
   - Its `compile()` takes one source string. It does no `.ino` preprocessing: no
     `#include <Arduino.h>`, no prototypes, no joining of `.ino` files.
   - It links every library object into every build. Blink comes out at 5,292 bytes instead of
     1,064, and any sketch that defines its own `TIMER1_COMPA` interrupt fails to link with
     "multiple definition of `__vector_11`" because of Servo.
   - It does not ship `WInterrupts.o` (`attachInterrupt`), `libatmega328p.a` (so EEPROM fails
     to link), EEPROM.h, SoftwareSerial, or any avr6 (Mega) libraries.
   - It has no C compiler (`cc1`).
6. **Download size.** For a Uno build, the trimmed set is about **23.4 MB raw, 6.4 MB gzip and
   5.3 MB brotli**. The full package is 52.7 MB raw, 11.2 MB gzip and 8.2 MB brotli. `cc1plus.wasm`
   is most of the trimmed set: 13.2 MB raw, 4.3 MB gzip, 3.3 MB brotli. 26.7 MB of the package's
   29 MB of headers are `avr/io*.h` files for other MCUs. A real Uno build opens 38 headers
   (433 KB).
7. **Maintenance.** One contributor, 4 commits, all between 2026-05-13 and 2026-05-29, 3 stars,
   no GitHub releases. The repo holds the wasm tools as binaries only. It has no recipe for
   building them.

**Recommendation.** Write our own toolchain build: a Dockerfile with a pinned emsdk that builds
GCC 7.3.0 (Arduino's `toolchain-avr` patch set), binutils and avr-libc. Its outputs are
`cc1plus`, `cc1`, `as`, `ld` and `objcopy`. Copy the package's proven settings: DWARF stripped,
4 MB initial memory with growth allowed, MODULARIZE ES module, `callMain`, MEMFS. Then publish
the build repository as our GPL corresponding source.

Everything above the tools is ours: the Worker, asset packs, board profiles, `.ino`
preprocessing, archive linking and error mapping. This spike already has working versions of
all of them. We can use the package's binaries locally while we develop, but we do not ship
them.

**Fallback.** If our own toolchain build fails or takes too long: Electron + arduino-cli for the
desktop app, then the sandboxed VPS service for the web app (PLAN 6b). Part of the wasm path
survives either way: the sketch preprocessor, error parser, board profiles and the
`Compiler` seam are the same code.

## Proposed architecture for Gatehouse

```
UI thread                                  Worker (module, long-lived; recycled every N builds)
-----------                                ------------------------------------------------------
WasmAvrCompiler implements Compiler  --->  BuildRequest {profileId, files, hashes}
  available(): packs cached?               1. ensurePacks(profile.packs) - from Cache Storage, else
  build(): post + await, map errors           fetch with progress events -> Cache Storage
  progress events -> loading screen        2. WebAssembly.compileStreaming each tool once, keep
                                              the Module; new instance per tool run (callMain once)
board profiles (JSON data)                 3. preprocess .ino (join, Arduino.h, prototypes, #line)
  uno/nano/mega: mcu, arch, defines,       4. find #include <X.h> -> library packs
  F_CPU, variant path, data start,         5. per unit: cc1plus/cc1 -> as (object cache keyed by
  n-flash, packs, flash size, pins,           hash(text + flags + pack versions))
  serial ports                             6. ld with crt + objects + libarduino.a + lib*.a +
                                              -lm -lc -l<mcu> -lgcc, --gc-sections
asset packs (versioned, content-hashed)    7. objcopy -O ihex -> hex, size check vs profile
  toolchain-avr  (tools; shared)           8. stderr -> {file, line, col, severity, message}
  board-uno (trimmed headers, core .a, crt, libc/libm/libgcc/libatmega328p, ldscript)
  lib-wire, lib-spi, lib-servo, ... (headers + .a each)
```

- **Packs:** use one file per pack (a tar or a small container of our own) instead of 542
  separate fetches. Each pack has a manifest with sizes and sha256. The URLs are versioned, so
  Cache Storage keeps them forever and builds work offline afterwards. Electron loads the same
  packs from app resources.
- **Archives:** link the core and libraries as indexed `.a` archives, never as loose objects, so
  only referenced objects are pulled in. I wrote a 60-line JavaScript `ar` writer with a
  symbol index for this spike (`ar.mjs`); a native `avr-ar` in CI does the same job.
- **Prototypes:** `@lezer/cpp` is already installed through `@codemirror/lang-cpp`. A proper
  top-level function scan can use it, replacing the spike's regex.
- **Errors:** cc1plus prints `file:line:col: error: message`. Because the joined sketch carries
  `#line 1 "x.ino"` markers, its errors already name `.ino` files. We strip the `/build/`
  prefix. For `ld`, map `undefined reference to 'X'` to a sentence like "X is used but not
  defined; is a library missing?". Also set `thisProgram` so `ld` messages are not prefixed with
  `./this.program`.

### Task breakdown (rough effort)

| # | Task | Effort |
|---|------|--------|
| 1 | Own wasm toolchain: Dockerfile (pinned emsdk, GCC 7.3.0 + Arduino patches, binutils, avr-libc 2.0), build cc1plus/cc1/as/ld/objcopy, strip, CI, publish as the GPL source | 3-6 days (main risk) |
| 2 | Pack builder (Node, in CI): trimmed headers, core `.a` per board, library `.a` files, manifests, licence files | 1-2 days |
| 3 | Worker, tool runner, Module cache, MEMFS setup, recycling | 1-2 days |
| 4 | Sketch preprocessor (join `.ino`, Arduino.h, prototypes with @lezer/cpp, `#line`), with tests | 1-2 days |
| 5 | Include detection, library resolution, per-unit object cache | 1 day |
| 6 | Error parser to file:line, problems view, "Run builds first" | 1 day |
| 7 | Download manager: progress screen, Cache Storage, integrity check, offline behaviour | 1-2 days |
| 8 | `registerCompiler('uno', ...)`, board profiles as data, Electron resource path | 0.5-1 day |
| 9 | Emulator peripherals: TWI and SPI (avr8js classes exist), watchdog, USART driving d1 | 2-4 days (plus device models) |
| 10 | Nano (profile, art, pins); Mega later (avr6 pack, own ATmega2560 emulator setup) | 1 day / 3-5 days |

Total for Uno + Nano in the browser: about 3-4 weeks of focused work, half of it in tasks 1 and 9.

### Main risks

- **Licence:** solved only by building the toolchain ourselves (see Q2). Until then the
  package's binaries are for local development only.
- **Size:** about 6.4 MB gzip or 5.3 MB brotli on first use per toolchain, cached afterwards.
  Acceptable behind a progress screen.
- **Memory:** the cc1plus linear-memory peak was about 41 MB for these sketches (the package
  reports 40.8 MB). The JavaScript heap and MEMFS copies add more. Larger sketches were not
  measured, and low-end phones are untested.
- **Old compiler:** GCC 7.3 is what Arduino AVR ships, so it is compatible, but moving to a newer
  GCC means repeating task 1.
- **No LTO:** binaries are somewhat larger than the Arduino IDE's (Blink is 1,064 bytes here).
  Not compared against arduino-cli, which is not installed.
- **No `cc1` in the package:** user `.c` files need our own `cc1.wasm`. Compiling C as C++ (see
  Q5) was enough for the Arduino core, but it is a hack.
- **Maintenance:** we would own the toolchain. In return we no longer depend on a
  one-person repo.

## Evidence per question

### Q1. Install, Blink, timings, API, driving the tools directly

- `npm pack @horang-corp/avr-gcc-wasm@0.2.0` downloaded an 11.2 MB tarball with 556 files. I
  extracted it rather than installing it, so no package scripts ran.
- **The tools are built for web and worker only.** The Emscripten glue has no Node branch:
  `ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER`, and `readAsync` uses `fetch`. Two shims were
  enough to run the package's `buildFirmware()` in Node:
  - `globalThis.WorkerGlobalScope = function(){}`
  - a `fetch` that serves `file://` URLs, with `content-type: application/wasm` for `.wasm`
- **The tools are GCC 7.3.0 and binutils 2.42.** Strings in the binaries include
  `gcc-7.3.0/...`, `(GNU Binutils) 2.42`, `/work/prefix/lib/gcc/avr/7.3.0`, GMP 6.1.0,
  MPFR 3.1.4, MPC 1.0.3, ISL 0.16.1 and zlib 1.2.11.
- **A plain `.ino` does not compile.** cc1plus reports `'pinMode' was not declared in this scope`,
  because nothing adds `#include <Arduino.h>`. The build also does not stop after a compile error:
  it goes on to `avr-ld`, whose failure ("avr-ld did not produce ... errno=44") is what gets
  reported. With `#include <Arduino.h>` added, Blink builds.

Timings for the package's `buildFirmware()` in Node (Blink):

| Run | Wall time | cc1plus run | Headers into MEMFS | Fetched |
|-----|----------:|------------:|-------------------:|--------:|
| cold | 299 ms | 126 ms | 68 ms | 54.1 MB, 543 requests |
| warm 1 | 245 ms | 105 ms | 61 ms | 54.1 MB again (no asset cache) |
| warm 2 | 250 ms | 121 ms | 59 ms | 54.1 MB again |

Flash was 5,292 bytes, linear-memory peaks were cc1plus 42.7 MB and ld 6.1 MB.

**In the browser (Chromium 156, localhost, `cache-control: no-store`)**, the package's `compile()`
(a new Worker for each build) took **445 / 461 / 438 ms** for cold and two warm runs. Of that,
cc1plus ran 122 ms, `headersFsMs` (fetching 504 header files) took about 195 ms, and the
sequential linear-memory peak was 54.6 MB. Real network download time comes on top on first use.

**Driving the tools myself** (`tc.mjs`: one fresh Emscripten instance per tool run, with the
compiled `WebAssembly.Module` cached through `instantiateWasm`):

| Run | Total | cc1plus run |
|-----|------:|------------:|
| first | 221 ms | 108 ms |
| second (Module cached) | **42 ms** | 18 ms |

Linking only the core objects gives 2,246 bytes, against 5,292 with the package's object list.
Linking through an indexed archive gives **1,064 bytes**.

**The API.**
- `compile({ source, sensors, assetsBase })` and `buildFirmware(...)` return
  `{ hex, sensors, target, bytes, hexBytes, flashBytes, fitsTarget, objectCount, memory, timings, stderr }`.
- The include paths, defines and object list are hard-coded (`-DUSE_OLED` and `-DUSE_TOF` are
  the author's "sensor" switches), and the file name is fixed to `HorangFirmware.cpp`.
- The tool factories (`tools/*.mjs`) are plain Emscripten MODULARIZE ES modules. They take
  `{ noInitialRun, locateFile, print, printErr, instantiateWasm }` and expose `FS` and
  `callMain(args)`.

So yes, we can drive cc1plus, as, ld and objcopy directly. A build runs through these steps:

1. **cc1plus** (the driver is not used because it needs `vfork`):
   ```
   -quiet -imultilib avr5 -D__AVR_ATmega328P__ -D__AVR_DEVICE_NAME__=atmega328p -DF_CPU=16000000L
   -DARDUINO=10819 -DARDUINO_AVR_UNO -DARDUINO_ARCH_AVR -isystem /sysroot/gcc/include
   -isystem /sysroot/avr/include -I /arduino/variant -I /arduino/core ... <src> -mn-flash=1
   -mno-skip-bug -mmcu=avr5 -Os -std=gnu++11 -fpermissive -fno-exceptions
   -fno-threadsafe-statics -fno-rtti -fno-enforce-eh-specs -ffunction-sections -fdata-sections -o x.s
   ```
2. **as:** `-mmcu=atmega328p -o x.o x.s`
3. **ld:**
   ```
   -m avr5 -Tdata=0x800100 --gc-sections -o fw.elf /libs/crtatmega328p.o <objs> <archives>
   -L/libs -lm -lc [-latmega328p] -lgcc
   ```
   `ld` also needs `/ldscripts/avr5.xn` in MEMFS. Without it: `cannot open linker script file
   ldscripts/avr5.xn`.
4. **objcopy:** `-O ihex -R .eeprom fw.elf fw.hex`

### Q2. Licences

**What the package itself says:**
- `package.json`: `"license": "SEE LICENSE IN THIRD_PARTY_NOTICES.md"`.
- There is no LICENSE file in the tarball or the repo. GitHub's `/license` endpoint returns 404,
  and the repo metadata has `license: null`.
- `THIRD_PARTY_NOTICES.md` (1,370 bytes) says GCC and binutils are "GNU GPL v3 or later" and
  avr-libc is "generally BSD-style". It adds: "Any public or product distribution should also
  provide the corresponding source, local patches, and build scripts used to reproduce these
  artifacts."
- **The package does not provide that source itself.** The GitHub repo
  (tree listed through the API) contains `tools/*.wasm` binaries, `scripts/prepare-assets.mjs`
  and a publish workflow, with no emsdk or GCC build scripts.
- Issue #2 (2026-11-02, from a user shipping it in an education platform) asks for "the
  corresponding GCC/binutils source revisions, any local patches, and the build scripts". It
  has 0 comments.

| Component | Where | Licence | Source provided or linked? |
|---|---|---|---|
| Package's own JS (`firmware-builder.js`, `index.js`, `worker.js`, `prepare-assets.mjs`) | npm, GitHub | **None stated**, so all rights reserved by default | Visible, but no licence to reuse it |
| GCC 7.3.0 `cc1plus.wasm` (statically includes GMP 6.1.0, MPFR 3.1.4, MPC 1.0.3, ISL 0.16.1, zlib 1.2.11, libiberty) | `tools/` | GPLv3+; GMP, MPFR and MPC LGPLv3+; ISL MIT; zlib zlib licence | **No.** Version recoverable from strings only. Patches and flags unknown. |
| binutils 2.42 `avr-as`, `avr-ld`, `avr-objcopy` `.wasm` | `tools/` | GPLv3+ | **No** |
| Emscripten runtime inside the `.mjs` and `.wasm` files (musl libc, libc++/compiler-rt) | `tools/` | MIT / Apache-2.0 with LLVM exception | Not mentioned |
| `libgcc.a` (avr5) | `assets/libs` | GPLv3+ with GCC Runtime Library Exception 3.1 | No. Byte-identical to Arduino's toolchain, whose source Arduino publishes (`arduino/toolchain-avr`). |
| avr-libc `libc.a`, `libm.a`, `crtatmega328p.o`, headers | `assets/` | Modified BSD (copyright notice required) | No licence text included. Byte-identical to Arduino's. |
| Arduino AVR core 1.8.7 objects and headers | `assets/objects`, `fs/arduino` | LGPL-2.1+ | Downloaded from Arduino by `prepare-assets` (pinned, sha256) |
| Wire | objects + headers | LGPL-2.1+ | as above |
| SPI | objects + headers | GPLv2 or LGPL-2.1 (dual) | as above |
| Servo 1.3.0, Firmata 2.5.9 | objects + headers | LGPL-2.1+ | as above |
| Adafruit GFX 1.12.6, SSD1306 2.5.16, BMP085 1.2.4 | objects + headers | BSD | as above |
| Adafruit BusIO 1.17.4 | objects + headers | MIT | as above |
| DHT sensor library 1.4.7 | objects + headers | MIT | as above |
| Adafruit Unified Sensor 1.1.15 | headers | Apache-2.0 | as above |
| VL53L0X (Pololu) 1.3.1 | objects + headers | MIT-style (Pololu, with ST-derived parts) | as above |

The library licences come from the header comments in `assets/fs` and their well-known upstream
licences. **No library licence file is shipped in the package.**

**What shipping these wasm files in a public MIT-licensed web app would require of us:**
- **Keeping the app MIT is fine.** The compiler is a separate program: it runs in a Worker and
  is handed files and arguments. That is aggregation, so Gatehouse's own code can stay MIT.
- **But we would be distributing GPLv3 object code, which brings duties under §4-6:**
  - include the GPLv3 text and notices;
  - make the **complete corresponding source** of those exact binaries available, including the
    scripts used to build them (emsdk version, configure flags, patches), either alongside or
    through a written offer valid for 3 years.
  - "Installation Information" is not required, because the app is not a User Product.
- **We cannot do that with this package's binaries,** because nobody has published their
  source. That alone blocks shipping them. Rebuilding from known sources fixes it: we then
  publish our own build repository.
- **`libgcc.a`:** we redistribute it as a file, so the GPL applies to the file. Arduino's
  toolchain source covers it.
- **Users' firmware:** the GCC Runtime Library Exception means firmware built with this GCC
  (an "Eligible Compilation Process") is not under the GPL.
- **The Arduino core and libraries** are LGPL-2.1 (SPI is GPLv2 or LGPL). Shipping their
  compiled objects needs their notices and their source, which is easy: link or mirror the
  exact tags. Firmware linked with them stays with the user and is never distributed by us.
  This is the same situation as the Arduino IDE.
- **BSD, MIT and Apache libraries:** include their notices. avr-libc needs its copyright notice
  in the app's notices.
- **The package's own JavaScript has no licence,** so we must not copy it. Our pipeline should
  be written from scratch. The tool invocation flags are facts about GCC, not their code.

### Q3. Sizes

All sizes are in MiB. Brotli is quality 11 for the first table and quality 9 for the subset
tables. Each file was compressed on its own, so a pack bundled as one file compresses somewhat
better.

| File | Raw | gzip -9 | brotli |
|---|---:|---:|---:|
| `cc1plus.wasm` | 13.20 | 4.32 | 3.27 |
| `avr-ld.wasm` | 1.03 | 0.37 | 0.31 |
| `avr-as.wasm` | 0.73 | 0.30 | 0.25 |
| `avr-objcopy.wasm` | 0.69 | 0.28 | 0.23 |
| 4 `.mjs` glue files | 0.57 | 0.12 | 0.12 |
| **`tools/` total** | **16.22** | **5.41** | **4.19** |
| `assets/` total (542 files) | 36.44 | 5.78 | 4.00 |
| of which headers `fs/` (504 files) | 29.02 | 4.69 | 3.37 |
| of which `avr/io*.h` for other MCUs (309 files) | 26.67 | 4.15 | 3.48 (q9) |
| of which `libs/` (libgcc.a is 5.7 of that) | 6.05 | 0.67 | 0.30 |
| of which `objects/` (32 files) | 1.34 | 0.42 | 0.34 |

| Minimum sets (brotli quality 9) | Files | Raw | gzip | brotli |
|---|---:|---:|---:|---:|
| Headers trimmed (no other-MCU `io*.h`, no 3rd-party libraries) | 93 | 0.73 | 0.21 | 0.19 |
| Core objects | 17 | 0.40 | 0.13 | 0.11 |
| libc + libm + libgcc + crt + ldscript | 5 | 6.06 | 0.67 | 0.34 |
| **Minimum Uno Blink set (tools + the three rows above)** | 123 | **23.40** | **6.41** | **5.31** |
| Uno set + Wire, SPI, Servo | 139 | 23.55 | 6.47 | 5.35 |

- A build that includes Arduino.h, Wire.h, SPI.h and Servo.h opens only **38 headers (433 KB)**
  according to `cc1plus -H`. Only `iom328p.h` of the `io*.h` family is used.
- **The assets can be split well:**
  - one toolchain pack, shared by every AVR board;
  - one small board pack, about 0.5-1 MB brotli;
  - one tiny pack per library (Wire + twi + SPI + Servo objects together are 0.12 MB raw).
- The package itself always downloads everything: 54 MB, 542 requests per build.

### Q4. Multi-file sketches and preprocessing

**The package does no preprocessing** (see Q1), so I wrote it in `sketch.mjs`, about 50 lines:

1. Put the main `.ino` first and the others in alphabetical order, each preceded by
   `#line 1 "<name>.ino"`.
2. Add `#include <Arduino.h>` at the top.
3. Generate prototypes for top-level functions other than `setup` and `loop`, with default
   arguments removed, and place them after the include.
4. Compile `.cpp` and `.c` files as separate translation units. Headers sit next to them in
   `/build/`.
5. Link everything with the core and libraries as one indexed archive.

**Test sketch `multi`:**
- **Files:**
  - `multi.ino` calls `greet()` and `blinkTimes()` before they are defined;
  - `helpers.ino` defines them;
  - `counter.h` is shared;
  - `counter.cpp` and `describe.cpp` include it, and `describe` returns a `String`.
- **Result:** it built (4,528 bytes, 91 ms). In the emulator it printed `multi-file sketch`,
  `count=3`, `count=6`, ... and blinked d13.

Generated unit:
```
#include <Arduino.h>
void greet();
void blinkTimes(int n);
#line 1 "multi.ino"
...
#line 1 "helpers.ino"
...
```
**Errors map back to the right files.** With an error in `helpers.ino` line 2 and one in
`util.cpp` line 2, the output was:
```
helpers.ino:2:11: error: 'undefinedThing' was not declared in this scope
/build/util.cpp:2:21: error: expected ';' before '}' token
```
**What we still have to write properly:**
- A robust prototype generator. Arduino uses ctags or a clang-based preprocessor; the regex
  scan here would miss templates, multi-line signatures and function-pointer types. The
  `@lezer/cpp` parser we already have can do this.
- Where the prototypes go. Arduino places them before the first function definition, not
  right after the include.
- Library detection from `#include <X.h>`.
- Rules for `.ino` order and sub-folders, such as `src/`.

### Q5. Core version, pre-built libraries, regenerating assets

**Which core and libraries `prepare-assets` uses:**
- Arduino AVR core **1.8.7**, toolchain `avr-gcc 7.3.0-atmel3.6.1-arduino7`.
- Pre-built libraries: **Wire, SPI, Servo 1.3.0, Firmata 2.5.9, Adafruit BMP085 1.2.4,
  Adafruit BusIO 1.17.4, DHT 1.4.7, Adafruit GFX 1.12.6, Adafruit SSD1306 2.5.16, VL53L0X 1.3.1**,
  plus Adafruit Unified Sensor 1.1.15 (headers only).

**Missing from the package:**
- **Core files:** WInterrupts (`attachInterrupt`), IPAddress, CDC, USBCore and PluggableUSB.
  The last three are not needed on a Uno.
- **Libraries:** EEPROM (header, and `libatmega328p.a` for `eeprom_*`) and SoftwareSerial.
- **Board variants:** only `variants/standard` is included.

**How the assets are made:** `prepare-assets` runs on **Linux only**. It needs Node 18+, `tar`
and `unzip`. It downloads the Arduino package index, the core, the native avr-gcc toolchain and
the libraries (checked by sha256), copies their headers, compiles the objects with the
**native** avr-gcc, and writes `manifest.json`.

**Can we regenerate them ourselves? Yes, even without a native compiler.** `corebuild.mjs`
compiled every `.c`, `.cpp` and `.S` file in `cores/arduino` of core 1.8.7, plus Wire, `twi.c`,
SPI and SoftwareSerial, with only the wasm tools. For the `.S` file it ran
`cc1plus -E -lang-asm` and then `as`.

| Board | Objects | Time | Example sketches |
|---|---:|---:|---|
| Uno | 29/29 | 1.35 s | Blink 1,064 bytes, Serial 2,296, Wire 4,556, EEPROM 1,970, SoftwareSerial 2,552 |
| Nano | 29/29 | 1.0 s | Blink, Serial |
| Mega | 29/29 | 1.0 s | see Q6 |

A sketch using `Serial3` on the Uno fails, as it should (`'Serial3' was not declared`).

**The catch is that the package has no `cc1` (C compiler).** C files compiled with cc1plus get
C++ name mangling. For example `hooks.c` fails with "aliased to undefined symbol `__empty`", and
`twi_transmit` comes out unresolved. The workaround that worked:
- wrap the file in `extern "C" { #line 1 "x.c" ... }`;
- add `-U__cplusplus -D_Bool=bool`.

That is good enough to build the core, but for user `.c` files we should build `cc1.wasm` too,
or pre-build cores with a native compiler in CI.

The archive step needs no native `avr-ar` either: `ar.mjs` writes an indexed GNU `ar` file from
ELF symbol tables, and `avr-ld` accepts it.

### Q6. Other chips: Mega (ATmega2560) and Nano

- **The compiler handles atmega2560.** cc1plus and as with `-mmcu=avr6`, `-imultilib avr6`,
  `-D__AVR_ATmega2560__` and `-mn-flash=4` (from the device specs file) compiled with the
  package's headers alone (`iom2560.h` is there).
- **Linking with the package's assets alone fails.** There is no `crtatmega2560.o`, no avr6
  `libc.a`, `libm.a` or `libgcc.a`, no `libatmega2560.a`, no `avr6.xn` linker script and no
  `variants/mega`. The first missing input is `crtatmega2560.o`.
- **With those taken from Arduino's toolchain archive** (37.6 MB download, avr5 and avr6
  directories extracted) and the mega variant from the core source, a full Mega core (29 objects)
  and these sketches linked:

| Sketch | Flash |
|---|---:|
| Blink | 1,660 bytes |
| Serial | 2,654 bytes |
| Serial3 | 2,086 bytes |
| Wire | 5,336 bytes |
| EEPROM | 2,328 bytes |

  Link settings: `-m avr6 -Tdata=0x800200 -latmega2560`.
- **Not run:** Gatehouse has no ATmega2560 emulator yet.
- **Nano:** same MCU, same tools and libs. It uses `variants/eightanaloginputs`, which includes
  `../standard/pins_arduino.h`, so the variants need to be mounted at
  `/arduino/variants/<name>`. Built and ran: Serial printed `tick 0..2` in our Uno emulator.
- The package's `libgcc.a` and `libc.a` (avr5) are byte-identical (`cmp`) to Arduino's toolchain.

### Q7. End-to-end in Gatehouse's emulator

All hex files were built with my direct pipeline, linking the archive (core + `WInterrupts.o` +
libraries, plus `libatmega328p.a`). Each was run with `UnoEmulator` from a temporary vitest file
for the simulated time shown, sampling the program counter every 500 ms and resolving it against
the ELF symbol table. The temporary test was deleted afterwards. 15 cases passed.

| Sketch | Time | Result |
|---|---:|---|
| (a) Blink pin 13 | 4.5 s | **OK.** d13 edges at 0, 1.0000, 2.0000, 3.0001, 4.0001 s. The package-built hex and the from-source core behave the same. |
| (b) `Serial.begin(9600)` + `println` | 2.2 s | **OK.** `tick 0\r\n` ... `tick 4\r\n` every 500 ms, baud 9615 (correct for 16 MHz). The d1 pin never shows as driven: the emulator's USART does not take over the TX pin. |
| (c) `analogWrite(9, 64)` | 0.2 s | **OK.** Period 2.040 ms (490 Hz), high 0.512 ms, duty 25.1 %. |
| (d) `analogRead(A0)` to Serial | 1.2 s | **OK.** 2.5 V reads `512`, then 1.0 V reads `204`. |
| (e) Button on d2, `INPUT_PULLUP` + `attachInterrupt(FALLING)` | 1.2 s | **OK.** `ready`, `presses=1/2/3` for three 50 ms presses. avr8js port D has INT0 and INT1 configured. Needs `WInterrupts.o`, which the package does not ship. |
| (f1) Wire: `begin`, `beginTransmission(0x3C)`, `endTransmission` | 1.5 s | **Hangs** after `wire begin`. The program counter stays in `twi_writeTo`, waiting for the TWI interrupt. **Cause: no TWI peripheral.** A4 and A5 show pull-ups only. |
| (f2) SPI: `begin`, `transfer(0xA5)` | 1.0 s | **Hangs** after `spi begin`. The program counter stays in `setup` (the inlined `while (!(SPSR & _BV(SPIF)))`). **Cause: no SPI peripheral.** d10, d11 and d13 are set as outputs, but nothing is clocked. |
| Servo `attach(9)` + `write(90)` | 0.1 s | **OK.** 20.003 ms period, 1.471 ms pulse. |
| EEPROM `write`/`read` | 0.3 s | **OK.** Prints `42`. Needs `libatmega328p.a`, which the package lacks. |
| Own `ISR(TIMER1_COMPA_vect)` | 3.2 s | **OK.** d13 toggles every 0.5 s. With the package's `compile()` this sketch fails to link (`multiple definition of __vector_11`, from Servo). |
| Multi-file (Q4) | 1.0 s | **OK.** |
| SoftwareSerial TX on d11 | 0.3 s | d11 toggles (28 edges). The bits were not decoded. |
| Nano Serial | 1.2 s | **OK.** |

**Peripherals to add to the emulator, in order:**
1. **TWI** (`AVRTWI` exists in avr8js 0.21.1) plus an I2C bus with device models. Without it,
   any `Wire` sketch hangs on its first transfer.
2. **SPI** (`AVRSPI` exists). Without it, any `SPI.transfer` hangs.
3. **Watchdog** (`AVRWatchdog` exists). Not tested, not wired. Sketches that use `wdt_enable`
   for resets or timing will misbehave.
4. **USART pin override** on d0 and d1, so wires and logic views see TX traffic. Serial text
   already works.
5. **Mega:** a new `Atmega2560` setup (USART1-3, timers 3-5, ports A-L) when the Mega comes.

INT0/INT1, timers 0/1/2 (PWM, Servo, Tone), ADC, EEPROM and USART0 already work.

### Q8. Maintenance

**GitHub API, 2026-11-17:**
- created 2026-05-13, last push **2026-05-29**;
- **4 commits, all by one contributor**: `2700870` initial (05-13), `7ec76f2` npm packaging,
  `f3020ee` DataCloneError fix, `e3a563f` `.data` origin fix (all 05-29);
- tags v0.1.0, v0.1.1 and v0.2.0 (npm, all on 2026-05-29); **no GitHub releases**;
- 3 stars, 1 fork, 0 watchers;
- issues: one closed PR (packaging) and **#2 open** (GPL source request, no reply).

**Bus factor: 1.** No activity for 5.5 months. The publisher is a company account, and the
author built it for their own product ("HorangFirmware" with OLED and TOF sensor switches).

**There is no build recipe for the wasm tools.** The repo commits `tools/*.wasm` as binaries.
`prepare-assets.mjs` only builds the Arduino assets, and the publish workflow runs only that
script. We could not rebuild or update the tools from this repo.

### Q9. Recommendation

See the top of this file. In short: **fork nothing and wrap nothing.** Build our own toolchain
in the same style, so that we can publish the source the GPL requires, and own the pipeline
above it. While that is being built, the package's binaries can stand in during local
development and tests, but they never go into a public build.

## What I could not verify

- **Browser coverage:** only Chromium 156 in the desktop app's browser was tried, over localhost,
  with the package's `compile()`. My own pipeline (cached Module, archives) ran in Node only.
  Firefox, Safari, mobile, real network download times, Cache Storage behaviour and peak tab
  memory were not measured.
- **The tools' exact build:** emsdk version, configure flags, and whether Arduino's or Atmel's
  GCC patches were applied. The strings show a plain `gcc-7.3.0` tree under `/work`.
- **Size against arduino-cli:** flash sizes were not compared with an arduino-cli build of the
  same sketches (not installed). Arduino's build uses `-flto`, which this pipeline cannot do.
- **Large sketches:** compile time and memory for big sketches (for example Adafruit GFX with
  many fonts) were not measured. Blink-sized units take about 18-120 ms in cc1plus. A full core
  build of 29 units takes about 1-1.4 s.
- **SoftwareSerial output** was not decoded bit by bit.
- **Mega hex files** were not run, because there is no ATmega2560 emulator.
- **Licence classification** is my reading of the licences, not legal advice. The
  library licences were taken from header comments and upstream knowledge, not from licence
  files.

## Reproducing

Scratchpad root:
`C:\Users\angry\AppData\Local\Temp\claude\f03cf0160f31403c\c68f62b3-7227-466f-9b34-0ac2b1c13174\scratchpad`
(it may be cleared later; the scripts are short and described here).

```bash
# 1. package (no install scripts run)
cd scratchpad/pkg && npm pack @horang-corp/avr-gcc-wasm@0.2.0 && mkdir x && tar -xzf *.tgz -C x
# 2. sources for Q5/Q6
curl -L -o core-1.8.7.tar.gz https://github.com/arduino/ArduinoCore-avr/archive/refs/tags/1.8.7.tar.gz   # 7.9 MB
curl -L -o tc/avr-gcc-linux.tar.bz2 https://downloads.arduino.cc/tools/avr-gcc-7.3.0-atmel3.6.1-arduino7-x86_64-pc-linux-gnu.tar.bz2  # 37.6 MB
tar -xjf tc/avr-gcc-linux.tar.bz2 --wildcards 'avr/avr/lib/avr5/*' 'avr/avr/lib/avr6/*' 'avr/lib/gcc/avr/7.3.0/avr6/*' 'avr/avr/lib/ldscripts/avr6.x*' ...
# 3. experiments (work/)
node pkg-api.mjs sk/blink.cpp out/blink_pkg.hex      # Q1: package buildFirmware() in Node, cold/warm
node q1-direct.mjs                                     # Q1: direct tools, Module cache, core-only vs all objects
DEVLIB=../tc/avr/avr/lib/avr5/libatmega328p.a node build-all.mjs uno   # Q4/Q7: all sketches -> out/*.hex + .elf
node err-test.mjs                                      # Q4: error lines mapped to .ino/.cpp
node q56.mjs                                           # Q5/Q6: core from source (Uno, Nano, Mega) + sketches
node sizes2.mjs; node used-headers.mjs                 # Q3: sizes, headers actually opened
# Q7: temporary src/mcu/avr/spike-compiler.test.ts (UnoEmulator + parseIntelHex on out/*.hex),
#     npx vitest run src/mcu/avr/spike-compiler.test.ts, then node analyse.mjs; file deleted afterwards
# Browser: web/server.mjs (static server on 127.0.0.1:4183) + web/index.html (package compile() x3)
```

The scratchpad scripts and what they do:
- `tc.mjs`: tool runner, Module cache, board profiles, `compileUnit`, `linkHex`
- `ar.mjs`: indexed `ar` writer
- `sketch.mjs`: `.ino` preprocessing and `buildSketch`
- `corebuild.mjs`: core and libraries from source with wasm only, and C compiled as C++
- `sk/`: the test sketches
- `emu-results.json`: raw emulator output
