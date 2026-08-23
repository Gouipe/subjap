import type { WordState } from "@/core/types";

export class WordStateCache {
  private readonly promises = new Map<
    string,
    { lemma: string; promise: Promise<WordState | null> }
  >();

  constructor(
    private readonly load: (lemma: string, aliases?: string[]) => Promise<WordState | null>,
    private readonly maxEntries = 1_000,
  ) {}

  get(lemma: string, aliases?: string[]): Promise<WordState | null> {
    const cacheKey = [lemma, ...(aliases ?? [])].join("\u0000");
    const cached = this.promises.get(cacheKey);
    if (cached) return cached.promise;

    const promise = this.load(lemma, aliases);
    if (this.promises.size >= this.maxEntries) {
      const oldestKey = this.promises.keys().next().value;
      if (oldestKey !== undefined) this.promises.delete(oldestKey);
    }
    this.promises.set(cacheKey, { lemma, promise });
    return promise;
  }

  invalidate(lemma: string): void {
    for (const [cacheKey, entry] of this.promises) {
      if (entry.lemma === lemma) this.promises.delete(cacheKey);
    }
  }

  clear(): void {
    this.promises.clear();
  }
}
