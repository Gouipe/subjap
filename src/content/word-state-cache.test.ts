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

  it("clears all cached states", async () => {
    const load = vi.fn((lemma: string) =>
      Promise.resolve<WordState>({
        key: lemma,
        status: "known",
        source: "import",
      }),
    );
    const cache = new WordStateCache(load);

    await cache.get("食べる");
    cache.clear();
    await cache.get("食べる");

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("passes lexical aliases to the loader while caching by canonical lemma", async () => {
    const load = vi.fn((_lemma: string, _aliases?: string[]) =>
      Promise.resolve<WordState | null>({
        key: "いろんな",
        status: "known",
        source: "import",
      }),
    );
    const cache = new WordStateCache(load);

    await expect(cache.get("色んな", ["色んな", "いろんな"])).resolves.toMatchObject({
      status: "known",
    });
    expect(load).toHaveBeenCalledWith("色んな", ["色んな", "いろんな"]);
  });

  it("bounds the number of cached promise entries", async () => {
    const load = vi.fn((lemma: string) =>
      Promise.resolve<WordState>({
        key: lemma,
        status: "known",
        source: "import",
      }),
    );
    const cache = new WordStateCache(load, 2);

    await cache.get("一");
    await cache.get("二");
    await cache.get("三");
    await cache.get("一");

    expect(load).toHaveBeenCalledTimes(4);
  });
});
