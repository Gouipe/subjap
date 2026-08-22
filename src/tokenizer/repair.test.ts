import { describe, expect, it, vi } from "vitest";
import type { RawKuromojiToken } from "./convert";
import { repairKatakanaAdjectives } from "./repair";

function raw(
  surface: string,
  position: number,
  options: Partial<RawKuromojiToken> = {},
): RawKuromojiToken {
  return {
    surface_form: surface,
    basic_form: options.basic_form ?? surface,
    reading: options.reading ?? surface,
    pos: options.pos ?? "\u540d\u8a5e,\u4e00\u822c,*,*",
    word_type: options.word_type ?? "KNOWN",
    word_position: position,
    conjugated_type: options.conjugated_type,
    conjugated_form: options.conjugated_form,
  };
}

function adjective(surface: string, position: number, lemma: string): RawKuromojiToken {
  return raw(surface, position, {
    basic_form: lemma,
    reading: surface,
    pos: "\u5f62\u5bb9\u8a5e,\u81ea\u7acb,*,*",
    word_type: "KNOWN",
    conjugated_type: "\u5f62\u5bb9\u8a5e\u30fb\u30a2\u30a6\u30aa\u6bb5",
    conjugated_form: "\u9023\u7528\u30c6\u63a5\u7d9a",
  });
}

