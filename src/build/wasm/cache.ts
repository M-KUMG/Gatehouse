// Compiled-object cache for the browser compiler: one entry per translation
// unit, keyed by a content hash of everything that affects the object. The
// in-memory cache lives as long as the compiler; a persistent one (IndexedDB,
// Cache Storage) can implement the same interface later. Pure.

export interface CachedObject {
  /** The assembled object file. */
  object: Uint8Array;
  /** The compiler's stderr when it was built (its warnings are shown again on a cache hit). */
  stderr: string;
}

export interface ObjectCache {
  get(key: string): CachedObject | undefined | Promise<CachedObject | undefined>;
  set(key: string, value: CachedObject): void | Promise<void>;
}

/** An in-memory cache keeping the most recently used `limit` objects. */
export class MemoryObjectCache implements ObjectCache {
  private readonly entries = new Map<string, CachedObject>();

  constructor(private readonly limit = 256) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string): CachedObject | undefined {
    const v = this.entries.get(key);
    if (v) {
      this.entries.delete(key);
      this.entries.set(key, v);
    }
    return v;
  }

  set(key: string, value: CachedObject): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value as string);
  }
}

/** SHA-256 (hex) of the parts, each length-prefixed so different splits never collide. */
export async function contentHash(parts: readonly string[]): Promise<string> {
  const text = parts.map((p) => `${p.length}:${p}`).join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
