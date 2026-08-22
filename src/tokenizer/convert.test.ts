import { describe, expect, it } from "vitest";
import { toLinderaToken } from "./convert";

describe("toLinderaToken", () => {
  it("conserve la forme naturelle et l’identité lexicale UniDic", () => {
    const result = toLinderaToken({
      surface: "コイツ",
      byteStart: 0,
      byteEnd: 9,
      lexeme: "此奴",
      orthographicBaseForm: "コイツ",
      orthographicSurfaceForm: "コイツ",
      phonologicalBaseForm: "コイツ",
      phonologicalSurfaceForm: "コイツ",
      reading: "コイツ",
      partOfSpeech: "代名詞",
      partOfSpeechSubcategory1: "*",
      partOfSpeechSubcategory2: "*",
      partOfSpeechSubcategory3: "*",
      conjugationType: "*",
      conjugationForm: "*",
    });

    expect(result).toMatchObject({
      surface: "コイツ",
      dictionaryForm: "コイツ",
      canonicalKey: "此奴",
      lookupTerms: ["コイツ", "此奴", "こいつ"],
      reading: "こいつ",
      partOfSpeech: ["代名詞"],
    });
  });
});
