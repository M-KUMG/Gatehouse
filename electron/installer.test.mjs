// Tests for electron/installer.cjs and electron/setupmode.cjs against a real temporary folder and fakes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const I = require('./installer.cjs');
const { detectMode, appEnv } = require('./setupmode.cjs');

const EXE = 'Gatehouse.exe';
let root;
let src;
let calls;
let links;

function makeSource() {
  fs.mkdirSync(path.join(src, 'resources', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(src, EXE), 'exe-bytes');
  fs.writeFileSync(path.join(src, 'resources', 'app.asar'), 'a'.repeat(200_000));
  fs.writeFileSync(path.join(src, 'resources', 'sub', 'deep.txt'), 'deep');
}

function deps(extra = {}) {
  return {
    fs,
    src,
    exeName: EXE,
    version: '0.2.0',
    startMenuDir: path.join(root, 'startmenu'),
    desktopDir: path.join(root, 'desktop'),
    run: async (file, args) => void calls.push([file, ...args]),
    shell: {
      writeShortcutLink: (file, op, details) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, details.target);
        links[file] = details;
        return true;
      },
      readShortcutLink: (file) => ({ target: fs.readFileSync(file, 'utf8') }),
    },
    ...extra,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-setup-'));
  src = path.join(root, 'payload');
  calls = [];
  links = {};
  makeSource();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('install folder', () => {
  it('is always a folder named Gatehouse', () => {
    expect(I.resolveInstallDir(path.join(root, 'Apps'))).toBe(path.join(root, 'Apps', 'Gatehouse'));
    expect(I.resolveInstallDir(path.join(root, 'Apps', 'gatehouse'))).toBe(path.join(root, 'Apps', 'gatehouse'));
  });
  it('refuses relative paths, empty input and characters cmd.exe treats specially', () => {
    expect(I.resolveInstallDir('Apps')).toBeNull();
    expect(I.resolveInstallDir('')).toBeNull();
    expect(I.resolveInstallDir(undefined)).toBeNull();
    expect(I.resolveInstallDir(path.join(root, 'a&b'))).toBeNull();
    expect(I.resolveInstallDir(path.join(root, '100%'))).toBeNull();
  });
  it('puts a drive root choice into a Gatehouse folder inside it', () => {
    const rootDir = path.parse(root).root;
    expect(I.resolveInstallDir(rootDir)).toBe(path.join(rootDir, 'Gatehouse'));
  });
});

describe('install', () => {
  it('copies every file, writes the marker, makes shortcuts and registers the app', async () => {
    const progress = [];
    const target = path.join(root, 'Programs');
    const result = await I.install(deps(), { dir: target, startMenu: true, desktop: true }, (p) => progress.push(p));
    const dir = path.join(target, 'Gatehouse');
    expect(result).toEqual({ dir, exe: path.join(dir, EXE) });
    expect(fs.readFileSync(path.join(dir, 'resources', 'app.asar'), 'utf8')).toHaveLength(200_000);
    expect(fs.readFileSync(path.join(dir, 'resources', 'sub', 'deep.txt'), 'utf8')).toBe('deep');
    expect(I.readMarker(dir, fs)).toEqual({ version: '0.2.0' });
    expect(Object.keys(links)).toHaveLength(2);
    expect(Object.values(links)[0].target).toBe(path.join(dir, EXE));
    const names = calls.map((c) => c[4]);
    expect(names).toContain('UninstallString');
    expect(fs.existsSync(path.join(dir, I.UNINSTALL_EXE))).toBe(true); // the "Uninstall Gatehouse.exe" link
    expect(calls.find((c) => c[4] === 'UninstallString')[8]).toBe(`"${path.join(dir, I.UNINSTALL_EXE)}" --uninstall`);
    expect(progress.at(-1)).toEqual({ percent: 100, file: '' });
    expect(Math.max(...progress.map((p) => p.percent))).toBe(100);
  });

  it('makes only the shortcuts that were asked for', async () => {
    await I.install(deps(), { dir: path.join(root, 'P'), startMenu: false, desktop: true }, () => {});
    expect(Object.keys(links)).toEqual([path.join(root, 'desktop', 'Gatehouse.lnk')]);
  });

  it('replaces an older install of its own, leaving no stale files', async () => {
    const target = path.join(root, 'P');
    await I.install(deps(), { dir: target }, () => {});
    fs.writeFileSync(path.join(target, 'Gatehouse', 'old-only.txt'), 'x');
    await I.install(deps({ version: '0.3.0' }), { dir: target }, () => {});
    expect(fs.existsSync(path.join(target, 'Gatehouse', 'old-only.txt'))).toBe(false);
    expect(I.readMarker(path.join(target, 'Gatehouse'), fs)).toEqual({ version: '0.3.0' });
  });

  it('upgrades an install made by the earlier NSIS installer, running its uninstaller first', async () => {
    const dir = path.join(root, 'P', 'Gatehouse');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, EXE), 'old exe');
    fs.writeFileSync(path.join(dir, 'Uninstall Gatehouse.exe'), 'u');
    expect(I.findExisting(dir, EXE, fs)).toEqual({ version: null, dir });
    await I.install(deps(), { dir: path.join(root, 'P') }, () => {});
    expect(calls[0]).toEqual([path.join(dir, 'Uninstall Gatehouse.exe'), '/S', `_?=${dir}`]);
    expect(fs.readFileSync(path.join(dir, 'Uninstall Gatehouse.exe'), 'utf8')).toBe('exe-bytes'); // the old uninstaller is gone, ours (a link of the new exe) is there
    expect(I.readMarker(dir, fs)).toEqual({ version: '0.2.0' });
  });

  it('never touches a folder that has other files in it', async () => {
    const dir = path.join(root, 'P', 'Gatehouse');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mine.txt'), 'precious');
    await expect(I.install(deps(), { dir: path.join(root, 'P') }, () => {})).rejects.toThrow(/other files/);
    expect(fs.readFileSync(path.join(dir, 'mine.txt'), 'utf8')).toBe('precious');
  });

  it('a failed registry step takes back the copied files', async () => {
    const dir = path.join(root, 'P', 'Gatehouse');
    const bad = deps({ run: async () => { throw new Error('reg failed'); } });
    await expect(I.install(bad, { dir: path.join(root, 'P') }, () => {})).rejects.toThrow('reg failed');
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe('uninstall', () => {
  async function installed(extra = {}) {
    const result = await I.install(deps(), { dir: path.join(root, 'P'), startMenu: true, desktop: true }, () => {});
    return { ...deps(), dir: result.dir, userDataDir: null, ...extra };
  }

  it('removes the files, our shortcuts and the registry entry', async () => {
    const d = await installed();
    const out = await I.uninstall(d, () => {});
    expect(fs.existsSync(d.dir)).toBe(false);
    expect(fs.existsSync(path.join(root, 'desktop', 'Gatehouse.lnk'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'startmenu', 'Gatehouse.lnk'))).toBe(false);
    expect(calls.at(-1)).toEqual(['reg.exe', 'delete', I.UNINSTALL_KEY, '/f']);
    expect(out.locked).toEqual([]);
    expect(out.cleanup).toBeNull();
  });

  it('keeps a shortcut that points somewhere else', async () => {
    const d = await installed();
    fs.writeFileSync(path.join(root, 'desktop', 'Gatehouse.lnk'), 'C:\\other\\thing.exe');
    await I.uninstall(d, () => {});
    expect(fs.existsSync(path.join(root, 'desktop', 'Gatehouse.lnk'))).toBe(true);
  });

  it('deletes saved settings only when asked, and only a folder named Gatehouse', async () => {
    const data = path.join(root, 'appdata', 'Gatehouse');
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, 'x'), '1');
    await I.uninstall(await installed({ userDataDir: path.join(root, 'appdata') }), () => {});
    expect(fs.existsSync(data)).toBe(true); // the folder given was not named Gatehouse: left alone
    const d = await installed({ userDataDir: data });
    await I.uninstall(d, () => {});
    expect(fs.existsSync(data)).toBe(false);
  });

  it('leaves what is locked and asks for a cleanup after quitting', async () => {
    const d = await installed();
    const realUnlink = fs.unlinkSync;
    const locking = { ...fs, unlinkSync: (p) => { if (p.endsWith(EXE)) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return realUnlink(p); } };
    const out = await I.uninstall({ ...d, fs: locking }, () => {});
    expect(out.locked.sort()).toEqual([EXE, I.UNINSTALL_EXE].sort()); // both names of the running exe
    expect(out.cleanup).toBe(`ping -n 4 127.0.0.1 >nul & rmdir /s /q "${d.dir}"`);
    expect(fs.existsSync(path.join(d.dir, 'resources'))).toBe(false);
  });

  it('refuses a folder that is not our install', async () => {
    const foreign = path.join(root, 'foreign');
    fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(foreign, 'a.txt'), 'keep');
    await expect(I.uninstall({ ...deps(), dir: foreign, userDataDir: null }, () => {})).rejects.toThrow(/does not look like/);
    expect(fs.existsSync(path.join(foreign, 'a.txt'))).toBe(true);
  });

  it('never treats a drive root as removable', () => {
    expect(I.isRemovable(path.parse(root).root, EXE, fs)).toBe(false);
  });
});

