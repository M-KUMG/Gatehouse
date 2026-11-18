// Builds the toolchain packs from the unpacked toolchain/ folder (see scripts/fetch-toolchain.mjs):
//
//   toolchain/packs/manifest.json
//   toolchain/packs/<name>-<sha256 first 12>.pack      raw container (format: scripts/packreader.mjs)
//   toolchain/packs/<name>-<sha256 first 12>.pack.gz   the same, gzip -9
//
// Packs: "compiler" (the four tools + glue + linker script), "board-atmega328p" (start-up code, libc/libm/libgcc,
// the Arduino core archive, all headers) and one "lib-<name>" pack per Arduino library (headers + archive).
// Output is deterministic: same input files, same bytes. toolchain/ is git-ignored, nothing here is committed.
//
// Usage: npm run toolchain:packs [-- --dir <toolchain folder>]
// Layout, sizes and how the Worker should load them: docs/toolchain-packs.md

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sha256Hex, formatBytes } from './lib/download.mjs';
import { PACK_MAGIC, readPack, verifyPack } from './packreader.mjs';
import { RELEASE, TOOLS } from './lib/toolchain-pins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Licence of each library pack (see licenses/toolchain/Arduino-AVR-core-and-libraries-notices.txt). */
const LIBRARY_LICENCES = {
  Wire: 'LGPL-2.1-or-later',
  SPI: 'GPL-2.0-only OR LGPL-2.1-only (dual; used under LGPL-2.1)',
  SoftwareSerial: 'LGPL-2.1-or-later',
  EEPROM: 'LGPL-2.1-or-later',
  Servo: 'LGPL-2.1-or-later',
  Adafruit_NeoPixel: 'LGPL-3.0-or-later',
  HCSR04: 'MIT',
};

const SOURCE_OFFER =
  'Corresponding source: https://github.com/M-KUMG/Gatehouse/releases (tag toolchain-sources-v1) and ' +
  `https://github.com/${RELEASE.repo}/releases/tag/${RELEASE.tag}. See NOTICE and licenses/toolchain/ of the Gatehouse distribution.`;

// ---------------------------------------------------------------------------------------------------------------
// Container

/**
 * Serialise files into one pack. Files are sorted by path; paths must be unique and safe.
 * @param {{path: string, data: Uint8Array}[]} files
 * @returns {Uint8Array}
 */
export function buildPack(files) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let offset = 0;
  const index = sorted.map((f) => {
    const entry = { path: f.path, offset, length: f.data.length, sha256: sha256Hex(f.data) };
    offset += f.data.length;
    return entry;
  });
  const indexBytes = new TextEncoder().encode(JSON.stringify(index));
  const out = new Uint8Array(8 + indexBytes.length + offset);
  for (let i = 0; i < 4; i++) out[i] = PACK_MAGIC.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, indexBytes.length, true);
  out.set(indexBytes, 8);
  let p = 8 + indexBytes.length;
  for (const f of sorted) {
    out.set(f.data, p);
    p += f.data.length;
  }
  readPack(out); // validates paths, uniqueness and layout
  return out;
}

/** gzip -9 with the operating-system byte fixed to 3 (Unix), so the output is the same on every platform. */
export function gzipDeterministic(bytes) {
  const gz = gzipSync(bytes, { level: 9 });
  gz[9] = 3;
  return gz;
}

