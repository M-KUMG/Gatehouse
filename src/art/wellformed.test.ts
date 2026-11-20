import { describe, expect, it } from 'vitest';
import { PARTS } from '../parts';

// An SVG with a duplicate attribute on one element is invalid XML: the browser
// refuses to draw the image at all (the part then has no picture).
describe('part artwork is well-formed', () => {
  for (const part of PARTS) {
    it(`${part.id}: no duplicate attributes, balanced tags`, () => {
      for (const tag of part.svg.match(/<[^>]+>/g) ?? []) {
        const attrs = [...tag.matchAll(/\s([a-zA-Z:-]+)="/g)].map((m) => m[1]);
        expect(new Set(attrs).size, tag).toBe(attrs.length);
      }
      const opens = (part.svg.match(/<[a-zA-Z][^>]*[^/]>/g) ?? []).length;
      const closes = (part.svg.match(/<\/[a-zA-Z]+>/g) ?? []).length;
      expect(opens, 'opening tags without a matching closing tag').toBe(closes);
    });
  }
});
