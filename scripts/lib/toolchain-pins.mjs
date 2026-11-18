// Pinned data for the WebAssembly AVR toolchain we use for development:
// https://github.com/startabit/avr-gcc-wasm, release v1 (published 2026-11-02, built from commit 6972a73,
// GPL-3.0). The sizes and sha256 digests below were copied from the GitHub API snapshot in
// spikes/compiler-startabit/release.json (taken 2026-11-17). The fetch scripts compare every download with
// these constants AND with the release's own SHA256SUMS, so a release that was replaced or tampered with
// after the snapshot is detected. To move to a new release: re-snapshot, review, then edit this file.
//
// Plain data and no side effects, so the scripts and their tests can import it freely.

export const RELEASE = {
  repo: 'startabit/avr-gcc-wasm',
  tag: 'v1',
  commit: '6972a73',
  publishedAt: '2026-11-02T14:34:09Z',
  licence: 'GPL-3.0',
  baseUrl: 'https://github.com/startabit/avr-gcc-wasm/releases/download/v1/',
  /** Raw files of the recipe repository at the release commit (for the source mirror). */
  rawBase: 'https://raw.githubusercontent.com/startabit/avr-gcc-wasm/6972a73/',
};

/** The small runtime assets (about 6 MB). Only these are downloaded by `npm run toolchain:fetch`. */
export const RUNTIME_ASSETS = [
  { name: 'cc1plus.mjs', size: 108686, sha256: '1d0d11037c051f8af31b0cc20d595be9bb7caf23e7d1d567c60e0e5f7f0ee8b6' },
  { name: 'cc1plus.wasm.gz', size: 4376836, sha256: '7e36e95f26f3934a4dc86b9d984de1e5e89df80f794347d176d6dff646eb554f' },
  { name: 'as.mjs', size: 66925, sha256: '61bbed90ca23c1eb091674a14853e0cef8d2ed6bbfa1b259390210514b603abc' },
  { name: 'as.wasm.gz', size: 289495, sha256: '8fd59073e4e861bca4016412a944dd6049c957b91deb2cea652b578d45f0242d' },
  { name: 'ld.mjs', size: 72705, sha256: '52924d1c389bffb3301288e191e65289c002a9c2ef5401e2472c536d077766a7' },
  { name: 'ld.wasm.gz', size: 356333, sha256: '6ae23384697ce27858d71f8f3eccab6607ff08b5e688f90e81e918a44747ff9b' },
  { name: 'objcopy.mjs', size: 67915, sha256: '8d6bf1179c349a21845201c3750c5d6bae4847293b97b8a4d8894da7d5a1516d' },
  { name: 'objcopy.wasm.gz', size: 270038, sha256: 'e9b8a977a9f297225c6b512da1b63d29150dc0593d4cf185fe3576e115fe1083' },
  { name: 'sysroot.tar.gz', size: 939045, sha256: '51c5d54ee437f1c0a78032c4f122cae0184a9ebf478312e46f175b2769192c22' },
  { name: 'manifest.json', size: 836, sha256: 'f81ca6a24609fb96386cf58b9aac1d00393a36526ff5200f6710b8c02d95c69e' },
  { name: 'SHA256SUMS', size: 931, sha256: '227c38611f35eeeff9ac288bbb800262366258d21001ab79bab5e1cf8aeebec0' },
  { name: 'COPYING', size: 35149, sha256: '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986' },
  { name: 'README.md', size: 2196, sha256: '131ddb91e3efb4eaeff491f94a810fd562f35b69ad8ce9948e363096cffdf3d9' },
];

/** The four tools: <name>.mjs (Emscripten glue) + <name>.wasm.gz (gunzipped next to the glue). */
export const TOOLS = ['cc1plus', 'as', 'ld', 'objcopy'];

/**
 * The source archives of the release that correspond to the shipped binaries.
 * `upstream` is where the project itself publishes the file (from the recipe's scripts/build.sh and
 * scripts/sysroot.py at commit 6972a73). We download from the release, whose digests are pinned here.
 */
