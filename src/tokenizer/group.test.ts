import { describe, expect, it } from "vitest";
import type { Token } from "@/core/types";
import { groupTokens } from "@/tokenizer/group";

function token(
  surface: string,
  lemma = surface,
  partOfSpeech = ["助詞"],
  metadata: Partial<Token> = {},
): Token {
  return {
    surface,
    lemma,
    reading: surface,
    partOfSpeech,
    ...metadata,
  };
}

function independentVerb(surface: string, lemma: string): Token {
  return token(surface, lemma, ["動詞"], {
    partOfSpeechDetails: ["自立"],
  });
}

function suffixVerb(surface: string, lemma: string): Token {
  return token(surface, lemma, ["動詞"], {
    partOfSpeechDetails: ["接尾"],
    conjugationType: "一段",
  });
}

function auxiliary(surface: string, lemma: string, type: string): Token {
  return token(surface, lemma, ["助動詞"], { conjugationType: type });
}

describe("groupTokens", () => {
  it("regroupe じゃなくて en une unité pédagogique", () => {
    const input = [
      token("じゃ", "だ", ["助動詞"]),
      token("なく", "ない", ["形容詞"]),
      token("て", "て", ["助詞"]),
    ];

    const result = groupTokens(input);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      surface: "じゃなくて",
      lemma: "じゃなくて",
      reading: "じゃなくて",
      components: input,
    });
  });

  it("regroupe aussi ではなくて", () => {
    const result = groupTokens([
      token("では", "だ", ["助動詞"]),
      token("なく", "ない", ["形容詞"]),
      token("て", "て", ["助詞"]),
    ]);

    expect(result.map((item) => item.surface)).toEqual(["ではなくて"]);
  });

  it("regroupe la variante familière じゃなくって", () => {
    const result = groupTokens([
      token("じゃ", "だ", ["助動詞"]),
      token("なくっ", "ない", ["形容詞"]),
      token("て", "て", ["助詞"]),
    ]);

    expect(result.map((item) => item.surface)).toEqual(["じゃなくって"]);
  });

  it("regroupe んです comme construction explicative", () => {
    const result = groupTokens([
      token("ん", "ん", ["名詞"]),
      token("です", "です", ["助動詞"]),
    ]);

    expect(result.map((item) => item.surface)).toEqual(["んです"]);
  });

  it("regroupe なんです quand なん est la copule, pas le mot 何", () => {
    const explanatory = groupTokens([
      token("なん", "だ", ["助動詞"]),
      token("です", "です", ["助動詞"]),
    ]);
    const question = groupTokens([
      token("何", "何", ["名詞"]),
      token("です", "です", ["助動詞"]),
    ]);
    const splitExplanatory = groupTokens([
      token("な", "だ", ["助動詞"]),
      token("ん", "ん", ["名詞"]),
      token("です", "です", ["助動詞"]),
    ]);

    expect(explanatory.map((item) => item.surface)).toEqual(["なんです"]);
    expect(splitExplanatory.map((item) => item.surface)).toEqual(["なんです"]);
    expect(question.map((item) => item.surface)).toEqual(["何", "です"]);
  });

  it("regroupe les variantes familières んだ et なんだ", () => {
    const nDa = groupTokens([
      token("ん", "ん", ["名詞"]),
      token("だ", "だ", ["助動詞"]),
    ]);
    const nanDa = groupTokens([
      token("なん", "だ", ["助動詞"]),
      token("だ", "だ", ["助動詞"]),
    ]);

    expect(nDa.map((item) => item.surface)).toEqual(["んだ"]);
    expect(nanDa.map((item) => item.surface)).toEqual(["なんだ"]);
  });

  it.each([
    {
      label: "affirmative",
      suffix: [auxiliary("ます", "ます", "特殊・マス")],
      expectedSurface: "します",
    },
    {
      label: "passée",
      suffix: [
        auxiliary("まし", "ます", "特殊・マス"),
        auxiliary("た", "た", "特殊・タ"),
      ],
      expectedSurface: "しました",
    },
    {
      label: "négative",
      suffix: [
        auxiliary("ませ", "ます", "特殊・マス"),
        auxiliary("ん", "ん", "不変化型"),
      ],
      expectedSurface: "しません",
    },
    {
      label: "négative passée",
      suffix: [
        auxiliary("ませ", "ます", "特殊・マス"),
        auxiliary("ん", "ん", "不変化型"),
        auxiliary("でし", "です", "特殊・デス"),
        auxiliary("た", "た", "特殊・タ"),
      ],
      expectedSurface: "しませんでした",
    },
  ])(
    "regroupe la forme polie $label autour du lemme verbal",
    ({ suffix, expectedSurface }) => {
      const verb = independentVerb("し", "する");
      const input = [verb, ...suffix];

      const result = groupTokens(input);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        surface: expectedSurface,
        lemma: "する",
        reading: expectedSurface,
        partOfSpeech: ["動詞"],
        partOfSpeechDetails: ["自立"],
        components: input,
      });
    },
  );

  it("applique la règle à tous les verbes sans absorber le nom précédent", () => {
    const noun = token("感動", "感動", ["名詞"]);
    const verb = independentVerb("し", "する");
    const masu = auxiliary("まし", "ます", "特殊・マス");
    const past = auxiliary("た", "た", "特殊・タ");

    const result = groupTokens([noun, verb, masu, past]);

    expect(result.map((item) => item.surface)).toEqual(["感動", "しました"]);
    expect(result[1]).toMatchObject({
      lemma: "する",
      partOfSpeech: ["動詞"],
      components: [verb, masu, past],
    });
  });

  it("regroupe passif et passé sans absorber le nom en する", () => {
    const noun = token("取材", "取材", ["名詞"], {
      partOfSpeechDetails: ["サ変接続"],
    });
    const verb = independentVerb("さ", "する");
    const passive = suffixVerb("れ", "れる");
    const past = auxiliary("た", "た", "特殊・タ");

    const result = groupTokens([noun, verb, passive, past]);

    expect(result.map((item) => item.surface)).toEqual(["取材", "された"]);
    expect(result[1]).toMatchObject({
      lemma: "する",
      partOfSpeech: ["動詞"],
      components: [verb, passive, past],
    });
  });

  it("regroupe une chaîne causative, passive, polie et passée", () => {
    const input = [
      independentVerb("読ま", "読む"),
      suffixVerb("せ", "せる"),
      suffixVerb("られ", "られる"),
      auxiliary("まし", "ます", "特殊・マス"),
      auxiliary("た", "た", "特殊・タ"),
    ];

    expect(groupTokens(input)).toEqual([
      expect.objectContaining({
        surface: "読ませられました",
        lemma: "読む",
        components: input,
      }),
    ]);
  });

  it("regroupe le passif-potentiel et la négation autour du verbe lexical", () => {
    const input = [
      independentVerb("食べ", "食べる"),
      suffixVerb("られ", "られる"),
      auxiliary("なかっ", "ない", "特殊・ナイ"),
      auxiliary("た", "た", "特殊・タ"),
    ];

    expect(groupTokens(input)[0]).toMatchObject({
      surface: "食べられなかった",
      lemma: "食べる",
      components: input,
    });
  });

  it("conserve le lemme verbal et signale le comportement adjectival de たい", () => {
    const input = [
      independentVerb("読み", "読む"),
      auxiliary("たかっ", "たい", "特殊・タイ"),
      auxiliary("た", "た", "特殊・タ"),
    ];

    expect(groupTokens(input)[0]).toMatchObject({
      surface: "読みたかった",
      lemma: "読む",
      partOfSpeech: ["動詞", "形容詞"],
      components: input,
    });
  });

  it("conserve le potentiel lexical choisi par Kuromoji", () => {
    const input = [
      independentVerb("行け", "行ける"),
      auxiliary("た", "た", "特殊・タ"),
    ];

    expect(groupTokens(input)[0]).toMatchObject({
      surface: "行けた",
      lemma: "行ける",
    });
  });

  it("s'arrête devant une particule et un nouveau verbe", () => {
    const input = [
      independentVerb("読ん", "読む"),
      token("で", "で", ["助詞"], { partOfSpeechDetails: ["接続助詞"] }),
      token("いる", "いる", ["動詞"], { partOfSpeechDetails: ["非自立"] }),
    ];

    expect(groupTokens(input)).toEqual(input);
  });

  it("ne traite pas un verbe suffixe isolé comme une tête lexicale", () => {
    const input = [
      suffixVerb("れ", "れる"),
      auxiliary("た", "た", "特殊・タ"),
    ];

    expect(groupTokens(input)).toEqual(input);
  });

  it("ne regroupe pas une suite ressemblante qui ne commence pas par un verbe", () => {
    const input = [
      token("枡", "枡", ["名詞"]),
      token("まし", "ます", ["助動詞"]),
      token("た", "た", ["助動詞"]),
    ];

    expect(groupTokens(input)).toEqual(input);
  });

  it("conserve les tokens qui ne correspondent à aucune règle", () => {
    const input = [
      token("思っ", "思う", ["動詞"]),
      token("て", "て", ["助詞"]),
    ];

    const result = groupTokens(input);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ surface: "思っ", lemma: "思う" });
    expect(result[1]).toMatchObject({ surface: "て", lemma: "て" });
  });
});
