// Downloads the small runtime assets of the WebAssembly AVR toolchain (startabit/avr-gcc-wasm release v1,
// about 6 MB) into toolchain/ for DEVELOPMENT use, verifies them, and unpacks them:
//
//   toolchain/dl/         the downloaded files, exactly as released (verified, kept as the cache)
//   toolchain/tools/      <tool>.mjs (Emscripten glue) + <tool>.wasm (gunzipped from <tool>.wasm.gz)
//   toolchain/sysroot/    sysroot.tar.gz extracted (headers, libraries, Arduino core archive, ldscripts)
//   toolchain/toolchain.json   what is there: names, sizes, sha256, release tag/commit, date fetched
//
// Every file is checked against the pinned digests in scripts/lib/toolchain-pins.mjs AND against the release's
// own SHA256SUMS. A mismatch deletes the file and stops with an error. The binaries are never committed
// (toolchain/ is in .gitignore) and the 37.6 MB native tarball of the release is never downloaded.
//
// Usage: npm run toolchain:fetch [-- --force] [-- --dir <folder>]
//   --force   download and unpack everything again
//   --dir     target folder (default: toolchain/ in the repository root)
// Idempotent: files that are present and verified are skipped.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkFile, ensureAsset, formatBytes, parseSha256Sums, sha256Hex, VerifyError } from './lib/download.mjs';
import { progressPrinter } from './lib/progress.mjs';
import { extractEntries, readTar } from './lib/tar.mjs';
import { RELEASE, RUNTIME_ASSETS, TOOLS, EXCLUDED_ASSETS } from './lib/toolchain-pins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_WASM_BYTES = 64 * 1024 * 1024; // cc1plus.wasm is 14.4 MB; refuse anything absurd
const MAX_SYSROOT_BYTES = 64 * 1024 * 1024; // sysroot is 7.6 MB unpacked

