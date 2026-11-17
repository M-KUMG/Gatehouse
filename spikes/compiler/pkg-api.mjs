// Q1: the package's own buildFirmware() in Node, with a fetch shim for file:// URLs.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { PKG } from './tc.mjs';

globalThis.WorkerGlobalScope ??= function WorkerGlobalScope() {}; // glue is built web/worker-only
const realFetch = globalThis.fetch;
let fetched = 0, fetchCount = 0;
globalThis.fetch = async (u, ...rest) => {
  const url = new URL(String(u));
  if (url.protocol !== 'file:') return realFetch(u, ...rest);
  try {
    const buf = await readFile(fileURLToPath(url));
    fetched += buf.length; fetchCount++;
    return new Response(buf, { status: 200, headers: url.pathname.endsWith(".wasm") ? { "content-type": "application/wasm" } : {} });
  } catch { return new Response('', { status: 404 }); }
};

const { buildFirmware } = await import(pathToFileURL(join(PKG, 'firmware-builder.js')).href);
const source = await readFile(process.argv[2], 'utf8');
for (const label of ['cold', 'warm1', 'warm2']) {
  fetched = 0; fetchCount = 0;
  const t0 = performance.now();
  try {
    const r = await buildFirmware({ source });
    const ms = performance.now() - t0;
    console.log(label, { wallMs: Math.round(ms), flashBytes: r.flashBytes, hexBytes: r.hexBytes, objectCount: r.objectCount, fetchCount, fetchedMB: (fetched / 1e6).toFixed(1),
      timings: Object.fromEntries(Object.entries(r.timings).map(([k, v]) => [k, Math.round(v)])), peaks: r.memory.linearPeakBytesByTool, stderr: r.stderr.slice(0, 5) });
    if (label === 'cold' && process.argv[3]) await writeFile(process.argv[3], r.hex);
    if (label === 'cold') console.log('result keys', Object.keys(r));
  } catch (e) { console.log(label, 'FAILED', String(e.message).slice(0, 1500)); break; }
}
