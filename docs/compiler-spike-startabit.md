# Compiler spike follow-up: startabit/avr-gcc-wasm v1

Check date: 2026-11-17. Subject: GitHub release `startabit/avr-gcc-wasm` tag `v1` (published 2026-11-02 by
github-actions from commit `6972a73`), recipe repo `startabit/avr-gcc-wasm` (GPL-3.0, 2 commits, created
2026-11-02). Run on Windows 11, Node 24.20.0, Node only (no browser). Follows `docs/compiler-spike.md`.
Nothing in `package.json` or the app source was changed. Work files are in the session scratchpad (`sb/`, see the
last section).

## Summary

**Verdict: it drops in.** The four tools run in plain Node with **no shims**, the sysroot has every piece the
horang package lacked, and all 12 test sketches built for the Uno. The 10 sketches we can run behave **exactly**
as in the earlier spike in our emulator. The release publishes its licence, build recipe and the source archives
for everything it ships, so we can meet the GPL and LGPL if we mirror them.

- **Builds:** 12/12 sketches. Blink is **1,064 bytes**. Warm builds take **39-60 ms** for one unit and about
  110 ms for the 3-unit multi-file sketch. The first build in a process takes 256 ms.
- **Emulator:** 10/10 run sketches (Wire and SPI skipped) give the same serial text, final pin drives and pin
  edges (within 1 ms) as the old spike's hex files. The SoftwareSerial output now decodes to `"hi\r\n"`.
- **Against horang:** same GCC 7.3.0 and binutils 2.42. The wasm binaries are not byte-identical, but Blink's hex
  is byte-identical. One real codegen difference: startabit's `cc1plus` puts string literals in plain `.rodata`
  instead of mergeable `.rodata.<fn>.str1.1` sections. Flash sizes were the same for all 12 sketches.
- **Download size:** about **6.24 MiB gzip** in total (tools 5.05 MiB, glue 0.30 MiB, sysroot 0.90 MiB). The
  trimmed horang Uno set was 6.41 MiB.
- **Gaps that remain:**
  - Uno/ATmega328P (avr5) only: no avr6/ATmega2560.
  - Only the `standard` variant (no Nano A6/A7).
  - No `cc1`, so the C-as-C++ hack is still needed for users' `.c` files.
  - `ld` still needs `ldscripts/avr5.xn` relative to its working directory.
  - TWI and SPI are still missing in our emulator.
- **Surprises:**
  - The release ships Arduino's 37.6 MB *native Linux toolchain binary* as a "source archive".
  - The release has no licence texts other than the GPL-3.0 `COPYING`.
  - `cc1plus` was built without assembler feature detection (see Q4).

## Q1. Do the tools run? What is in the sysroot and the manifest? Is the layout compatible?

**Downloads.** I fetched 13 assets with `curl -L https://github.com/startabit/avr-gcc-wasm/releases/download/v1/<name>`,
6.25 MiB in total. `sha256sum -c SHA256SUMS` passed for all 12 listed files. All 13 also match the `digest`
field of the GitHub release API.

**The tools run in Node with no shims.** The glue is built with `-sENVIRONMENT=web,worker,node`
(`ENVIRONMENT_IS_NODE` is present), so the old shims (`WorkerGlobalScope`, `fetch` for `file://`) are not
needed. The factory is still the Emscripten MODULARIZE default export (`createTool`), with `FS` and `callMain`,
and it takes `noInitialRun`, `locateFile`, `print`, `printErr`, `thisProgram` and `instantiateWasm` as before.
Each `.wasm.gz` must be gunzipped, or served with `content-encoding: gzip` in a browser.

| Tool | `--version` |
|---|---|
| `cc1plus -version` | `GNU C++14 (GCC) version 7.3.0 (avr)`, built by `Clang 21.0.0git` (Emscripten 4.0.10), `GMP 6.2.1, MPFR 4.1.0, MPC 1.2.1, isl version none` |
| `as`, `ld`, `objcopy --version` | `GNU assembler / GNU ld / GNU objcopy (GNU Binutils) 2.42` |

(`cc1plus --version` prints nothing. Use `-version` with an empty input.)

