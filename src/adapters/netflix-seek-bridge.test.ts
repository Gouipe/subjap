import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NETFLIX_SEEK_EVENT,
  NETFLIX_SEEK_RESULT_EVENT,
  NetflixSeekBridge,
} from "./netflix-seek-bridge";

describe("NetflixSeekBridge", () => {
  beforeEach(() => {
    document.documentElement.dataset.subjapNetflixBridge = "ready";
  });

  it("dispatches milliseconds and resolves a successful acknowledgement", async () => {
    const bridge = new NetflixSeekBridge(document, () => "extension://test/bridge.js");
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        requestId: string;
        timeMs: number;
        resume: boolean;
      };
      expect(detail.timeMs).toBe(12500);
      expect(detail.resume).toBe(true);
      document.dispatchEvent(
        new CustomEvent(NETFLIX_SEEK_RESULT_EVENT, {
          detail: { source: "subjap", requestId: detail.requestId, ok: true },
        }),
      );
    };
    document.addEventListener(NETFLIX_SEEK_EVENT, onRequest);

    await expect(bridge.seek(12.5, true)).resolves.toBe(true);

    document.removeEventListener(NETFLIX_SEEK_EVENT, onRequest);
  });

  it("returns false for invalid times", async () => {
    const bridge = new NetflixSeekBridge(document, () => "extension://test/bridge.js");

    await expect(bridge.seek(Number.NaN, true)).resolves.toBe(false);
    await expect(bridge.seek(-1, true)).resolves.toBe(false);
  });

  it("returns false when the bridge does not acknowledge", async () => {
    vi.useFakeTimers();
    const bridge = new NetflixSeekBridge(
      document,
      () => "extension://test/bridge.js",
      25,
    );

    const pending = bridge.seek(4, false);
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toBe(false);
    vi.useRealTimers();
  });

  it("serializes seek requests so Netflix never receives overlapping commands", async () => {
    const bridge = new NetflixSeekBridge(
      document,
      () => "extension://test/bridge.js",
      100,
    );
    const requestIds: string[] = [];
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent).detail as { requestId: string };
      requestIds.push(detail.requestId);
    };
    document.addEventListener(NETFLIX_SEEK_EVENT, onRequest);

    const first = bridge.seek(1, true);
    const second = bridge.seek(2, true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requestIds).toHaveLength(1);
    document.dispatchEvent(
      new CustomEvent(NETFLIX_SEEK_RESULT_EVENT, {
        detail: { source: "subjap", requestId: requestIds[0], ok: true },
      }),
    );
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requestIds).toHaveLength(2);
    document.dispatchEvent(
      new CustomEvent(NETFLIX_SEEK_RESULT_EVENT, {
        detail: { source: "subjap", requestId: requestIds[1], ok: true },
      }),
    );
    await expect(second).resolves.toBe(true);

    document.removeEventListener(NETFLIX_SEEK_EVENT, onRequest);
  });
});
