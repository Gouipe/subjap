import { describe, expect, it } from "vitest";
import type { Token } from "@/core/types";
import { groupTokens } from "@/tokenizer/group";

function token(
  surface: string,
  lemma = surface,
  partOfSpeech = ["助詞"],
): Token {
  return {
    surface,
    lemma,
    reading: surface,
    partOfSpeech,
  };
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