**The sysroot** (`sysroot.tar.gz`: 939 KB, 7.6 MB unpacked, 132 files). The tools were configured with
`--prefix=/sysroot`, so the tree is mounted at `/` in MEMFS.

- `sysroot/lib/gcc/avr/7.3.0/include{,-fixed}`: GCC's headers (19 files).
- `sysroot/avr/include`: avr-libc headers, **trimmed to the Uno**. `avr/` has `io.h`, `iom328p.h` and the shared
  `iomxx0_1.h` and `iousbxx6_7.h`, and no other `io*.h` (the horang package shipped 309 of them). `util/`,
  `sys/` and the C library headers are all present.
- `sysroot/avr/lib/avr5/`: `crtatmega328p.o`, `libc.a`, `libm.a` and **`libatmega328p.a`** (the 13 `eeprom_*`
  objects plus `ccp_write.o`). `sysroot/lib/gcc/avr/7.3.0/avr5/libgcc.a`.
- `sysroot/avr/lib/ldscripts/avr5.{x,xbn,xe,xn,xr,xu}`: binutils 2.42 scripts. The horang package used Arduino's
  2.26-era `avr5.xn`. The diff is only `__TEXT_REGION_ORIGIN__` and comments.
- **avr5 only.** There is no avr6 directory, no `crtatmega2560.o`, no `iom2560.h` and no `avr6.x*`. The Mega
  cannot be built from this release.
- `libc.a`, `libm.a`, `crtatmega328p.o`, `libatmega328p.a` and `libgcc.a` are byte-identical (`cmp`) to Arduino's
  `avr-gcc-7.3.0-atmel3.6.1-arduino7`. All but `libatmega328p.a` are also identical to the horang copies.
- `arduino/core/*.h` (core 1.8.8 headers, no sources) and `arduino/variant/pins_arduino.h` (`standard` only).
- `arduino/core.a`: **25 objects, including `WInterrupts.c.o`**, plus CDC, USBCore, PluggableUSB and
  HardwareSerial1-3 stubs. It was compiled with Arduino's native avr-gcc (real C for the `.c` files) and the IDE
  flags without LTO, using `-DARDUINO_AVR_UNO`.
- `arduino/libraries/<Name>/` headers plus `<Name>.a`:
  - Wire (`Wire` + `twi`), SPI, SoftwareSerial;
  - **EEPROM** (header only, as upstream);
  - Servo 1.3.0 (the avr object plus 10 empty objects for other architectures);
  - Adafruit_NeoPixel 1.15.5 (and `rp2040_pio.h`);
  - HCSR04 2.0.0.
- There is no `cc1`, so the release still has no C compiler.

**`manifest.json`** (836 bytes) has `toolchain: 7.3.0-atmel3.6.1-arduino7`, `core: 1.8.8`, `coreObjects: 25`,
and for each library its version, top-level headers and `archive: true/false`. It has no file list, sizes,
hashes or tool versions.

**Compatibility with the spike pipeline: yes, with path changes only.** I copied `ar.mjs`, `sketch.mjs`
(preprocessing) and the sketches unchanged, and rewrote `tc.mjs` for the new layout:

- Tool names: `as`, `ld`, `objcopy` (previously `avr-as` and so on). The wasm files are gunzipped first.
- Include paths: `-isystem /sysroot/lib/gcc/avr/7.3.0/include`, `.../include-fixed`, `/sysroot/avr/include`, plus
  `-I /arduino/variant -I /arduino/core -I /arduino/libraries/<Name>`.
- Link: `crt` comes from `/sysroot/avr/lib/avr5`. Use `-L/sysroot/avr/lib/avr5 -L/sysroot/lib/gcc/avr/7.3.0/avr5`,
  `--start-group <libs>.a core.a --end-group`, `-lm -lc -latmega328p -lgcc`.
- **The core does not need to be built any more.** We link the release's `core.a` and library archives directly.
  WInterrupts and EEPROM work with no extra files.
