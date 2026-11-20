import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Text that was saved with the wrong encoding shows up as "Î©" instead of
// "Ω" or "â’" instead of "−". Such sequences never belong in our sources.
const MOJIBAKE = /[\u00c2\u00c3\u00ce\u00cf\u00d0\u00d1\u00e2][\u0080-\u00bf\u0192\u02c6\u02dc\u2018-\u203a\u20ac\u2122\u0152\u0153\u0160\u0161\u0178\u017d\u017e]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'fixtures' ? [] : files(path);
    return /\.(ts|css|html)$/.test(name) ? [path] : [];
  });
}

describe('source files are valid UTF-8 text', () => {
  it('contain no mis-decoded characters', () => {
    const bad: string[] = [];
    for (const file of [...files('src'), 'index.html']) {
      if (file.endsWith('encoding.test.ts')) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (MOJIBAKE.test(line)) bad.push(`${file}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