export const SOURCE_ASSETS = [
  {
    name: 'gcc-7.3.0.tar.xz', size: 62462388,
    sha256: '832ca6ae04636adbb430e865a1451adf6979ab44ca1c8374f61fba65645ce15c',
    upstream: 'https://ftp.gnu.org/gnu/gcc/gcc-7.3.0/gcc-7.3.0.tar.xz',
    covers: 'cc1plus.wasm (GCC 7.3.0, cc1plus); GCC headers and libgcc source',
    licence: 'GPL-3.0-or-later; libgcc under the GCC Runtime Library Exception 3.1',
  },
  {
    name: 'atmel-patches-gcc.7.3.0-arduino2.patch', size: 107177,
    sha256: '96782c75dd11e994e1ab9250c41fc5cd81ba65bbcf44383cd9d660d01cc85f97',
    upstream: 'https://raw.githubusercontent.com/arduino/toolchain-avr/7.3.0-atmel3.6.1-arduino7/avr-gcc-patches/atmel-patches-gcc.7.3.0-arduino2.patch',
    covers: 'cc1plus.wasm (Arduino/Atmel AVR patch applied to GCC 7.3.0)',
    licence: 'GPL-3.0-or-later (a patch to GCC)',
  },
  {
    name: 'binutils-2.42.tar.xz', size: 27567160,
    sha256: 'f6e4d41fd5fc778b06b7891457b3620da5ecea1006c6a4a41ae998109f85a800',
    upstream: 'https://ftp.gnu.org/gnu/binutils/binutils-2.42.tar.xz',
    covers: 'as.wasm, ld.wasm, objcopy.wasm (GNU Binutils 2.42) and sysroot/avr/lib/ldscripts/*',
    licence: 'GPL-3.0-or-later',
  },
  {
    name: 'gmp-6.2.1.tar.xz', size: 2027316,
    sha256: 'fd4829912cddd12f84181c3451cc752be224643e87fac497b69edddadc49b4f2',
    upstream: 'https://ftp.gnu.org/gnu/gmp/gmp-6.2.1.tar.xz',
    covers: 'linked into cc1plus.wasm (GMP 6.2.1)',
    licence: 'LGPL-3.0-or-later OR GPL-2.0-or-later (dual; we use it under LGPL-3.0)',
  },
  {
    name: 'mpfr-4.1.0.tar.xz', size: 1525476,
    sha256: '0c98a3f1732ff6ca4ea690552079da9c597872d30e96ec28414ee23c95558a7f',
    upstream: 'https://ftp.gnu.org/gnu/mpfr/mpfr-4.1.0.tar.xz',
    covers: 'linked into cc1plus.wasm (MPFR 4.1.0)',
    licence: 'LGPL-3.0-or-later',
  },
  {
    name: 'mpc-1.2.1.tar.gz', size: 838731,
    sha256: '17503d2c395dfcf106b622dc142683c1199431d095367c6aacba6eec30340459',
    upstream: 'https://ftp.gnu.org/gnu/mpc/mpc-1.2.1.tar.gz',
    covers: 'linked into cc1plus.wasm (MPC 1.2.1)',
    licence: 'LGPL-3.0-or-later',
  },
  {
    name: 'avr-1.8.8.tar.bz2', size: 7162150,
    sha256: 'a234c2a43dcd01ce54be665806f183b8e6ec4e966d2e3e0c3358b63023d6390c',
    upstream: 'https://downloads.arduino.cc/cores/staging/avr-1.8.8.tar.bz2',
    covers: 'sysroot/arduino/core.a and the core headers; Wire, SPI, SoftwareSerial and EEPROM libraries (Arduino AVR core 1.8.8)',
    licence: 'LGPL-2.1-or-later; USB files ISC-style, Udp.h MIT, SPI GPL-2.0 or LGPL-2.1 (per file: licenses/toolchain/Arduino-AVR-core-and-libraries-notices.txt)',
  },
  {
    name: 'Servo-1.3.0.tar.gz', size: 110807,
    sha256: '7b829d24f9165e9d2689d157568f066f290cbe41734a9384b9a06250a69e7993',
    upstream: 'https://codeload.github.com/arduino-libraries/Servo/tar.gz/refs/tags/1.3.0',
    covers: 'sysroot/arduino/libraries/Servo.a and Servo headers (Servo 1.3.0)',
    licence: 'LGPL-2.1-or-later',
  },
  {
    name: 'Adafruit_NeoPixel-1.15.5.tar.gz', size: 60637,
    sha256: '3aa189a5a397a13539fcb58ff297ab9dc4a4faf45115e48afd533f1337cb0f3b',
    upstream: 'https://codeload.github.com/adafruit/Adafruit_NeoPixel/tar.gz/refs/tags/1.15.5',
    covers: 'sysroot/arduino/libraries/Adafruit_NeoPixel.a and headers (Adafruit NeoPixel 1.15.5)',
    licence: 'LGPL-3.0',
  },
  {
    name: 'arduino-lib-hc-sr04-2.0.0.tar.gz', size: 15021,
    sha256: 'b0e996017438db9617ad4e46f450011ecb1d89ea83309e7c1a9bb5732c5a2aed',
    upstream: 'https://codeload.github.com/Martinsos/arduino-lib-hc-sr04/tar.gz/refs/tags/2.0.0',
    covers: 'sysroot/arduino/libraries/HCSR04.a and headers (HC-SR04 library 2.0.0)',
    licence: 'MIT',
  },
];

