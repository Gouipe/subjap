import { describe, expect, it } from "vitest";
import { toLinderaToken } from "./convert";
import { unidic } from "./unidic-fixture";

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

  describe("forme moderne de la forme de base UniDic", () => {
    const shinzuru = {
      lexeme: "信ずる",
      orthographicBaseForm: "信ずる",
      phonologicalBaseForm: "シンズル",
      reading: "シンズル",
      partOfSpeech: "動詞",
      conjugationType: "サ行変格",
    };

    it("affiche 信じる pour 信じろ, analysé comme le サ変 littéraire 信ずる", () => {
      const result = toLinderaToken(
        unidic({ ...shinzuru, surface: "信じろ", phonologicalSurfaceForm: "シンジロ" }),
      );
      expect(result).toMatchObject({
        dictionaryForm: "信じる",
        dictionaryReading: "しんじる",
        canonicalKey: "信ずる",
      });
    });

    it("garde 信ずる quand le sous-titre l’écrit en ず/ぜ", () => {
      const result = toLinderaToken(
        unidic({ ...shinzuru, surface: "信ぜよ", phonologicalSurfaceForm: "シンゼヨ" }),
      );
      expect(result).toMatchObject({ dictionaryForm: "信ずる", dictionaryReading: "しんずる" });
    });

    it("affiche le verbe de base d’un potentiel (動けない → 動く)", () => {
      const result = toLinderaToken(
        unidic({
          surface: "動け",
          lexeme: "動く",
          orthographicBaseForm: "動ける",
          phonologicalBaseForm: "ウゴケル",
          phonologicalSurfaceForm: "ウゴケ",
          reading: "ウゴク",
          partOfSpeech: "動詞",
          conjugationType: "下一段-カ行",
        }),
      );
      expect(result).toMatchObject({
        dictionaryForm: "動く",
        dictionaryReading: "うごく",
        canonicalKey: "動く",
      });
    });

    it("garde いける en kana, identifié comme 行ける et non 行く", () => {
      const result = toLinderaToken(
        unidic({
          surface: "いけ",
          lexeme: "行く",
          orthographicBaseForm: "いける",
          phonologicalBaseForm: "イケル",
          phonologicalSurfaceForm: "イケ",
          reading: "イク",
          partOfSpeech: "動詞",
          conjugationType: "下一段-カ行",
        }),
      );
      expect(result).toMatchObject({
        dictionaryForm: "いける",
        dictionaryReading: "いける",
        canonicalKey: "行ける",
      });
    });

    it("affiche l’adjectif moderne d’un adjectif littéraire (弱き → 弱い, 悪しき → 悪しい)", () => {
      const yowaki = toLinderaToken(
        unidic({
          surface: "弱き",
          lexeme: "弱い",
          orthographicBaseForm: "弱し",
          phonologicalBaseForm: "ヨワシ",
          phonologicalSurfaceForm: "ヨワキ",
          reading: "ヨワイ",
          partOfSpeech: "形容詞",
          conjugationType: "文語形容詞-ク",
        }),
      );
      expect(yowaki).toMatchObject({ dictionaryForm: "弱い", dictionaryReading: "よわい" });

      const ashiki = toLinderaToken(
        unidic({
          surface: "悪しき",
          lexeme: "悪しい",
          orthographicBaseForm: "悪し",
          phonologicalBaseForm: "アシ",
          phonologicalSurfaceForm: "アシキ",
          reading: "アシイ",
          partOfSpeech: "形容詞",
          conjugationType: "文語形容詞-シク",
        }),
      );
      expect(ashiki).toMatchObject({ dictionaryForm: "悪しい", dictionaryReading: "あしい" });
    });
  });
});
