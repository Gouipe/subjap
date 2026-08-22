import { describe, expect, it } from "vitest";
import { toToken } from "@/tokenizer/convert";

describe("toToken", () => {
  it("conserve le lemme et les métadonnées de conjugaison Kuromoji", () => {
    const result = toToken({
      surface_form: "思っ",
      basic_form: "思う",
      reading: "オモッ",
      pos: "動詞",
      pos_detail_1: "自立",
      pos_detail_2: "*",
      pos_detail_3: "*",
      word_type: "KNOWN",
      word_position: 1,
      conjugated_type: "五段・ワ行促音便",
      conjugated_form: "連用タ接続",
    });

    expect(result).toMatchObject({
      surface: "思っ",
      lemma: "思う",
      reading: "おもっ",
      partOfSpeech: ["動詞"],
      partOfSpeechDetails: ["自立"],
      conjugationType: "五段・ワ行促音便",
      conjugationForm: "連用タ接続",
    });
  });
});