- **Still needed:** `ld` looks for `ldscripts/avr5.xn` relative to its working directory. Putting the script at
  `/sysroot/avr/lib/ldscripts/` (or adding `-L/sysroot/avr/lib`) still fails with `cannot open linker script file
  ldscripts/avr5.xn`. Copy it to `/ldscripts/avr5.xn` as before, or pass the script with `-T`. The recipe's comment
  says the prefix fixes this, but in my test it did not.

## Q2. Building the test sketches (Uno)

These are the spike's sketches with the spike's `.ino` preprocessing: `#include <Arduino.h>`, prototypes and
`#line`. Each sketch was built 3 times in one Node process with the compiled `WebAssembly.Module` cached and a fresh
instance per tool run. The times are wall-clock for the whole build (cc1plus, as, ld, objcopy).

| Sketch | Result | Flash | ms (run 1/2/3) |
|---|---|---:|---|
| a Blink | OK | **1,064** | 256 (first in process) / 47 / 52 |
| b `Serial.println` | OK | 2,292 | 77 / 54 / 50 |
| c `analogWrite(9, 64)` | OK | 1,054 | 52 / 45 / 45 |
| d `analogRead(A0)` | OK | 2,300 | 47 / 44 / 43 |
| e button + `attachInterrupt` | OK | 2,506 | 60 / 59 / 50 |
| f1 Wire | OK | 4,574 | 55 / 48 / 52 |
| f2 SPI | OK | 2,542 | 60 / 48 / 47 |
| g Servo | OK | 2,272 | 45 / 41 / 42 |
| h EEPROM | OK | 1,970 | 48 / 44 / 45 |
| i own `ISR(TIMER1_COMPA_vect)` | OK (no `__vector_11` clash) | 700 | 41 / 42 / 39 |
| j SoftwareSerial | OK | 2,552 | 44 / 45 / 45 |
| multi-file (2 `.ino`, 2 `.cpp`, 1 `.h`) | OK | 4,528 | 119 / 113 / 110 |

All 12 flash sizes equal the old spike's builds, which used horang's tools, its 1.8.7 objects and my own
WInterrupts archive. The hex is byte-identical for 5 of them: Blink, PWM, analogRead, EEPROM and Timer1 ISR. The
others differ in string placement (see Q4) and in the core version (1.8.8 against 1.8.7).

**What horang lacked, now present:**
- `WInterrupts` (in `core.a`);
- `EEPROM.h`;
- `libatmega328p.a`;
- SoftwareSerial;
- archives instead of loose objects (Blink is 1,064 bytes with no archive writer of our own needed).

**Still missing:** `cc1`. The core no longer needs it because it ships precompiled with native gcc. Users' `.c`
files still need the `extern "C"` + `-U__cplusplus -D_Bool=bool` hack. `ar.mjs` is only needed if we build our
own library archives.

## Q3. Running in our emulator

Temporary file `src/mcu/avr/spike-startabit.test.ts`, deleted afterwards; `git status` was clean afterwards. It
ran `UnoEmulator` on each hex in 1 ms slices for the same simulated time as before, with the same inputs:
- A0 at 2.5 V, then 1.0 V after 0.6 s;
- three 50 ms low pulses on d2 with the pull-up.

It ran the **old spike's hex files in the same run** as reference. The comparison covered serial text, final
drives, and edges on d1, d9, d10, d11 and d13 within 1 ms.

| Sketch | Time | Same as earlier spike? | Observed |
|---|---:|---|---|
| Blink | 4.5 s | **yes** | d13 edges at 0, 1.0000, 2.0000, 3.0001, 4.0001 s |
| Serial | 2.2 s | **yes** | `tick 0..4`, baud 9615 |
| PWM d9 | 0.2 s | **yes** | period 2.040 ms, high 0.512 ms (25.1 %) |
| analogRead | 1.2 s | **yes** | `512` x3, then `204` x2 |
| button + INT0 | 1.2 s | **yes** | `ready`, `presses=1/2/3` |
| Servo | 0.1 s | **yes** | 20.003 ms period, 1.471 ms pulse |
| EEPROM | 0.3 s | **yes** | `42` |
| Timer1 ISR | 3.2 s | **yes** | d13 toggles every 0.5000 s |
| SoftwareSerial d11 | 0.3 s | **yes** | 28 edges; decoded at 9600 8N1: `"hi\r\n"` (new) |
| multi-file | 1.0 s | **yes** | `multi-file sketch`, `count=3/6/9/12/15`, d13 blinks |
| Wire, SPI | - | skipped | expected to hang (no TWI or SPI in `atmega328p.ts`) |

