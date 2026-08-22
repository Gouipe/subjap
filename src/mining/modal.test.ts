import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeContext, RenderedCue, SpanToken } from "@/core/types";

const { captureFrameMock } = vi.hoisted(() => ({
  captureFrameMock: vi.fn(),
}));
const { sendMessageMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
}));

vi.mock("./capture", () => ({
  captureFrame: captureFrameMock,
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
    sendMessageMock.mockReset();
    sendMessageMock.mockResolvedValue({ dataUrl: "data:audio/wav;base64,fixture" });
    vi.stubGlobal(
      "Audio",
      class {
        play(): Promise<void> {
          return Promise.resolve();
        }
      },
    );
  });

  it("captures the video frame when the modal opens", async () => {
    const video = document.createElement("video");
    const modal = new MiningModal(video);
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
      definitions: ["promise"],
    });

    await vi.waitFor(() => {
      expect(captureFrameMock).toHaveBeenCalled();
      expect(captureFrameMock.mock.calls[0]?.[0]).toBe(video);
      expect(document.querySelector(".subjap-screenshot-info")?.textContent).toContain(
        "✓ Screenshot captured",
      );
      expect(sendMessageMock).toHaveBeenCalledWith("tts:generate", { text: "やくそく" });
      expect(document.querySelector(".subjap-audio-info")?.textContent).toContain(
        "✓ Word audio ready",
      );
    });
  });

  it("conserve la carte locale, affiche l’erreur Anki et réessaie sans doublon local", async () => {
    let setupAttempts = 0;
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "tts:generate") return Promise.resolve({ dataUrl: "data:audio/wav;base64,fixture" });
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
    const modal = new MiningModal(document.createElement("video"));
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
      definitions: ["promise"],
    });
    await vi.waitFor(() => expect(document.querySelector(".subjap-screenshot-info")).not.toBeNull());
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
    expect(sendMessageMock).toHaveBeenCalledWith(
      "anki:addNote",
      expect.objectContaining({ deckName: "SubJap" }),
    );
  });
});
