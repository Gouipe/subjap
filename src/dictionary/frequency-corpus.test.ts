// @vitest-environment node
// ---------------------------------------------------------------------------
// Frequency ranks of subtitle words over real UniDic and the bundled list.
// ---------------------------------------------------------------------------
//
// Each line of frequency-corpus.txt is a subtitle and the JPDB rank SubJap
// must show for its words, looked up as the content script and the service
// worker do.

import { describe, expect, it } from "vitest";
import type { Token } from "@/core/types";
import { bestFrequencyRank, frequencyLookupTerms, isFunctionWordToken } from "@/core/frequency";
import { parseFrequencyList, rankFrequencyTerm } from "@/dictionary/frequency";
import { describeUnits, readCorpus, segment } from "@/tokenizer/corpus-pipeline";
import corpus from "./frequency-corpus.txt?raw";
import frequencyList from "../../public/frequency/jpdb-v2.2-top10000.tsv?raw";

const entryByKey = new Map(parseFrequencyList(frequencyList).map((entry) => [entry.key, entry]));

/** The rank shown on a subtitle word, `-` when it has none. */
function shownRank(token: Token): string {
  if (isFunctionWordToken(token)) return "-";
  const { lexical, surface } = frequencyLookupTerms(token);
  const ranks: Record<string, number> = {};
  for (const term of [...lexical, surface]) {
    const rank = rankFrequencyTerm(term, (key) => entryByKey.get(key));
    if (rank != null) ranks[term] = rank;
  }
  return String(bestFrequencyRank(ranks, token) ?? "-");
}

describe("subtitle word frequency", () => {
  it.each(readCorpus(corpus, "frequency-corpus.txt"))(
    "$text (line $line)",
    ({ text, expected }) => {
      expect(describeUnits(segment(text), expected, shownRank)).toBe(expected);
    },
  );
});
