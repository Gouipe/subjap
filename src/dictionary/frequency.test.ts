import { describe, expect, it } from "vitest";
import { parseFrequencyList } from "@/dictionary/frequency";

describe("parseFrequencyList", () => {
  it("parses counts and assigns descending ranks", () => {
    expect(
      parseFrequencyList("遅い 2\n速い 9\n速い 10\ninvalid\n"),
    ).toEqual([
      { key: "速い", rank: 1 },
      { key: "遅い", rank: 2 },
    ]);
  });
});
