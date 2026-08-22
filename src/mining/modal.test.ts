import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeContext, RenderedCue, SpanToken } from "@/core/types";

const { captureFrameMock } = vi.hoisted(() => ({
  captureFrameMock: vi.fn(),
}));

vi.mock("./capture", () => ({
  captureFrame: captureFrameMock,
}));

vi.mock("@/core/messaging", () => ({
  sendMessage: vi.fn(),
}));

import { MiningModal } from "./modal";

describe("MiningModal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    captureFrameMock.mockReset();
    captureFrameMock.mockResolvedValue("data:image/jpeg;base64,fixture");
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
      episodeContext,
      definitions: ["promise"],
    });

    await vi.waitFor(() => {
      expect(captureFrameMock).toHaveBeenCalledWith(video);
      expect(document.querySelector(".subjap-screenshot-info")?.textContent).toContain(
        "✓ Screenshot captured",
      );
    });
  });
});
