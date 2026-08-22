import { describe, expect, it, vi } from "vitest";
import type { SubtitleCue } from "@/core/types";
import {
  CueNavigator,
  installPlaybackShortcuts,
  installSubtitleCopyShortcut,
  subtitleTextForClipboard,
} from "./shortcuts";

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

  it("returns an unseen previous cue remembered from an authoritative track", () => {
    const navigator = new CueNavigator();
    const previous = cue("previous", 105, 110.778);
    const current = cue("current", 110.778, 114);

    navigator.remember([previous, current]);
    navigator.observe([current]);

    expect(navigator.getSeekTime("previous", 111.2)).toBe(105);
  });

  it("ignores whitespace-only cues in navigation history", () => {
    const navigator = new CueNavigator();
    const previous = cue("previous", 10, 12);
    const blank = { ...cue("blank", 13, 14), text: " \u00a0 " };
    const current = cue("current", 15, 18);

    navigator.remember([previous, blank, current]);
    navigator.observe([current]);

    expect(navigator.getSeekTime("previous", 16)).toBe(10);
  });

  it("returns the latest observed cue from a gap after subtitles", () => {
    const navigator = new CueNavigator();
    navigator.observe([cue("last", 10, 12)]);
    navigator.observe([]);

    expect(navigator.getSeekTime("previous", 13)).toBe(10);
  });

  it("returns the current cue start for replay", () => {
    const navigator = new CueNavigator();
    navigator.observe([cue("current", 10, 12)]);

    expect(navigator.getSeekTime("current", 11)).toBe(10);
  });

  it("keeps the original start when Netflix rebuilds the current cue", () => {
    const navigator = new CueNavigator();
    navigator.observe([
      { id: "first", start: 10, end: 12, text: "待って", language: "ja" },
    ]);

    expect(navigator.getSeekTime("current", 11)).toBe(10);
    navigator.observe([]);
    navigator.observe([
      {
        id: "rebuilt",
        start: 10.35,
        end: 12.35,
        text: "待って",
        language: "ja",
      },
    ]);

    expect(navigator.getSeekTime("current", 11)).toBe(10);
  });

  it("treats whitespace-only Netflix rebuilds as the same cue", () => {
    const navigator = new CueNavigator();
    navigator.observe([
      {
        id: "real-previous",
        start: 50,
        end: 52,
        text: "本当の前の字幕",
        language: "ja",
      },
    ]);
    navigator.observe([
      {
        id: "first-dom-build",
        start: 59.4,
        end: 59.7,
        text: "（篠原 ）でも すごいですね",
        language: "ja",
      },
    ]);
    navigator.observe([]);
    navigator.observe([
      {
        id: "seek-rebuild",
        start: 59.7,
        end: 60.5,
        text: "（篠原）でも すごいですね",
        language: "ja",
      },
    ]);

    expect(navigator.getSeekTime("previous", 60)).toBe(50);
  });

  it("keeps the historical start when a seek rebuild overlaps the old cue", () => {
    const navigator = new CueNavigator();
    navigator.observe([
      {
        id: "real-previous",
        start: 106,
        end: 110.778,
        text: "廊下を走らないって言ってるでしょう",
        language: "ja",
      },
    ]);
    navigator.observe([
      {
        id: "current",
        start: 110.778,
        end: 114,
        text: "困るんですよ 生徒に示しがつかないから",
        language: "ja",
      },
    ]);
    navigator.observe([
      {
        id: "late-seek-rebuild",
        start: 110.489,
        end: 110.489,
        endConfirmed: false,
        text: "廊下を走らないって言ってるでしょう",
        language: "ja",
      },
    ]);
    navigator.observe([
      {
        id: "current-rebuilt",
        start: 110.778,
        end: 114,
        text: "困るんですよ生徒に示しがつかないから",
        language: "ja",
      },
    ]);

    expect(navigator.getSeekTime("previous", 111)).toBe(106);
  });

  it("keeps distant non-overlapping repetitions as separate cues", () => {
    const navigator = new CueNavigator();
    navigator.observe([
      { id: "first", start: 10, end: 11, text: "はい", language: "ja" },
    ]);
    navigator.observe([
      { id: "second", start: 20, end: 21, text: "はい", language: "ja" },
    ]);

    expect(navigator.getSeekTime("previous", 20.5)).toBe(10);
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

  it.each(["q", "s", "d"])(
    "keeps playback paused when navigating with %s",
    async (key) => {
      const navigator = new CueNavigator();
      navigator.observe([cue("one", 5, 8)]);
      navigator.observe([cue("two", 10, 13)]);
      navigator.observe([cue("three", 15, 18)]);
      const seekTo = vi.fn().mockResolvedValue(true);
      const removeShortcuts = installPlaybackShortcuts(
        document,
        { getCurrentTime: () => 11, isPaused: () => true, seekTo },
        navigator,
      );

      document.dispatchEvent(new KeyboardEvent("keydown", { key }));
      await vi.waitFor(() => expect(seekTo).toHaveBeenCalledOnce());

      expect(seekTo).toHaveBeenCalledWith(expect.any(Number), false);
      removeShortcuts();
    },
  );

  it.each(["q", "s", "d"])(
    "keeps playback running when navigating with %s",
    async (key) => {
      const navigator = new CueNavigator();
      navigator.observe([cue("one", 5, 8)]);
      navigator.observe([cue("two", 10, 13)]);
      navigator.observe([cue("three", 15, 18)]);
      const seekTo = vi.fn().mockResolvedValue(true);
      const removeShortcuts = installPlaybackShortcuts(
        document,
        { getCurrentTime: () => 11, isPaused: () => false, seekTo },
        navigator,
      );

      document.dispatchEvent(new KeyboardEvent("keydown", { key }));
      await vi.waitFor(() => expect(seekTo).toHaveBeenCalledOnce());

      expect(seekTo).toHaveBeenCalledWith(expect.any(Number), true);
      removeShortcuts();
    },
  );

  it("captures playback state when the key is pressed", async () => {
    const navigator = new CueNavigator();
    navigator.observe([cue("one", 5, 8)]);
    navigator.observe([cue("two", 10, 13)]);
    navigator.observe([cue("three", 15, 18)]);

    let paused = false;
    let releaseFirstSeek: ((accepted: boolean) => void) | undefined;
    const seekTo = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            releaseFirstSeek = resolve;
          }),
      )
      .mockResolvedValue(true);
    const removeShortcuts = installPlaybackShortcuts(
      document,
      { getCurrentTime: () => 16, isPaused: () => paused, seekTo },
      navigator,
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    paused = true;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    await Promise.resolve();

    expect(seekTo).toHaveBeenCalledWith(10, true);
    releaseFirstSeek?.(true);
    await vi.waitFor(() => expect(seekTo).toHaveBeenCalledTimes(2));
    expect(seekTo).toHaveBeenLastCalledWith(5, false);
    removeShortcuts();
  });

  it("serializes rapid q presses and advances from the last requested cue", async () => {
    const navigator = new CueNavigator();
    navigator.observe([cue("one", 5, 8)]);
    navigator.observe([cue("two", 10, 13)]);
    navigator.observe([cue("three", 15, 18)]);

    let releaseFirstSeek: ((accepted: boolean) => void) | undefined;
    const seekTo = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            releaseFirstSeek = resolve;
          }),
      )
      .mockResolvedValue(true);
    const removeShortcuts = installPlaybackShortcuts(
      document,
      { getCurrentTime: () => 16, isPaused: () => false, seekTo },
      navigator,
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    await Promise.resolve();

    expect(seekTo).toHaveBeenCalledTimes(1);
    expect(seekTo).toHaveBeenLastCalledWith(10, true);

    releaseFirstSeek?.(true);
    await vi.waitFor(() => expect(seekTo).toHaveBeenCalledTimes(2));
    expect(seekTo).toHaveBeenLastCalledWith(5, true);
    removeShortcuts();
  });
});

