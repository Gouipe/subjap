import { describe, expect, it } from "vitest";
import {
  mergeFrequencyRanks,
  parseFrequencyList,
} from "@/dictionary/frequency";

describe("Japanese subtitle frequency list", () => {
  it("parses ranked lexical entries and keeps the lowest duplicate rank", () => {
    expect(
      parseFrequencyList("あなた\t3\n映画\t9\nあなた\t5\ninvalid\n"),
    ).toEqual([
      { key: "あなた", rank: 3 },
      { key: "映画", rank: 9 },
    ]);
  });

  it("ignores malformed and tagged source rows", () => {
    expect(
      parseFrequencyList("<num>\t1\n[音楽]\t2\n\t3\n映画\t4\n"),
    ).toEqual([{ key: "映画", rank: 4 }]);
  });

  it("keeps the lowest rank found in supplied sources", () => {
    expect(
      mergeFrequencyRanks(
        [
          { key: "食べる", rank: 800 },
          { key: "映画", rank: 120 },
        ],
        [
          { key: "食べる", rank: 90 },
          { key: "映画", rank: 2_000 },
          { key: "買い物", rank: 300 },
        ],
      ),
    ).toEqual([
      { key: "食べる", rank: 90 },
      { key: "映画", rank: 120 },
      { key: "買い物", rank: 300 },
    ]);
  });
});
