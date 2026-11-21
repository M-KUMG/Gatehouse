import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPHICS, GRAPHICS_MODES, graphicsMode, initialGraphics, onGraphicsChange, parseGraphics, setGraphics } from './graphics';

describe('graphics setting', () => {
  it('knows its modes and rejects anything else', () => {
    expect(GRAPHICS_MODES.map((m) => m.id)).toEqual(['glass', 'solid']);
    expect(parseGraphics('solid')).toBe('solid');
    expect(parseGraphics('glass')).toBe('glass');
    expect(parseGraphics('neon')).toBeNull();
    expect(parseGraphics(null)).toBeNull();
    expect(parseGraphics(3)).toBeNull();
  });

  it('starts with the saved look; without one, solid only when the system asks for less transparency', () => {
    expect(initialGraphics('solid', false)).toBe('solid');
    expect(initialGraphics('glass', true)).toBe('glass'); // the saved choice wins
    expect(initialGraphics(null, false)).toBe(DEFAULT_GRAPHICS);
    expect(initialGraphics(null, true)).toBe('solid');
    expect(initialGraphics('junk', false)).toBe(DEFAULT_GRAPHICS);
  });

  it('switching tells the listeners once, and not when nothing changes (no DOM or storage needed)', () => {
    const seen: string[] = [];
    const off = onGraphicsChange((m) => seen.push(m));
    setGraphics('solid');
    setGraphics('solid');
    expect(graphicsMode()).toBe('solid');
    setGraphics('glass');
    off();
    setGraphics('solid');
    expect(seen).toEqual(['solid', 'glass']);
    setGraphics('glass');
  });
});