export function brotliBest(bytes) {
  return brotliCompressSync(bytes, {
    params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_LGWIN]: 24, [zc.BROTLI_PARAM_SIZE_HINT]: bytes.length },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Input files

/** Relative posix paths of all files below dir, sorted. */
function walk(dir, base = '') {
  const out = [];
  for (const e of readdirSync(join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

function mustRead(file) {
  if (!existsSync(file)) throw new Error(`missing ${file}. Run "npm run toolchain:fetch" first.`);
  return readFileSync(file);
}

function text(s) {
  return new TextEncoder().encode(s);
}

function readmeText(title, lines) {
  return text([`Gatehouse toolchain pack: ${title}`, '', ...lines, '', SOURCE_OFFER, ''].join('\n'));
}

/** Everything the packs are made of, as {name, kind, version, files, ...} (no compression yet). */
export function collectPacks(root) {
  const tools = join(root, 'tools');
  const sys = join(root, 'sysroot');
  const dl = join(root, 'dl');
  const rel = JSON.parse(mustRead(join(root, 'toolchain.json')).toString('utf8')).release;
  const manifest = JSON.parse(mustRead(join(dl, 'manifest.json')).toString('utf8'));
  const licDir = join(ROOT, 'licenses', 'toolchain');
  const lic = (name) => mustRead(join(licDir, name));
  const fromSys = (p) => mustRead(join(sys, ...p.split('/')));
  const rev = `v${rel.tag.replace(/^v/, '')}`; // release tag as part of every version
  const avrLibc = /__AVR_LIBC_VERSION_STRING__\s+"([^"]+)"/.exec(fromSys('sysroot/avr/include/avr/version.h').toString('utf8'))?.[1];
  if (!avrLibc) throw new Error('cannot read the avr-libc version from avr/version.h');
  const gcc = String(manifest.toolchain ?? '7.3.0').split('-')[0]; // "7.3.0-atmel3.6.1-arduino7" -> 7.3.0
  const packs = [];

  // compiler
  {
    const files = [];
    for (const t of TOOLS) {
      files.push({ path: `tools/${t}.mjs`, data: mustRead(join(tools, `${t}.mjs`)) });
      files.push({ path: `tools/${t}.wasm`, data: mustRead(join(tools, `${t}.wasm`)) });
    }
    // ld opens "ldscripts/avr5.xn" relative to its working directory; none of the other five scripts is read.
    files.push({ path: 'ldscripts/avr5.xn', data: fromSys('sysroot/avr/lib/ldscripts/avr5.xn') });
    files.push({ path: 'licenses/COPYING', data: lic('GPL-3.0.txt') });
    files.push({ path: 'licenses/GCC-Runtime-Library-Exception-3.1.txt', data: lic('GCC-Runtime-Library-Exception-3.1.txt') });
    files.push({
      path: 'licenses/README.txt',
      data: readmeText('compiler', [
        `Contents: cc1plus (GCC ${gcc} with the Arduino/Atmel AVR patch, C++ compiler), as, ld and objcopy (GNU Binutils 2.42),`,
        'each as a WebAssembly module (.wasm) with its Emscripten glue (.mjs), plus the linker script ldscripts/avr5.xn.',
        `Built by https://github.com/${RELEASE.repo} release ${RELEASE.tag} (commit ${RELEASE.commit}).`,
        'GCC and Binutils: GPL-3.0-or-later (COPYING). GMP, MPFR, MPC inside cc1plus: LGPL-3.0-or-later.',
        'GCC Runtime Library Exception 3.1 (libgcc, GCC headers): see the second licence file.',
      ]),
    });
    packs.push({
      name: 'compiler', kind: 'compiler', version: `gcc${gcc}-binutils2.42-${rev}`,
      description: 'cc1plus, as, ld, objcopy (WebAssembly) and the avr5 linker script; shared by all AVR boards',
      dependencies: [], files,
    });
  }

  // board
  {
    const files = [];
    const add = (path) => files.push({ path, data: fromSys(path) });
    const L = 'sysroot/avr/lib/avr5';
    for (const n of ['crtatmega328p.o', 'libatmega328p.a', 'libc.a', 'libm.a']) add(`${L}/${n}`);
    add('sysroot/lib/gcc/avr/7.3.0/avr5/libgcc.a');
    add('arduino/core.a');
    // All headers of the (already Uno-trimmed) sysroot, not only the 38 that Arduino.h+Wire+SPI+Servo opens: a
    // sketch may include <avr/sleep.h>, <util/atomic.h>, <string.h>... Adds ~0.2 MB raw, 60 KB compressed.
    for (const dir of ['sysroot/avr/include', 'sysroot/lib/gcc/avr/7.3.0/include', 'sysroot/lib/gcc/avr/7.3.0/include-fixed', 'arduino/core', 'arduino/variant']) {
      for (const p of walk(sys, dir)) add(p);
    }
    files.push({ path: 'licenses/avr-libc-BSD.txt', data: lic('avr-libc-BSD.txt') });
    files.push({
      path: 'licenses/README.txt',
      data: readmeText('board-atmega328p', [
        `Contents for the ATmega328P (Arduino Uno/Nano, avr5): start-up code, avr-libc ${avrLibc} (libc.a, libm.a, libatmega328p.a, headers),`,
        `libgcc.a, GCC headers, the Arduino AVR core ${manifest.core} as core.a with its headers, and the "standard" pin variant.`,
        'avr-libc: modified BSD (avr-libc-BSD.txt). libgcc and GCC headers: GPL-3.0-or-later with the GCC Runtime Library Exception 3.1.',
        'Arduino core: LGPL-2.1-or-later (its USB files are ISC-style, Udp.h is MIT; see licenses/toolchain/ of the distribution).',
      ]),
    });
    packs.push({
      name: 'board-atmega328p', kind: 'board', version: `core${manifest.core}-avrlibc${avrLibc}-${rev}`,
      description: 'ATmega328P (avr5): crt, libc, libm, libgcc, libatmega328p, core.a, headers, standard variant',
      dependencies: ['compiler'], files,
    });
  }

  // libraries
  for (const [libName, info] of Object.entries(manifest.libraries).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const files = [];
    for (const p of walk(sys, `arduino/libraries/${libName}`)) files.push({ path: p, data: fromSys(p) });
    const archive = `arduino/libraries/${libName}.a`;
    const hasArchive = existsSync(join(sys, ...archive.split('/')));
    if (hasArchive !== Boolean(info.archive)) throw new Error(`${libName}: manifest.json says archive=${info.archive} but ${archive} ${hasArchive ? 'exists' : 'is missing'}`);
    if (hasArchive) files.push({ path: archive, data: fromSys(archive) });
    const licence = LIBRARY_LICENCES[libName];
    if (!licence) throw new Error(`no licence recorded for library ${libName}; add it to LIBRARY_LICENCES`);
    if (licence === 'MIT') files.push({ path: 'licenses/LICENSE', data: lic('HC-SR04-MIT.txt') });
    files.push({
      path: 'licenses/README.txt',
      data: readmeText(`lib-${libName.toLowerCase()}`, [
        `Library ${libName} ${info.version}: headers${hasArchive ? ' and precompiled archive (' + libName + '.a)' : ' only (header-only library)'}.`,
        `Licence: ${licence}. Texts and exact statements: licenses/toolchain/ of the Gatehouse distribution.`,
      ]),
    });
    packs.push({
      name: `lib-${libName.toLowerCase()}`, kind: 'library', library: libName, version: `${info.version}-${rev}`,
      includes: info.headers, licence,
      description: `${libName} ${info.version}: ${hasArchive ? 'headers + archive' : 'headers only'}`,
      dependencies: ['board-atmega328p'], files,
    });
  }
  return { packs, release: rel, manifest, avrLibc };
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {{root?: string, log?: (s: string) => void}} [opts]
 */
export async function makePacks(opts = {}) {
  const { root = join(ROOT, 'toolchain'), log = console.log } = opts;
  const outDir = join(root, 'packs');
  const { packs, release, manifest, avrLibc } = collectPacks(root);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const doc = {
    schema: 1,
    format: { magic: PACK_MAGIC, description: 'GHP1: "GHP1", uint32le index length, JSON index [{path, offset, length, sha256}], data' },
    source: {
      repo: release.repo, tag: release.tag, commit: release.commit, licence: release.licence,
      toolchain: manifest.toolchain, core: manifest.core, avrLibc, gcc: '7.3.0', binutils: '2.42', emscripten: '4.0.10',
    },
    packs: [],
  };
  for (const p of packs) {
    const raw = buildPack(p.files);
    const gz = gzipDeterministic(raw);
    const br = brotliBest(raw);
    const sha = sha256Hex(raw);
    const file = `${p.name}-${sha.slice(0, 12)}.pack`;
    writeFileSync(join(outDir, file), raw);
    writeFileSync(join(outDir, `${file}.gz`), gz);
    // Read back what we wrote: structure, then every file's sha256 against the index.
    const check = readPack(readFileSync(join(outDir, file)));
    await verifyPack(check, sha256Hex);
    const entry = {
      name: p.name, kind: p.kind, version: p.version, description: p.description,
      ...(p.library ? { library: p.library, includes: p.includes, licence: p.licence } : {}),
      dependencies: p.dependencies,
      file, fileGz: `${file}.gz`,
      files: p.files.length,
      contentBytes: p.files.reduce((n, f) => n + f.data.length, 0),
      size: { raw: raw.length, gzip: gz.length, brotli: br.length },
      sha256: sha,
      sha256Gz: sha256Hex(gz),
    };
    doc.packs.push(entry);
    log(`${p.name.padEnd(24)} ${String(entry.files).padStart(4)} files  raw ${formatBytes(raw.length).padStart(10)}  gzip ${formatBytes(gz.length).padStart(10)}  brotli ${formatBytes(br.length).padStart(10)}  ${file}`);
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(doc, null, 2) + '\n');
  const total = (k) => doc.packs.reduce((n, p) => n + p.size[k], 0);
  log(`total (all packs)        raw ${formatBytes(total('raw'))}  gzip ${formatBytes(total('gzip'))}  brotli ${formatBytes(total('brotli'))}`);
  log(`wrote ${join(outDir, 'manifest.json')}`);
  return doc;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') o.root = resolve(argv[++i] ?? '');
    else throw new Error(`unknown argument: ${argv[i]} (use --dir <toolchain folder>)`);
  }
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await makePacks(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(`MAKE PACKS FAILED: ${e.message}`);
    process.exit(1);
  }
}
