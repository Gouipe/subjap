// ---------------------------------------------------------------------------
// SubJap — dictionary in-memory index tests (lemma → entry mapping)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { loadDictionary, lookup, entryCount } from "@/dictionary";
import type { DictionaryEntry } from "@/core/types";

function entry(
  headword: string,
  reading: string,
  glosses: string[] = ["definition"],
): DictionaryEntry {
  return {
    headword,
    reading,
    partOfSpeech: ["noun"],
    senses: [{ glosses }],
    common: true,
  };
}

const ENTRIES: DictionaryEntry[] = [
  entry("食べる", "たべる", ["to eat"]),
  entry("食べ物", "たべもの", ["food"]),
  entry("行く", "いく", ["to go"]),
];

describe("dictionary index", () => {
  it("returns null before any load", () => {
    expect(lookup("食べる")).toBeNull();
    expect(entryCount()).toBe(0);
  });

  it("resolves by headword after load", () => {
    loadDictionary(ENTRIES);
    expect(lookup("食べる")?.senses[0]?.glosses).toEqual(["to eat"]);
    expect(lookup("行く")?.reading).toBe("いく");
    expect(entryCount()).toBe(3);
  });

  it("falls back to the reading index", () => {
    loadDictionary(ENTRIES);
    expect(lookup("たべる")?.headword).toBe("食べる");
    expect(lookup("たべもの")?.headword).toBe("食べ物");
  });

  it("returns null for unknown lemmas", () => {
    loadDictionary(ENTRIES);
    expect(lookup("存在しない")).toBeNull();
  });

  it("replaces indexes on a second load (idempotent)", () => {
    loadDictionary(ENTRIES);
    const replacement: DictionaryEntry[] = [entry("新しい", "あたらしい")];
    loadDictionary(replacement);
    expect(entryCount()).toBe(1);
    expect(lookup("新しい")?.headword).toBe("新しい");
    expect(lookup("食べる")).toBeNull();
  });

  it("first-write-wins when headword and reading collide", () => {
    loadDictionary([
      entry("花", "はな", ["flower"]),
      entry("華", "はな", ["splendour"]),
    ]);
    // "はな" reading maps to the first entry written (花)
    expect(lookup("はな")?.headword).toBe("花");
  });
});
