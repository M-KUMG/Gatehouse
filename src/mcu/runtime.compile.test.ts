// The board runtime with a registered (FAKE) compiler: how the program is
// chosen (compiled sketch / firmware file / nothing), the build log, and
// buildBoard (compile only).
import { afterEach, describe, expect, it } from 'vitest';
import type { BuildInput, BuildResult, Compiler } from '../build/compiler';
import { COMPILER_UNAVAILABLE_NOTE, registerCompiler } from '../build/registry';
import { EXAMPLES } from '../examples';
import { Scene } from '../model';
import { boardParts, buildInput } from '../simulation';
import { UNO_CLOCK_HZ, UNO_IO } from './avr/uno';
import type { BoardEmulator } from './board';
import { BoardRuntimes } from './runtime';

const D13 = UNO_IO.findIndex((p) => p.id === 'd13');
const IDLE_HEX = ':02000000FFCF30\n:00000001FF\n';
const BLINK_EXAMPLE = EXAMPLES.find((e) => e.name === 'Uno blink')!;

function blinkScene(): { scene: Scene; uno: Scene['parts'][number] } {
  const scene = new Scene();
  scene.insert(BLINK_EXAMPLE.state);
  return { scene, uno: scene.parts.find((p) => p.typeId === 'uno')! };
}

/** The Blink example's compiled firmware (what the fake compiler "produces"). */
const BLINK_HEX = (() => {
  const { scene, uno } = blinkScene();
  return scene.files[uno.boardId!].files['firmware.hex'];
})();

function setup(files: Record<string, string>) {
  const { scene, uno } = blinkScene();
  scene.files[uno.boardId!] = { ...scene.files[uno.boardId!], files };
  const boards = new BoardRuntimes((partId) => buildInput(scene, partId));
  boards.sync(boardParts(scene));
  return { scene, boards, id: uno.id, boardId: uno.boardId!, blinkHex: BLINK_HEX };
}

function edges(emu: BoardEmulator, seconds: number): string {
  let out = '';
  let last = emu.drives()[D13];
  const end = emu.cycles + seconds * UNO_CLOCK_HZ;
  while (emu.cycles < end) {
    for (const e of emu.run(UNO_CLOCK_HZ / 1000).events) if (e.drives[D13] !== last) out += last = e.drives[D13];
  }
  return out;
}

/** "Compiles" by returning `hex`; a sketch containing "#error" fails with structured messages. */
class FakeCompiler implements Compiler {
  readonly id = 'fake-wasm';
  readonly inputs: BuildInput[] = [];
  release: (() => void) | null = null;
  hold = false;

  constructor(public hex: string, public isAvailable = true) {}

  available(): Promise<boolean> {
    return Promise.resolve(this.isAvailable);
  }

  async build(input: BuildInput): Promise<BuildResult> {
    this.inputs.push(input);
    input.onEvent?.({ kind: 'download', download: { pack: 'compiler', loadedBytes: 50, totalBytes: 100, fromCache: false } });
    input.onEvent?.({ kind: 'download', download: { pack: 'compiler', loadedBytes: 100, totalBytes: 100, fromCache: false } });
    input.onEvent?.({ kind: 'progress', phase: 'compile', message: 'Compiling main.ino (1/1)', current: 1, total: 1 });
    if (this.hold) await new Promise<void>((r) => (this.release = r));
    if (Object.values(input.files).some((t) => t.includes('#error'))) {
      return {
        ok: false,
        errors: ['main.ino:2:2: error: #error boom', 'main.ino:3:1: error: second'],
        buildMessages: [
          { severity: 'warning', file: 'main.ino', line: 1, message: 'careful', raw: 'w' },
          { severity: 'error', file: 'main.ino', line: 2, column: 2, message: '#error boom', raw: 'e1' },
          { severity: 'error', file: 'main.ino', line: 3, column: 1, message: 'second', raw: 'e2' },
        ],
      };
    }
    return {
      ok: true, hex: this.hex, source: 'compiled', name: 'main.ino', messages: ['main.ino:1: warning: careful'],
      buildMessages: [{ severity: 'warning', file: 'main.ino', line: 1, message: 'careful', raw: 'w' }],
      size: { flashBytes: 1064, flashMax: 32256, ramBytes: 9, ramMax: 2048 },
    };
  }
}

const SKETCH = 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() {}\n';

