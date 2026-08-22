import { describe, expect, it } from "vitest";
import type { Token } from "@/core/types";
import { groupTokens } from "./group";
import {
  assertLinderaSurfaceCoverage,
  toLinderaToken,
  type RawLinderaToken,
} from "./convert";

function raw(overrides: Partial<RawLinderaToken>): RawLinderaToken {
  return {
    surface: "こいつ",
    byteStart: 0,
    byteEnd: 9,
    lexeme: "此奴",
    orthographicBaseForm: "こいつ",
    orthographicSurfaceForm: "こいつ",
    phonologicalBaseForm: "コイツ",
    phonologicalSurfaceForm: "コイツ",
    reading: "コイツ",
    partOfSpeech: "代名詞",
    partOfSpeechSubcategory1: "*",
    partOfSpeechSubcategory2: "*",
    partOfSpeechSubcategory3: "*",
    conjugationType: "*",
    conjugationForm: "*",
    ...overrides,
  };
}

function token(
  surface: string,
  dictionaryForm: string,
  canonicalKey: string,
  partOfSpeech: string[],
): Token {
  return {
    surface,
    dictionaryForm,
    canonicalKey,
    lookupTerms: [dictionaryForm, canonicalKey, surface],
    lemma: canonicalKey,
    reading: surface,
    partOfSpeech,
    partOfSpeechDetails: partOfSpeech.includes("接尾辞") ? ["名詞的", "一般"] : ["一般"],
  };
}

describe("UniDic contract", () => {
  it("separates natural orthography from canonical lexeme identity", () => {
    expect(toLinderaToken(raw({}))).toMatchObject({
      surface: "こいつ",
      dictionaryForm: "こいつ",
      canonicalKey: "此奴",
      lemma: "此奴",
      lookupTerms: ["こいつ", "此奴", "コイツ"],
      reading: "こいつ",
      partOfSpeech: ["代名詞"],
    });
  });

  it("validates UTF-8 byte offsets without confusing them with UTF-16 indices", () => {
    const sentence = "こいつら。";
    const first = raw({ surface: "こいつ", byteStart: 0, byteEnd: 9 });
    const second = raw({
      surface: "ら",
      byteStart: 9,
      byteEnd: 12,
      lexeme: "等",
      orthographicBaseForm: "ら",
      orthographicSurfaceForm: "ら",
      phonologicalBaseForm: "ラ",
      phonologicalSurfaceForm: "ラ",
      reading: "ラ",
      partOfSpeech: "接尾辞",
    });
    const punctuation = raw({
      surface: "。",
      byteStart: 12,
      byteEnd: 15,
      lexeme: "。",
      orthographicBaseForm: "。",
      orthographicSurfaceForm: "。",
      phonologicalBaseForm: "。",
      phonologicalSurfaceForm: "。",
      reading: "。",
      partOfSpeech: "補助記号",
    });

    expect(() => assertLinderaSurfaceCoverage(sentence, [first, second, punctuation])).not.toThrow();
    expect(() =>
      assertLinderaSurfaceCoverage(sentence, [first, { ...second, byteStart: 10 }, punctuation]),
    ).toThrow(/offsets are not contiguous/);
  });
});

describe("pedagogical plural grouping", () => {
  it.each([
    ["ら", "等", "こいつら"],
    ["たち", "達", "生徒たち"],
    ["ども", "共", "子供ども"],
    ["がた", "方", "先生がた"],
  ])("groups %s only when UniDic marks the suffix", (suffix, suffixKey, surface) => {
    const baseSurface = surface.slice(0, -suffix.length);
    const result = groupTokens([
      token(baseSurface, baseSurface, baseSurface === "こいつ" ? "此奴" : baseSurface, ["名詞"]),
      token(suffix, suffix, suffixKey, ["接尾辞"]),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      surface,
      dictionaryForm: baseSurface,
      canonicalKey: baseSurface === "こいつ" ? "此奴" : baseSurface,
      components: expect.any(Array),
      grammar: [{ surface: suffix, kind: "plural-suffix" }],
    });
  });

  it("keeps らしい and honorific suffixes separate", () => {
    const base = token("こいつ", "こいつ", "此奴", ["代名詞"]);
    const rashi = token("らしい", "らしい", "らしい", ["助動詞"]);
    const honorific = token("さん", "さん", "さん", ["接尾辞"]);

    expect(groupTokens([base, rashi]).map((item) => item.surface)).toEqual(["こいつ", "らしい"]);
    expect(groupTokens([base, honorific]).map((item) => item.surface)).toEqual(["こいつ", "さん"]);
  });
});