describe("subtitle copy shortcut", () => {
  it("normalizes displayed cues onto one line", () => {
    expect(
      subtitleTextForClipboard([
        { text: "<i>日本語を</i>\n勉強します。" },
        { text: "  次です。  " },
      ]),
    ).toBe("日本語を 勉強します。 次です。");
  });

  it("copies with plain C and shows confirmation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const removeShortcut = installSubtitleCopyShortcut(document, {
      getText: () => "待ってください。",
      writeText,
      feedbackDurationMs: 10,
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));

    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("待ってください。"),
    );
    expect(document.querySelector("#subjap-copy-feedback")?.textContent).toBe(
      "Copié",
    );
    removeShortcut();
  });

  it("ignores modifiers, repeats, and editable targets", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const removeShortcut = installSubtitleCopyShortcut(document, {
      getText: () => "日本語",
      writeText,
    });
    const input = document.createElement("input");
    document.body.appendChild(input);

    for (const init of [
      { key: "c", ctrlKey: true },
      { key: "c", altKey: true },
      { key: "c", metaKey: true },
      { key: "C", shiftKey: true },
      { key: "c", repeat: true },
    ]) {
      document.dispatchEvent(new KeyboardEvent("keydown", init));
    }
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    await Promise.resolve();

    expect(writeText).not.toHaveBeenCalled();
    input.remove();
    removeShortcut();
  });

  it("serializes rapid copies", async () => {
    let releaseFirstCopy: (() => void) | undefined;
    const writeText = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirstCopy = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const removeShortcut = installSubtitleCopyShortcut(document, {
      getText: () => "日本語",
      writeText,
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledTimes(1);

    releaseFirstCopy?.();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    removeShortcut();
  });

  it("continues after a rejected clipboard write", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValue(undefined);
    const removeShortcut = installSubtitleCopyShortcut(document, {
      getText: () => "日本語",
      writeText,
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(document.querySelector("#subjap-copy-feedback")?.textContent).toBe(
        "Copié",
      ),
    );
    removeShortcut();
  });
});
