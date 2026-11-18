import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect, type Plugin } from 'vite';

// The compiler's toolchain packs (docs/toolchain-packs.md), made by
// `npm run toolchain:fetch` + `npm run toolchain:packs` into toolchain/packs/.
const PACKS_DIR = fileURLToPath(new URL('./toolchain/packs/', import.meta.url));
const PACKS_URL = '/toolchain-packs/';

/**
 * Serves toolchain/packs/ at /toolchain-packs/ for `vite` (dev) and
 * `vite preview` ONLY. `vite build` does not copy the packs into dist/ (they
 * are not in public/ and nothing here emits them): they are published only
 * once the toolchain source mirror exists (scripts/MIRROR.md).
 * .pack.gz is served as plain bytes (application/octet-stream, NO
 * Content-Encoding): the Worker gunzips it itself with DecompressionStream.
 */
function toolchainPacks(): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith(PACKS_URL)) return next();
    const notFound = (why: string): void => {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(why);
    };
    let name: string;
    try {
      name = decodeURIComponent(path.slice(PACKS_URL.length));
    } catch {
      return notFound('Not found');
    }
    // Plain file names only (no folders, no ".."), and only what the packs folder holds.
    if (!/^[A-Za-z0-9][\w.-]*$/.test(name) || !/(^manifest\.json|\.pack|\.pack\.gz)$/.test(name)) return notFound('Not found');
    const file = join(PACKS_DIR, name);
    if (!existsSync(file)) return notFound(`${name} not found: run "npm run toolchain:fetch" and "npm run toolchain:packs".`);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      return res.end();
    }
    const st = statSync(file);
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    res.setHeader('ETag', etag);
    // Pack names contain their hash, so they never change; the manifest is checked every time.
    res.setHeader('Cache-Control', name === 'manifest.json' ? 'no-cache, no-transform' : 'public, max-age=31536000, immutable, no-transform');
    res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      return res.end();
    }
    res.setHeader('Content-Length', String(st.size));
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  };
  return {
    name: 'gatehouse-toolchain-packs',
    // Installed before Vite's own middlewares (so the SPA fallback never answers these URLs).
    configureServer: (server) => void server.middlewares.use(serve),
    configurePreviewServer: (server) => void server.middlewares.use(serve),
  };
}

// base './' so the built files also load from file:// inside Electron.
// The compile Worker is a module worker (new Worker(url, { type: 'module' })),
// so it is bundled as ES. No SharedArrayBuffer is used (the tools are single
// threaded), so no cross-origin isolation headers (COOP/COEP) are needed.
export default defineConfig({
  base: './',
  plugins: [toolchainPacks()],
  worker: { format: 'es' },
});
