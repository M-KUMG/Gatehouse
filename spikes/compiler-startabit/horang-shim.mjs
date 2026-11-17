// the old spike's shims: pretend to be a worker, serve file:// via fetch
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
globalThis.WorkerGlobalScope = function () {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { const s = String(u); if (!s.startsWith('file:') && !/^[A-Za-z]:[\/]/.test(s)) return realFetch(u, o);
  const p = s.startsWith('file:') ? fileURLToPath(s) : s; return new Response(readFileSync(p), { headers: { 'content-type': p.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } }); };
