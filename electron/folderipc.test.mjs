// Tests for electron/folderipc.cjs with a fake ipcMain / dialog (no Electron).

import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { CHANNEL, checkFolderName, registerFolderIpc } = require('./folderipc.cjs');

let dir;
let handlers;
let picked;
let stateFile;
const appEvent = { senderFrame: { url: 'gatehouse://app/index.html' } };
const webEvent = { senderFrame: { url: 'https://evil.example/' } };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-ipc-'));
  stateFile = path.join(dir, 'state', 'project-folder.json');
  handlers = {};
  picked = { canceled: false, filePaths: [dir] };
  registerFolderIpc(
    { handle: (name, fn) => (handlers[name] = fn) },
    { showOpenDialog: async () => picked },
    (url) => url.startsWith('gatehouse://app/'),
    () => null,
    { defaultParent: dir, stateFile },
  );
});

describe('project folder IPC', () => {
  it('uses the channel names the preload has written out', () => {
    const preload = fs.readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
    for (const name of Object.values(CHANNEL)) expect(preload).toContain(`'${name}'`);
  });

  it('refuses everything from a page that is not the app', async () => {
    expect(await handlers[CHANNEL.pick](webEvent, 'open')).toEqual({ error: 'Refused.' });
    expect(await handlers[CHANNEL.home](webEvent)).toEqual({ error: 'Refused.' });
    expect(await handlers[CHANNEL.create](webEvent, dir, 'x')).toEqual({ error: 'Refused.' });
    expect(await handlers[CHANNEL.read](webEvent, dir)).toEqual({ error: 'Refused.' });
    expect(await handlers[CHANNEL.write](webEvent, dir, {})).toEqual({ error: 'Refused.' });
  });

  it('only reads and writes folders the user picked', async () => {
    expect(await handlers[CHANNEL.read](appEvent, dir)).toEqual({ error: 'Refused.' });
    expect(await handlers[CHANNEL.write](appEvent, dir, { 'gatehouse.json': '{}' })).toEqual({ error: 'Refused.' });
    expect(fs.readdirSync(dir)).toEqual([]);
    const got = await handlers[CHANNEL.pick](appEvent, 'open');
    expect(got).toMatchObject({ dir: path.resolve(dir), kind: 'empty' });
    expect(await handlers[CHANNEL.write](appEvent, got.dir, { 'gatehouse.json': '{"a":1}' })).toEqual({});
    expect(await handlers[CHANNEL.read](appEvent, got.dir)).toEqual({ map: { 'gatehouse.json': '{"a":1}' } });
    expect(await handlers[CHANNEL.read](appEvent, path.join(dir, '..'))).toEqual({ error: 'Refused.' });
  });

  it('a new project is <parent>/<name>, parents only from Browse or the default, and it is created on writing', async () => {
    expect(await handlers[CHANNEL.create](appEvent, dir, 'fresh')).toEqual({ error: 'Refused.' }); // not offered yet
    const home = await handlers[CHANNEL.home](appEvent);
    expect(home).toEqual({ dir: path.resolve(dir) });
    const got = await handlers[CHANNEL.create](appEvent, home.dir, '  fresh  ');
    expect(got).toEqual({ dir: path.join(home.dir, 'fresh'), name: 'fresh', kind: 'new' });
    expect(fs.existsSync(got.dir)).toBe(false);
    expect(await handlers[CHANNEL.write](appEvent, got.dir, { 'gatehouse.json': '{}' })).toEqual({});
    expect(fs.existsSync(path.join(dir, 'fresh', 'gatehouse.json'))).toBe(true);
    expect((await handlers[CHANNEL.create](appEvent, home.dir, 'fresh')).kind).toBe('project');
  });

  it('refuses bad names without creating anything', async () => {
    const { dir: parent } = await handlers[CHANNEL.home](appEvent);
    for (const bad of ['', '  ', '..', 'a/b', 'a\\b', 'a:b', 'nul', 'trail.', 'x'.repeat(101), 7]) {
      expect(await handlers[CHANNEL.create](appEvent, parent, bad), String(bad)).toHaveProperty('error');
    }
    expect(fs.readdirSync(dir).filter((n) => n !== 'state')).toEqual([]);
  });

  it('Browse picks a parent, remembered for the next start; a gone folder falls back to the default', async () => {
    const sub = path.join(dir, 'work');
    fs.mkdirSync(sub);
    picked = { canceled: false, filePaths: [sub] };
    expect(await handlers[CHANNEL.pick](appEvent, 'parent')).toEqual({ dir: path.resolve(sub), name: 'work' });
    expect(await handlers[CHANNEL.create](appEvent, path.resolve(sub), 'p')).toMatchObject({ kind: 'new' });
    expect(await handlers[CHANNEL.home](appEvent)).toEqual({ dir: path.resolve(sub) });
    fs.rmdirSync(sub);
    expect(await handlers[CHANNEL.home](appEvent)).toEqual({ dir: path.resolve(dir) });
  });

  it('reports a cancelled dialog, a bad mode and a bad map', async () => {
    picked = { canceled: true, filePaths: [] };
    expect(await handlers[CHANNEL.pick](appEvent, 'open')).toEqual({ cancelled: true });
    expect(await handlers[CHANNEL.pick](appEvent, 'save')).toEqual({ error: 'Refused.' });
    picked = { canceled: false, filePaths: [dir] };
    const got = await handlers[CHANNEL.pick](appEvent, 'open');
    expect(await handlers[CHANNEL.write](appEvent, got.dir, [])).toEqual({ error: 'Refused.' });
    expect(await handlers[CHANNEL.write](appEvent, got.dir, { '../x': 'y' })).toHaveProperty('error');
  });

  it('returns a message, not an exception, for a folder that is not a project', async () => {
    const got = await handlers[CHANNEL.pick](appEvent, 'open');
    expect(await handlers[CHANNEL.read](appEvent, got.dir)).toEqual({ error: expect.stringMatching(/not a Gatehouse project/) });
  });
});

describe('checkFolderName', () => {
  it('accepts ordinary names, with spaces and dots inside', () => {
    for (const ok of ['demo1', 'My project', 'v1.2 final', 'läsning']) expect(checkFolderName(ok)).toBeNull();
  });
});