describe('board runtime with a registered compiler', () => {
  let undo: (() => void) | null = null;
  afterEach(() => {
    undo?.();
    undo = null;
  });
  const use = (c: FakeCompiler): FakeCompiler => {
    undo = registerCompiler('uno', c);
    return c;
  };

  it('sources + available compiler: runs the COMPILED hex (not firmware.hex), build log filled', async () => {
    const { boards, id, blinkHex } = setup({ 'main.ino': SKETCH, 'firmware.hex': IDLE_HEX });
    const compiler = use(new FakeCompiler(blinkHex));
    const events: (number | null)[] = [];
    boards.buildLog.onChange((p) => events.push(p));
    await boards.runBoard(id);
    expect(compiler.inputs.length).toBe(1);
    expect(boards.boardRunState(id)).toMatchObject({ state: 'running', firmwareName: 'main.ino', building: false, messages: ['main.ino:1: warning: careful'] });
    expect(edges(boards.get(id)!.emulator!, 1.1)).toBe('LHL'); // Blink, not the idle firmware.hex
    const log = boards.buildLog.get(id);
    expect(log).toMatchObject({
      status: 'succeeded', source: 'compiled', flashBytes: 1064, flashMax: 32256, ramBytes: 9, ramMax: 2048,
      summary: 'Compiled main.ino: 1064 bytes of flash (3%), 9 bytes of RAM (0%).',
      downloads: [{ pack: 'compiler', loadedBytes: 100, totalBytes: 100, fromCache: false }],
      messages: [{ severity: 'warning', message: 'careful' }],
    });
    expect(log.durationMs).toBeGreaterThanOrEqual(0);
    expect(log.finishedAt! >= log.startedAt!).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events.every((p) => p === id)).toBe(true);
  });

  it('the log shows downloading, then building, while the build runs', async () => {
    const { boards, id, blinkHex } = setup({ 'main.ino': SKETCH });
    const compiler = use(new FakeCompiler(blinkHex));
    compiler.hold = true;
    const statuses: string[] = [];
    boards.buildLog.onChange(() => statuses.push(boards.buildLog.get(id).status));
    const run = boards.runBoard(id);
    await new Promise((r) => setTimeout(r, 0));
    expect(boards.buildLog.get(id).progress).toEqual({ phase: 'compile', message: 'Compiling main.ino (1/1)', current: 1, total: 1 });
    expect(boards.boardRunState(id).building).toBe(true);
    compiler.release!();
    await run;
    expect(statuses).toEqual(['building', 'downloading', 'downloading', 'building', 'succeeded']);
  });

  it('compile errors: error state with a short text, all messages in the log, NO fall back to firmware.hex', async () => {
    const { boards, id, blinkHex } = setup({ 'main.ino': '#error boom\n', 'firmware.hex': BLINK_HEX });
    use(new FakeCompiler(blinkHex));
    await boards.runBoard(id);
    const s = boards.boardRunState(id);
    expect(s.state).toBe('error');
    expect(s.error).toBe('Build failed: main.ino:2:2: error: #error boom (and 1 more error, see the build output)');
    expect(boards.get(id)!.emulator).toBeNull();
    expect(boards.anyRunning).toBe(false);
    expect(boards.buildLog.get(id)).toMatchObject({ status: 'failed', source: 'compiled', summary: 'Build failed: 2 errors.' });
    expect(boards.buildLog.get(id).messages.map((m) => m.raw)).toEqual(['w', 'e1', 'e2']);
  });

  it('no sources + firmware.hex: the firmware file, the compiler is not asked', async () => {
    const { boards, id } = setup({ 'firmware.hex': BLINK_HEX, 'notes.txt': 'hi' });
    const compiler = use(new FakeCompiler(IDLE_HEX));
    await boards.runBoard(id);
    expect(compiler.inputs.length).toBe(0);
    expect(boards.boardRunState(id)).toMatchObject({ state: 'running', firmwareName: 'firmware.hex', messages: [] });
    expect(boards.buildLog.get(id)).toMatchObject({ status: 'succeeded', source: 'firmware-file', summary: 'Running firmware.hex (not compiled).' });
  });

  it('sources + unavailable compiler + firmware.hex: the firmware file with the note', async () => {
    const { boards, id } = setup({ 'main.ino': SKETCH, 'firmware.hex': BLINK_HEX });
    const compiler = use(new FakeCompiler(IDLE_HEX, false));
    await boards.runBoard(id);
    expect(compiler.inputs.length).toBe(0);
    expect(boards.boardRunState(id)).toMatchObject({ state: 'running', firmwareName: 'firmware.hex', messages: [COMPILER_UNAVAILABLE_NOTE] });
    expect(boards.buildLog.get(id)).toMatchObject({ status: 'succeeded', source: 'firmware-file', messages: [{ severity: 'note', message: COMPILER_UNAVAILABLE_NOTE }] });
  });

  it('nothing to run: the "No firmware" error (with the note when sources could not be compiled)', async () => {
    const { boards, id } = setup({ 'readme.md': '# hi' });
    use(new FakeCompiler(IDLE_HEX));
    await boards.runBoard(id);
    expect(boards.boardRunState(id).error).toMatch(/^No firmware/);
    expect(boards.buildLog.get(id).status).toBe('failed');
    const other = setup({ 'main.ino': SKETCH });
    undo?.();
    use(new FakeCompiler(IDLE_HEX, false));
    await other.boards.runBoard(other.id);
    expect(other.boards.boardRunState(other.id).error).toMatch(/^No firmware[^]*\nSketch files are not compiled: compiler files not available here/);
  });

  it('buildBoard compiles only: the board is not started, a running board keeps running', async () => {
    const { scene, boardId, boards, id, blinkHex } = setup({ 'main.ino': SKETCH });
    const compiler = use(new FakeCompiler(blinkHex));
    const build = boards.buildBoard(id);
    expect(boards.boardRunState(id)).toMatchObject({ state: 'stopped', building: true });
    await build;
    expect(boards.boardRunState(id)).toMatchObject({ state: 'stopped', building: false, firmwareName: null });
    expect(boards.get(id)!.emulator).toBeNull();
    expect(boards.buildLog.get(id).status).toBe('succeeded');
    await boards.runBoard(id);
    const emu = boards.get(id)!.emulator!;
    await boards.buildBoard(id);
    expect(boards.boardRunState(id).state).toBe('running');
    expect(boards.get(id)!.emulator).toBe(emu);
    expect(compiler.inputs.length).toBe(3);
    // A failing buildBoard does not stop it either; the errors are in the log.
    scene.files[boardId] = { ...scene.files[boardId], files: { 'main.ino': '#error boom\n' } };
    await boards.buildBoard(id);
    expect(boards.boardRunState(id)).toMatchObject({ state: 'running', building: false });
    expect(boards.boardRunState(id).error).toBeUndefined();
    expect(boards.get(id)!.emulator).toBe(emu);
    expect(boards.buildLog.get(id)).toMatchObject({ status: 'failed', summary: 'Build failed: 2 errors.' });
  });

  it('a Run during buildBoard overtakes it; the stale result is dropped', async () => {
    const { boards, id, blinkHex } = setup({ 'main.ino': SKETCH });
    const compiler = use(new FakeCompiler(blinkHex));
    compiler.hold = true;
    const build = boards.buildBoard(id);
    await new Promise((r) => setTimeout(r, 0));
    const firstRelease = compiler.release!;
    const run = boards.runBoard(id);
    await new Promise((r) => setTimeout(r, 0));
    compiler.release!();
    firstRelease();
    await Promise.all([build, run]);
    expect(boards.boardRunState(id)).toMatchObject({ state: 'running', building: false });
    expect(boards.buildLog.get(id).status).toBe('succeeded');
  });

  it('the build log goes with the board (deleted) and with clear()', async () => {
    const { scene, boards, id, blinkHex } = setup({ 'main.ino': SKETCH });
    use(new FakeCompiler(blinkHex));
    await boards.buildBoard(id);
    expect(boards.buildLog.boards()).toEqual([id]);
    const seen: (number | null)[] = [];
    boards.buildLog.onChange((p) => seen.push(p));
    scene.remove(id);
    boards.sync(boardParts(scene));
    expect(boards.buildLog.boards()).toEqual([]);
    expect(boards.buildLog.get(id).status).toBe('idle');
    expect(seen).toEqual([id]);
    const again = setup({ 'main.ino': SKETCH });
    await again.boards.buildBoard(again.id);
    again.boards.clear();
    expect(again.boards.buildLog.boards()).toEqual([]);
  });
});
