import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { create } from 'tar';

const appDir = resolve(process.argv[2] ?? 'release/linux-unpacked');
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const name = `Gatehouse-${version}-linux-x64`;
const file = join(dirname(appDir), `${name}.tar.gz`);
const pending = `${file}.part`;
const packsDir = join(appDir, 'resources/toolchain-packs');
const manifest = JSON.parse(await readFile(join(packsDir, 'manifest.json'), 'utf8'));
await Promise.all([
  access(join(appDir, 'gatehouse')),
  access(join(appDir, 'resources/app.asar')),
  ...manifest.packs.flatMap(({ file, fileGz }) => [access(join(packsDir, file)), access(join(packsDir, fileGz))]),
]);

const executable = /^(?:\.\/)?(?:gatehouse|chrome-sandbox|chrome_crashpad_handler|lib[^/]+\.so(?:\.\d+)*)$/;
await create({
  cwd: appDir,
  file: pending,
  prefix: name,
  gzip: true,
  portable: true,
  strict: true,
  onWriteEntry(entry) {
    // NTFS does not retain the executable modes from the Linux Electron ZIP.
    if (process.platform === 'win32' && entry.type === 'File' && executable.test(entry.path)) {
      entry.stat.mode = 0o755;
    }
  },
}, ['.']);
await rename(pending, file);

const hash = createHash('sha256');
for await (const chunk of createReadStream(file)) hash.update(chunk);
await writeFile(`${file}.sha256`, `${hash.digest('hex')}  ${name}.tar.gz\n`);
console.log(`Packed ${file}`);
