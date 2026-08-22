import { describe, expect, it } from "vitest";
import { containsKanjiOrKatakana } from "@/core/kana";

describe("containsKanjiOrKatakana", () => {
  it("identifies kanji and katakana tokens", () => {
    expect(containsKanjiOrKatakana("弱気")).toBe(true);
    expect(containsKanjiOrKatakana("コイツ")).toBe(true);
  });

  it("rejects hiragana-only tokens", () => {
    expect(containsKanjiOrKatakana("てんだ")).toBe(false);
  });
});
