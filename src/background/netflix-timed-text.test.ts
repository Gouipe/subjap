import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNetflixTimedText } from "./netflix-timed-text";

describe("fetchNetflixTimedText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("télécharge la piste depuis le contexte du service worker", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBonjour", {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchNetflixTimedText({
        url: "https://cdn.nflxvideo.net/timedtext/fr.vtt",
        language: "fr-FR",
      }),
    ).resolves.toEqual({
      url: "https://cdn.nflxvideo.net/timedtext/fr.vtt",
      language: "fr-FR",
      body: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBonjour",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.nflxvideo.net/timedtext/fr.vtt",
      { credentials: "include", cache: "no-store" },
    );
  });

  it("refuse une URL qui ne provient pas de Netflix", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchNetflixTimedText({
        url: "https://cdn.example/timedtext/fr.vtt",
        language: "fr",
      }),
    ).rejects.toThrow("Unsupported Netflix timed-text host");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
