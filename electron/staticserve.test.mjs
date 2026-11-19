// Tests for electron/staticserve.cjs (the pure part of the gatehouse:// protocol server).
// No Electron: requests are plain Request objects against a temporary folder.
// vitest picks it up by its default *.test.* pattern, so `npm test` runs it.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const S = require('./staticserve.cjs');

let tmp;
let roots;
const PACK = Buffer.from('GHP1 pack bytes');

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'gatehouse-static-'));
  const app = path.join(tmp, 'dist');
  const packs = path.join(tmp, 'packs');
  mkdirSync(path.join(app, 'assets'), { recursive: true });
  mkdirSync(path.join(app, 'licenses'), { recursive: true });
  mkdirSync(packs);
  writeFileSync(path.join(app, 'index.html'), '<!doctype html><title>x</title>');
  writeFileSync(path.join(app, 'assets', 'index-abc.js'), 'export default 1;');
  writeFileSync(path.join(app, 'assets', 'index-abc.css'), 'a{}');
  writeFileSync(path.join(app, 'assets', 'tool.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]));
  writeFileSync(path.join(app, 'NOTICE'), 'notice');
  writeFileSync(path.join(app, 'licenses', 'a.txt'), 'licence');
  writeFileSync(path.join(app, '.hidden'), 'secret');
  writeFileSync(path.join(packs, 'manifest.json'), '{"schema":1,"packs":[]}');
  writeFileSync(path.join(packs, 'compiler-0123456789ab.pack'), PACK);
  writeFileSync(path.join(packs, 'compiler-0123456789ab.pack.gz'), PACK);
  writeFileSync(path.join(packs, 'notes.txt'), 'not a pack');
  writeFileSync(path.join(tmp, 'secret.txt'), 'outside both roots');
  roots = { appRoot: app, packsRoot: packs };
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const get = (url, init) => S.createHandler(roots)(new Request(url, init));
const U = (p) => `gatehouse://app${p}`;

describe('resolveUrl: normal files', () => {
  it('maps / and /index.html to the app index', () => {
    for (const p of ['/', '/index.html', '/?x=1', '/#frag', '']) {
      const r = S.resolveUrl(U(p), roots);
      expect(r).toMatchObject({ status: 200, kind: 'app', rel: 'index.html' });
      expect(r.file).toBe(path.join(roots.appRoot, 'index.html'));
    }
  });

  it('maps app files and nested app files', () => {
    expect(S.resolveUrl(U('/assets/index-abc.js'), roots)).toMatchObject({ status: 200, kind: 'app', file: path.join(roots.appRoot, 'assets', 'index-abc.js') });
    expect(S.resolveUrl(U('/licenses/a.txt?v=2'), roots)).toMatchObject({ status: 200, rel: 'licenses/a.txt' });
  });

  it('maps /toolchain-packs/<file> to the packs folder', () => {
    expect(S.resolveUrl(U('/toolchain-packs/manifest.json'), roots)).toMatchObject({ status: 200, kind: 'packs', file: path.join(roots.packsRoot, 'manifest.json') });
    expect(S.resolveUrl(U('/toolchain-packs/compiler-0123456789ab.pack.gz'), roots)).toMatchObject({ status: 200, kind: 'packs', rel: 'compiler-0123456789ab.pack.gz' });
  });

  it('decodes a percent escape once', () => {
    expect(S.resolveUrl(U('/assets/index%2Dabc.js'), roots)).toMatchObject({ status: 200, rel: 'assets/index-abc.js' });
  });

  it('is case-insensitive on the host and scheme only', () => {
    expect(S.resolveUrl('GATEHOUSE://APP/index.html', roots).status).toBe(200);
  });
});

describe('resolveUrl: refused', () => {
  const bad = {
    'dot-dot': '/../secret.txt',
    'dot-dot deeper': '/assets/../../secret.txt',
    'encoded dot-dot': '/%2e%2e/secret.txt',
    'encoded dot-dot upper': '/%2E%2E/secret.txt',
    'half-encoded dot-dot': '/.%2e/secret.txt',
    'dot-dot with encoded backslash': '/..%5csecret.txt',
    'dot-dot with encoded backslash upper': '/assets/..%5Csecret.txt',
    'encoded slash': '/assets%2f..%2f..%2fsecret.txt',
    'raw backslash': '/assets\\..\\secret.txt',
    'leading backslash': '/\\secret.txt',
    'single dot segment': '/./index.html',
    'NUL raw': '/index.html\0',
    'NUL encoded': '/index.html%00.png',
    'control character': '/index%0a.html',
    'drive letter': '/C:/Windows/win.ini',
    'drive letter encoded colon': '/C%3A/Windows/win.ini',
    'NTFS stream': '/index.html:stream',
    'double encoded dot-dot': '/%252e%252e/secret.txt',
    'double encoded slash': '/assets%252f..%252fsecret.txt',
    'bad escape': '/%zz',
    'trailing dot': '/index.html.',
    'trailing space': '/index.html%20',
    'device name': '/nul',
    'device name with extension': '/assets/CON.txt',
    'too long': `/${'a'.repeat(2000)}`,
  };
  for (const [name, p] of Object.entries(bad)) {
    it(`400: ${name}`, () => {
      expect(S.resolveUrl(U(p), roots)).toEqual({ status: 400 });
    });
  }

  it('absolute-looking paths stay under the root', () => {
    // "//etc/passwd" is an empty segment, not an absolute path.
    expect(S.resolveUrl(U('//etc/passwd'), roots).status).toBe(404);
    const r = S.resolveUrl(U('/etc/passwd'), roots);
    expect(r.file).toBe(path.join(roots.appRoot, 'etc', 'passwd'));
  });

  it('404: other hosts, schemes, dotfiles, directories, empty segments', () => {
    for (const u of ['gatehouse://evil/index.html', 'gatehouse://app.evil.com/index.html', 'gatehouse://user@app/index.html', 'gatehouse://app:8080/index.html', 'https://app/index.html', 'file:///C:/x', 'gatehouseapp://app/', 'x']) {
      expect(S.resolveUrl(u, roots).status, u).toBe(404);
    }
    for (const p of ['/.hidden', '/assets/.x', '/assets/', '/a//b', '/toolchain-packs', '/toolchain-packs/']) {
      expect(S.resolveUrl(U(p), roots).status, p).toBe(404);
    }
  });

  it('serves only manifest and packs from /toolchain-packs/', () => {
    for (const f of ['notes.txt', 'sub/compiler.pack', 'compiler.pack.txt', '.pack', 'manifest.json.bak', 'MANIFEST.JSON.x']) {
      expect(S.resolveUrl(U(`/toolchain-packs/${f}`), roots).status, f).toBe(404);
    }
    expect(S.resolveUrl(U('/toolchain-packs/../index.html'), roots).status).toBe(400);
  });

  it('404 for packs when there is no packs folder', () => {
    expect(S.resolveUrl(U('/toolchain-packs/manifest.json'), { appRoot: roots.appRoot, packsRoot: null }).status).toBe(404);
    expect(S.resolveUrl(U('/toolchain-packs/manifest.json'), { appRoot: roots.appRoot }).status).toBe(404);
  });

  it('never reads the app root for /toolchain-packs/', () => {
    // dist/toolchain-packs would be ignored even if it existed: the packs root decides.
    const r = S.resolveUrl(U('/toolchain-packs/manifest.json'), roots);
    expect(r.root).toBe(roots.packsRoot);
  });
});

describe('resolveUrl: Windows paths', () => {
  const win = { appRoot: 'C:\\Apps\\Gatehouse\\dist', packsRoot: 'D:\\packs' };
  it('resolves under the root with backslashes', () => {
    expect(S.resolveUrl(U('/assets/x.js'), win, path.win32)).toMatchObject({ status: 200, file: 'C:\\Apps\\Gatehouse\\dist\\assets\\x.js' });
    expect(S.resolveUrl(U('/toolchain-packs/manifest.json'), win, path.win32)).toMatchObject({ status: 200, file: 'D:\\packs\\manifest.json' });
  });
  it('refuses traversal and drive letters', () => {
    for (const p of ['/..\\x', '/..%5cx', '/C:/Windows/win.ini', '/C%3A%5CWindows', '/assets/..\\..\\x', '/\\\\server\\share']) {
      expect(S.resolveUrl(U(p), win, path.win32).status, p).toBe(400);
    }
  });
  it('isInside ignores case on Windows but not on POSIX', () => {
    expect(S.isInside('C:\\Apps\\DIST', 'c:\\apps\\dist\\a.js', path.win32)).toBe(true);
    expect(S.isInside('C:\\Apps\\dist', 'C:\\Apps\\dist2\\a.js', path.win32)).toBe(false);
    expect(S.isInside('C:\\Apps\\dist', 'C:\\Apps\\dist', path.win32)).toBe(false);
    expect(S.isInside('C:\\Apps\\dist', 'D:\\Apps\\dist\\a.js', path.win32)).toBe(false);
    expect(S.isInside('/a/dist', '/a/dist/b/c.js', path.posix)).toBe(true);
    expect(S.isInside('/a/dist', '/a/DIST/b.js', path.posix)).toBe(false);
    expect(S.isInside('/a/dist', '/a/dist-evil/b.js', path.posix)).toBe(false);
    expect(S.isInside('/a/dist', '/a/secret.txt', path.posix)).toBe(false);
  });
});

describe('isAppUrl', () => {
  it('allows only gatehouse://app', () => {
    expect(S.isAppUrl('gatehouse://app/index.html')).toBe(true);
    expect(S.isAppUrl('gatehouse://app')).toBe(true);
    for (const u of ['https://example.com', 'http://localhost:5173/', 'file:///C:/x/index.html', 'gatehouse://other/', 'javascript:alert(1)', 'about:blank', '']) {
      expect(S.isAppUrl(u), u).toBe(false);
    }
  });
});

describe('MIME types and headers', () => {
  it('has the types the app needs', () => {
    const t = {
      'a.html': 'text/html; charset=utf-8',
      'a.js': 'text/javascript; charset=utf-8',
      'a.mjs': 'text/javascript; charset=utf-8',
      'a.css': 'text/css; charset=utf-8',
      'a.json': 'application/json; charset=utf-8',
      'a.map': 'application/json; charset=utf-8',
      'a.svg': 'image/svg+xml',
      'a.png': 'image/png',
      'a.ico': 'image/x-icon',
      'a.wasm': 'application/wasm',
      'a.woff': 'font/woff',
      'a.woff2': 'font/woff2',
      'a.txt': 'text/plain; charset=utf-8',
      'a.pack': 'application/octet-stream',
      'a.pack.gz': 'application/octet-stream',
      'A.WASM': 'application/wasm',
      NOTICE: 'application/octet-stream',
      'a.unknown': 'application/octet-stream',
    };
    for (const [name, type] of Object.entries(t)) expect(S.mimeFor(name), name).toBe(type);
  });

  it('manifest is no-cache, packs and hashed assets are immutable, index.html is revalidated', () => {
    expect(S.cacheControlFor('packs', 'manifest.json')).toMatch(/no-cache/);
    expect(S.cacheControlFor('packs', 'compiler-0123456789ab.pack.gz')).toMatch(/immutable/);
    expect(S.cacheControlFor('app', 'assets/index-abc.js')).toMatch(/immutable/);
    expect(S.cacheControlFor('app', 'index.html')).toMatch(/no-cache/);
    expect(S.cacheControlFor('app', 'NOTICE')).toMatch(/no-cache/);
  });

  it('headersFor never sets Content-Encoding', () => {
    const h = S.headersFor('packs', 'compiler-0123456789ab.pack.gz', { size: 15, mtimeMs: 1000 });
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('content-encoding');
    expect(h['Content-Type']).toBe('application/octet-stream');
    expect(h['Content-Length']).toBe('15');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h.ETag).toMatch(/^W\/"f-3e8"$/);
  });
});

describe('createHandler', () => {
  it('serves index.html for / and /index.html', async () => {
    for (const p of ['/', '/index.html']) {
      const res = await get(U(p));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await res.text()).toContain('<title>x</title>');
    }
  });

  it('serves app assets with the right type', async () => {
    const js = await get(U('/assets/index-abc.js'));
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(js.headers.get('cache-control')).toMatch(/immutable/);
    expect(await js.text()).toBe('export default 1;');
    const wasm = await get(U('/assets/tool.wasm'));
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
    expect([...new Uint8Array(await wasm.arrayBuffer())]).toEqual([0, 0x61, 0x73, 0x6d]);
  });

  it('serves the manifest with no-cache', async () => {
    const res = await get(U('/toolchain-packs/manifest.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toMatch(/no-cache/);
    expect(JSON.parse(await res.text())).toEqual({ schema: 1, packs: [] });
  });

  it('serves .pack and .pack.gz as plain octet-stream bytes without Content-Encoding', async () => {
    for (const name of ['compiler-0123456789ab.pack', 'compiler-0123456789ab.pack.gz']) {
      const res = await get(U(`/toolchain-packs/${name}`));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(res.headers.get('content-encoding')).toBeNull();
      expect(res.headers.get('content-length')).toBe(String(PACK.length));
      expect(res.headers.get('cache-control')).toMatch(/immutable/);
      expect(Buffer.from(await res.arrayBuffer()).equals(PACK)).toBe(true);
    }
  });

  it('HEAD has headers and no body; other methods are 405', async () => {
    const head = await get(U('/toolchain-packs/compiler-0123456789ab.pack'), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(PACK.length));
    expect(await head.text()).toBe('');
    const post = await get(U('/index.html'), { method: 'POST', body: 'x' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('answers 304 for a matching ETag', async () => {
    const first = await get(U('/toolchain-packs/manifest.json'));
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const again = await get(U('/toolchain-packs/manifest.json'), { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    const other = await get(U('/toolchain-packs/manifest.json'), { headers: { 'If-None-Match': 'W/"nope"' } });
    expect(other.status).toBe(200);
  });

  it('404 for unknown paths, directories, dotfiles, non-pack files and a missing pack', async () => {
    for (const p of ['/nope.js', '/assets', '/assets/', '/.hidden', '/toolchain-packs/notes.txt', '/toolchain-packs/missing-000000000000.pack', '/toolchain-packs/']) {
      expect((await get(U(p))).status, p).toBe(404);
    }
    const noFolder = S.createHandler({ appRoot: roots.appRoot, packsRoot: path.join(tmp, 'no-such-folder') });
    const missing = await noFolder(new Request(U('/toolchain-packs/manifest.json')));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('toolchain:packs');
  });

  it('400 for traversal attempts and never leaks the file outside the roots', async () => {
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/%252e%252e/secret.txt', '/assets\\..\\..\\secret.txt', '/toolchain-packs/../secret.txt', '/toolchain-packs/..%5csecret.txt']) {
      // A plain object, not `new Request(url)`: the URL parser would already collapse "..".
      const res = await S.createHandler(roots)({ url: U(p), method: 'GET', headers: new Headers() });
      expect(res.status, p).toBe(400);
      expect(await res.text()).not.toContain('outside both roots');
    }
  });

  it('a URL the parser has already normalised stays inside the roots', async () => {
    const res = await get(U('/../secret.txt'));
    expect(new Request(U('/../secret.txt')).url).not.toContain('..');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('outside both roots');
  });

  it('404 for another host or scheme', async () => {
    expect((await get('gatehouse://evil/index.html')).status).toBe(404);
  });

  it('does not follow a symlink out of a root', async (ctx) => {
    try {
      symlinkSync(path.join(tmp, 'secret.txt'), path.join(roots.appRoot, 'link.txt'));
    } catch {
      ctx.skip(); // no symlink permission (Windows without developer mode)
      return;
    }
    const res = await get(U('/link.txt'));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('outside both roots');
  });

  it('accepts roots as a function (looked up per request)', async () => {
    const res = await S.createHandler(() => roots)(new Request(U('/index.html')));
    expect(res.status).toBe(200);
  });
});
