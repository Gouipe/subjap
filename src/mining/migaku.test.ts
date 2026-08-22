import { describe, expect, it } from "vitest";
import type { RenderedCue, SpanToken } from "@/core/types";
import { formatMigakuDefinitions, formatMigakuSentence, formatMigakuWord } from "@/mining/migaku";

const firstToken = {
  surface: "食べて",
  lemma: "食べる",
  reading: "たべて",
  partOfSpeech: ["動詞"],
};

const secondToken = {
  surface: "ください",
  lemma: "くださる",
  reading: "ください",
  partOfSpeech: ["動詞"],
};

const target: SpanToken = { index: 0, token: firstToken, wordState: null };
const cue: RenderedCue = {
  cue: {
    id: "cue-1",
    start: 1,
    end: 3,
    text: "食べてください",
  },
  spans: [target, { index: 1, token: secondToken, wordState: null }],
};

describe("Migaku Memory formatting", () => {
  it("formats the lemma with its dictionary reading", () => {
    expect(formatMigakuWord("食べる", "たべる")).toBe("<ruby>食べる<rt>たべる</rt></ruby>");
  });

  it("highlights the mined token in the phrase field", () => {
    expect(formatMigakuSentence(cue, target)).toBe(
      '<span class="target">食べて</span><span>ください</span>',
    );
  });

  it("escapes and separates dictionary definitions", () => {
    expect(formatMigakuDefinitions(["to eat", "<unsafe>"])).toBe("to eat<br>&lt;unsafe&gt;");
  });
});
