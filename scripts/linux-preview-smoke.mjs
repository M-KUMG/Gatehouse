import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [executable, profile] = process.argv.slice(2);
const port = 9222;
const app = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const errors = [];
app.stderr.setEncoding('utf8').on('data', (chunk) => errors.push(chunk));
app.stdout.resume();
let socket;

async function until(description, check, timeoutMs = 25_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (app.exitCode !== null || app.signalCode !== null) throw new Error('Gatehouse exited before ' + description);
    const result = await check();
    if (result) return result;
    await delay(150);
  }
  throw new Error('Timed out waiting for ' + description);
}

try {
  const page = await until('the packaged Electron window', async () => {
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })
      .then((response) => response.json()).catch(() => []);
    return pages.find((entry) => entry.type === 'page' && entry.url.startsWith('gatehouse://app/'));
  });
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  async function evaluate(fn, ...args) {
    const id = ++nextId;
    const params = {
      expression: `(${fn})(${args.map((arg) => JSON.stringify(arg)).join(',')})`,
      returnByValue: true,
      awaitPromise: true,
    };
    const response = await new Promise((resolve) => {
      function receive({ data }) {
        const message = JSON.parse(data);
        if (message.id !== id) return;
        socket.removeEventListener('message', receive);
        resolve(message.result);
      }
      socket.addEventListener('message', receive);
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params }));
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  }
  const click = (selector, prefix = '') => until(prefix || selector, () => evaluate((selector, prefix) => {
    const item = [...document.querySelectorAll(selector)].find((element) =>
      element.getClientRects().length && !element.disabled && element.textContent.trim().startsWith(prefix));
    if (!item) return false;
    item.click();
    return true;
  }, selector, prefix));
  async function menu(prefix) {
    await click('.file-menu > button');
    await click('.file-menu-list .file-menu-item', prefix);
  }

  await until('the circuit editor', () => evaluate(() => !!document.querySelector('.palette-search-input')));
  assert.equal(await evaluate(() => !!window.gatehouseHost), true);
  console.log('Packaged desktop window opened.');

  const relay = await evaluate(async () => {
    const data = await (await fetch('part-library/relays.json')).json();
    return data.find((preset) => preset.name === 'G5LE-1 DC12')?.settings.coilOhms;
  });
  assert.equal(relay, 360);
  console.log('Bundled relay catalog loaded without network access.');

  await click('.welcome-action', 'Run the blinking board');
  if (!await evaluate(() => !!document.querySelector('.build-output')?.getClientRects().length)) {
    await click('.windows-menu:not(.file-menu) > button', 'Windows');
    await click('.windows-menu:not(.file-menu) .windows-menu-item', 'Build output');
  }
  await until('the Uno in Build output', () => evaluate(() => {
    const select = document.querySelector('.bo-select');
    const board = [...(select?.options ?? [])].find((option) => option.value !== 'auto' && /Uno/.test(option.textContent));
    if (!board) return false;
    select.value = board.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }));
  await click('.bo-button', 'Build');
  const built = await until('an offline build of the Uno sketch', () => evaluate(() => {
    const text = document.querySelector('.bo-header-text')?.textContent ?? '';
    if (/^(Build failed|Could not)/.test(text)) throw new Error(text + ' ' + document.querySelector('.bo-list')?.textContent);
    const usage = document.querySelector('.bo-usage')?.textContent ?? '';
    return /^Build succeeded/.test(text) && /Flash.*\d/.test(usage) && `${text}. ${usage}`;
  }), 90_000);
  console.log(built);

  await menu('Save');
  const name = 'Linux Preview Smoke';
  const path = await until('the project save dialog', () => evaluate((name) => {
    const form = document.querySelector('.save-dialog');
    if (!form) return false;
    const input = form.querySelector('input:not([readonly])');
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    return form.querySelector('input[readonly]').value;
  }, name));
  const folder = join(path, name);
  const manifest = join(folder, 'gatehouse.json');
  await until('the project and sketch on disk', () =>
    existsSync(manifest) && existsSync(join(folder, 'boards', 'uno-1', 'main.ino')));
  const saved = JSON.parse(readFileSync(manifest, 'utf8'));
  assert(saved.parts.some((part) => part.typeId === 'uno'));
  await until('the project marked saved', () => evaluate((name) => document.querySelector('.project-name')?.textContent === name, name));
  console.log('Saved the circuit and sketch to a project folder.');

  await menu('New project');
  await until('the new project', () => evaluate(() => document.querySelector('.project-name')?.textContent === 'Untitled'));
  await menu('Open project folder');
  const dialog = await until('the Linux folder picker', () => {
    try {
      return execFileSync('xdotool', ['search', '--onlyvisible', '--name', '^Open project folder$'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0];
    } catch {
      return false;
    }
  });
  await delay(500);
  execFileSync('xdotool', ['windowactivate', '--sync', dialog], { timeout: 5000 });
  execFileSync('xdotool', ['key', '--clearmodifiers', 'ctrl+l']);
  await delay(400);
  execFileSync('xdotool', ['key', '--clearmodifiers', 'ctrl+a']);
  execFileSync('xdotool', ['type', '--clearmodifiers', folder]);
  await delay(300);
  execFileSync('xdotool', ['key', 'Return']);
  await delay(1000);
  const activeWindow = execFileSync('xdotool', ['getactivewindow'], { encoding: 'utf8' }).trim();
  if (activeWindow === dialog) execFileSync('xdotool', ['key', 'Return']);
  await until('the reopened Uno project', () => evaluate((name) =>
    document.querySelector('.project-name')?.textContent === name && !!document.querySelector('.fx-row.k-board'), name));
  console.log('Reopened the saved project through the Linux folder picker.');
} catch (error) {
  console.error(errors.join('').slice(-12000));
  throw error;
} finally {
  socket?.close();
  app.kill();
}
