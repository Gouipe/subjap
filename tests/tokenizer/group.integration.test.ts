import path from "node:path";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import kuromoji from "kuromoji";
import { toToken, type RawKuromojiToken } from "../../src/tokenizer/convert";
import { groupTokens } from "../../src/tokenizer/group";

interface RawTokenizer {
  tokenize(text: string): RawKuromojiToken[];
}

const require = createRequire(import.meta.url);
const dicPath = path.join(
  path.dirname(require.resolve("kuromoji/package.json")),
  "dict",
);

describe("inflection grouping with the bundled IPADIC", () => {
  let tokenizer: RawTokenizer;

  beforeAll(async () => {
    tokenizer = await new Promise<RawTokenizer>((resolve, reject) => {
      kuromoji.builder({ dicPath }).build((error, built) => {
        if (error) reject(error);
        else resolve(built);
      });
    });
  });

  function tokenize(sentence: string) {
    return groupTokens(tokenizer.tokenize(sentence).map(toToken));
  }

  it.each([
    ["感動しました", ["感動", "しました"], "する"],
    ["取材された", ["取材", "された"], "する"],
    ["食べられなかった", ["食べられなかった"], "食べる"],
    ["読ませられました", ["読ませられました"], "読む"],
    ["行けた", ["行けた"], "行ける"],
  ])(
    "groups %s around its lexical dictionary lemma",
    (sentence, expectedSurfaces, expectedLemma) => {
      const result = tokenize(sentence);

      expect(result.map((token) => token.surface)).toEqual(expectedSurfaces);
      expect(result.at(-1)?.lemma).toBe(expectedLemma);
    },
  );

  it("keeps the lexical verb while exposing たい's adjectival behaviour", () => {
    const result = tokenize("読みたかった");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      surface: "読みたかった",
      lemma: "読む",
      partOfSpeech: ["動詞", "形容詞"],
    });
  });

  it("stops at the connective particle in ている", () => {
    expect(tokenize("読んでいる").map((token) => token.surface)).toEqual([
      "読ん",
      "で",
      "いる",
    ]);
  });
});
