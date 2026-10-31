// ---------------------------------------------------------------------------
// SubJap — options (pure logic) unit tests
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, mergeOptions, sanitizeOptions } from "@/core/options";

describe("mergeOptions", () => {
  it("returns the defaults untouched when no partial is given", () => {
    expect(mergeOptions(DEFAULT_OPTIONS, undefined)).toEqual(DEFAULT_OPTIONS);
    expect(mergeOptions(DEFAULT_OPTIONS)).toEqual(DEFAULT_OPTIONS);
  });

  it("overrides only the provided fields", () => {
    const merged = mergeOptions(DEFAULT_OPTIONS, { subtitleScale: 150 });
    expect(merged.subtitleScale).toBe(150);
    expect(merged.showFurigana).toBe(true);
  });

  it("applies the partial over a custom base", () => {
    const base = { ...DEFAULT_OPTIONS, showFurigana: false };
    const merged = mergeOptions(base, { subtitleScale: 150 });
    expect(merged.showFurigana).toBe(false);
    expect(merged.subtitleScale).toBe(150);
  });
});

describe("sanitizeOptions", () => {
  it("returns an empty object for null/undefined/non-object input", () => {
    expect(sanitizeOptions(undefined)).toEqual({});
    expect(sanitizeOptions(null)).toEqual({});
  });

  it("drops malformed field values", () => {
    const raw = {
      subtitleScale: "big",
      showFurigana: "yes",
    } as unknown as Partial<typeof DEFAULT_OPTIONS>;
    const out = sanitizeOptions(raw);
    expect(out.subtitleScale).toBeUndefined();
    expect(out.showFurigana).toBeUndefined();
  });

  it("keeps valid boolean toggles", () => {
    const out = sanitizeOptions({ showFurigana: false });
    expect(out.showFurigana).toBe(false);
  });

  it("defaults known-sentence hiding to off", () => {
    expect(DEFAULT_OPTIONS.knownSentenceSubtitles).toBe("show");
  });

  it("keeps the known-sentence choice when valid", () => {
    expect(
      sanitizeOptions({ knownSentenceSubtitles: "hide-all" }),
    ).toEqual({ knownSentenceSubtitles: "hide-all" });
  });

  it("clamps subtitleScale to the [50, 200] range", () => {
    expect(sanitizeOptions({ subtitleScale: 300 }).subtitleScale).toBe(200);
    expect(sanitizeOptions({ subtitleScale: 10 }).subtitleScale).toBe(50);
    expect(sanitizeOptions({ subtitleScale: 120 }).subtitleScale).toBe(120);
  });
});