describe('cleanup command and registry arguments', () => {
  it('refuses a path that could break out of the command', () => {
    expect(I.cleanupCommand('C:\\a & del x')).toBeNull();
    expect(I.cleanupCommand('C:\\ok\\Gatehouse')).toContain('rmdir /s /q "C:\\ok\\Gatehouse"');
  });
  it('builds reg.exe argument lists, not a shell string', () => {
    const [entry] = I.uninstallEntries({ dir: 'C:\\x\\Gatehouse', version: '1', exeName: EXE, sizeKb: 5 });
    expect(I.regAddArgs(entry)).toEqual(['add', I.UNINSTALL_KEY, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'Gatehouse', '/f']);
  });
});

describe('start mode', () => {
  it('picks the uninstaller, the installer or the app', () => {
    expect(detectMode(['Gatehouse.exe', '--uninstall'], {})).toBe('uninstall');
    expect(detectMode(['Gatehouse.exe', '--setup'], {})).toBe('install');
    expect(detectMode(['Gatehouse.exe'], { PORTABLE_EXECUTABLE_FILE: 'C:\\x\\Setup.exe' })).toBe('install');
    expect(detectMode(['Gatehouse.exe'], {})).toBeNull();
    expect(detectMode([], {}, 'C:\\x\\Gatehouse\\Uninstall Gatehouse.exe')).toBe('uninstall');
    expect(detectMode([], {}, 'C:\\x\\Gatehouse\\Gatehouse.exe')).toBeNull();
  });
  it('strips the installer markers from the environment of the app it launches', () => {
    const env = appEnv({ PATH: 'p', PORTABLE_EXECUTABLE_FILE: 'a', PORTABLE_EXECUTABLE_DIR: 'b' });
    expect(env).toEqual({ PATH: 'p' });
  });
});

describe('preload channels', () => {
  it('match the ones the window answers on', () => {
    const { CHANNEL } = require('./installerwindow.cjs');
    const text = fs.readFileSync(new URL('./installer-preload.cjs', import.meta.url), 'utf8');
    for (const name of Object.values(CHANNEL)) expect(text).toContain(`'${name}'`);
  });
});

describe('cleanup script', () => {
  it('names only the folder, deletes itself, and refuses unsafe paths', () => {
    const script = I.cleanupScript(path.join(root, 'Gatehouse'));
    expect(script).toContain(`DeleteFolder "${path.join(root, 'Gatehouse')}"`);
    expect(script).toContain('DeleteFile WScript.ScriptFullName');
    expect(I.cleanupScript('C:' + String.fromCharCode(92) + 'a"b')).toBeNull();
  });
});
