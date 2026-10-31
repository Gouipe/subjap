import { beforeEach, describe, expect, it, vi } from "vitest";
import { GENERIC_HTML5_ADAPTER } from "@/core/adapters/registry";

function installVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  // The adapter only follows a rendered video.
  video.getBoundingClientRect = () => new DOMRect(0, 0, 640, 360);
  document.body.appendChild(video);
  return video;
}

describe("generic HTML5 adapter seeking", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("seeks and resumes playback", async () => {
    const video = installVideo();
    const play = vi.spyOn(video, "play").mockResolvedValue(undefined);

    await expect(GENERIC_HTML5_ADAPTER.seekTo(12, true)).resolves.toBe(true);

    expect(video.currentTime).toBe(12);
    expect(play).toHaveBeenCalledOnce();
  });

  it("seeks without resuming when requested", async () => {
    const video = installVideo();
    const play = vi.spyOn(video, "play").mockResolvedValue(undefined);

    await expect(GENERIC_HTML5_ADAPTER.seekTo(8, false)).resolves.toBe(true);

    expect(video.currentTime).toBe(8);
    expect(play).not.toHaveBeenCalled();
  });

  it("reports failure when no video exists", async () => {
    await expect(GENERIC_HTML5_ADAPTER.seekTo(8, true)).resolves.toBe(false);
  });
});
