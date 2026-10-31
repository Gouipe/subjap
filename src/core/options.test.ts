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
    const merged = mergeOptions(DEFAULT_OPTIONS, { fontSize: 40 });
    expect(merged.fontSize).toBe(40);
    expect(merged.showFurigana).toBe(true);
    expect(merged.hideNativeSubtitles).toBe(DEFAULT_OPTIONS.hideNativeSubtitles);
  });

  it("applies the partial over a custom base", () => {
    const base = { ...DEFAULT_OPTIONS, showFurigana: false };
    const merged = mergeOptions(base, { hideNativeSubtitles: false });
    expect(merged.showFurigana).toBe(false);
    expect(merged.hideNativeSubtitles).toBe(false);
  });
});

describe("sanitizeOptions", () => {
  it("returns an empty object for null/undefined/non-object input", () => {
    expect(sanitizeOptions(undefined)).toEqual({});
    expect(sanitizeOptions(null)).toEqual({});
  });

  it("drops malformed field values", () => {
    const raw = {
      fontSize: "big",
      showFurigana: "yes",
      hideNativeSubtitles: 1,
    } as unknown as Partial<typeof DEFAULT_OPTIONS>;
    const out = sanitizeOptions(raw);
    expect(out.fontSize).toBeUndefined();
    expect(out.showFurigana).toBeUndefined();
    expect(out.hideNativeSubtitles).toBeUndefined();
  });

  it("keeps valid boolean toggles", () => {
    const out = sanitizeOptions({
      showFurigana: false,
      hideNativeSubtitles: false,
    });
    expect(out.showFurigana).toBe(false);
    expect(out.hideNativeSubtitles).toBe(false);
  });

  it("defaults hide the native subtitle track", () => {
    expect(DEFAULT_OPTIONS.hideNativeSubtitles).toBe(true);
  });

  it("defaults secondary subtitle hiding to off", () => {
    expect(DEFAULT_OPTIONS.hideSecondarySubtitlesWhenAllKnown).toBe(false);
  });

  it("keeps the secondary subtitle toggle when valid", () => {
    expect(
      sanitizeOptions({ hideSecondarySubtitlesWhenAllKnown: true }),
    ).toEqual({ hideSecondarySubtitlesWhenAllKnown: true });
  });

  it("clamps fontSize to the [12, 64] range", () => {
    expect(sanitizeOptions({ fontSize: 200 }).fontSize).toBe(64);
    expect(sanitizeOptions({ fontSize: 2 }).fontSize).toBe(12);
    expect(sanitizeOptions({ fontSize: 28 }).fontSize).toBe(28);
  });
});