describe("repairKatakanaAdjectives", () => {
  it("regroupe \u30e4\u30d0\u304f\u306a\u3044 avec le lemme \u3084\u3070\u3044", () => {
    const original = [
      raw("\u30e4\u30d0", 1, { basic_form: "*", word_type: "UNKNOWN" }),
      raw("\u304f", 3, { basic_form: "\u304f\u3044", pos: "\u5f62\u5bb9\u8a5e" }),
      raw("\u306a\u3044", 4, { basic_form: "\u306a\u3044", pos: "\u5f62\u5bb9\u8a5e" }),
    ];
    const tokenize = vi.fn(() => [
      adjective("\u3084\u3070\u304f", 1, "\u3084\u3070\u3044"),
      raw("\u306a\u3044", 4, {
        basic_form: "\u306a\u3044",
        pos: "\u52a9\u52d5\u8a5e",
        reading: "\u30ca\u30a4",
      }),
    ]);

    const result = repairKatakanaAdjectives("\u30e4\u30d0\u304f\u306a\u3044", original, tokenize);

    expect(tokenize).toHaveBeenCalledWith("\u3084\u3070\u304f\u306a\u3044");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      surface: "\u30e4\u30d0\u304f\u306a\u3044",
      lemma: "\u3084\u3070\u3044",
      reading: "\u3084\u3070\u304f\u306a\u3044",
      partOfSpeech: ["\u5f62\u5bb9\u8a5e", "\u81ea\u7acb", "*", "*"],
    });
    expect(result[0]?.components?.map((token) => token.surface)).toEqual([
      "\u30e4\u30d0\u304f",
      "\u306a\u3044",
    ]);
  });

  it.each([
    {
      surface: "\u30e4\u30d0\u304b\u3063\u305f",
      normalized: "\u3084\u3070\u304b\u3063\u305f",
      original: [
        raw("\u30e4\u30d0", 1, { basic_form: "*", word_type: "UNKNOWN" }),
        raw("\u304b\u3063", 3, { basic_form: "\u304b\u3046", pos: "\u52d5\u8a5e" }),
        raw("\u305f", 5, { basic_form: "\u305f", pos: "\u52a9\u52d5\u8a5e" }),
      ],
      recovered: [
        adjective("\u3084\u3070\u304b\u3063", 1, "\u3084\u3070\u3044"),
        raw("\u305f", 5, { basic_form: "\u305f", pos: "\u52a9\u52d5\u8a5e" }),
      ],
    },
    {
      surface: "\u30e4\u30d0\u304f\u306a\u304b\u3063\u305f",
      normalized: "\u3084\u3070\u304f\u306a\u304b\u3063\u305f",
      original: [
        raw("\u30e4\u30d0", 1, { basic_form: "*", word_type: "UNKNOWN" }),
        raw("\u304f", 3, { basic_form: "\u304f\u3044", pos: "\u5f62\u5bb9\u8a5e" }),
        raw("\u306a\u304b\u3063", 4, { basic_form: "\u306a\u3044", pos: "\u52a9\u52d5\u8a5e" }),
        raw("\u305f", 7, { basic_form: "\u305f", pos: "\u52a9\u52d5\u8a5e" }),
      ],
      recovered: [
        adjective("\u3084\u3070\u304f", 1, "\u3084\u3070\u3044"),
        raw("\u306a\u304b\u3063", 4, { basic_form: "\u306a\u3044", pos: "\u52a9\u52d5\u8a5e" }),
        raw("\u305f", 7, { basic_form: "\u305f", pos: "\u52a9\u52d5\u8a5e" }),
      ],
    },
    {
      surface: "\u30e4\u30d0\u304f\u3066",
      normalized: "\u3084\u3070\u304f\u3066",
      original: [
        raw("\u30e4\u30d0", 1, { basic_form: "*", word_type: "UNKNOWN" }),
        raw("\u304f", 3, { basic_form: "\u304f", pos: "\u52d5\u8a5e" }),
        raw("\u3066", 4, { basic_form: "\u3066", pos: "\u52a9\u8a5e" }),
      ],
      recovered: [
        adjective("\u3084\u3070\u304f", 1, "\u3084\u3070\u3044"),
        raw("\u3066", 4, { basic_form: "\u3066", pos: "\u52a9\u8a5e" }),
      ],
    },
    {
      surface: "\u30e4\u30d0\u3059\u304e\u308b",
      normalized: "\u3084\u3070\u3059\u304e\u308b",
      original: [
        raw("\u30e4\u30d0", 1, { basic_form: "*", word_type: "UNKNOWN" }),
        raw("\u3059\u304e\u308b", 3, { basic_form: "\u3059\u304e\u308b", pos: "\u52d5\u8a5e" }),
      ],
      recovered: [
        adjective("\u3084\u3070", 1, "\u3084\u3070\u3044"),
        raw("\u3059\u304e\u308b", 3, { basic_form: "\u3059\u304e\u308b", pos: "\u52d5\u8a5e" }),
      ],
    },
  ])("regroupe la flexion $surface", ({ surface, normalized, original, recovered }) => {
    const result = repairKatakanaAdjectives(surface, original, (text) => {
      expect(text).toBe(normalized);
      return recovered;
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ surface, lemma: "\u3084\u3070\u3044" });
  });

  it("r\u00e9pare aussi une forme enti\u00e8rement en katakana", () => {
    const original = [raw("\u30e4\u30d0\u30a4", 1, { basic_form: "*", word_type: "UNKNOWN" })];

    const result = repairKatakanaAdjectives("\u30e4\u30d0\u30a4", original, () => [
      adjective("\u3084\u3070\u3044", 1, "\u3084\u3070\u3044"),
    ]);

    expect(result[0]).toMatchObject({
      surface: "\u30e4\u30d0\u30a4",
      lemma: "\u3084\u3070\u3044",
      reading: "\u3084\u3070\u3044",
    });
  });

  it("conserve l'analyse originale si la normalisation ne produit pas d'adjectif", () => {
    const original = [raw("\u30c8\u30e9\u30a4", 1, { basic_form: "*", word_type: "UNKNOWN" })];

    const result = repairKatakanaAdjectives("\u30c8\u30e9\u30a4", original, () => [
      raw("\u3068\u3089\u3044", 1, { basic_form: "*", word_type: "UNKNOWN" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ surface: "\u30c8\u30e9\u30a4", lemma: "\u30c8\u30e9\u30a4" });
  });

  it("ne retokenise pas un adjectif mixte d\u00e9j\u00e0 correctement reconnu", () => {
    const tokenize = vi.fn();
    const original = [adjective("\u30c0\u30b5\u3044", 1, "\u30c0\u30b5\u3044")];

    const result = repairKatakanaAdjectives("\u30c0\u30b5\u3044", original, tokenize);

    expect(tokenize).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({ surface: "\u30c0\u30b5\u3044", lemma: "\u30c0\u30b5\u3044" });
  });
});
