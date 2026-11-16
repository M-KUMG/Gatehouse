// Current carried by each link (wire). Wires are ideal, so inside one net
// the split between parallel paths is not defined; a link that is part of a
// loop of links reports 0. Every other link has exactly one possible value.

import { terminalKey } from './nets';
import type { SimInput, SimResult } from './types';

/** Amps flowing from links[i][0] to links[i][1], per link. */
export function linkCurrents(input: SimInput, result: SimResult): number[] {
  const flows = new Array<number>(input.links.length).fill(0);
  // Amps each terminal still has to receive from its links (what flows on into the part).
  const demand = new Map<string, number>();
  const edges = new Map<string, Set<number>>();
  const ends = input.links.map(([a, b]) => [terminalKey(a), terminalKey(b)] as const);

  ends.forEach(([a, b], i) => {
    if (a === b) return;
    for (const key of [a, b]) {
      let set = edges.get(key);
      if (!set) edges.set(key, (set = new Set()));
      set.add(i);
    }
  });
  for (const key of edges.keys()) {
    const sep = key.indexOf(':');
    const part = result.parts[Number(key.slice(0, sep))];
    demand.set(key, part?.pins[key.slice(sep + 1)] ?? 0);
  }

  // Peel off terminals with a single remaining link: that link must carry all they need.
  const queue = [...edges.keys()].filter((k) => edges.get(k)?.size === 1);
  while (queue.length > 0) {
    const leaf = queue.pop() as string;
    const set = edges.get(leaf);
    if (!set || set.size !== 1) continue;
    const [i] = set;
    const [a, b] = ends[i];
    const other = leaf === a ? b : a;
    const amps = demand.get(leaf) ?? 0;
    flows[i] = leaf === b ? amps : -amps;
    demand.set(other, (demand.get(other) ?? 0) + amps);
    set.clear();
    const rest = edges.get(other);
    rest?.delete(i);
    if (rest?.size === 1) queue.push(other);
  }
  return flows;
}
