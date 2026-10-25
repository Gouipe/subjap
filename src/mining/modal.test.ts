import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeContext, RenderedCue, SpanToken } from "@/core/types";

const { captureFrameMock } = vi.hoisted(() => ({
  captureFrameMock: vi.fn(),
}));
const { sendMessageMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
}));
const { captureCueMock } = vi.hoisted(() => ({
  captureCueMock: vi.fn(),
}));
vi.mock("./capture", () => ({
  captureFrame: captureFrameMock,
  hideVideoChromeForCapture: () => () => undefined,
}));

vi.mock("@/core/messaging", () => ({
  sendMessage: sendMessageMock,
}));

import { MiningModal } from "./modal";

describe("MiningModal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    captureFrameMock.mockReset();
    captureFrameMock.mockResolvedValue("data:image/jpeg;base64,fixture");
    captureCueMock.mockReset();
    sendMessageMock.mockReset();
  });

  it("captures the video frame when the modal opens", async () => {
    const video = document.createElement("video");
    const modal = new MiningModal(video);
    captureFrameMock.mockImplementation(() => {
      expect(document.querySelector("#subjap-mining-modal")).toBeNull();
      return Promise.resolve("data:image/jpeg;base64,fixture");
    });
    const cue = {
      cue: { text: "約束した", start: 1, end: 2 },
      spans: [],
    } as unknown as RenderedCue;
    const targetToken = {
      token: { surface: "約束", lemma: "約束", reading: "やくそく" },
    } as unknown as SpanToken;
    const episodeContext = {
      platform: "fixture",
      title: "Fixture episode",
      language: "ja",
      url: "https://example.test/episode",
    } as unknown as EpisodeContext;

    modal.open({
      cue,
      targetToken,
      lemmaReading: "やくそく",
      episodeContext,
      senses: [["promise"]],
    });

    await vi.waitFor(() => {
      expect(captureFrameMock).toHaveBeenCalled();
      expect(captureFrameMock.mock.calls[0]?.[0]).toBe(video);
      expect(document.querySelector(".subjap-scene-image img")?.getAttribute("src")).toBe(
        "data:image/jpeg;base64,fixture",
      );
    });
  });

  it("sends the selected definitions and personal notes to Anki", async () => {
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "mine:create") return Promise.resolve({ id: "local-card" });
      if (type === "anki:setup") {
        return Promise.resolve({ deckName: "SubJap", modelName: "Migaku Memory" });
      }
      if (type === "anki:addNote") {
        return Promise.resolve({ noteId: 42, modelName: "Migaku Memory" });
      }
      return Promise.resolve(undefined);
    });

    const modal = new MiningModal(document.createElement("video"));
    modal.open({
      cue: {
        cue: { text: "約束した", start: 1, end: 2 },
        spans: [],
      } as unknown as RenderedCue,
      targetToken: {
        token: { surface: "約束", lemma: "約束", reading: "やくそく" },
      } as unknown as SpanToken,
      lemmaReading: "やくそく",
      translation: "I made a promise.",
      episodeContext: {
        platform: "fixture",
        title: "Fixture episode",
        language: "ja",
        url: "https://example.test/episode",
      } as unknown as EpisodeContext,
      senses: [["promise", "a commitment"], ["vow"]],
    });

    await vi.waitFor(() => {
      expect(document.querySelector(".subjap-scene-image img")).not.toBeNull();
    });

    const definitions = [...document.querySelectorAll<HTMLButtonElement>(".subjap-definition")];
    expect(definitions.map((definition) => definition.textContent)).toEqual([
      "promise · a commitment",
      "vow",
    ]);
    expect(definitions.map((definition) => definition.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
    ]);
    definitions[1]?.click();
    expect(definitions[1]?.getAttribute("aria-pressed")).toBe("true");
    (document.querySelector(".subjap-add-note") as HTMLButtonElement).click();
    const notes = document.querySelector<HTMLTextAreaElement>(".subjap-notes");
    if (!notes) throw new Error("Notes textarea was not rendered");
    notes.value = "personal note\n";
    notes.dispatchEvent(new Event("input", { bubbles: true }));

    (document.querySelector(".subjap-modal-btn-send") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect((document.querySelector("#subjap-mining-modal") as HTMLElement).style.display).toBe(
        "none",
      );
    });

    expect(sendMessageMock).toHaveBeenCalledWith(
      "mine:create",
      expect.objectContaining({ definitions: ["promise · a commitment", "vow"] }),
    );
    const ankiAddNoteCall = (sendMessageMock.mock.calls as unknown[][]).find(
      ([type]) => type === "anki:addNote",
    );
    expect(ankiAddNoteCall?.[1]).toMatchObject({
      fields: {
        Définitions: '<div class="sense">promise · a commitment</div><div class="sense">vow</div>',
        Notes: "personal note",
        Traduction: "I made a promise.",
      },
    });
  });

  it("captures Netflix phrase audio before sending the card", async () => {
    let releaseScreenshot: ((value: string) => void) | undefined;
    captureFrameMock.mockReturnValue(
      new Promise<string>((resolve) => {
        releaseScreenshot = resolve;
      }),
    );
    captureCueMock.mockResolvedValue("data:audio/wav;base64,phrase");
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "mine:create") return Promise.resolve({ id: "local-card" });
      if (type === "anki:setup") return Promise.resolve({ deckName: "SubJap", modelName: "Migaku Memory" });
      if (type === "anki:addNote") return Promise.resolve({ noteId: 42, modelName: "Migaku Memory" });
      return Promise.resolve(undefined);
    });

    const audioCapture = {
      captureCue: captureCueMock,
      captureSegment: vi.fn(),
      getTabVideo: vi.fn().mockResolvedValue(null),
      startTabCapture: vi.fn().mockResolvedValue(undefined),
    } as never;
    const modal = new MiningModal(document.createElement("video"), audioCapture);
    modal.open({
      cue: {
        cue: { id: "fixture", text: "約束した", start: 1, end: 2 },
        spans: [],
      } as unknown as RenderedCue,
      targetToken: {
        token: { surface: "約束", lemma: "約束", reading: "やくそく" },
      } as unknown as SpanToken,
      lemmaReading: "やくそく",
      episodeContext: {
        platform: "netflix",
        title: "Fixture",
        language: "ja",
        url: "https://example.test",
      } as unknown as EpisodeContext,
      senses: [],
    });

    await vi.waitFor(() => expect(captureFrameMock).toHaveBeenCalled());
    expect(captureCueMock).not.toHaveBeenCalled();
    releaseScreenshot?.("data:image/jpeg;base64,fixture");

    await vi.waitFor(() => {
      expect(captureCueMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: "fixture", start: 1, end: 2 }),
      );
      expect(document.querySelector<HTMLButtonElement>(".subjap-audio-control")?.disabled).toBe(
        false,
      );
    });
    await vi.waitFor(() => {
      expect((document.querySelector("#subjap-mining-modal") as HTMLElement).style.display).toBe("flex");
    });

    (document.querySelector(".subjap-modal-btn-send") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector("#subjap-mining-modal")?.getAttribute("style")).toContain("none"));
    expect(sendMessageMock).toHaveBeenCalledWith(
      "anki:addNote",
      expect.objectContaining({ audioPhraseDataUrl: "data:audio/wav;base64,phrase" }),
    );
  });

  it("creates the card without phrase audio when the cue end stays unknown", async () => {
    captureCueMock.mockResolvedValue(undefined);
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "mine:create") return Promise.resolve({ id: "local-card" });
      if (type === "anki:setup") {
        return Promise.resolve({ deckName: "SubJap", modelName: "Migaku Memory" });
      }
      if (type === "anki:addNote") {
        return Promise.resolve({ noteId: 42, modelName: "Migaku Memory" });
      }
      return Promise.resolve(undefined);
    });
    const captureSegment = vi.fn();
    const modal = new MiningModal(document.createElement("video"), {
      captureCue: captureCueMock,
      captureSegment,
      getTabVideo: vi.fn().mockResolvedValue(null),
    } as never);

    modal.open({
      cue: {
        cue: {
          id: "open",
          text: "未完了の字幕",
          start: 4,
          end: 4,
          endConfirmed: false,
        },
        spans: [],
      } as unknown as RenderedCue,
      targetToken: {
        token: { surface: "字幕", lemma: "字幕", reading: "じまく" },
      } as unknown as SpanToken,
      lemmaReading: "じまく",
      episodeContext: {
        platform: "netflix",
        title: "Fixture",
        language: "ja",
        url: "https://example.test",
      } as unknown as EpisodeContext,
      senses: [],
    });

    await vi.waitFor(() => expect(captureCueMock).toHaveBeenCalled());
    (document.querySelector(".subjap-modal-btn-send") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(
        (document.querySelector("#subjap-mining-modal") as HTMLElement).style
          .display,
      ).toBe("none");
    });

    expect(captureSegment).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith(
      "mine:create",
      expect.objectContaining({ audioDataUrl: undefined }),
    );
  });

  it("conserve la carte locale, affiche l’erreur Anki et réessaie sans doublon local", async () => {
    let setupAttempts = 0;
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "mine:create") return Promise.resolve({ id: "local-card" });
      if (type === "anki:setup") {
        setupAttempts++;
        return setupAttempts === 1
          ? Promise.reject(new Error("AnkiConnect indisponible"))
          : Promise.resolve({ deckName: "SubJap", modelName: "Migaku Memory" });
      }
      if (type === "anki:addNote") {
        return Promise.resolve({ noteId: 42, modelName: "Migaku Memory", deckName: "SubJap" });
      }
      return Promise.resolve(undefined);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const modal = new MiningModal(document.createElement("video"));
    try {
      modal.open({
        cue: {
          cue: { id: "fixture", text: "約束した", start: 1, end: 2 },
          spans: [{
            index: 0,
            token: { surface: "約束", lemma: "約束", reading: "やくそく", partOfSpeech: ["名詞"] },
            wordState: null,
          }],
        },
        targetToken: {
          index: 0,
          token: { surface: "約束", lemma: "約束", reading: "やくそく", partOfSpeech: ["名詞"] },
          wordState: null,
        },
        lemmaReading: "やくそく",
        episodeContext: {
          platform: "netflix",
          title: "Fixture",
          language: "ja",
          url: "https://example.test",
        },
        senses: [["promise"]],
      });
      await vi.waitFor(() => expect(document.querySelector(".subjap-scene-image img")).not.toBeNull());
      await vi.waitFor(() => {
        expect((document.querySelector("#subjap-mining-modal") as HTMLElement).style.display).toBe("flex");
      });
      (document.querySelector(".subjap-add-note") as HTMLButtonElement).click();
      const notes = document.querySelector<HTMLTextAreaElement>(".subjap-notes");
      if (!notes) throw new Error("Notes textarea was not rendered");
      notes.value = "keep this note for retry";
      notes.dispatchEvent(new Event("input", { bubbles: true }));
      (document.querySelector(".subjap-modal-btn-send") as HTMLButtonElement).click();
      await vi.waitFor(() => {
        expect(document.querySelector(".subjap-local-info")?.textContent).toContain("localement");
        expect(document.querySelector(".subjap-error")?.textContent).toContain("AnkiConnect");
      });
      expect(sendMessageMock.mock.calls.filter(([type]) => type === "mine:create")).toHaveLength(1);

      (document.querySelector(".subjap-modal-btn-send") as HTMLButtonElement).click();
      await vi.waitFor(() => {
        expect((document.querySelector("#subjap-mining-modal") as HTMLElement).style.display).toBe("none");
      });
      expect(sendMessageMock.mock.calls.filter(([type]) => type === "mine:create")).toHaveLength(1);
      const retryAnkiAddNoteCall = (sendMessageMock.mock.calls as unknown[][]).find(
        ([type]) => type === "anki:addNote",
      );
      expect(retryAnkiAddNoteCall?.[1]).toMatchObject({
        deckName: "SubJap",
        fields: { Notes: "keep this note for retry" },
      });
      expect(warn).toHaveBeenCalledWith(
        "[SubJap] Anki push failed (local card kept):",
        expect.any(Error),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
