// Downloads the SOURCE archives that correspond to the WebAssembly AVR toolchain binaries (startabit/avr-gcc-wasm
// release v1) into toolchain/sources/, verifies every file against the pinned sha256 digests in
// scripts/lib/toolchain-pins.mjs, fetches the build recipe files at the release commit, and writes
// toolchain/sources/SOURCES.md. This folder is what the owner publishes as the GitHub release
// "toolchain-sources-v1" (GPLv3 section 6, see scripts/MIRROR.md).
//
// About 100 MB. It is run by the OWNER when preparing the mirror: `npm run toolchain:sources`.
// Usage: npm run toolchain:sources [-- --force] [-- --dir <folder>]
//
// EXCLUDED ON PURPOSE: avr-gcc-7.3.0-atmel3.6.1-arduino7-x86_64-pc-linux-gnu.tar.bz2 (37.6 MB). The release lists
// it among its "source archives", but it is Arduino's NATIVE Linux toolchain (compiled binaries), not source.
// Mirroring it would make us redistribute GPL binaries we do not ship, with a source obligation of our own that the
// upstream release does not meet either. We only use five library files taken from it (libc.a, libm.a,
// libgcc.a, crt, libatmega328p.a); the corresponding source is gcc-7.3.0 + the Arduino patch (libgcc) and
// avr-libc, see NOTICE and licenses/toolchain/SOURCES.txt. This script refuses to download that name.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureAsset, formatBytes, VerifyError } from './lib/download.mjs';
import { progressPrinter } from './lib/progress.mjs';
import { EXCLUDED_ASSETS, RECIPE_FILES, RELEASE, SOURCE_ASSETS } from './lib/toolchain-pins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Markdown table row cell: no pipes or newlines. */
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * Text of toolchain/sources/SOURCES.md.
 * @param {typeof SOURCE_ASSETS} sources
 * @param {typeof RECIPE_FILES} recipe
 * @param {typeof EXCLUDED_ASSETS} excluded
 */
