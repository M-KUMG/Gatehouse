# Toolchain packs

How the WebAssembly AVR toolchain (startabit/avr-gcc-wasm release `v1`, commit `6972a73`, see
`docs/compiler-spike-startabit.md`) is downloaded for development, verified, and cut into the **packs** that the
compile Worker loads. Everything here is plain Node (built-ins only) and nothing it produces is committed: the whole
`toolchain/` folder is in `.gitignore`.

## The pipeline

```
npm run toolchain:fetch      6 MB    -> toolchain/dl, tools, sysroot, toolchain.json   (verified, idempotent)
npm run toolchain:packs      ~35 s   -> toolchain/packs/   (compiler, board, one pack per library, manifest.json)
npm run toolchain:sources    100 MB  -> toolchain/sources/ (owner only, for the GPL source mirror: scripts/MIRROR.md)
npx vitest run scripts               -> unit tests of all of the above (also part of `npm test`)
```

| File | What it does |
|---|---|
| `scripts/lib/toolchain-pins.mjs` | the pinned release: names, sizes, sha256 (copied from `spikes/compiler-startabit/release.json`), upstream URLs, the excluded native tarball |
| `scripts/lib/download.mjs` | sha256, `SHA256SUMS` parser, streaming download with size and digest check |
| `scripts/lib/tar.mjs` | the safe tar reader (ustar, pax, GNU long names; see below) |
| `scripts/fetch-toolchain.mjs` | `toolchain:fetch` |
| `scripts/fetch-toolchain-sources.mjs` | `toolchain:sources` |
| `scripts/make-packs.mjs` | `toolchain:packs`, plus `buildPack()` |
| `scripts/packreader.mjs` | the pack reader, **no imports**, meant to be copied into the Worker |
| `scripts/toolchain.test.mjs` | tests; vitest picks it up by its default `*.test.*` pattern |

### `toolchain:fetch`

Downloads only the 13 small runtime assets of the release (6.28 MiB: the four `.mjs` glue files, four `.wasm.gz`,
`sysroot.tar.gz`, `manifest.json`, `SHA256SUMS`, `COPYING`, `README.md`) from
`https://github.com/startabit/avr-gcc-wasm/releases/download/v1/`. The 37.6 MB native toolchain tarball and all source
archives are never downloaded by it.

- **Checks.** Every file must match the size and sha256 pinned in the script, and the release's own `SHA256SUMS` must
  list all 12 other files with exactly the pinned digests. A mismatch deletes the file (a download goes to
  `<name>.part` and is only renamed after the check), prints a loud error and exits with status 1. A response larger
  than the pinned size is cut off early.
- **Layout.** `toolchain/dl/` holds the files as released (the cache). `toolchain/tools/` gets `<tool>.mjs` and the
  gunzipped `<tool>.wasm` (output capped at 64 MiB). `toolchain/sysroot/` gets `sysroot.tar.gz` extracted: top-level
  folders `sysroot/` (`avr/include`, `avr/lib/avr5`, `avr/lib/ldscripts`, `lib/gcc/avr/7.3.0`) and `arduino/`
  (`core.a`, `core/`, `variant/`, `libraries/`), 132 files, 7.11 MiB.
- **`toolchain/toolchain.json`** records release tag and commit, the date fetched, every asset (name, size, sha256,
  URL), the four wasm files (size and sha256 after gunzip) and every sysroot file with its sha256.
- **Idempotent.** A second run downloads nothing and leaves `toolchain.json` byte for byte unchanged. Present downloads
  are re-verified, `tools/*.wasm` and every sysroot file are checked against `toolchain.json`; anything wrong is
  rebuilt from the verified downloads. `--force` downloads and unpacks everything again; `--dir <folder>` uses another
  target folder.
- **Safe tar reader.** The sysroot tarball comes from the network, so `lib/tar.mjs` validates the whole archive before
  anything is written: every header checksum, relative paths only (no absolute path, `..`, backslash, drive letter or
  `:`), only regular files and directories (devices and fifos are rejected), caps on entries (20,000), path length and
  total content (64 MiB for the sysroot). Hardlinks and symlinks are accepted only when the target is a regular file
  inside the archive; they are then written as plain copies, so no link is ever created. Links that leave the folder or
  point at an absolute path are rejected.

### `toolchain:packs`

