// @vitest-environment node
// ---------------------------------------------------------------------------
// Subtitle segmentation over real UniDic and the bundled expression list.
// ---------------------------------------------------------------------------
//
// Each line of segmentation-corpus.txt is a subtitle and the clickable units
// SubJap must show for it. Nominal compounds are not merged here: they need
// an installed JMdict pack.

import { describe, expect, it } from "vitest";
import { tokenCanonicalKey } from "@/core/types";
import { describeUnits, readCorpus, segment } from "./corpus-pipeline";
import corpus from "./segmentation-corpus.txt?raw";

describe("subtitle segmentation", () => {
  it.each(readCorpus(corpus, "segmentation-corpus.txt"))(
    "$text (line $line)",
    ({ text, expected }) => {
      // An identity is checked only where the corpus gives one.
      expect(describeUnits(segment(text), expected, tokenCanonicalKey)).toBe(expected);
    },
  );
});
