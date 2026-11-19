import { describe, expect, it } from 'vitest';
import { NANO_LEFT, NANO_RIGHT } from '../../art/nano';
import { PARTS, boardLabel, getPart } from '../../parts';
import { boardSlug, isBoardType, nextBoardId } from '../../project/boardid';
import { parseIntelHex } from '../hex';
import { BLINK_HEX } from '../programs/blink';
import { NANO_SPEC, UNO_CLOCK_HZ, UNO_IO, UNO_SPEC } from './uno';

describe('Arduino Nano part', () => {
  const nano = getPart('nano')!;
  const uno = getPart('uno')!;

  it('is registered next to the Uno with the same board settings', () => {
    expect(nano.name).toBe('Arduino Nano');
    const ids = PARTS.map((p) => p.id);
    expect(ids.indexOf('nano')).toBe(ids.indexOf('uno') + 1);
    expect(isBoardType('nano')).toBe(true);
    expect(nano.sourceExtensions).toEqual(uno.sourceExtensions);
    expect(nano.resetButton).toBeDefined();
    expect(nano.overlay).toBeDefined();
  });

  it('has unique pins on grid points, 0.1 inch apart, rows 6 cells apart', () => {
    const ids = nano.pins.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of nano.pins) {
      expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
      expect(p.x >= 0 && p.x <= nano.cols && p.y >= 0 && p.y <= nano.rows).toBe(true);
    }
    expect(NANO_LEFT).toHaveLength(15);
    expect(NANO_RIGHT).toHaveLength(15);
    expect(NANO_RIGHT[0].x - NANO_LEFT[0].x).toBe(6);
    expect(NANO_LEFT.map((p) => p.y)).toEqual(NANO_RIGHT.map((p) => p.y));
    for (const id of [...UNO_IO.map((p) => p.id), '5v', '3v3', 'gnd', 'vin', 'aref']) expect(ids, id).toContain(id);
  });

  it('links its two ground pins, and only existing pins', () => {
    const ids = nano.pins.map((p) => p.id);
    expect(nano.links).toEqual([['gnd', 'gnd2']]);
    for (const [a, b] of nano.links ?? []) expect([ids.includes(a), ids.includes(b)]).toEqual([true, true]);
  });

  it('names boards nano-N and "Arduino Nano #N"', () => {
    expect(boardSlug('nano')).toBe('nano');
    expect(nextBoardId({}, 'nano')).toBe('nano-1');
    expect(boardLabel({ typeId: 'nano', boardId: 'nano-3' })).toBe('Arduino Nano #3');
  });

  it('runs Blink like the Uno through NANO_SPEC, and leaves UNO_SPEC alone', () => {
    expect(NANO_SPEC.io).toBe(UNO_SPEC.io);
    expect(NANO_SPEC.serialPorts).toEqual([{ id: 'usart0', name: 'Serial (USART0)' }]);
    const board = NANO_SPEC.create(parseIntelHex(BLINK_HEX, NANO_SPEC.flashBytes).bytes);
    const d13 = NANO_SPEC.io.findIndex((p) => p.id === 'd13');
    const levels: string[] = [];
    for (let i = 0; i < 2100; i++) {
      for (const e of board.run(UNO_CLOCK_HZ / 1000).events) {
        if (levels[levels.length - 1] !== e.drives[d13]) levels.push(e.drives[d13]);
      }
    }
    expect(levels.join('')).toBe('LHLH');
  });
});
