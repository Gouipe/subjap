// ---------------------------------------------------------------------------
// SubJap — LRU cache tests
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { LRUCache } from "@/tokenizer/lru-cache";

describe("LRUCache", () => {
  it("stores and retrieves values", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts the least recently used entry when full", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4); // evicts "a"
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(3);
  });

  it("promotes accessed keys to most-recently used", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.get("a"); // "a" becomes MRU
    cache.set("d", 4); // evicts "b"
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
  });

  it("updates in place without changing size", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(2);
  });

  it("has() does not affect recency", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.has("a");
    cache.set("c", 3); // evicts "a" (not promoted by has)
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });

  it("clear() empties the cache", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  it("rejects invalid capacities", () => {
    expect(() => new LRUCache<string, number>(0)).toThrow();
    expect(() => new LRUCache<string, number>(-1)).toThrow();
  });
});
