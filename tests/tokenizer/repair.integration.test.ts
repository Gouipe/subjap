import path from "node:path";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import kuromoji from "kuromoji";
import type { RawKuromojiToken } from "../../src/tokenizer/convert";
import { repairKatakanaAdjectives } from "../../src/tokenizer/repair";

interface RawTokenizer {
  tokenize(text: string): RawKuromojiToken[];
}

const require = createRequire(import.meta.url);
const dicPath = path.join(path.dirname(require.resolve("kuromoji/package.json")), "dict");

describe("mixed-script adjective repair with the bundled IPADIC", () => {
  let tokenizer: RawTokenizer;

  beforeAll(async () => {
    tokenizer = await new Promise<RawTokenizer>((resolve, reject) => {
      kuromoji.builder({ dicPath }).build((error, built) => {
        if (error) reject(error);
        else resolve(built);
      });
    });
  });

  it.each([
    ["ヤバい", "やばい"],
    ["ヤバく", "やばい"],
    ["ヤバくない", "やばい"],
    ["ヤバくなかった", "やばい"],
    ["ヤバければ", "やばい"],
    ["ヤバさ", "やばい"],
    ["スゴかった", "すごい"],
    ["カワイくて", "かわいい"],
    ["ウマくない", "うまい"],
    ["ダルそう", "だるい"],
    ["エグすぎる", "えぐい"],
    ["デカかった", "でかい"],
    ["クサくない", "くさい"],
    ["イタくない", "いたい"],
    ["カッコいい", "かっこいい"],
    ["ヤバイ", "やばい"],
  ])("recovers %s as %s", (surface, lemma) => {
    const result = repairKatakanaAdjectives(surface, tokenizer.tokenize(surface), (normalized) =>
      tokenizer.tokenize(normalized),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ surface, lemma });
  });

  it("preserves the repaired span inside the subtitle context", () => {
    const sentence = "（菊乃）なんかヤバくない？";
    const result = repairKatakanaAdjectives(
      sentence,
      tokenizer.tokenize(sentence),
      (normalized) => tokenizer.tokenize(normalized),
    );

    expect(result.find((token) => token.lemma === "やばい")).toMatchObject({
      surface: "ヤバくない",
      reading: "やばくない",
      partOfSpeech: ["形容詞"],
    });
  });
});
