import { describe, expect, it, vi } from "vitest";
import type { WordState } from "@/core/types";
import { WordStateCache } from "@/content/word-state-cache";

describe("WordStateCache", () => {
  it("reloads a lemma after it is invalidated", async () => {
    let state: WordState | null = null;
    const load = vi.fn(() => Promise.resolve(state));
    const cache = new WordStateCache(load);

    await expect(cache.get("食べる")).resolves.toBeNull();

    state = {
      key: "食べる",
      status: "known",
      source: "manual",
    };
    cache.invalidate("食べる");

    await expect(cache.get("食べる")).resolves.toEqual(state);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
