import { describe, expect, it, vi } from "vitest";
import {
  NETFLIX_SEEK_RESULT_EVENT,
  handleNetflixSeek,
  installNetflixBridge,
  resolveNetflixPlayer,
} from "./netflix-bridge";

describe("Netflix page seek bridge", () => {
  it("selects the watch player session", () => {
    const watchPlayer = { seek: vi.fn() };
    const otherPlayer = { seek: vi.fn() };
    const page = {
      netflix: {
        appContext: {
          state: {
            playerApp: {
              getAPI: () => ({
                videoPlayer: {
                  getAllPlayerSessionIds: () => ["other", "watch-123"],
                  getVideoPlayerBySessionId: (id: string) =>
                    id === "watch-123" ? watchPlayer : otherPlayer,
                },
              }),
            },
          },
        },
      },
    } as unknown as Window;

    expect(resolveNetflixPlayer(page)).toBe(watchPlayer);
  });

  it("seeks and acknowledges a valid request", () => {
    const player = { seek: vi.fn(), play: vi.fn() };
    const page = {
      netflix: {
        appContext: {
          state: {
            playerApp: {
              getAPI: () => ({ videoPlayer: { getVideoPlayerBySessionId: () => player } }),
            },
          },
        },
      },
    } as unknown as Window;
    const onResult = vi.fn<(event: Event) => void>();
    document.addEventListener(NETFLIX_SEEK_RESULT_EVENT, onResult);

    handleNetflixSeek(
      new CustomEvent("subjap:netflix-seek", {
        detail: { source: "subjap", requestId: "request-1", timeMs: 9500, resume: true },
      }),
      document,
      page,
    );

    expect(player.seek).toHaveBeenCalledWith(9500);
    expect(player.play).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledOnce();
    const resultEvent = onResult.mock.calls[0]?.[0];
    expect(resultEvent).toBeDefined();
    const resultDetail = (resultEvent as CustomEvent<Record<string, unknown>>).detail;
    expect(resultDetail).toMatchObject({
      source: "subjap",
      requestId: "request-1",
      ok: true,
    });
    document.removeEventListener(NETFLIX_SEEK_RESULT_EVENT, onResult);
  });

  it("acknowledges false when Netflix is not ready", () => {
    const onResult = vi.fn<(event: Event) => void>();
    document.addEventListener(NETFLIX_SEEK_RESULT_EVENT, onResult);

    handleNetflixSeek(
      new CustomEvent("subjap:netflix-seek", {
        detail: { source: "subjap", requestId: "request-2", timeMs: 1000, resume: false },
      }),
      document,
      {} as Window,
    );

    const resultEvent = onResult.mock.calls[0]?.[0];
    expect(resultEvent).toBeDefined();
    const resultDetail = (resultEvent as CustomEvent<Record<string, unknown>>).detail;
    expect(resultDetail).toMatchObject({
      requestId: "request-2",
      ok: false,
    });
    document.removeEventListener(NETFLIX_SEEK_RESULT_EVENT, onResult);
  });

  it("installs the listener and marks the page bridge as ready", () => {
    const doc = document.implementation.createHTMLDocument("bridge");
    const onResult = vi.fn<(event: Event) => void>();
    doc.addEventListener(NETFLIX_SEEK_RESULT_EVENT, onResult);

    installNetflixBridge(doc, {} as Window);
    doc.dispatchEvent(
      new CustomEvent("subjap:netflix-seek", {
        detail: {
          source: "subjap",
          requestId: "request-3",
          timeMs: 1000,
          resume: false,
        },
      }),
    );

    expect(doc.documentElement.dataset.subjapNetflixBridge).toBe("ready");
    expect(onResult).toHaveBeenCalledOnce();
    expect(
      (onResult.mock.calls[0]?.[0] as CustomEvent<Record<string, unknown>>)
        .detail,
    ).toMatchObject({ requestId: "request-3", ok: false });
  });
});