function readJsonIfExists(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Throws unless the release's SHA256SUMS lists every pinned asset with exactly the pinned digest. */
export function crossCheckSums(sumsText, assets) {
  const sums = parseSha256Sums(sumsText);
  for (const a of assets) {
    if (a.name === 'SHA256SUMS') continue;
    const listed = sums.get(a.name);
    if (listed === undefined) throw new VerifyError(`SHA256SUMS does not list ${a.name}`);
    if (listed !== a.sha256) {
      throw new VerifyError(
        `The release's SHA256SUMS disagrees with the pinned digest for ${a.name}: release says ${listed}, pinned ${a.sha256}. ` +
          'The release may have been replaced or tampered with.',
      );
    }
  }
  return sums;
}

/**
 * @param {{root?: string, force?: boolean, fetchImpl?: typeof fetch, log?: (s: string) => void,
 *          assets?: typeof RUNTIME_ASSETS, baseUrl?: string, out?: any}} [opts]
 */
export async function fetchToolchain(opts = {}) {
  const {
    root = join(ROOT, 'toolchain'), force = false, fetchImpl, log = console.log,
    assets = RUNTIME_ASSETS, baseUrl = RELEASE.baseUrl, out = process.stdout,
  } = opts;
  const dl = join(root, 'dl');
  const toolsDir = join(root, 'tools');
  const sysrootDir = join(root, 'sysroot');
  const prev = force ? null : readJsonIfExists(join(root, 'toolchain.json'));
  mkdirSync(dl, { recursive: true });
  mkdirSync(toolsDir, { recursive: true });

  for (const x of EXCLUDED_ASSETS) {
    if (assets.some((a) => a.name === x.name)) throw new Error(`refusing to fetch ${x.name}: ${x.reason}`);
  }

  log(`Gatehouse toolchain: ${RELEASE.repo} ${RELEASE.tag} (commit ${RELEASE.commit}, ${RELEASE.licence}) -> ${root}`);
  const total = assets.reduce((n, a) => n + a.size, 0);
  log(`${assets.length} files, ${formatBytes(total)} to download at most${force ? ' (--force)' : ''}`);

  // 1. Download and verify. SHA256SUMS first, so it can be cross-checked as soon as it is there.
  const ordered = [...assets].sort((a, b) => (a.name === 'SHA256SUMS' ? -1 : b.name === 'SHA256SUMS' ? 1 : 0));
  let sumsChecked = false;
  const results = [];
  for (const [i, a] of ordered.entries()) {
    const label = `[${String(i + 1).padStart(2)}/${ordered.length}] ${a.name.padEnd(16)} ${formatBytes(a.size).padStart(10)}`;
    const pp = progressPrinter(label, out);
    let status;
    try {
      status = await ensureAsset({
        dir: dl, asset: a, url: baseUrl + a.name, force, fetchImpl,
        onProgress: (r, t) => pp.update(r, t), log,
      });
    } catch (e) {
      pp.done('FAILED');
      throw e;
    }
    pp.done(status === 'skipped' ? 'present, sha256 verified' : 'downloaded, sha256 verified');
    results.push({ ...a, status });
    if (a.name === 'SHA256SUMS' && !sumsChecked) {
      crossCheckSums(readFileSync(join(dl, 'SHA256SUMS'), 'utf8'), assets);
      log(`       release SHA256SUMS agrees with the pinned digests for ${assets.length - 1} files`);
      sumsChecked = true;
    }
  }
  if (!sumsChecked) {
    log('       warning: SHA256SUMS is not among the assets, only the pinned digests were checked');
  }

  // 2. Tools: glue copied, wasm gunzipped next to it.
  const prevTools = new Map((prev?.tools ?? []).map((t) => [t.name, t]));
  const tools = [];
  for (const name of TOOLS) {
    const mjsAsset = assets.find((a) => a.name === `${name}.mjs`);
    const gzAsset = assets.find((a) => a.name === `${name}.wasm.gz`);
    if (!mjsAsset || !gzAsset) continue; // a reduced asset list (tests)
    const mjsDest = join(toolsDir, `${name}.mjs`);
    if ((await checkFile(mjsDest, mjsAsset)) !== null) {
      copyFileSync(join(dl, mjsAsset.name), mjsDest);
      log(`  tools/${name}.mjs copied`);
    }
    const wasmDest = join(toolsDir, `${name}.wasm`);
    const known = prevTools.get(name);
    let wasm = null;
    if (known && (await checkFile(wasmDest, { sha256: known.wasmSha256, size: known.wasmSize })) === null) {
      wasm = { sha256: known.wasmSha256, size: known.wasmSize };
      log(`  tools/${name}.wasm present, unchanged since the last run`);
    } else {
      const raw = gunzipSync(readFileSync(join(dl, gzAsset.name)), { maxOutputLength: MAX_WASM_BYTES });
      writeFileSync(wasmDest, raw);
      wasm = { sha256: sha256Hex(raw), size: raw.length };
      log(`  tools/${name}.wasm unpacked (${formatBytes(raw.length)})`);
    }
    tools.push({ name, glue: `${name}.mjs`, wasm: `${name}.wasm`, wasmSize: wasm.size, wasmSha256: wasm.sha256 });
  }

  // 3. Sysroot.
  let sysroot = null;
  const sysAsset = assets.find((a) => a.name === 'sysroot.tar.gz');
  if (sysAsset) {
    const known = prev?.sysroot?.files;
    let intact = Array.isArray(known) && known.length > 0 && existsSync(sysrootDir);
    if (intact) {
      for (const f of known) {
        if ((await checkFile(join(sysrootDir, ...f.path.split('/')), f)) !== null) { intact = false; break; }
      }
    }
    if (intact) {
      sysroot = prev.sysroot;
      log(`  sysroot/ present: ${known.length} files verified`);
    } else {
      const tar = gunzipSync(readFileSync(join(dl, sysAsset.name)), { maxOutputLength: MAX_SYSROOT_BYTES });
      const entries = readTar(tar, { maxTotalBytes: MAX_SYSROOT_BYTES });
      // Extract in place (no temp folder + rename: renaming a fresh folder fails with EPERM on Windows while a
      // virus scanner or indexer holds it). A half-written folder is caught by the verification pass next run.
      rmSync(sysrootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      const files = extractEntries(entries, sysrootDir);
      sysroot = { fileCount: files.length, totalBytes: files.reduce((n, f) => n + f.size, 0), files };
      log(`  sysroot/ extracted: ${files.length} files, ${formatBytes(sysroot.totalBytes)}`);
    }
  }

  // 4. toolchain.json. fetchedAt is kept when nothing changed, so a second run leaves the file as it was.
  const changed = results.some((r) => r.status === 'downloaded') || !prev;
  const doc = {
    schema: 1,
    release: {
      repo: RELEASE.repo, tag: RELEASE.tag, commit: RELEASE.commit, publishedAt: RELEASE.publishedAt,
      licence: RELEASE.licence, url: `https://github.com/${RELEASE.repo}/releases/tag/${RELEASE.tag}`,
    },
    fetchedAt: changed || !prev?.fetchedAt ? new Date().toISOString() : prev.fetchedAt,
    assets: results.map((r) => ({ name: r.name, size: r.size, sha256: r.sha256, url: baseUrl + r.name })),
    tools,
    sysroot,
  };
  writeFileSync(join(root, 'toolchain.json'), JSON.stringify(doc, null, 2) + '\n');
  log(`wrote ${join(root, 'toolchain.json')}`);
  const downloaded = results.filter((r) => r.status === 'downloaded');
  log(downloaded.length > 0
    ? `done: ${downloaded.length} files downloaded (${formatBytes(downloaded.reduce((n, r) => n + r.size, 0))}), all verified`
    : 'done: nothing to download, everything present and verified');
  return doc;
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
    await fetchToolchain(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error('\n' + '*'.repeat(70));
    console.error(`TOOLCHAIN FETCH FAILED: ${e.message}`);
    if (e instanceof VerifyError) {
      console.error('The offending file was deleted. Do not use files from this release until the');
      console.error('difference is understood (compare with spikes/compiler-startabit/release.json).');
    }
    console.error('*'.repeat(70));
    process.exit(1);
  }
}