## Q4. Against the horang package's tools

| | horang raw | horang gzip -9 | startabit raw | startabit `.wasm.gz` (gzip -9) |
|---|---:|---:|---:|---:|
| cc1plus.wasm | 13,844,490 | 4,525,554 | 14,406,570 | 4,376,836 |
| as.wasm | 761,856 | 310,247 | 696,879 | 289,495 |
| ld.wasm | 1,078,207 | 385,083 | 981,539 | 356,333 |
| objcopy.wasm | 725,405 | 286,688 | 667,150 | 270,038 |
| **4 wasm** | 16,409,958 | 5,507,572 | 16,750,138 | **5,292,702** |
| 4 `.mjs` glue (raw) | 595,511 | | 316,231 | |

- **Versions:** both are GCC 7.3.0 and binutils 2.42. The builds differ:
  - horang: Clang 23.0.0git, GMP 6.1.0, MPFR 3.1.4, MPC 1.0.3, ISL 0.16.1;
  - startabit: Emscripten 4.0.10 / Clang 21.0.0git, GMP 6.2.1, MPFR 4.1.0, MPC 1.2.1, no ISL.
- **The wasm files are not byte-identical,** as expected from different builds.
- **The output is functionally equal, and byte-identical for Blink.** I ran horang's tools (with the old shims)
  through the same runner and the same startabit sysroot. Blink, PWM, Servo and EEPROM gave identical sketch
  objects and identical hex files.