Reads `toolchain/` and the licence texts in `licenses/toolchain/` and writes `toolchain/packs/`. The output is
deterministic (same inputs give the same bytes; the gzip header's OS byte is fixed), and the script reads every pack
back and verifies each file's sha256 before it finishes. Old files in `toolchain/packs/` are deleted first.

## Pack format `GHP1`

One file per pack, so a build needs a handful of requests instead of hundreds. All numbers are little endian.

```
bytes 0..3    "GHP1"
bytes 4..7    uint32 N, the length of the index in bytes
bytes 8..8+N  index: UTF-8 JSON array [{ "path", "offset", "length", "sha256" }, ...] sorted by path
then          the data: all files back to back, in index order, no padding
```

`offset` counts from the first data byte and files are contiguous, so a given list of files has exactly one valid
byte layout. `readPack(bytes)` (in `scripts/packreader.mjs`) checks the magic, the index, that paths are safe
(relative, no `..`, no empty segment), that offsets are contiguous and that the lengths add up to exactly the size of
the pack; `verifyPack(pack, sha256Hex)` then checks every file's digest. Each pack is also written as `.pack.gz`
(gzip -9). Files are named `<name>-<first 12 hex of the sha256>.pack`, so a URL always means the same bytes.

**Paths.** A path is the file's place in the compiler's virtual file system (MEMFS) without the leading `/`:
`sysroot/avr/include/stdio.h` is mounted at `/sysroot/avr/include/stdio.h`, which is where the tools were configured
to look (`--prefix=/sysroot`, and `-I /arduino/core`). Two prefixes are special: `tools/` files are programs the
Worker keeps (glue as a module, wasm as a compiled `WebAssembly.Module`), never mounted; `licenses/` files are for
people, never mounted.

## The packs

Sizes measured on 2026-11-18 (bytes). "raw" is the `.pack`, gzip is `-9` (`.pack.gz`), brotli is quality 11 on the
whole pack. `toolchain/packs/manifest.json` is the authoritative list with the exact figures and hashes.

| Pack | Files | Raw | gzip | brotli | Needs |
|---|---:|---:|---:|---:|---|
| `compiler` | 12 | 17,118,231 | 5,421,158 | 3,754,665 | |
| `board-atmega328p` | 102 | 7,280,225 | 897,921 | 442,237 | `compiler` |
| `lib-adafruit_neopixel` | 4 | 38,674 | 13,644 | 11,066 | `board-atmega328p` |
| `lib-eeprom` | 2 | 6,173 | 2,247 | 1,810 | `board-atmega328p` |
| `lib-hcsr04` | 4 | 6,841 | 3,095 | 2,485 | `board-atmega328p` |
| `lib-servo` | 14 | 48,363 | 11,122 | 8,990 | `board-atmega328p` |
| `lib-softwareserial` | 3 | 13,788 | 5,310 | 4,351 | `board-atmega328p` |
| `lib-spi` | 3 | 14,607 | 5,092 | 4,278 | `board-atmega328p` |
| `lib-wire` | 4 | 29,215 | 8,817 | 7,055 | `board-atmega328p` |
| **all** | 148 | 24,556,117 (23.42 MiB) | 6,368,406 (6.07 MiB) | 4,236,937 (4.04 MiB) | |

A first Uno build downloads `compiler` + `board-atmega328p`: **6.03 MiB gzip or 4.0 MiB brotli**. A library adds
2-14 KiB gzip. (The spike measured 6.24 MiB gzip for the same files shipped separately.)

**`compiler`** (shared by every AVR board, loaded once): `tools/{cc1plus,as,ld,objcopy}.{mjs,wasm}` (wasm raw:
cc1plus 14,406,570, ld 981,539, as 696,879, objcopy 667,150; the four glue files together 316,231) and
`ldscripts/avr5.xn`. **`ld` opens `ldscripts/avr5.xn` relative to its working directory** and no other linker script
(tested: each of the six `avr5.*` alone; only `.xn` links), so only that one is shipped, mounted at `/ldscripts/`.
It is architecture specific, so when the Mega (avr6) arrives `avr6.xn` belongs in that board's pack. Also
`licenses/COPYING` (GPL-3.0), the GCC Runtime Library Exception and a `licenses/README.txt`.

**`board-atmega328p`** (one per board family): `sysroot/avr/lib/avr5/{crtatmega328p.o,libc.a,libm.a,libatmega328p.a}`
(376,034), `sysroot/lib/gcc/avr/7.3.0/avr5/libgcc.a` (5,976,098: 82 % of the pack), `arduino/core.a` (91,760), and
**all** headers of the sysroot: avr-libc (`sysroot/avr/include`), GCC (`.../include`, `.../include-fixed`),
the Arduino core (`arduino/core`, including the extensionless `new`) and the `standard` variant: 94 files, 817,931
bytes raw, 118,118 brotli. A real build opens fewer: `Arduino.h` + `Wire.h` + `SPI.h` + `Servo.h` open 38 headers,
443,493 bytes (the spike's 433 KB, re-measured with `cc1plus -H`; 34 of them live in this pack, the other 4 in the Wire, SPI and Servo packs).
The pack keeps all of them anyway because a sketch may include `<avr/sleep.h>`, `<util/atomic.h>`, `<string.h>` and
so on, and the 94 headers cost only 118 KB brotli.

**`lib-<name>`** (one per library of the release's `manifest.json`, loaded on demand): everything under
`arduino/libraries/<Name>/` (headers; Servo includes the header folders of other architectures, harmless) and, if the
library has one, `arduino/libraries/<Name>.a`. EEPROM is header only. `includes` in the manifest lists the top-level
headers (`Wire.h`, ...) so the Worker can map `#include <Wire.h>` to `lib-wire`. HC-SR04 carries its MIT notice.

Every pack has `licenses/README.txt` (what it contains, its licences, the source offer); the full licence texts are
in `licenses/toolchain/` and `NOTICE`.

Versions in the manifest are `<tool or library versions>-<release tag>`: `gcc7.3.0-binutils2.42-v1`,
`core1.8.8-avrlibc2.0.0-v1`, and `1.3.0-v1` for the Servo pack. A new upstream release or a rebuild changes the tag part.

### Check that it is enough

`toolchain.test.mjs` round-trips every pack: sizes, hashes, `.pack.gz` against `.pack`, `verifyPack`, and every file
byte for byte against the unpacked toolchain (or the licence folder); it also checks that together the packs contain
every sysroot file except the five linker scripts that are never read. In addition, a one-off run built a sketch that
includes `Arduino.h`, `Wire.h`, `SPI.h`, `Servo.h`, `EEPROM.h`, `<avr/sleep.h>` and `<util/atomic.h>` using **only
files read from the packs** (tools from the compiler pack, headers and archives from the board and library packs, the
linker script from the compiler pack): `cc1plus`, `as`, `ld` and `objcopy` all exit 0 and the hex has 3,418 flash
bytes.

## How the Worker should load them

1. **Manifest.** Fetch `packs/manifest.json` (small, versioned with the app build, not cached long). It says which
   file belongs to which pack, its sizes and sha256, and the dependencies. Choose pack URLs from `file` / `fileGz`.
2. **Which packs.** The board profile names its pack (`board-atmega328p`) and the board pack names the compiler
   through `dependencies`; resolve the closure. After the sketch is preprocessed, scan `#include <X.h>` / `"X.h"`
   against the `includes` lists to find the library packs; a library not in the list is a user error ("library
   missing"), not a download.
3. **Cache Storage, keyed by name + sha256.** Open `caches.open('gatehouse-packs')` and use the key
   `https://gatehouse.invalid/pack/<name>/<sha256>` (any synthetic URL with both parts works). Look the key up before
   fetching. On a miss, fetch `fileGz` (or `file`), report progress to the loading screen, decompress, **check the
   sha256 of the `.pack`** with `crypto.subtle.digest('SHA-256', ...)` against the manifest, and only then `put` it.
   Store the decompressed `.pack`, so later builds need no decompression. Delete entries of the
   same name with another sha256 when a new one is stored. Because the hash is in the key, a cached pack is never
   stale and builds work offline after the first download.
4. **Decompress** a `.pack.gz` with `new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()`.
   Do not rely on `Content-Encoding`: serve `.pack.gz` as `application/octet-stream` with no content encoding. (If the
   host serves the plain `.pack` with `Content-Encoding: br`, the browser decodes it for you and the brotli column of
   the table is what is transferred; not every static host does that, so plan with the gzip column.)
5. **Read** with `readPack(new Uint8Array(buf))` (port `scripts/packreader.mjs`; it has no imports and uses only `Uint8Array`, `DataView`, `TextDecoder` and `JSON`).
   `verifyPack` per file is not needed after the whole-pack hash matched.
6. **Tools.** Compile each `tools/<t>.wasm` **once** per Worker with `WebAssembly.compile` and keep the module; make
   a fresh instance per tool run with `instantiateWasm`. Import the glue from a Blob URL
   (`URL.createObjectURL(new Blob([glue], { type: 'text/javascript' }))`) once and reuse the factory.
7. **MEMFS.** For each run write only what that tool reads, from the pack bytes without copying them around: `cc1plus`
   gets the include folders (`/sysroot/...include*`, `/arduino/core`, `/arduino/variant`, the libraries used) and the
   sources; `as` only its input; `ld` gets `crtatmega328p.o`, `libc.a`, `libm.a`, `libatmega328p.a`, `libgcc.a`,
   `core.a`, the library archives, the objects, and `/ldscripts/avr5.xn` from the compiler pack; `objcopy` the ELF. The
   include flags and link line are in `spikes/compiler-startabit/tc.mjs`.
8. **Electron** reads the same files from the app resources (raw `.pack`, no gzip) and skips Cache Storage.
9. **Integrity of the manifest.** In a hosted build the manifest and the packs come from the same origin as the app, so
   the sha256 check protects against truncated or stale files, not against a hostile server. Pinning the manifest hash
   into the app bundle at build time would close that gap.

## Regenerating

```
npm run toolchain:fetch      # once, or after changing the pins; skips what is already verified
npm run toolchain:packs      # whenever toolchain/ or licenses/toolchain/ changed
npx vitest run scripts
```

Deploying: copy `toolchain/packs/*` (the `.pack.gz` files and `manifest.json`; the `.pack` files only for Electron or a
host with brotli) next to the app, and `licenses/` + `NOTICE` (done by `npm run build` into `dist/`). Do this only after
the source mirror release exists (`scripts/MIRROR.md`). The `build` script does **not** copy the toolchain or the packs.

To add a library or a board: libraries appear automatically when the release's `manifest.json` lists them (a
licence line for it must be added to `LIBRARY_LICENCES` in `make-packs.mjs`, otherwise the script stops); a new board
means one more entry in `collectPacks()` (its own `crt`, `libc.a`, ldscript...) and a new sysroot, which this release
does not have (avr5 / ATmega328P only, `standard` variant only).
