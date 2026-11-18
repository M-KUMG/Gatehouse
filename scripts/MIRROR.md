# Publishing the toolchain source mirror (owner steps)

Why: the WebAssembly AVR tools and libraries we ship or download (GCC 7.3.0, binutils 2.42, GMP, MPFR, MPC, the
Arduino core and libraries) are GPL or LGPL. GPLv3 section 6 says whoever distributes the binaries must also offer
the corresponding source, and `NOTICE` makes that offer from our own GitHub release. Pointing only at the upstream
release (startabit/avr-gcc-wasm) is not enough: under section 6(d) we stay responsible for keeping the source
available. **Do these steps before any Gatehouse build that includes the toolchain is published** (web deploy,
Electron installer). During local development nothing here is needed.

The release is called **`toolchain-sources-v1`** in `https://github.com/M-KUMG/Gatehouse` and corresponds to
startabit release `v1` (commit `6972a73`). A new upstream release or a rebuild of our own gets its own mirror
release (`toolchain-sources-v2`, ...); keep the old one for as long as anyone can still get binaries built from it.

## 1. Download and verify (about 100 MB)

```
npm run toolchain:sources
```

This downloads into `toolchain/sources/` (git-ignored) and checks every file against the sha256 pinned in
`scripts/lib/toolchain-pins.mjs` (a mismatch deletes the file and stops):

| File | Bytes |
|---|---:|
| gcc-7.3.0.tar.xz | 62,462,388 |
| binutils-2.42.tar.xz | 27,567,160 |
| avr-1.8.8.tar.bz2 | 7,162,150 |
| gmp-6.2.1.tar.xz | 2,027,316 |
| mpfr-4.1.0.tar.xz | 1,525,476 |
| mpc-1.2.1.tar.gz | 838,731 |
| Servo-1.3.0.tar.gz | 110,807 |
| atmel-patches-gcc.7.3.0-arduino2.patch | 107,177 |
| Adafruit_NeoPixel-1.15.5.tar.gz | 60,637 |
| arduino-lib-hc-sr04-2.0.0.tar.gz | 15,021 |

It also fetches the build recipe at commit `6972a73` (the scripts that control the build, GPLv3 section 1) from these
raw URLs, which you can open yourself to check them:

- https://raw.githubusercontent.com/startabit/avr-gcc-wasm/6972a73/scripts/build.sh  (saved as `build.sh`)
- https://raw.githubusercontent.com/startabit/avr-gcc-wasm/6972a73/.github/workflows/build.yml  (saved as `build.yml`)
- https://raw.githubusercontent.com/startabit/avr-gcc-wasm/6972a73/COPYING  (saved as `COPYING`)
- https://raw.githubusercontent.com/startabit/avr-gcc-wasm/6972a73/scripts/sysroot.py  (saved as `sysroot.py`; builds the
  Arduino core and libraries)
- https://raw.githubusercontent.com/startabit/avr-gcc-wasm/6972a73/scripts/SHA256SUMS  (saved as `SHA256SUMS.recipe`;
  the checksums `build.sh` checks its downloads against)

The script then writes `toolchain/sources/SOURCES.md` (file, size, sha256, upstream URL, which shipped binary it
belongs to, licence) and `toolchain/sources/SHA256SUMS` (for `sha256sum -c`).

**Not mirrored on purpose:** `avr-gcc-7.3.0-atmel3.6.1-arduino7-x86_64-pc-linux-gnu.tar.bz2` (37.6 MB). The upstream
release lists it as a "source archive" but it is Arduino's compiled Linux toolchain. Do not upload it; the scripts
refuse to download it. (We only use five library files that originate from it; see `NOTICE`.)

Check the result:

```
cd toolchain/sources && sha256sum -c SHA256SUMS      # 15 x OK  (Git Bash on Windows has sha256sum)
```

## 2. Create the GitHub release

With the GitHub CLI (`gh auth login` once), from the repository root:

```
gh release create toolchain-sources-v1 toolchain/sources/* \
  --repo M-KUMG/Gatehouse --target main \
  --title "Toolchain sources v1 (GPL/LGPL corresponding source)" \
  --notes-file toolchain/sources/SOURCES.md
```

Or in the browser: Releases > Draft a new release, tag `toolchain-sources-v1` (create on publish, target `main`), upload
every file in `toolchain/sources/` (all 17: ten source files, five recipe files, `SOURCES.md`, `SHA256SUMS`),
paste `SOURCES.md` into the description, and publish it as a normal release (not a draft, not a pre-release).
GitHub allows 2 GiB per file, the largest here is 62 MB.

Then check it from outside: open `https://github.com/M-KUMG/Gatehouse/releases/tag/toolchain-sources-v1` in a private
window, download `gcc-7.3.0.tar.xz` and compare `sha256sum` with `SOURCES.md`.

## 3. Keep it consistent

- `NOTICE` (section "Written offer of source code") names this release tag and the repository. If you rename the
  repository or the tag, change `NOTICE`, `scripts/make-packs.mjs` (the `SOURCE_OFFER` text in every pack's
  `licenses/README.txt`) and `scripts/lib/toolchain-pins.mjs` together.
- Do not delete the release while Gatehouse still distributes binaries from this toolchain, and for at least three
  years after the last distribution (the period `NOTICE` promises).
- If you switch to your own build of the toolchain (the plan in `docs/compiler-spike-startabit.md`), publish that
  build's recipe and sources the same way as `toolchain-sources-v2` before shipping its binaries.
- The licence texts are in `licenses/toolchain/` (copied to `dist/licenses/` by `npm run build`). They are not part of
  the source mirror; the release page may link to them.
