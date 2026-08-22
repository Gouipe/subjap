import { describe, expect, it, vi } from "vitest";
import type { SubtitleCue } from "@/core/types";
import { CueNavigator, installPlaybackShortcuts } from "./shortcuts";

function cue(id: string, start: number, end: number): SubtitleCue {
  return { id, start, end, text: id, language: "ja" };
}

describe("CueNavigator", () => {
  it("returns the previous observed cue", () => {
    const navigator = new CueNavigator();
    navigator.observe([cue("one", 10, 12)]);
    navigator.observe([cue("two", 14, 16)]);

    expect(navigator.getSeekTime("previous", 15)).toBe(10);
  });

  it("returns the current cue start for replay", () => {
    const navigator = new CueNavigator();
    navigator.observe([cue("current", 10, 12)]);

    expect(navigator.getSeekTime("current", 11)).toBe(10);
  });

  it("returns the next observed cue when it is known", () => {
    const navigator = new CueNavigator();
    navigator.observe([cue("one", 10, 12)]);
    navigator.observe([cue("two", 14, 16)]);

    expect(navigator.getSeekTime("next", 11)).toBe(14);
  });

  it("falls through to the current cue end when the next cue is not known", () => {
    const navigator = new CueNavigator();
    navigator.observe([cue("current", 10, 12)]);

    expect(navigator.getSeekTime("next", 11)).toBe(12.05);
  });

  it("returns null at the beginning when no previous cue is known", () => {
    const navigator = new CueNavigator();
    navigator.observe([cue("first", 10, 12)]);

    expect(navigator.getSeekTime("previous", 11)).toBeNull();
  });

  it("forgets cues when a new video starts", () => {
    const navigator = new CueNavigator();
    navigator.observe([cue("old", 10, 12)]);
    navigator.reset();

    navigator.observe([cue("new", 20, 22)]);
    expect(navigator.getSeekTime("previous", 21)).toBeNull();
  });

  it("delegates playback to the adapter instead of touching the video", async () => {
    const navigator = new CueNavigator();
    navigator.observe([cue("current", 10, 12)]);
    const seekTo = vi.fn().mockResolvedValue(true);
    const removeShortcuts = installPlaybackShortcuts(
      document,
      { getCurrentTime: () => 11, seekTo },
      navigator,
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    await Promise.resolve();

    expect(seekTo).toHaveBeenCalledWith(10, true);
    removeShortcuts();
  });
});
