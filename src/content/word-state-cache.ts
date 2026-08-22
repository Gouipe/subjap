import type { WordState } from "@/core/types";

export class WordStateCache {
  private readonly promises = new Map<string, Promise<WordState | null>>();

  constructor(
    private readonly load: (lemma: string) => Promise<WordState | null>,
  ) {}

  get(lemma: string): Promise<WordState | null> {
    const cached = this.promises.get(lemma);
    if (cached) return cached;

    const promise = this.load(lemma);
    this.promises.set(lemma, promise);
    return promise;
  }

  invalidate(lemma: string): void {
    this.promises.delete(lemma);
  }

  clear(): void {
    this.promises.clear();
  }
}