- **One codegen difference: string literals.** For sketches with string literals (Serial, button), the objects
  differ only in where the literals go. startabit's `cc1plus` emits `.section .rodata`, while horang's (and
  normally Arduino's) emits `.section .rodata.loop.str1.1,"aMS",@progbits,1`. In this test the flash size was the
  same.
  - The likely cause: `cc1plus` was configured without a target assembler to probe (`build.sh` passes no
    `--with-as`), so `HAVE_GAS_SHF_MERGE` and similar `gas` feature checks came out "no".
  - The consequence: there is no string merging, and `--gc-sections` cannot drop strings that belong to one
    function. Larger sketches may grow a little. Other `gas`-feature-dependent codegen may differ too; I did not
    audit it.
  - The fix is cheap if we rebuild: configure GCC with `--with-as=<native avr-as>` or set the `gcc_cv_as_*`
    cache variables.

## Q5. Licence and source offer

**What the release says.** COPYING is the GPL-3.0 text (35,149 bytes). The repo's licence is GPL-3.0 (GitHub API).
The README (identical to the release notes) lists:
- GCC and binutils: GPL-3;
- GMP, MPFR and MPC: LGPL-3;
- libgcc: GPL-3 with the Runtime Library Exception;
- avr-libc: Modified BSD;
- core, Wire, SPI, SoftwareSerial, EEPROM and Servo: LGPL-2.1;
- NeoPixel: LGPL-3;
- HCSR04: MIT.

It says "each release has the source archives of all of them". The build recipe is public:
- `scripts/build.sh`: pinned versions, SHA-256-checked downloads, full configure and link flags;
- `scripts/sysroot.py`: the core and libraries compiled with Arduino's native avr-gcc;
- `.github/workflows/build.yml`: Ubuntu 24.04, emsdk 4.0.10.

It credits `ajeetjain94608/avr-toolchain-wasm` (GPL-3.0, created 2026-10-25) for the recipe.

**Source archives in the release** (sizes from the API; not downloaded). Their sha256 values match the repo's
`scripts/SHA256SUMS` and the API digests.

| Asset | Bytes | Covers |
|---|---:|---|
| gcc-7.3.0.tar.xz | 62,462,388 | cc1plus; also libgcc's GCC source |
| atmel-patches-gcc.7.3.0-arduino2.patch | 107,177 | Arduino/Atmel patch applied to GCC |
| binutils-2.42.tar.xz | 27,567,160 | as, ld, objcopy, ldscripts |
| gmp-6.2.1.tar.xz | 2,027,316 | inside cc1plus (LGPL-3) |
| mpfr-4.1.0.tar.xz | 1,525,476 | inside cc1plus (LGPL-3) |
| mpc-1.2.1.tar.gz | 838,731 | inside cc1plus (LGPL-3) |
| avr-1.8.8.tar.bz2 | 7,162,150 | core.a, Wire, SPI, SoftwareSerial, EEPROM (LGPL-2.1) |
| Servo-1.3.0.tar.gz | 110,807 | Servo.a (LGPL-2.1) |
| Adafruit_NeoPixel-1.15.5.tar.gz | 60,637 | NeoPixel.a (LGPL-3) |
| arduino-lib-hc-sr04-2.0.0.tar.gz | 15,021 | HCSR04.a (MIT) |
| avr-gcc-7.3.0-atmel3.6.1-arduino7-x86_64-pc-linux-gnu.tar.bz2 | 37,630,618 | **a native binary toolchain**, not source: the origin of libc/libm/libgcc/crt/headers |

**What we would ship or mirror next to the wasm and sysroot:**
- **Corresponding source for the GPL tools:**
  - the gcc, patch, binutils, gmp, mpfr and mpc tarballs (about 94.5 MB);
  - `build.sh` and `build.yml` from commit `6972a73`, because the GPL requires the scripts that control the build.
  - Mirror them ourselves rather than pointing at startabit's release: under GPLv3 §6(d), the distributor stays
    responsible for keeping the source available.
- **LGPL'd precompiled objects:** `avr-1.8.8.tar.bz2`, `Servo-1.3.0.tar.gz`, `Adafruit_NeoPixel-1.15.5.tar.gz`
  and `sysroot.py` (about 7.3 MB). HCSR04 needs its MIT notice only. We would ship its tarball anyway, since it
  is 15 KB.
- **Licence texts.** The release has only GPL-3 `COPYING`, so we must add:
  - LGPL-3 and LGPL-2.1 texts;
  - the GCC Runtime Library Exception (`COPYING.RUNTIME` in gcc);
  - the avr-libc BSD notice;
  - the HCSR04 MIT notice;
  - the Emscripten runtime notices (MIT / University of Illinois NCSA, plus musl's MIT), which are compiled into
    every `.wasm` and are not mentioned anywhere.
  We can extract these from the source tarballs.

**Inconsistencies and weak points found:**
1. **The SHA256SUMS split.** The release's `SHA256SUMS` covers only the 12 built files. The 11 source archives are
   checked only by the repo's `scripts/SHA256SUMS` and the API digests. Both agree. No mismatches were found.
2. **A native binary shipped as "source".** The 37.6 MB Arduino toolchain tarball is native Linux GPL binaries
   (avr-gcc, binutils 2.26 and others). Redistributing it gives startabit its own source obligation, which the
   release does not meet: the arduino/toolchain-avr and Atmel source tarballs are linked, not mirrored. **We should
   not mirror it.** We only need the five library files taken from it.
3. **libgcc.a's exact source.** libgcc.a (GPL+RLE) is Arduino's binary. Its exact corresponding source is Arduino's
   toolchain-avr build: Atmel 3.6.1 GCC plus patches. The release's gcc-7.3.0 + `arduino2.patch` is probably that
   source, but I did not verify it.
   - Safer: mirror arduino/toolchain-avr at tag `7.3.0-atmel3.6.1-arduino7`.
   - Or: rebuild libgcc with the wasm GCC ourselves.
4. **No missing library sources.** Servo, NeoPixel and HCSR04 all have their tarballs. Wire, SPI, SoftwareSerial
   and EEPROM are in `avr-1.8.8`.
5. **README claims vs contents:**
   - The README says "UNO and Nano", but only the `standard` variant ships and the core is built with
     `-DARDUINO_AVR_UNO`, so there are no Nano A6/A7 analog-only pins.
   - The `build.sh` comment says `--prefix=/sysroot` lets `ld` find its default scripts. In my test it does not
     (see Q1).
6. **Young project.** The repo has 2 commits (2026-11-02), 0 stars and 1 release. The bus factor is 1.
   Unlike horang, though, the recipe is public and complete, so we can rebuild it ourselves.

## Q6. Verdict

1. **Drops in:** yes. All 12 Uno sketches build (Blink is 1,064 bytes, about 40-60 ms warm), and all 10 runnable
   ones behave identically in our emulator.
2. **What changed:**
   - no shims;
   - new tool names and sysroot paths;
   - the core, WInterrupts, EEPROM, `libatmega328p` and libraries come as archives, so no core build is needed.
3. **What stays the same:** the `ldscripts/avr5.xn` copy and the C-as-C++ hack (no `cc1`).
4. **Gaps:**
   - Uno/avr5 only (no Mega/avr6, no Nano variant);
   - non-mergeable string sections from the `gas` probe;
   - incomplete licence texts and a binary "source" archive;
   - TWI and SPI still missing in our emulator.
5. **Next step:**
   - Use these binaries now for development.
   - Fork the recipe into our own build repo with `--with-as`, plus `cc1` and an avr6/Mega sysroot.
   - Reproduce it in CI and check the build gives byte-identical output against v1.
   - Publish our build as the mirrored corresponding source, with the full licence set.

## What I could not verify

- **Reproducibility:** I did not rebuild the tools from source, so I have not confirmed that the published sources
  and recipe produce these exact binaries. That needs a 1-6 h CI run.
- **The browser:** not tried (Node only, as instructed). Gunzip/`content-encoding` handling and memory peaks were
  not measured.
- **The gcc patch:** I did not check that `gcc-7.3.0 + arduino2.patch` is exactly the source of Arduino's libgcc.a.
- **Other effects of the `gas` probe:** only the string-section difference was seen in these sketches. Larger
  sketches were not compared byte-for-byte.
- **Legal reading:** the licence assessment is my reading, not legal advice.

## Reproducing

Scratchpad `sb/` folder:
`C:\Users\angry\AppData\Local\Temp\claude\f03cf0160f31403c\c68f62b3-7227-466f-9b34-0ac2b1c13174\scratchpad\sb`.
The old spike's `pkg/` and `work/out/` sit next to it.

```bash
curl -sSL -o meta/release.json https://api.github.com/repos/startabit/avr-gcc-wasm/releases/tags/v1
for f in cc1plus.mjs cc1plus.wasm.gz as.mjs as.wasm.gz ld.mjs ld.wasm.gz objcopy.mjs objcopy.wasm.gz \
         sysroot.tar.gz manifest.json SHA256SUMS COPYING README.md; do
  curl -sSL -o dl/$f https://github.com/startabit/avr-gcc-wasm/releases/download/v1/$f; done
(cd dl && sha256sum -c SHA256SUMS)                       # 12 x OK
for t in cc1plus as ld objcopy; do cp dl/$t.mjs x/tools/; gzip -dc dl/$t.wasm.gz > x/tools/$t.wasm; done
tar -xzf dl/sysroot.tar.gz -C x/sysroot
cd work
node build-sb.mjs versions          # tool versions
node build-sb.mjs                   # 12 sketches -> out/*.hex, .elf (3 builds each, timings)
node cmp-sb.mjs a_blink b_serial g_servo h_eeprom c_pwm                   # startabit -> outs/
TOOLDIR=../../pkg/x/package/tools TOOLNAMES='{"cc1plus":"cc1plus","as":"avr-as","ld":"avr-ld","objcopy":"avr-objcopy"}' \
  node cmp-horang.mjs a_blink b_serial g_servo h_eeprom c_pwm             # horang tools (shims) -> outh/
node asm.mjs outs b_serial e_button; TOOLDIR=... node asm.mjs outh b_serial e_button   # .s diff
node ldtest.mjs                     # ld default-script lookup
# emulator: temporary src/mcu/avr/spike-startabit.test.ts (new + old hex), npx vitest run <it>, deleted;
node analyse-sb.mjs                 # compare emu-results-sb.json new vs old
```
