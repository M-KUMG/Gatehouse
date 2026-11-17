import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../examples';
import { Scene } from '../model';
import { boardParts, buildInput } from '../simulation';
import { UNO_CLOCK_HZ, UNO_IO } from './avr/uno';
import type { BoardEmulator } from './board';
import { BoardRuntimes } from './runtime';

const D13 = UNO_IO.findIndex((p) => p.id === 'd13');
/** rjmp to itself: a program that never touches a pin. */
const IDLE_HEX = ':02000000FFCF30\n:00000001FF\n';

function setup(example = true): { scene: Scene; boards: BoardRuntimes; id: number; boardId: string } {
  const scene = new Scene();
  if (example) scene.insert(EXAMPLES.find((e) => e.name === 'Uno blink')!.state);
  else scene.add({ typeId: 'uno', col: 0, row: 0, rotation: 0 });
  const boards = new BoardRuntimes((partId) => buildInput(scene, partId));
  boards.sync(boardParts(scene));
  const uno = scene.parts.find((p) => p.typeId === 'uno')!;
  return { scene, boards, id: uno.id, boardId: uno.boardId! };
}

/** Run an emulator for `seconds`; pin 13's changes in seconds since its reset. */
function edges(emu: BoardEmulator, seconds: number): { t: number; level: string }[] {
  const out: { t: number; level: string }[] = [];
  let last = emu.drives()[D13];
  const end = emu.cycles + seconds * UNO_CLOCK_HZ;
  while (emu.cycles < end) {
    for (const e of emu.run(UNO_CLOCK_HZ / 1000).events) {
      if (e.drives[D13] !== last) out.push({ t: e.cycle / UNO_CLOCK_HZ, level: (last = e.drives[D13]) });
    }
  }
  return out;
}

describe('board runtime: program from the board files', () => {
  it('a new board (only main.ino) cannot run: error state with the "no firmware" message', async () => {
    const { boards, id } = setup(false);
    expect(boards.boardRunState(id)).toEqual({ state: 'stopped', time: 0, speed: 0, firmwareName: null, messages: [], building: false });
    let changes = 0;
    boards.onChange(() => changes++);
    const run = boards.runBoard(id);
    expect(boards.boardRunState(id).building).toBe(true);
    await run;
    const s = boards.boardRunState(id);
    expect(s.state).toBe('error');
    expect(s.error).toMatch(/^No firmware/);
    expect(s.building).toBe(false);
    expect(boards.get(id)!.emulator).toBeNull();
    expect(boards.anyRunning).toBe(false);
    expect(changes).toBeGreaterThanOrEqual(2); // build started, build done
  });

  it('runs firmware.hex: pin 13 toggles at the Blink times, with the build messages', async () => {
    const { boards, id } = setup();
    await boards.runBoard(id);
    const s = boards.boardRunState(id);
    expect(s).toMatchObject({ state: 'running', firmwareName: 'firmware.hex', messages: ['Sketch files are not compiled yet: running firmware.hex'] });
    expect(s.error).toBeUndefined();
    expect(boards.anyRunning).toBe(true);
    const e = edges(boards.get(id)!.emulator!, 2.1);
    expect(e.map((x) => x.level).join('')).toBe('LHLH'); // low at pinMode, then every second from ~20 ms
    expect(e[1].t).toBeGreaterThan(0.015);
    expect(e[1].t).toBeLessThan(0.03);
    expect(e[2].t - e[1].t).toBeCloseTo(1, 2);
    expect(boards.boardRunState(id).time).toBeCloseTo(2.1, 2);
  });

  it('pause and continue keep the same emulator, even when the files change', async () => {
    const { scene, boards, id, boardId } = setup();
    await boards.runBoard(id);
    const emu = boards.get(id)!.emulator!;
    emu.run(UNO_CLOCK_HZ / 10);
    boards.pauseBoard(id);
    expect(boards.boardRunState(id).state).toBe('paused');
    scene.files[boardId] = { ...scene.files[boardId], files: { ...scene.files[boardId].files, 'firmware.hex': IDLE_HEX } };
    await boards.runBoard(id);
    expect(boards.get(id)!.emulator).toBe(emu);
    expect(boards.boardRunState(id).state).toBe('running');
    expect(boards.boardRunState(id).time).toBeCloseTo(0.1, 3);
  });

  it('Reset rebuilds from the changed firmware, starts from zero, stopped, serial cleared', async () => {
    const { scene, boards, id, boardId } = setup();
    await boards.runBoard(id);
    boards.addSerial(id, { usart0: [65] });
    expect(edges(boards.get(id)!.emulator!, 0.1).length).toBeGreaterThan(0);
    scene.files[boardId] = { ...scene.files[boardId], files: { ...scene.files[boardId].files, 'firmware.hex': IDLE_HEX } };
    await boards.resetBoard(id);
    expect(boards.boardRunState(id)).toMatchObject({ state: 'stopped', time: 0, firmwareName: 'firmware.hex' });
    expect(boards.serial.get(id, 'usart0')).toBeUndefined();
    expect(boards.anyRunning).toBe(false);
    await boards.runBoard(id);
    expect(edges(boards.get(id)!.emulator!, 0.1)).toEqual([]); // the idle program: pin 13 untouched
  });

  it('a broken firmware file is an error state, not a crash; fixing it and pressing Run works', async () => {
    const { scene, boards, id, boardId } = setup();
    const good = scene.files[boardId].files['firmware.hex'];
    scene.files[boardId] = { ...scene.files[boardId], files: { ...scene.files[boardId].files, 'firmware.hex': 'hello' } };
    await boards.runBoard(id);
    expect(boards.boardRunState(id).state).toBe('error');
    expect(boards.boardRunState(id).error).toMatch(/^firmware\.hex is not a valid program/);
    scene.files[boardId] = { ...scene.files[boardId], files: { ...scene.files[boardId].files, 'firmware.hex': good } };
    await boards.runBoard(id);
    expect(boards.boardRunState(id).state).toBe('running');
  });

  it('a build overtaken by Reset or by removing the board is dropped', async () => {
    const { scene, boards, id } = setup();
    const run = boards.runBoard(id);
    const reset = boards.resetBoard(id);
    await Promise.all([run, reset]);
    expect(boards.boardRunState(id).state).toBe('stopped'); // Reset won
    const again = boards.runBoard(id);
    scene.remove(id);
    boards.sync(boardParts(scene));
    await again;
    expect(boards.get(id)).toBeUndefined();
  });
});
