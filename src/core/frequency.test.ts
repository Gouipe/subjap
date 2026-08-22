import { describe, expect, it } from "vitest";
import { getFrequencyHighlight, NEAR_FREQUENCY_WINDOW } from "@/core/frequency";

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
    expect(getFrequencyHighlight(null, 401, 100)).toBe("neutral");
  });

  it("keeps missing or invalid ranks neutral", () => {
    expect(getFrequencyHighlight(null, undefined, 100)).toBe("neutral");
    expect(getFrequencyHighlight(null, 0, 100)).toBe("neutral");
  });
});
