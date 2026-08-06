// ---------------------------------------------------------------------------
// LRU (Least Recently Used) cache — generic, reusable, bounded.
// ---------------------------------------------------------------------------

/**
 * Generic LRU cache backed by a Map (which preserves insertion order in JS).
 *
 * - `get` moves the accessed key to the end ("most recently used").
 * - `set` inserts-or-updates, evicting the least recently used entry when
 *   the cache exceeds `maxSize`.
 * - `has` checks membership **without** affecting recency order.
 * - `clear` empties the cache.
 */
export class LRUCache<K, V> {
  private readonly maxSize: number;
  private readonly map: Map<K, V>;

  constructor(maxSize: number) {
    if (maxSize < 1) {
      throw new Error(`LRUCache maxSize must be >= 1, got ${maxSize}`);
    }
    this.maxSize = maxSize;
    this.map = new Map();
  }

  /** Retrieve a value by key, marking it as most-recently used. */
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;

    // Re-insert to move to the tail (most-recently used).
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /** Insert or update a value. Evicts LRU entry when over capacity. */
  set(key: K, value: V): void {
    // If key already exists, delete so the fresh set goes to the tail.
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict the least-recently used (first) entry.
      const lruKey = this.map.keys().next().value as K;
      this.map.delete(lruKey);
    }
    this.map.set(key, value);
  }

  /** Check whether a key exists **without** affecting recency. */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Remove all entries. */
  clear(): void {
    this.map.clear();
  }

  /** Current number of entries (read-only convenience). */
  get size(): number {
    return this.map.size;
  }
}