/**
 * Deliberately NOT downloaded or mirrored by any script here.
 * The release lists this 37.6 MB file among its "source archives", but it is Arduino's NATIVE Linux x86_64
 * avr-gcc toolchain (compiled GPL binaries), not source. Redistributing it would give us our own source
 * obligation for binaries we do not ship. The binaries we do ship (libc.a, libm.a, libgcc.a, crt) are only
 * five library files taken from it; their source is covered by gcc-7.3.0 + the Arduino patch (libgcc) and
 * avr-libc (see NOTICE). The fetch scripts refuse to download this name.
 */
export const EXCLUDED_ASSETS = [
  {
    name: 'avr-gcc-7.3.0-atmel3.6.1-arduino7-x86_64-pc-linux-gnu.tar.bz2', size: 37630618,
    sha256: 'bd8c37f6952a2130ac9ee32c53f6a660feb79bee8353c8e289eb60fdcefed91e',
    reason: 'native binary toolchain mislabeled as source',
  },
];

/**
 * Files of the recipe repository at RELEASE.commit that go into the source mirror next to the archives
 * (GPLv3 section 1: "the scripts to control those activities"). Fetched from RELEASE.rawBase + path; sizes and
 * digests were taken on 2026-11-18 from that URL.
 */
export const RECIPE_FILES = [
  { path: 'scripts/build.sh', as: 'build.sh', size: 6952, sha256: '82bc8b7dfe0355508dfe0bd18ada8cad4b21625d6d1f53c2d57dd5ce374852a7' },
  { path: '.github/workflows/build.yml', as: 'build.yml', size: 1861, sha256: 'd078497cdb66ef577f017c1c6f5cb30d73c6b1a283a5bbe11e45008a59dcef6c' },
  { path: 'COPYING', as: 'COPYING', size: 35149, sha256: '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986' },
  // Not asked for explicitly, but part of the build: sysroot.py builds the Arduino core and libraries,
  // scripts/SHA256SUMS pins every source archive.
  { path: 'scripts/sysroot.py', as: 'sysroot.py', size: 7976, sha256: '8bc096d4b7a782a5500d8e7a79d371fb3770acf8f1b0f9e346beb355ba3b8681' },
  { path: 'scripts/SHA256SUMS', as: 'SHA256SUMS.recipe', size: 1019, sha256: 'a58d6b13e424918b807b4b5e3fa2c8a998c7435eb5bb2d0cce05da97a5d53507' },
];