export function renderSourcesMd(sources, recipe = RECIPE_FILES, excluded = EXCLUDED_ASSETS) {
  const lines = [];
  lines.push('# Corresponding source for the Gatehouse WebAssembly AVR toolchain', '');
  lines.push(
    `These files are the source that corresponds to the compiled tools and libraries Gatehouse uses in its browser`,
    `and desktop compiler (release \`${RELEASE.tag}\` of https://github.com/${RELEASE.repo}, built from commit`,
    `\`${RELEASE.commit}\`, ${RELEASE.licence}). They are the unmodified archives of that release; every file was`,
    `checked against the sha256 below before it was published. The programs are built with the files in`,
    `"Build recipe" (Emscripten 4.0.10, Ubuntu 24.04). The licence texts are in \`licenses/toolchain/\` in the`,
    `Gatehouse repository and in \`dist/licenses/\` of every build.`, '',
  );
  lines.push('## Source archives', '');
  lines.push('| File | Bytes | sha256 | Upstream | Corresponds to | Licence |', '|---|---:|---|---|---|---|');
  for (const s of sources) {
    lines.push(`| ${cell(s.name)} | ${s.size} | \`${s.sha256}\` | ${cell(s.upstream)} | ${cell(s.covers)} | ${cell(s.licence)} |`);
  }
  lines.push('', '## Build recipe', '');
  lines.push(`From https://github.com/${RELEASE.repo} at commit \`${RELEASE.commit}\`.`, '');
  lines.push('| File | Bytes | sha256 | Raw URL |', '|---|---:|---|---|');
  for (const r of recipe) {
    lines.push(`| ${cell(r.as)} | ${r.size} | \`${r.sha256}\` | ${RELEASE.rawBase}${r.path} |`);
  }
  lines.push('', '## Not included', '');
  for (const x of excluded) {
    lines.push(
      `- \`${x.name}\` (${x.size} bytes): ${x.reason}. It is Arduino's compiled Linux toolchain, not source, so it is not`,
      '  mirrored. Gatehouse uses only five library files taken from it (libc.a, libm.a, libgcc.a, crtatmega328p.o,',
      '  libatmega328p.a). Their source: avr-libc (modified BSD licence), and for libgcc.a the GCC 7.3.0 source with the',
      '  Arduino patch above (GCC Runtime Library Exception). The exact upstream build is',
      '  https://github.com/arduino/toolchain-avr at tag `7.3.0-atmel3.6.1-arduino7`.',
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** "sha256sum -c" compatible list of the mirrored files, sorted by name. */
export function renderSha256Sums(assets) {
  return [...assets].sort((a, b) => (a.name < b.name ? -1 : 1)).map((a) => `${a.sha256}  ${a.name}`).join('\n') + '\n';
}

/**
 * @param {{root?: string, force?: boolean, fetchImpl?: typeof fetch, log?: (s: string) => void,
 *          sources?: typeof SOURCE_ASSETS, recipe?: typeof RECIPE_FILES, out?: any}} [opts]
 */
export async function fetchSources(opts = {}) {
  const {
    root = join(ROOT, 'toolchain', 'sources'), force = false, fetchImpl, log = console.log,
    sources = SOURCE_ASSETS, recipe = RECIPE_FILES, out = process.stdout,
  } = opts;
  for (const x of EXCLUDED_ASSETS) {
    if (sources.some((s) => s.name === x.name)) throw new Error(`refusing to fetch ${x.name}: ${x.reason}`);
  }
  mkdirSync(root, { recursive: true });
  const jobs = [
    ...sources.map((s) => ({ asset: s, url: RELEASE.baseUrl + s.name })),
    ...recipe.map((r) => ({ asset: { name: r.as, size: r.size, sha256: r.sha256 }, url: RELEASE.rawBase + r.path })),
  ];
  const total = jobs.reduce((n, j) => n + j.asset.size, 0);
  log(`Gatehouse toolchain sources: ${jobs.length} files, ${formatBytes(total)} at most -> ${root}`);
  let downloaded = 0;
  for (const [i, j] of jobs.entries()) {
    const label = `[${String(i + 1).padStart(2)}/${jobs.length}] ${j.asset.name.slice(0, 44).padEnd(44)} ${formatBytes(j.asset.size).padStart(10)}`;
    const pp = progressPrinter(label, out);
    let status;
    try {
      status = await ensureAsset({ dir: root, asset: j.asset, url: j.url, force, fetchImpl, onProgress: (r, t) => pp.update(r, t), log });
    } catch (e) {
      pp.done('FAILED');
      throw e;
    }
    if (status === 'downloaded') downloaded++;
    pp.done(status === 'skipped' ? 'present, sha256 verified' : 'downloaded, sha256 verified');
  }
  writeFileSync(join(root, 'SOURCES.md'), renderSourcesMd(sources, recipe));
  writeFileSync(join(root, 'SHA256SUMS'), renderSha256Sums(jobs.map((j) => j.asset)));
  log(`wrote ${join(root, 'SOURCES.md')} and ${join(root, 'SHA256SUMS')}`);
  log(`done: ${downloaded} downloaded, ${jobs.length - downloaded} already present; all verified. Next: scripts/MIRROR.md`);
}

function parseArgs(argv) {
  const o = { force: false, root: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') o.force = true;
    else if (argv[i] === '--dir') o.root = resolve(argv[++i] ?? '');
    else throw new Error(`unknown argument: ${argv[i]} (use --force or --dir <folder>)`);
  }
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await fetchSources(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error('\n' + '*'.repeat(70));
    console.error(`TOOLCHAIN SOURCES FETCH FAILED: ${e.message}`);
    if (e instanceof VerifyError) console.error('The offending file was deleted. Do not publish the mirror until this is understood.');
    console.error('*'.repeat(70));
    process.exit(1);
  }
}
