// Incremental decoding of a bus (I2C, SPI) over growing traces: update() reads
// only what is new, so a long run costs the same per frame as a short one (the
// same idea as UartStream). A decoder may hand back the items of a transfer that
// is still going on; those start at or after its `next` and are read again from
// there next time, so they are replaced, not repeated.

import type { Annotation, LogicSignal, ProtocolDecoder } from './decoders';

export interface BusSource {
  /** The lines in the decoder's order (a line that is not connected is null). */
  signals: readonly (LogicSignal | null)[];
  /** Changes whenever any of the traces was cleared. */
  generation: number;
}

export class BusStream<Settings, Item extends Annotation> {
  /** Every item in the kept data, in time order (the last ones may belong to a transfer still open). */
  items: Item[] = [];
  private generation = -1;
  private settingsKey = '';
  private next = -Infinity;

  constructor(private readonly decoder: ProtocolDecoder<Settings, Item>) {}

  /** Bring the items up to date. True when they changed. */
  update(source: BusSource, settings: Settings): boolean {
    const key = JSON.stringify(settings);
    let changed = false;
    if (source.generation !== this.generation || key !== this.settingsKey) {
      this.generation = source.generation;
      this.settingsKey = key;
      this.items = [];
      this.next = -Infinity;
      changed = true;
    }
    const known = source.signals.filter((s): s is LogicSignal => s !== null);
    if (known.length === 0) return changed;
    // Items that ended before the oldest kept edge go (the recorder drops old edges).
    const oldest = Math.min(...known.map((s) => s.start));
    if (this.items.length > 0 && this.items[0].end < oldest) {
      const keep = this.items.findIndex((i) => i.end >= oldest);
      this.items = keep < 0 ? [] : this.items.slice(keep);
      changed = true;
    }
    const horizon = Math.min(...known.map((s) => s.end));
    if (!(horizon > this.next)) return changed;
    const fresh = this.decoder.decode(source.signals, settings, this.next, horizon);
    // What was provisional last time is read again from `next`.
    const before = this.items.length;
    let cut = this.items.length;
    while (cut > 0 && this.items[cut - 1].start >= this.next) cut--;
    this.items.length = cut;
    for (const item of fresh.items) this.items.push(item);
    this.next = fresh.next;
    return changed || cut !== before || fresh.items.length > 0;
  }
}
