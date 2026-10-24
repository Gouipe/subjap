import { describe, expect, it } from "vitest";
import {
  getFrequencyHighlight,
  isNonLexicalToken,
  isSingleMiningCandidate,
  NEAR_FREQUENCY_WINDOW,
} from "@/core/frequency";

describe("isNonLexicalToken", () => {
  const nonLexical = (surface: string) =>
    isNonLexicalToken({ surface, partOfSpeech: [] });

  it("treats quotes, dashes and symbols as non-lexical without relying on POS", () => {
    for (const surface of ['"', "“", "”", "—", "——", "―", "〜", "ー", "ーー", "♪", "・", "…", " "]) {
      expect(nonLexical(surface), surface).toBe(true);
    }
  });

  it("keeps real words, including ones containing a long-vowel mark", () => {
    for (const surface of ["猫", "もし", "コーヒー", "ABC", "123"]) {
      expect(nonLexical(surface), surface).toBe(false);
    }
  });
});

describe("getFrequencyHighlight", () => {
  it("keeps known words neutral even when highly frequent", () => {
    expect(
      getFrequencyHighlight(
        { key: "日本語", status: "known", source: "manual" },
        1,
        100,
      ),
    ).toBe("known");
  });

  it("marks unknown words in the known-vocabulary range as relevant", () => {
    expect(getFrequencyHighlight(null, 100, 100)).toBe("relevant");
  });

  it("marks the next 300 ranks as near", () => {
    expect(
      getFrequencyHighlight(null, 101 + NEAR_FREQUENCY_WINDOW - 1, 100),
    ).toBe("near");
    expect(getFrequencyHighlight(null, 401, 100)).toBe("unknown");
  });

  it("uses orange unknown as the fallback and preserves explicit Anki learning states", () => {
    expect(getFrequencyHighlight(null, undefined, 100)).toBe("unknown");
    expect(getFrequencyHighlight(null, 0, 100)).toBe("unknown");
    expect(
      getFrequencyHighlight({ key: "x", status: "learning", source: "import" }, 1, 100),
    ).toBe("learning");
    expect(
      getFrequencyHighlight({ key: "x", status: "ignored", source: "import" }, 1, 100),
    ).toBe("ignored");
    expect(
      getFrequencyHighlight(
        { key: "x", status: "ignored", source: "import" },
        1,
        100,
        2,
      ),
    ).toBe("ignored");
  });

  it("applies frequency bands to words explicitly tagged UNKNOWN in Anki", () => {
    const unknown = { key: "x", status: "unknown", source: "import" } as const;

    expect(getFrequencyHighlight(unknown, 100, 100)).toBe("relevant");
    expect(getFrequencyHighlight(unknown, 101, 100)).toBe("near");
    expect(getFrequencyHighlight(unknown, 401, 100)).toBe("unknown");
  });

  it("uses learning purple for an existing Anki card unless it is known", () => {
    expect(getFrequencyHighlight(null, 1, 100, 2)).toBe("learning");
    expect(
      getFrequencyHighlight(
        { key: "x", status: "known", source: "import" },
        1,
        100,
        2,
      ),
    ).toBe("known");
  });

  it("accepts exactly one green or blue word when no word is orange", () => {
    expect(
      isSingleMiningCandidate(["known", "relevant", "learning", null]),
    ).toBe(true);
    expect(isSingleMiningCandidate(["known", "near", "learning", null])).toBe(
      true,
    );
    expect(isSingleMiningCandidate(["known", "relevant", "unknown"])).toBe(
      false,
    );
    expect(isSingleMiningCandidate(["known", "relevant", "near"])).toBe(false);
  });
});
